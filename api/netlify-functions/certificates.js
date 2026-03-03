// api/netlify-functions/certificates.js
// Stock Certificate management: generate, list, cancel, reissue, download PDF
// Architecture: Frontend → Netlify → Neon DB + Supabase Storage

const { query, withTransaction } = require('./utils/db');
const { authMiddleware, requireRole, enforceEntityScope } = require('./middleware/auth');
const { logAudit, getClientIp } = require('./utils/auditLog');

const {
  pad, abbrevStockType, numberToWords,
  generateCertificateNumber, generateCertificatePdf, uploadPdfToStorage,
} = require('./utils/certificateUtils');
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
  catch { throw new Error('Invalid JSON body'); }
}

/* Generate Lost Certificate Affidavit PDF
 */
async function generateAffidavitPdf({
  companyName, companyAddress, shareholderName, shareholderAddress,
  lostCertificateNumber, replacementCertificateNumber,
  shares, stockType, stockSeries, affidavitDate,
  narrative, signerName, signerTitle, notaryState, notaryCounty
}) {
  let PDFDocument, StandardFonts, rgb;
  try {
    const pdfLib = require('pdf-lib');
    PDFDocument = pdfLib.PDFDocument;
    StandardFonts = pdfLib.StandardFonts;
    rgb = pdfLib.rgb;
  } catch (e) {
    throw new Error('pdf-lib not available');
  }

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]); // Portrait letter
  const { width, height } = page.getSize();
  const font = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const fontBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  const margin = 54;
  let y = height - margin;
  const darkBlue = rgb(0.05, 0.1, 0.25);
  const gray = rgb(0.4, 0.4, 0.4);

  // Title
  const title = 'LOST STOCK CERTIFICATE AFFIDAVIT';
  page.drawText(title, { x: margin, y: y - 10, size: 16, font: fontBold, color: darkBlue });
  y -= 40;

  // Company info
  page.drawText(companyName || '____________________________', { x: margin, y, size: 12, font: fontBold, color: darkBlue });
  y -= 16;
  if (companyAddress) {
    page.drawText(companyAddress, { x: margin, y, size: 10, font, color: gray });
    y -= 16;
  }
  y -= 10;

  // Affiant info
  page.drawText('AFFIANT (REGISTERED OWNER):', { x: margin, y, size: 11, font: fontBold, color: darkBlue });
  y -= 18;
  page.drawText(shareholderName || '____________________________', { x: margin, y, size: 11, font, color: darkBlue });
  y -= 16;
  if (shareholderAddress) {
    page.drawText(shareholderAddress, { x: margin, y, size: 10, font, color: gray });
    y -= 16;
  }
  y -= 12;

  // Certificate details
  page.drawText('Certificate details:', { x: margin, y, size: 11, font: fontBold, color: darkBlue });
  y -= 18;
  page.drawText(`Lost Certificate Number: ${lostCertificateNumber || '__________________'}`, { x: margin, y, size: 11, font, color: darkBlue });
  y -= 16;
  page.drawText(`Replacement Certificate Number: ${replacementCertificateNumber || '________________'}`, { x: margin, y, size: 11, font, color: darkBlue });
  y -= 16;
  page.drawText(`Shares: ${shares ? Number(shares).toLocaleString() : '________'}`, { x: margin, y, size: 11, font, color: darkBlue });
  y -= 16;
  const classText = stockSeries ? `${stockType} (${stockSeries})` : (stockType || '________');
  page.drawText(`Class/Series: ${classText}`, { x: margin, y, size: 11, font, color: darkBlue });
  y -= 24;

  // Statement of loss
  page.drawText('STATEMENT OF LOSS:', { x: margin, y, size: 11, font: fontBold, color: darkBlue });
  y -= 18;

  const defaultNarrative = 'The undersigned affiant states under penalty of perjury that the above-referenced stock certificate has been lost, misplaced, or destroyed and cannot be located after a diligent search. The affiant has not endorsed, assigned, pledged, transferred, or otherwise disposed of the certificate. The affiant agrees to surrender the certificate immediately to the corporation if it is later found and agrees to indemnify and hold harmless the corporation from any claim arising out of the original certificate.';
  const text = narrative || defaultNarrative;

  // Word wrap
  const maxLen = 95;
  const words = text.split(/\s+/);
  const lines = [];
  let line = [];
  let len = 0;
  for (const w of words) {
    if (len + w.length + 1 > maxLen) {
      lines.push(line.join(' '));
      line = [w]; len = w.length;
    } else {
      line.push(w); len += w.length + 1;
    }
  }
  if (line.length) lines.push(line.join(' '));

  for (const l of lines) {
    if (y < margin + 220) break;
    page.drawText(l, { x: margin, y, size: 11, font, color: darkBlue });
    y -= 14;
  }
  y -= 8;

  // Date
  page.drawText(`Date: ${affidavitDate || '________________'}`, { x: margin, y, size: 11, font, color: darkBlue });
  y -= 34;

  // Signature
  page.drawText('AFFIANT SIGNATURE:', { x: margin, y, size: 11, font: fontBold, color: darkBlue });
  y -= 24;
  page.drawLine({ start: { x: margin, y }, end: { x: margin + 360, y }, thickness: 1, color: darkBlue });
  page.drawText(signerName || '____________________________', { x: margin, y: y - 16, size: 11, font, color: darkBlue });
  page.drawText(signerTitle || 'Registered Owner', { x: margin, y: y - 32, size: 10, font, color: gray });
  y -= 64;

  // Notary block
  page.drawText('NOTARY ACKNOWLEDGMENT:', { x: margin, y, size: 11, font: fontBold, color: darkBlue });
  y -= 18;
  page.drawText(`State of ${notaryState || '__________'}    County of ${notaryCounty || '__________'}`, { x: margin, y, size: 11, font, color: darkBlue });
  y -= 16;
  page.drawText('Subscribed and sworn before me on __________________ by the affiant named above.', { x: margin, y, size: 11, font, color: darkBlue });
  y -= 34;
  page.drawLine({ start: { x: margin, y }, end: { x: margin + 300, y }, thickness: 1, color: darkBlue });
  page.drawText('Notary Public', { x: margin, y: y - 16, size: 10, font, color: gray });
  page.drawText('My commission expires: __________________', { x: margin, y: y - 32, size: 10, font, color: gray });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

/* ========== HANDLER ========== */
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return json(204, null, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    });
  }

  const params = event.queryStringParameters || {};
  const action = params.action;

  try {
    const auth = await authMiddleware(event);
    if (auth.statusCode) return auth;
    const { user, headers } = auth;

    /* ===== GET: List certificates ===== */
    if (event.httpMethod === 'GET' && action === 'list') {
      const { entity_id, shareholder_id, status: filterStatus } = params;
      const targetEntityId = user.role === 'SUPER_ADMIN' && entity_id ? entity_id : user.entity_id;

      let q = `
        SELECT sc.*, 
               sh.full_name AS shareholder_name,
               e.name AS entity_name,
               est.stock_type, est.display_name AS stock_type_name,
               ess.series
        FROM stock_certificates sc
        JOIN shareholders sh ON sh.id = sc.shareholder_id
        JOIN entities e ON e.id = sc.entity_id
        JOIN entity_stock_types est ON est.id = sc.entity_stock_type_id
        LEFT JOIN entity_stock_series ess ON ess.id = sc.entity_stock_series_id
        WHERE sc.entity_id = $1
      `;
      const qParams = [targetEntityId];
      let idx = 1;

      if (shareholder_id) {
        idx++;
        q += ` AND sc.shareholder_id = $${idx}`;
        qParams.push(shareholder_id);
      }
      if (filterStatus) {
        idx++;
        q += ` AND sc.status = $${idx}`;
        qParams.push(filterStatus);
      }

      q += ` ORDER BY sc.created_at DESC`;

      const result = await query(q, qParams);
      return json(200, { success: true, certificates: result.rows }, headers);
    }

    /* ===== GET: Download certificate PDF ===== */
    if (event.httpMethod === 'GET' && action === 'download') {
      const { certificate_id } = params;
      if (!certificate_id) return json(400, { success: false, error: 'certificate_id required' }, headers);

      const certRes = await query(`
        SELECT sc.*, 
               sh.full_name AS shareholder_name, sh.address AS sh_address, sh.city AS sh_city, sh.state AS sh_state, sh.zip_code AS sh_zip, sh.country AS sh_country,
               e.name AS entity_name, e.address AS e_address, e.city AS e_city, e.state AS e_state, e.zip_code AS e_zip, e.country AS e_country,
               est.stock_type, est.display_name AS stock_type_name,
               ess.series
        FROM stock_certificates sc
        JOIN shareholders sh ON sh.id = sc.shareholder_id
        JOIN entities e ON e.id = sc.entity_id
        JOIN entity_stock_types est ON est.id = sc.entity_stock_type_id
        LEFT JOIN entity_stock_series ess ON ess.id = sc.entity_stock_series_id
        WHERE sc.id = $1
      `, [certificate_id]);

      if (!certRes.rows.length) return json(404, { success: false, error: 'Certificate not found' }, headers);

      const cert = certRes.rows[0];
      if (!enforceEntityScope(user, cert.entity_id)) {
        return json(403, { success: false, error: 'Forbidden' }, headers);
      }

      const shAddress = [cert.sh_address, cert.sh_city, cert.sh_state, cert.sh_zip, cert.sh_country].filter(Boolean).join(', ');
      const eAddress = [cert.e_address, cert.e_city, cert.e_state, cert.e_zip, cert.e_country].filter(Boolean).join(', ');

      const pdfBuffer = await generateCertificatePdf({
        ...cert,
        shareholder_address: shAddress,
        entity_address: eAddress,
        stock_series: cert.series,
      });

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${cert.certificate_number}.pdf"`,
          ...headers,
        },
        body: pdfBuffer.toString('base64'),
        isBase64Encoded: true,
      };
    }

    /* ===== POST: Generate certificate ===== */
    if (event.httpMethod === 'POST' && action === 'generate') {
      if (!requireRole(['SUPER_ADMIN', 'ENTITY_ADMIN'])(user)) {
        return json(403, { success: false, error: 'Forbidden: Only admins can issue certificates' }, headers);
      }

      const body = parseBody(event);
      const {
        shareholder_id,
        entity_stock_type_id,
        entity_stock_series_id,
        shares,
        issue_date,
        share_transaction_id,
        signed_by_name,
        signed_by_title,
        countersigned_by_name,
        countersigned_by_title,
      } = body;

      if (!shareholder_id || !entity_stock_type_id || !shares) {
        return json(400, { success: false, error: 'shareholder_id, entity_stock_type_id, and shares are required' }, headers);
      }

      const entityId = user.entity_id;

      // Validate shareholder belongs to entity
      const shRes = await query('SELECT id, full_name, address, city, state, zip_code, country FROM shareholders WHERE id = $1 AND entity_id = $2', [shareholder_id, entityId]);
      if (!shRes.rows.length) return json(404, { success: false, error: 'Shareholder not found' }, headers);

      // Validate stock type
      const stRes = await query('SELECT id, stock_type, display_name FROM entity_stock_types WHERE id = $1 AND entity_id = $2', [entity_stock_type_id, entityId]);
      if (!stRes.rows.length) return json(404, { success: false, error: 'Stock type not found' }, headers);

      // Get entity info
      const entRes = await query('SELECT name, address, city, state, zip_code, country FROM entities WHERE id = $1', [entityId]);
      const entity = entRes.rows[0];
      const stockType = stRes.rows[0];
      const shareholder = shRes.rows[0];

      // Get series info if applicable
      let seriesName = null;
      if (entity_stock_series_id) {
        const serRes = await query('SELECT series FROM entity_stock_series WHERE id = $1', [entity_stock_series_id]);
        seriesName = serRes.rows[0]?.series || null;
      }

      // Generate certificate number inside transaction (using dedicated client)
      const cert = await withTransaction(async (client) => {
	 
        const certNumber = await generateCertificateNumber(client, entityId, entity.name, abbrevStockType(stockType.stock_type));

        const insertRes = await client.query(`
          INSERT INTO stock_certificates (
            entity_id, shareholder_id, share_transaction_id,
            entity_stock_type_id, entity_stock_series_id,
            certificate_number, shares, issue_date, status,
            original_issue_date,
            signed_by_name, signed_by_title,
            countersigned_by_name, countersigned_by_title,
            created_by
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::date, CURRENT_DATE),'ISSUED',
                    COALESCE($8::date, CURRENT_DATE),
                    $9,$10,$11,$12,$13)
          RETURNING *
        `, [
          entityId, shareholder_id, share_transaction_id || null,
          entity_stock_type_id, entity_stock_series_id || null,
          certNumber, shares, issue_date || null,
          signed_by_name || null, signed_by_title || null,
          countersigned_by_name || null, countersigned_by_title || null,
          user.id,
        ]);

        return insertRes.rows[0];
      });

        // Generate and upload PDF (non-blocking, best-effort)
        const shAddress = [shareholder.address, shareholder.city, shareholder.state, shareholder.zip_code, shareholder.country].filter(Boolean).join(', ');
        const eAddress = [entity.address, entity.city, entity.state, entity.zip_code, entity.country].filter(Boolean).join(', ');

        try {
          const pdfBuffer = await generateCertificatePdf({
            entity_name: entity.name,
            entity_address: eAddress,
            certificate_number: cert.certificate_number,
            shareholder_name: shareholder.full_name,
            shareholder_address: shAddress,
            shares,
            stock_type: stockType.display_name,
            stock_series: seriesName,
            issue_date: cert.issue_date,
            signed_by_name, signed_by_title,
            countersigned_by_name, countersigned_by_title,
          });

          const pdfPath = `certificates/${entityId}/${cert.certificate_number}.pdf`;
          await uploadPdfToStorage(pdfPath, pdfBuffer);
          await query('UPDATE stock_certificates SET pdf_path = $1 WHERE id = $2', [pdfPath, cert.id]);
          cert.pdf_path = pdfPath;
        } catch (pdfErr) {
          console.error('PDF generation error (non-fatal):', pdfErr.message);
        }

        await logAudit({
          user_id: user.id, user_email: user.email, user_role: user.role,
          entity_id: entityId, action: 'GENERATE_CERTIFICATE',
          resource_type: 'STOCK_CERTIFICATE', resource_id: cert.id,
          details: { certificate_number: cert.certificate_number, shareholder_id, shares, stock_type: stockType.display_name },
          ip_address: getClientIp(event),
        });

        return json(201, { success: true, certificate: cert }, headers);
	
    }

    /* ===== POST: Cancel certificate ===== */
    if (event.httpMethod === 'POST' && action === 'cancel') {
      if (!requireRole(['SUPER_ADMIN', 'ENTITY_ADMIN'])(user)) {
        return json(403, { success: false, error: 'Forbidden' }, headers);
      }

      const body = parseBody(event);
      const { certificate_id, reason } = body;
      if (!certificate_id) return json(400, { success: false, error: 'certificate_id required' }, headers);

      const certRes = await query('SELECT * FROM stock_certificates WHERE id = $1', [certificate_id]);
      if (!certRes.rows.length) return json(404, { success: false, error: 'Certificate not found' }, headers);

      const cert = certRes.rows[0];
      if (!enforceEntityScope(user, cert.entity_id)) return json(403, { success: false, error: 'Forbidden' }, headers);
      if (cert.status === 'CANCELLED') return json(400, { success: false, error: 'Certificate is already cancelled' }, headers);

      await query(
        `UPDATE stock_certificates SET status = 'CANCELLED', cancelled_at = NOW(), cancelled_reason = $1, updated_at = NOW() WHERE id = $2`,
        [reason || 'Cancelled by administrator', certificate_id]
      );

      await logAudit({
        user_id: user.id, user_email: user.email, user_role: user.role,
        entity_id: cert.entity_id, action: 'CANCEL_CERTIFICATE',
        resource_type: 'STOCK_CERTIFICATE', resource_id: certificate_id,
        details: { certificate_number: cert.certificate_number, reason },
        ip_address: getClientIp(event),
      });

      return json(200, { success: true, message: 'Certificate cancelled' }, headers);
    }

    /* ===== POST: Reissue certificate (cancel old + create new) ===== */
    if (event.httpMethod === 'POST' && action === 'reissue') {
      if (!requireRole(['SUPER_ADMIN', 'ENTITY_ADMIN'])(user)) {
        return json(403, { success: false, error: 'Forbidden' }, headers);
      }

      const body = parseBody(event);
      const { certificate_id, reason, new_shareholder_id, new_shares } = body;
      if (!certificate_id) return json(400, { success: false, error: 'certificate_id required' }, headers);

      const certRes = await query(`
        SELECT sc.*, e.name AS entity_name, e.address AS e_address, e.city AS e_city, e.state AS e_state, e.zip_code AS e_zip, e.country AS e_country,
               est.stock_type, est.display_name AS stock_type_name
        FROM stock_certificates sc
        JOIN entities e ON e.id = sc.entity_id
        JOIN entity_stock_types est ON est.id = sc.entity_stock_type_id
        WHERE sc.id = $1
      `, [certificate_id]);
      if (!certRes.rows.length) return json(404, { success: false, error: 'Certificate not found' }, headers);

      const oldCert = certRes.rows[0];
      if (!enforceEntityScope(user, oldCert.entity_id)) return json(403, { success: false, error: 'Forbidden' }, headers);
      if (oldCert.status === 'CANCELLED') return json(400, { success: false, error: 'Cannot reissue a cancelled certificate' }, headers);

      const targetShareholderId = new_shareholder_id || oldCert.shareholder_id;
      const targetShares = new_shares || oldCert.shares;

      // Get shareholder info
      const shRes = await query('SELECT id, full_name, address, city, state, zip_code, country FROM shareholders WHERE id = $1', [targetShareholderId]);
      if (!shRes.rows.length) return json(404, { success: false, error: 'Shareholder not found' }, headers);
      const shareholder = shRes.rows[0];

      // Get series
      let seriesName = null;
      if (oldCert.entity_stock_series_id) {
        const serRes = await query('SELECT series FROM entity_stock_series WHERE id = $1', [oldCert.entity_stock_series_id]);
        seriesName = serRes.rows[0]?.series || null;
      }

      const newCert = await withTransaction(async (client) => {
	 
        // Cancel old certificate
        await client.query(
          `UPDATE stock_certificates SET status = 'CANCELLED', cancelled_at = NOW(), cancelled_reason = $1, updated_at = NOW() WHERE id = $2`,
          [reason || 'Replaced by reissued certificate', certificate_id]
        );

        // Generate new certificate
        const newCertNumber = await generateCertificateNumber(client, oldCert.entity_id, oldCert.entity_name, abbrevStockType(oldCert.stock_type));

        const insertRes = await client.query(`
          INSERT INTO stock_certificates (
            entity_id, shareholder_id, share_transaction_id,
            entity_stock_type_id, entity_stock_series_id,
            certificate_number, shares, issue_date, status,
            original_issue_date, source_certificate_id,
            signed_by_name, signed_by_title,
            countersigned_by_name, countersigned_by_title,
            created_by
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_DATE,'ISSUED',
                    COALESCE($8::date, CURRENT_DATE), $9,
                    $10,$11,$12,$13,$14)
          RETURNING *
        `, [
          oldCert.entity_id, targetShareholderId, oldCert.share_transaction_id,
          oldCert.entity_stock_type_id, oldCert.entity_stock_series_id,
          newCertNumber, targetShares,
          oldCert.original_issue_date || oldCert.issue_date, certificate_id,
          oldCert.signed_by_name, oldCert.signed_by_title,
          oldCert.countersigned_by_name, oldCert.countersigned_by_title,
          user.id,
        ]);

        const nc = insertRes.rows[0];

        // Link old → new
        await client.query('UPDATE stock_certificates SET replaced_by_certificate_id = $1 WHERE id = $2', [nc.id, certificate_id]);

        return nc;
      });

        // Generate PDF for new certificate
        const shAddress = [shareholder.address, shareholder.city, shareholder.state, shareholder.zip_code, shareholder.country].filter(Boolean).join(', ');
        const eAddress = [oldCert.e_address, oldCert.e_city, oldCert.e_state, oldCert.e_zip, oldCert.e_country].filter(Boolean).join(', ');

        try {
          const pdfBuffer = await generateCertificatePdf({
            entity_name: oldCert.entity_name,
            entity_address: eAddress,
            certificate_number: newCert.certificate_number,
            shareholder_name: shareholder.full_name,
            shareholder_address: shAddress,
            shares: targetShares,
            stock_type: oldCert.stock_type_name,
            stock_series: seriesName,
            issue_date: newCert.issue_date,
            signed_by_name: oldCert.signed_by_name,
            signed_by_title: oldCert.signed_by_title,
            countersigned_by_name: oldCert.countersigned_by_name,
            countersigned_by_title: oldCert.countersigned_by_title,
          });

          const pdfPath = `certificates/${oldCert.entity_id}/${newCert.certificate_number}.pdf`;
          await uploadPdfToStorage(pdfPath, pdfBuffer);
          await query('UPDATE stock_certificates SET pdf_path = $1 WHERE id = $2', [pdfPath, newCert.id]);
          newCert.pdf_path = pdfPath;
        } catch (pdfErr) {
          console.error('PDF generation error (non-fatal):', pdfErr.message);
        }

        await logAudit({
          user_id: user.id, user_email: user.email, user_role: user.role,
          entity_id: oldCert.entity_id, action: 'REISSUE_CERTIFICATE',
          resource_type: 'STOCK_CERTIFICATE', resource_id: newCert.id,
          details: { old_certificate_id: certificate_id, old_number: oldCert.certificate_number, new_number: newCert.certificate_number, reason },
          ip_address: getClientIp(event),
        });

        return json(201, { success: true, old_certificate_id: certificate_id, new_certificate: newCert }, headers);
	
    }

    /* ===== POST: Report Lost Certificate (mark old REPLACED + create new with lost_certificate_* fields) ===== */
    if (event.httpMethod === 'POST' && action === 'report-lost') {
      if (!requireRole(['SUPER_ADMIN', 'ENTITY_ADMIN'])(user)) {
        return json(403, { success: false, error: 'Forbidden' }, headers);
      }

      const body = parseBody(event);
      const { certificate_id, signed_by_name, signed_by_title, countersigned_by_name, countersigned_by_title } = body;
      if (!certificate_id) return json(400, { success: false, error: 'certificate_id required' }, headers);

      const certRes = await query(`
        SELECT sc.*, e.name AS entity_name, e.address AS e_address, e.city AS e_city, e.state AS e_state, e.zip_code AS e_zip, e.country AS e_country,
               est.stock_type, est.display_name AS stock_type_name
        FROM stock_certificates sc
        JOIN entities e ON e.id = sc.entity_id
        JOIN entity_stock_types est ON est.id = sc.entity_stock_type_id
        WHERE sc.id = $1
      `, [certificate_id]);
      if (!certRes.rows.length) return json(404, { success: false, error: 'Certificate not found' }, headers);

      const lostCert = certRes.rows[0];
      if (!enforceEntityScope(user, lostCert.entity_id)) return json(403, { success: false, error: 'Forbidden' }, headers);
      if (lostCert.status !== 'ISSUED') return json(400, { success: false, error: `Cannot report lost: certificate status is '${lostCert.status}'` }, headers);

      // Get shareholder info
      const shRes = await query('SELECT id, full_name, address, city, state, zip_code, country FROM shareholders WHERE id = $1', [lostCert.shareholder_id]);
      if (!shRes.rows.length) return json(404, { success: false, error: 'Shareholder not found' }, headers);
      const shareholder = shRes.rows[0];

      // Get series
      let seriesName = null;
      if (lostCert.entity_stock_series_id) {
        const serRes = await query('SELECT series FROM entity_stock_series WHERE id = $1', [lostCert.entity_stock_series_id]);
        seriesName = serRes.rows[0]?.series || null;
      }

      const newCert = await withTransaction(async (client) => {
	 
        // Generate new replacement certificate
        const newCertNumber = await generateCertificateNumber(client, lostCert.entity_id, lostCert.entity_name, abbrevStockType(lostCert.stock_type));

        const insertRes = await client.query(`
          INSERT INTO stock_certificates (
            entity_id, shareholder_id, share_transaction_id,
            entity_stock_type_id, entity_stock_series_id,
            certificate_number, shares, issue_date, status,
            original_issue_date, source_certificate_id,
            signed_by_name, signed_by_title,
            countersigned_by_name, countersigned_by_title,
            lost_certificate_number, lost_certificate_id,
            created_by
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_DATE,'ISSUED',
                    COALESCE($8::date, CURRENT_DATE), $9,
                    $10,$11,$12,$13,$14,$15,$16)
          RETURNING *
        `, [
          lostCert.entity_id, lostCert.shareholder_id, lostCert.share_transaction_id,
          lostCert.entity_stock_type_id, lostCert.entity_stock_series_id,
          newCertNumber, lostCert.shares,
          lostCert.original_issue_date || lostCert.issue_date, lostCert.id,
          signed_by_name || lostCert.signed_by_name, signed_by_title || lostCert.signed_by_title,
          countersigned_by_name || lostCert.countersigned_by_name, countersigned_by_title || lostCert.countersigned_by_title,
          lostCert.certificate_number, lostCert.id,
          user.id,
        ]);

        const nc = insertRes.rows[0];

        // Mark old certificate as REPLACED with reason LOST
        await client.query(
          `UPDATE stock_certificates SET status = 'REPLACED', cancelled_at = NOW(), cancelled_reason = 'LOST', replaced_by_certificate_id = $1, updated_at = NOW() WHERE id = $2`,
          [nc.id, certificate_id]
        );

        return nc;
      });

        // Generate PDF for replacement certificate
        const shAddress = [shareholder.address, shareholder.city, shareholder.state, shareholder.zip_code, shareholder.country].filter(Boolean).join(', ');
        const eAddress = [lostCert.e_address, lostCert.e_city, lostCert.e_state, lostCert.e_zip, lostCert.e_country].filter(Boolean).join(', ');

        try {
          const pdfBuffer = await generateCertificatePdf({
            entity_name: lostCert.entity_name,
            entity_address: eAddress,
            certificate_number: newCert.certificate_number,
            shareholder_name: shareholder.full_name,
            shareholder_address: shAddress,
            shares: lostCert.shares,
            stock_type: lostCert.stock_type_name,
            stock_series: seriesName,
            issue_date: newCert.issue_date,
            signed_by_name: signed_by_name || lostCert.signed_by_name,
            signed_by_title: signed_by_title || lostCert.signed_by_title,
            countersigned_by_name: countersigned_by_name || lostCert.countersigned_by_name,
            countersigned_by_title: countersigned_by_title || lostCert.countersigned_by_title,
            lost_certificate_number: lostCert.certificate_number,
          });

          const pdfPath = `certificates/${lostCert.entity_id}/${newCert.certificate_number}.pdf`;
          await uploadPdfToStorage(pdfPath, pdfBuffer);
          await query('UPDATE stock_certificates SET pdf_path = $1 WHERE id = $2', [pdfPath, newCert.id]);
          newCert.pdf_path = pdfPath;
        } catch (pdfErr) {
          console.error('PDF generation error (non-fatal):', pdfErr.message);
        }

        await logAudit({
          user_id: user.id, user_email: user.email, user_role: user.role,
          entity_id: lostCert.entity_id, action: 'REPORT_LOST_CERTIFICATE',
          resource_type: 'STOCK_CERTIFICATE', resource_id: newCert.id,
          details: { lost_certificate_id: certificate_id, lost_number: lostCert.certificate_number, new_number: newCert.certificate_number },
          ip_address: getClientIp(event),
        });

        return json(201, { success: true, lost_certificate_id: certificate_id, new_certificate: newCert }, headers);
	
    }

    /* ===== POST: Generate Lost Certificate Affidavit PDF ===== */
    if (event.httpMethod === 'POST' && action === 'generate-affidavit') {
      if (!requireRole(['SUPER_ADMIN', 'ENTITY_ADMIN'])(user)) {
        return json(403, { success: false, error: 'Forbidden' }, headers);
      }

      const body = parseBody(event);
      const { certificate_id, narrative, signer_name, signer_title, notary_state, notary_county } = body;
      if (!certificate_id) return json(400, { success: false, error: 'certificate_id required' }, headers);

      // Find the lost certificate (should be REPLACED with reason LOST)
      const certRes = await query(`
        SELECT sc.*, 
               sh.full_name AS shareholder_name, sh.address AS sh_address, sh.city AS sh_city, sh.state AS sh_state, sh.zip_code AS sh_zip, sh.country AS sh_country,
               e.name AS entity_name, e.address AS e_address, e.city AS e_city, e.state AS e_state, e.zip_code AS e_zip, e.country AS e_country,
               est.stock_type, est.display_name AS stock_type_name,
               ess.series
        FROM stock_certificates sc
        JOIN shareholders sh ON sh.id = sc.shareholder_id
        JOIN entities e ON e.id = sc.entity_id
        JOIN entity_stock_types est ON est.id = sc.entity_stock_type_id
        LEFT JOIN entity_stock_series ess ON ess.id = sc.entity_stock_series_id
        WHERE sc.id = $1
      `, [certificate_id]);

      if (!certRes.rows.length) return json(404, { success: false, error: 'Certificate not found' }, headers);
      const cert = certRes.rows[0];
      if (!enforceEntityScope(user, cert.entity_id)) return json(403, { success: false, error: 'Forbidden' }, headers);

      // Find replacement certificate if exists
      let replacementCertNumber = null;
      let replacementCertId = null;
      if (cert.replaced_by_certificate_id) {
        const repRes = await query('SELECT id, certificate_number FROM stock_certificates WHERE id = $1', [cert.replaced_by_certificate_id]);
        if (repRes.rows.length) {
          replacementCertNumber = repRes.rows[0].certificate_number;
          replacementCertId = repRes.rows[0].id;
        }
      }

      const shAddress = [cert.sh_address, cert.sh_city, cert.sh_state, cert.sh_zip, cert.sh_country].filter(Boolean).join(', ');
      const eAddress = [cert.e_address, cert.e_city, cert.e_state, cert.e_zip, cert.e_country].filter(Boolean).join(', ');

      // Generate affidavit PDF
      const pdfBuffer = await generateAffidavitPdf({
        companyName: cert.entity_name,
        companyAddress: eAddress,
        shareholderName: cert.shareholder_name,
        shareholderAddress: shAddress,
        lostCertificateNumber: cert.certificate_number,
        replacementCertificateNumber: replacementCertNumber,
        shares: cert.shares,
        stockType: cert.stock_type_name || cert.stock_type,
        stockSeries: cert.series,
        affidavitDate: new Date().toISOString().slice(0, 10),
        narrative: narrative || null,
        signerName: signer_name || cert.shareholder_name,
        signerTitle: signer_title || 'Registered Owner',
        notaryState: notary_state || null,
        notaryCounty: notary_county || null,
      });

      // Record in certificate_documents
      try {
        await query(`
          INSERT INTO certificate_documents (entity_id, certificate_id, lost_certificate_id, replacement_certificate_id, document_type, title, created_by)
          VALUES ($1, $2, $3, $4, 'LOST_CERTIFICATE_AFFIDAVIT', 'Lost Certificate Affidavit', $5)
        `, [cert.entity_id, replacementCertId || null, cert.id, replacementCertId || null, user.id]);
      } catch (docErr) {
        console.error('Failed to record affidavit document (non-fatal):', docErr.message);
      }

      await logAudit({
        user_id: user.id, user_email: user.email, user_role: user.role,
        entity_id: cert.entity_id, action: 'GENERATE_LOST_AFFIDAVIT',
        resource_type: 'CERTIFICATE_DOCUMENT', resource_id: cert.id,
        details: { lost_certificate_number: cert.certificate_number, replacement_certificate_number: replacementCertNumber },
        ip_address: getClientIp(event),
      });

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="Lost_Certificate_Affidavit_${cert.certificate_number}.pdf"`,
          ...headers,
        },
        body: pdfBuffer.toString('base64'),
        isBase64Encoded: true,
      };
    }

    return json(405, { success: false, error: 'Method not allowed or invalid action' });
  } catch (error) {
    console.error('CERTIFICATES ERROR:', error);
    return json(500, { success: false, error: error.message });
  }
};
