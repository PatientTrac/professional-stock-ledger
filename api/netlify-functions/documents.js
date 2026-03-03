// api/netlify-functions/documents.js
// Proxies file uploads to Supabase Storage using service_role key
// Frontend → Netlify → Supabase (private bucket, no public upload access)

const { authMiddleware } = require('./middleware/auth');
const { query } = require('./utils/db');
const Busboy = require('busboy');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    },
    body: JSON.stringify(body),
  };
}

/**
 * Parse multipart form data from Netlify event
 */
function parseMultipart(event) {
  return new Promise((resolve, reject) => {
    const contentType = event.headers['content-type'] || event.headers['Content-Type'];
    if (!contentType || !contentType.includes('multipart/form-data')) {
      return reject(new Error('Content-Type must be multipart/form-data'));
    }

    const busboy = Busboy({ headers: { 'content-type': contentType } });
    const fields = {};
    let fileData = null;
    let fileName = null;
    let fileContentType = null;

    busboy.on('field', (name, value) => {
      fields[name] = value;
    });

    busboy.on('file', (name, stream, info) => {
      fileName = info.filename;
      fileContentType = info.mimeType;
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => {
        fileData = Buffer.concat(chunks);
      });
    });

    busboy.on('finish', () => {
      resolve({ fields, fileData, fileName, fileContentType });
    });

    busboy.on('error', reject);

    // Netlify provides body as base64 when isBase64Encoded is true
    const bodyBuffer = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : Buffer.from(event.body, 'utf-8');

    busboy.end(bodyBuffer);
  });
}

/**
 * Upload file to Supabase Storage via REST API using service_role key
 */
async function uploadToStorage(filePath, fileBuffer, contentType) {
  const url = `${SUPABASE_URL}/storage/v1/object/aegisiq-storage/${filePath}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': contentType,
      'x-upsert': 'false',
    },
    body: fileBuffer,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Storage upload failed: ${res.status} ${errText}`);
  }

  return await res.json();
}

/**
 * Delete file from Supabase Storage via REST API
 */
async function deleteFromStorage(filePaths) {
  const url = `${SUPABASE_URL}/storage/v1/object/aegisiq-storage`;

  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prefixes: filePaths }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Storage delete failed: ${res.status} ${errText}`);
  }
}

/**
 * Get public URL for a file in storage
 */
function getPublicUrl(filePath) {
  return `${SUPABASE_URL}/storage/v1/object/public/aegisiq-storage/${filePath}`;
}

/* =====================================================
   HANDLER
===================================================== */
exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return json(204, null);
  }

  const params = event.queryStringParameters || {};
  const action = params.action;

  try {
    // Authenticate
    const authResult = await authMiddleware(event);
    if (authResult.statusCode) return authResult; // Auth failed

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, { success: false, error: 'Storage configuration missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.' });
    }

    // GET: List documents for a transaction
    if (event.httpMethod === 'GET' && action === 'list') {
      const { transaction_id, entity_id } = params;

      if (!transaction_id || !entity_id) {
        return json(400, { success: false, error: 'transaction_id and entity_id required' });
      }

      const result = await query(
        `SELECT * FROM transaction_documents 
         WHERE transaction_id = $1 AND entity_id = $2 
         ORDER BY created_at DESC`,
        [transaction_id, entity_id]
      );

      const docs = (result.rows || []).map((doc) => ({
        ...doc,
        url: getPublicUrl(doc.file_path),
      }));

      return json(200, { success: true, documents: docs });
    }

    // POST: Upload document
    if (event.httpMethod === 'POST') {
      const { fields, fileData, fileName, fileContentType } = await parseMultipart(event);
      const { transaction_id, entity_id } = fields;

      if (!fileData || !transaction_id || !entity_id) {
        return json(400, { success: false, error: 'file, transaction_id, and entity_id required' });
      }

      // Build storage path
      const timestamp = Date.now();
      const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      //const filePath = `${entity_id}/${transaction_id}/${timestamp}_${safeName}`;
	  const filePath = `${safeName}`;


      // Upload to Supabase Storage via service_role
      await uploadToStorage(filePath, fileData, fileContentType);

      // Record metadata in Neon DB
      const insertResult = await query(
        `INSERT INTO transaction_documents 
         (transaction_id, entity_id, file_name, file_path, file_size, content_type, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          parseInt(transaction_id),
          parseInt(entity_id),
          fileName,
          filePath,
          fileData.length,
          fileContentType,
          authResult.user.id,
        ]
      );

      const docRecord = insertResult.rows[0];

      return json(201, {
        success: true,
        document: { ...docRecord, url: getPublicUrl(filePath) },
      });
    }

    // DELETE: Remove document
    if (event.httpMethod === 'DELETE') {
      const body = JSON.parse(event.body || '{}');
      const { document_id, file_path } = body;

      if (!document_id || !file_path) {
        return json(400, { success: false, error: 'document_id and file_path required' });
      }

      // Delete from Supabase Storage
      await deleteFromStorage([file_path]);

      // Delete metadata from Neon DB
      await query('DELETE FROM transaction_documents WHERE id = $1', [document_id]);

      return json(200, { success: true });
    }

    return json(405, { success: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('Document handler error:', error);
    return json(500, { success: false, error: error.message });
  }
};
