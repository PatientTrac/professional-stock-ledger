/**
 * AegisIQ Stock Ledger - Shareholders API
 * CRUD operations for shareholders
 */
const { query } = require('./utils/db');
const { authMiddleware, requireRole, enforceEntityScope } = require('./middleware/auth');

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  };
}

function parseBody(event) {
  if (!event.body) return {};
  try { return JSON.parse(event.body); }
  catch { throw new Error('Invalid JSON in request body'); }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return json(200, { success: true }, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    });
  }
  const params = event.queryStringParameters || {};
  const action = params.action;

  console.log('SHAREHOLDERS:', { method: event.httpMethod, action });

  try {
    if (event.httpMethod === 'GET') {
      if (action === 'list') return await handleListShareholders(event, params);
      if (action === 'get') return await handleGetShareholder(event, params);
      return json(400, { success: false, error: 'Invalid action' });
    }

    if (event.httpMethod === 'POST') {
      if (action === 'create') return await handleCreateShareholder(event);
      return json(400, { success: false, error: 'Invalid action' });
    }

    if (event.httpMethod === 'PUT') {
      if (action === 'update') return await handleUpdateShareholder(event);
      return json(400, { success: false, error: 'Invalid action' });
    }

    if (event.httpMethod === 'DELETE') {
      if (action === 'delete') return await handleDeleteShareholder(event, params);
      return json(400, { success: false, error: 'Invalid action' });
    }

    return json(405, { success: false, error: 'Method not allowed' });
  } catch (e) {
    console.error('SHAREHOLDERS ERROR:', e);
    return json(500, { success: false, error: 'Server error: ' + e.message });
  }
};

// -----------------------------------
// GET list - List shareholders for entity
// -----------------------------------
async function handleListShareholders(event, params) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  const entityId = user.role === 'SUPER_ADMIN' && params.entity_id 
    ? params.entity_id 
    : user.entity_id;

  const includeInactive = params.include_inactive === 'true';

  try {
    let q = `
      SELECT 
        s.id,
        s.entity_id,
        s.external_id,
        s.full_name,
        s.email,
        s.phone,
        s.address,
        s.city,
        s.state,
        s.zip_code,
        s.country,
        s.shareholder_type,
        s.tax_id,
        s.is_active,
        s.created_at,
        s.updated_at
      FROM shareholders s
      WHERE s.entity_id = $1
    `;
    const qParams = [entityId];

    if (!includeInactive) {
      q += ` AND s.is_active = TRUE`;
    }

    q += ` ORDER BY s.full_name`;

    const result = await query(q, qParams);
    return json(200, { success: true, shareholders: result.rows }, headers);
  } catch (e) {
    console.error('List shareholders error:', e);
    return json(500, { success: false, error: 'Failed to list shareholders: ' + e.message }, headers);
  }
}

// -----------------------------------
// GET get - Get single shareholder
// -----------------------------------
async function handleGetShareholder(event, params) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  const { id } = params;
  if (!id) return json(400, { success: false, error: 'Shareholder ID is required' }, headers);

  try {
    const result = await query(
      `
      SELECT 
        s.id,
        s.entity_id,
        s.external_id,
        s.full_name,
        s.email,
        s.phone,
        s.address,
        s.city,
        s.state,
        s.zip_code,
        s.country,
        s.shareholder_type,
        s.tax_id,
        s.is_active,
        s.created_at,
        s.updated_at
      FROM shareholders s
      WHERE s.id = $1
      `,
      [id]
    );

    if (!result.rows.length) {
      return json(404, { success: false, error: 'Shareholder not found' }, headers);
    }

    const shareholder = result.rows[0];

    // Enforce entity scope
    if (!enforceEntityScope(user, shareholder.entity_id)) {
      return json(403, { success: false, error: 'Forbidden' }, headers);
    }

    return json(200, { success: true, shareholder }, headers);
  } catch (e) {
    console.error('Get shareholder error:', e);
    return json(500, { success: false, error: 'Failed to get shareholder: ' + e.message }, headers);
  }
}

// -----------------------------------
// POST create - Create new shareholder
// -----------------------------------
async function handleCreateShareholder(event) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  // Only ADMIN and SUPER_ADMIN can create shareholders
  if (!requireRole(['SUPER_ADMIN', 'ADMIN'])(user)) {
    return json(403, { success: false, error: 'Forbidden: Insufficient permissions' }, headers);
  }

  const body = parseBody(event);
  const {
    full_name,
    email,
    phone,
    address,
    city,
    state,
    zip_code,
    country,
    shareholder_type,
    tax_id,
    external_id,
    entity_id
  } = body;

  if (!full_name) {
    return json(400, { success: false, error: 'Shareholder name is required' }, headers);
  }

  // Determine target entity
  const targetEntityId = user.role === 'SUPER_ADMIN' && entity_id 
    ? entity_id 
    : user.entity_id;

  // Enforce entity scope
  if (!enforceEntityScope(user, targetEntityId)) {
    return json(403, { success: false, error: 'Forbidden: Cannot create shareholders for this entity' }, headers);
  }

  try {
    // Generate external_id if not provided
    let finalExternalId = external_id;
    if (!finalExternalId) {
      const countResult = await query(
        'SELECT COUNT(*) as cnt FROM shareholders WHERE entity_id = $1',
        [targetEntityId]
      );
      const count = parseInt(countResult.rows[0].cnt) + 1;
      finalExternalId = `SH-${String(count).padStart(6, '0')}`;
    }

    const result = await query(
      `
      INSERT INTO shareholders (
        entity_id, external_id, full_name, email, phone, address,
        city, state, zip_code, country, shareholder_type, tax_id, is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, TRUE)
      RETURNING *
      `,
      [
        targetEntityId,
        finalExternalId,
        full_name,
        email || null,
        phone || null,
        address || null,
        city || null,
        state || null,
        zip_code || null,
        country || 'US',
        shareholder_type || 'INDIVIDUAL',
        tax_id || null
      ]
    );

    const shareholder = result.rows[0];
						 
											 

    return json(201, { success: true, shareholder }, headers);
  } catch (e) {
    console.error('Create shareholder error:', e);
    return json(500, { success: false, error: 'Failed to create shareholder: ' + e.message }, headers);
  }
}

// -----------------------------------
// PUT update - Update shareholder
// -----------------------------------
async function handleUpdateShareholder(event) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  // Only ADMIN and SUPER_ADMIN can update shareholders
  if (!requireRole(['SUPER_ADMIN', 'ADMIN'])(user)) {
    return json(403, { success: false, error: 'Forbidden: Insufficient permissions' }, headers);
  }

  const body = parseBody(event);
  const { id, ...updates } = body;

  if (!id) {
    return json(400, { success: false, error: 'Shareholder ID is required' }, headers);
  }

  // Check shareholder exists and belongs to correct entity
  const existing = await query('SELECT id, entity_id FROM shareholders WHERE id = $1', [id]);
  if (!existing.rows.length) {
    return json(404, { success: false, error: 'Shareholder not found' }, headers);
  }

  const shareholder = existing.rows[0];
  if (!enforceEntityScope(user, shareholder.entity_id)) {
    return json(403, { success: false, error: 'Forbidden: Cannot update this shareholder' }, headers);
  }

  const allowedFields = new Set([
    'full_name', 'external_id', 'email', 'phone', 'address', 'city', 'state',
    'zip_code', 'country', 'shareholder_type', 'tax_id', 'is_active'
  ]);

  const keys = Object.keys(updates).filter(k => allowedFields.has(k));
  if (!keys.length) {
    return json(400, { success: false, error: 'No valid fields to update' }, headers);
  }

  try {
    const sets = [];
    const paramsArr = [];
    let i = 0;

    for (const k of keys) {
      i++;
      sets.push(`${k} = $${i}`);
      paramsArr.push(updates[k]);
    }

    sets.push('updated_at = CURRENT_TIMESTAMP');
    i++;
    paramsArr.push(id);

    const q = `
      UPDATE shareholders
      SET ${sets.join(', ')}
      WHERE id = $${i}
      RETURNING *
    `;

    const result = await query(q, paramsArr);
    const updated = result.rows[0];
									 

    return json(200, { success: true, shareholder: updated }, headers);
  } catch (e) {
    console.error('Update shareholder error:', e);
    return json(500, { success: false, error: 'Failed to update shareholder: ' + e.message }, headers);
  }
}

// -----------------------------------
// DELETE delete - Soft delete shareholder
// -----------------------------------
async function handleDeleteShareholder(event, params) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  // Only SUPER_ADMIN can delete shareholders
  if (!requireRole(['SUPER_ADMIN'])(user)) {
    return json(403, { success: false, error: 'Forbidden: Only SUPER_ADMIN can delete shareholders' }, headers);
  }

  const { id } = params;
  if (!id) {
    return json(400, { success: false, error: 'Shareholder ID is required' }, headers);
  }

  try {
    // Check for existing transactions
    const txCheck = await query(
      'SELECT COUNT(*) as cnt FROM share_transactions WHERE shareholder_id = $1',
      [id]
    );
    
    if (parseInt(txCheck.rows[0].cnt) > 0) {
      // Soft delete only if transactions exist
      await query(
        'UPDATE shareholders SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
        [id]
      );
      return json(200, { success: true, message: 'Shareholder deactivated (has transactions)' }, headers);
    }

    // Hard delete if no transactions
    await query('DELETE FROM shareholders WHERE id = $1', [id]);
    return json(200, { success: true, message: 'Shareholder deleted' }, headers);
  } catch (e) {
    console.error('Delete shareholder error:', e);
    return json(500, { success: false, error: 'Failed to delete shareholder: ' + e.message }, headers);
  }
}
