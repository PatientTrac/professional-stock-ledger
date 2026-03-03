/**
 * Shared Certificate Utilities
 * Used by both certificates.js and ledger.js for certificate generation
 */
const { query, withTransaction } = require('./db');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/* ========== HELPERS ========== */

function pad(num, width = 6) {
  const s = String(num);
  return s.length >= width ? s : '0'.repeat(width - s.length) + s;
}

function abbrevStockType(stockType) {
  const t = (stockType || '').toLowerCase();
  if (t.includes('common')) return 'COM';
  if (t.includes('preferred')) return 'PREF';
  if (t.includes('warrant')) return 'WAR';
  return (stockType || 'STK').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'STK';
}

function numberToWords(n) {
  if (n === 0) return 'Zero';
  const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine',
    'Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];

  function convert(num) {
    if (num < 20) return ones[num];
    if (num < 100) return tens[Math.floor(num / 10)] + (num % 10 ? ' ' + ones[num % 10] : '');
    if (num < 1000) return ones[Math.floor(num / 100)] + ' Hundred' + (num % 100 ? ' and ' + convert(num % 100) : '');
    if (num < 1000000) return convert(Math.floor(num / 1000)) + ' Thousand' + (num % 1000 ? ' ' + convert(num % 1000) : '');
    if (num < 1000000000) return convert(Math.floor(num / 1000000)) + ' Million' + (num % 1000000 ? ' ' + convert(num % 1000000) : '');
    return convert(Math.floor(num / 1000000000)) + ' Billion' + (num % 1000000000 ? ' ' + convert(num % 1000000000) : '');
  }
  return convert(Math.floor(Math.abs(n)));
}

/**
 * Generate certificate number transactionally (race-safe)
 * MUST be called within an active transaction (BEGIN already called)
 */
/**
 * Generate certificate number using a dedicated client (for use inside withTransaction).
 * @param {object} client - pg Client from withTransaction callback
 */
async function generateCertificateNumber(client, entityId, entityPrefix, stockTypeAbbrev) {
  // Ensure sequence row exists
  await client.query(
    `INSERT INTO certificate_sequences (entity_id, next_seq) VALUES ($1, 1) ON CONFLICT (entity_id) DO NOTHING`,
    [entityId]
  );

  // Lock and get next sequence
  const seqRes = await client.query(
    `SELECT next_seq FROM certificate_sequences WHERE entity_id = $1 FOR UPDATE`,
    [entityId]
  );
  const seq = Number(seqRes.rows[0].next_seq);

  // Increment
  await client.query(
    `UPDATE certificate_sequences SET next_seq = next_seq + 1, updated_at = NOW() WHERE entity_id = $1`,
    [entityId]
  );

  const prefix = (entityPrefix || 'AEGIS').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'AEGIS';
  return `${prefix}-${stockTypeAbbrev}-${pad(seq)}`;
}

/**
 * Generate certificate PDF using pdf-lib
 */
async function generateCertificatePdf(cert) {
  let PDFDocument, StandardFonts, rgb;
  try {
    const pdfLib = require('pdf-lib');
    PDFDocument = pdfLib.PDFDocument;
    StandardFonts = pdfLib.StandardFonts;
    rgb = pdfLib.rgb;
  } catch (e) {
    throw new Error('pdf-lib not available. Install with: npm i pdf-lib');
  }

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([792, 612]); // Landscape letter
  const { width, height } = page.getSize();

  const fontBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);

  const gold = rgb(0.72, 0.58, 0.2);
  const darkBlue = rgb(0.05, 0.1, 0.25);
  const gray = rgb(0.4, 0.4, 0.4);

  // Border
  const borderWidth = 3;
  page.drawRectangle({ x: 20, y: 20, width: width - 40, height: height - 40, borderColor: gold, borderWidth, opacity: 0 });
  page.drawRectangle({ x: 30, y: 30, width: width - 60, height: height - 60, borderColor: gold, borderWidth: 1, opacity: 0 });

  // Company name
  const companyName = cert.entity_name || 'Company Name';
  page.drawText(companyName, { x: width / 2 - fontBold.widthOfTextAtSize(companyName, 22) / 2, y: height - 70, size: 22, font: fontBold, color: darkBlue });

  // Jurisdiction
  if (cert.jurisdiction) {
    const jurisdText = `Incorporated in ${cert.jurisdiction}`;
    page.drawText(jurisdText, { x: width / 2 - fontItalic.widthOfTextAtSize(jurisdText, 10) / 2, y: height - 90, size: 10, font: fontItalic, color: gray });
  }

  // Company address
  if (cert.entity_address) {
    page.drawText(cert.entity_address, { x: width / 2 - fontRegular.widthOfTextAtSize(cert.entity_address, 9) / 2, y: height - 105, size: 9, font: fontRegular, color: gray });
  }

  // Certificate number and date
  page.drawText(`Certificate No: ${cert.certificate_number}`, { x: width - 250, y: height - 70, size: 11, font: fontBold, color: gold });
  page.drawText(`Date of Issue: ${cert.issue_date}`, { x: width - 250, y: height - 85, size: 10, font: fontRegular, color: gray });

  // Title
  const title = 'STOCK CERTIFICATE';
  page.drawText(title, { x: width / 2 - fontBold.widthOfTextAtSize(title, 20) / 2, y: height - 145, size: 20, font: fontBold, color: gold });

  // Body text
  const bodyY = height - 190;
  page.drawText('This certifies that', { x: 80, y: bodyY, size: 13, font: fontRegular, color: darkBlue });

  // Shareholder name (large)
  const shareholderName = cert.shareholder_name || 'Shareholder Name';
  page.drawText(shareholderName, { x: 80, y: bodyY - 30, size: 18, font: fontBold, color: darkBlue });

  // Line under name
  page.drawLine({ start: { x: 80, y: bodyY - 35 }, end: { x: 500, y: bodyY - 35 }, thickness: 0.5, color: gray });

  page.drawText('is the registered owner of', { x: 80, y: bodyY - 55, size: 13, font: fontRegular, color: darkBlue });

  // Shares
  const sharesNum = Number(cert.shares);
  const sharesText = `${sharesNum.toLocaleString()} (${numberToWords(sharesNum)})`;
  page.drawText(sharesText, { x: 80, y: bodyY - 80, size: 14, font: fontBold, color: darkBlue });
  page.drawText('shares', { x: 80 + fontBold.widthOfTextAtSize(sharesText, 14) + 5, y: bodyY - 80, size: 14, font: fontRegular, color: darkBlue });

  // Stock type
  const stockLabel = cert.stock_series
    ? `of ${cert.stock_type} Stock, Series ${cert.stock_series}`
    : `of ${cert.stock_type} Stock`;
  page.drawText(stockLabel, { x: 80, y: bodyY - 105, size: 13, font: fontRegular, color: darkBlue });

  page.drawText(`of ${companyName}.`, { x: 80, y: bodyY - 125, size: 13, font: fontRegular, color: darkBlue });

  // Shareholder address
  if (cert.shareholder_address) {
    page.drawText('Registered Owner Address:', { x: 80, y: bodyY - 160, size: 10, font: fontItalic, color: gray });
    page.drawText(cert.shareholder_address, { x: 80, y: bodyY - 175, size: 10, font: fontRegular, color: gray });
  }

  // Replacement note for lost certificates
  if (cert.lost_certificate_number) {
    const replNote = `Replacement for Lost Certificate: ${cert.lost_certificate_number}`;
    page.drawText(replNote, { x: 80, y: bodyY - 200, size: 10, font: fontItalic, color: rgb(0.7, 0.1, 0.1) });
  }

  // Legend
  const legendY = 110;
  let legendText = 'The shares represented by this certificate are subject to restrictions on transfer as set forth in the corporation\'s governing documents and applicable law.';
  if (cert.lost_certificate_number) {
    legendText += ' This is a replacement certificate issued due to lost original. Transfer restrictions may apply.';
  }
  page.drawText(legendText, { x: 80, y: legendY, size: 8, font: fontItalic, color: gray, maxWidth: width - 160 });

  // Signature lines
  const sigY = 75;
  const leftX = 100;
  const rightX = width - 350;

  page.drawLine({ start: { x: leftX, y: sigY }, end: { x: leftX + 200, y: sigY }, thickness: 1, color: darkBlue });
  page.drawText(cert.signed_by_name || '________________________', { x: leftX, y: sigY - 15, size: 10, font: fontRegular, color: darkBlue });
  page.drawText(cert.signed_by_title || 'Authorized Officer', { x: leftX, y: sigY - 28, size: 9, font: fontItalic, color: gray });

  page.drawLine({ start: { x: rightX, y: sigY }, end: { x: rightX + 200, y: sigY }, thickness: 1, color: darkBlue });
  page.drawText(cert.countersigned_by_name || '________________________', { x: rightX, y: sigY - 15, size: 10, font: fontRegular, color: darkBlue });
  page.drawText(cert.countersigned_by_title || 'Secretary', { x: rightX, y: sigY - 28, size: 9, font: fontItalic, color: gray });

  // Corporate seal placeholder
  const sealX = width / 2 - 25;
  page.drawCircle({ x: sealX, y: 65, size: 25, borderColor: gold, borderWidth: 1.5, opacity: 0 });
  page.drawText('SEAL', { x: sealX - 12, y: 61, size: 8, font: fontBold, color: gold });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

/**
 * Upload PDF to Supabase Storage via service_role
 */
async function uploadPdfToStorage(filePath, pdfBuffer) {
  const url = `${SUPABASE_URL}/storage/v1/object/aegisiq-storage/${filePath}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/pdf',
      'x-upsert': 'true',
    },
    body: pdfBuffer,
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('PDF upload failed:', errText);
  }
}

/**
 * Auto-generate a certificate for a share transaction
 * Called after issuance or transfer-in
 * @param {Object} params
 * @param {number} params.entityId
 * @param {number} params.shareholderId
 * @param {number} params.shareTransactionId
 * @param {number} params.entityStockTypeId
 * @param {number|null} params.entityStockSeriesId
 * @param {number} params.shares
 * @param {string|null} params.issueDate
 * @param {number} params.createdBy - user id
 * @returns {Object|null} certificate record or null on failure
 */
async function autoGenerateCertificate({
  entityId, shareholderId, shareTransactionId,
  entityStockTypeId, entityStockSeriesId,
  shares, issueDate, createdBy,
  originalIssueDate, transferDate, sourceCertificateId,
}) {
  try {
    // Get entity info
    const entRes = await query('SELECT name, address, city, state, zip_code, country FROM entities WHERE id = $1', [entityId]);
    if (!entRes.rows.length) { console.error('Auto-cert: entity not found'); return null; }
    const entity = entRes.rows[0];

    // Get stock type info
    const stRes = await query('SELECT id, stock_type, display_name FROM entity_stock_types WHERE id = $1', [entityStockTypeId]);
    if (!stRes.rows.length) { console.error('Auto-cert: stock type not found'); return null; }
    const stockType = stRes.rows[0];

    // Get shareholder info
    const shRes = await query('SELECT id, full_name, address, city, state, zip_code, country FROM shareholders WHERE id = $1', [shareholderId]);
    if (!shRes.rows.length) { console.error('Auto-cert: shareholder not found'); return null; }
    const shareholder = shRes.rows[0];

    // Get series info
    let seriesName = null;
    if (entityStockSeriesId) {
      const serRes = await query('SELECT series FROM entity_stock_series WHERE id = $1', [entityStockSeriesId]);
      seriesName = serRes.rows[0]?.series || null;
    }

    // Use withTransaction for proper client-based transaction
    const cert = await withTransaction(async (client) => {
   
      const certNumber = await generateCertificateNumber(client, entityId, entity.name, abbrevStockType(stockType.stock_type));

      // Determine dates: original_issue_date preserves lineage, transfer_date marks ownership change
      const effectiveOriginalDate = originalIssueDate || issueDate || null; // fallback to issue date for new issuances

      const insertRes = await client.query(`
        INSERT INTO stock_certificates (
          entity_id, shareholder_id, share_transaction_id,
          entity_stock_type_id, entity_stock_series_id,
          certificate_number, shares, issue_date, status,
          original_issue_date, transfer_date, source_certificate_id,
          created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::date, CURRENT_DATE),'ISSUED',
                  COALESCE($9::date, COALESCE($8::date, CURRENT_DATE)), $10::date, $11,
                  $12)
        RETURNING *
      `, [
        entityId, shareholderId, shareTransactionId,
        entityStockTypeId, entityStockSeriesId || null,
        certNumber, shares, issueDate || null,
        effectiveOriginalDate, transferDate || null, sourceCertificateId || null,
        createdBy,
      ]);

      return insertRes.rows[0];
    });

    // Generate and upload PDF (best-effort, non-blocking)
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
      });

      const pdfPath = `certificates/${entityId}/${cert.certificate_number}.pdf`;
      await uploadPdfToStorage(pdfPath, pdfBuffer);
      await query('UPDATE stock_certificates SET pdf_path = $1 WHERE id = $2', [pdfPath, cert.id]);
      cert.pdf_path = pdfPath;
    } catch (pdfErr) {
      console.error('Auto-cert PDF generation error (non-fatal):', pdfErr.message);
    }

    return cert;
  
  } catch (err) {
    console.error('Auto-cert error:', err.message);
    return null;
  }
}

/**
 * Cancel all ISSUED certificates for a shareholder's specific stock type/series
 * Used during transfers to cancel sender's certificates
 * @returns {Array} cancelled certificate records
 */
async function cancelCertificatesForHolding({
  entityId, shareholderId, entityStockTypeId, entityStockSeriesId, reason, replacedByCertId
}) {
  const seriesCondition = entityStockSeriesId
    ? 'AND entity_stock_series_id = $4'
    : 'AND entity_stock_series_id IS NULL';
  const params = entityStockSeriesId
    ? [entityId, shareholderId, entityStockTypeId, entityStockSeriesId]
    : [entityId, shareholderId, entityStockTypeId];

  const certsRes = await query(`
    SELECT id, certificate_number FROM stock_certificates 
    WHERE entity_id = $1 AND shareholder_id = $2 AND entity_stock_type_id = $3 
    ${seriesCondition} AND status = 'ISSUED'
  `, params);

  const cancelled = [];
  for (const cert of certsRes.rows) {
    await query(
      `UPDATE stock_certificates SET status = 'CANCELLED', cancelled_at = NOW(), cancelled_reason = $1, replaced_by_certificate_id = $2, updated_at = NOW() WHERE id = $3`,
      [reason || 'Cancelled due to share transfer', replacedByCertId || null, cert.id]
    );
    cancelled.push(cert);
  }

  return cancelled;
}

module.exports = {
  pad,
  abbrevStockType,
  numberToWords,
  generateCertificateNumber,
  generateCertificatePdf,
  uploadPdfToStorage,
  autoGenerateCertificate,
  cancelCertificatesForHolding,
};
