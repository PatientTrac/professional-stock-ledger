// api/netlify-functions/ledger.js
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
  catch { throw new Error('Invalid JSON body'); }
}

/* =====================================================
   HANDLER
===================================================== */
exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const action = params.action;

  try {
    if (event.httpMethod === 'GET') {
      if (action === 'ledger') return await handleLedger(event, params);
      if (action === 'list-book-entries') return await handleListBookEntries(event, params);
      return json(400, { success:false, error:'Invalid action' });
    }

    if (event.httpMethod === 'POST') {
      if (action === 'issue-shares') return await handleIssue(event);
      if (action === 'transfer-shares') return await handleTransfer(event);
      if (action === 'cancel-shares') return await handleCancel(event);
      return json(400, { success:false, error:'Invalid action' });
    }

    return json(405, { success:false, error:'Method not allowed' });
  } catch (e) {
    console.error('LEDGER ERROR:', e);
    return json(500, { success:false, error:e.message });
  }
};

/* =====================================================
   GET: Ledger View
===================================================== */
async function handleLedger(event) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  const entityId = user.entity_id;

  const result = await query(
    `
    SELECT
      st.id,
      st.transaction_date,
      st.transaction_type,
      st.shares,
      st.certificate_number,
      st.notes,

      sh.name AS shareholder_name,

      est.stock_type,
      est.display_name AS stock_type_name,

      ess.series,

      st.created_at
    FROM share_transactions st
    JOIN shareholders sh ON sh.id = st.shareholder_id
    JOIN entity_stock_types est ON est.id = st.entity_stock_type_id
    LEFT JOIN entity_stock_series ess ON ess.id = st.entity_stock_series_id
    WHERE st.entity_id = $1
    ORDER BY st.transaction_date DESC, st.id DESC
    `,
    [entityId]
  );

  return json(200, { success:true, ledger: result.rows }, headers);
}

/* =====================================================
   GET: List Book Entries for a Shareholder
===================================================== */
async function handleListBookEntries(event, params) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  const { shareholder_id, entity_id } = params;
  
  if (!shareholder_id) {
    return json(400, { success: false, error: 'shareholder_id is required' }, headers);
  }

  const targetEntityId = user.role === 'SUPER_ADMIN' && entity_id ? entity_id : user.entity_id;

  const result = await query(
    `
    SELECT
      st.id,
      st.transaction_date,
      st.transaction_type,
      st.shares,
      st.certificate_number,
      st.notes,
      est.stock_type,
      est.display_name AS stock_type_name,
      ess.series,
      st.created_at
    FROM share_transactions st
    JOIN entity_stock_types est ON est.id = st.entity_stock_type_id
    LEFT JOIN entity_stock_series ess ON ess.id = st.entity_stock_series_id
    WHERE st.entity_id = $1
      AND st.shareholder_id = $2
    ORDER BY st.transaction_date DESC, st.id DESC
    `,
    [targetEntityId, shareholder_id]
  );

  return json(200, { success: true, entries: result.rows }, headers);
}

/* =====================================================
   POST: Issue Shares
===================================================== */
async function handleIssue(event) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  const canIssue = requireRole(['SUPER_ADMIN', 'ADMIN'])(user);
  if (!canIssue) return json(403, { success:false, error:'Forbidden' }, headers);

  const body = parseBody(event);

  const {
    shareholder_id,
    entity_stock_type_id,
    entity_stock_series_id,
    shares,
    transaction_date,
    certificate_number,
    notes,
  } = body;

  if (!shareholder_id || !entity_stock_type_id || !shares) {
    return json(400, { success:false, error:'Missing required fields' }, headers);
  }

  // Validate stock type
  const typeRes = await query(
    `SELECT id, entity_id, supports_series, is_active
     FROM entity_stock_types
     WHERE id = $1`,
    [entity_stock_type_id]
  );

  if (!typeRes.rows.length) {
    return json(400, { success:false, error:'Invalid stock type' }, headers);
  }

  const st = typeRes.rows[0];
  if (!st.is_active) {
    return json(400, { success:false, error:'Stock type is inactive' }, headers);
  }

  if (!enforceEntityScope(user, st.entity_id)) {
    return json(403, { success:false, error:'Forbidden' }, headers);
  }

  // Validate series rules
  if (st.supports_series) {
    if (!entity_stock_series_id) {
      return json(400, { success:false, error:'Series is required for this stock type' }, headers);
    }

    const sRes = await query(
      `
      SELECT id
      FROM entity_stock_series
      WHERE id = $1 AND entity_stock_type_id = $2 AND is_active = TRUE
      `,
      [entity_stock_series_id, entity_stock_type_id]
    );

    if (!sRes.rows.length) {
      return json(400, { success:false, error:'Invalid or inactive series' }, headers);
    }
  } else if (entity_stock_series_id) {
    return json(400, { success:false, error:'Series not allowed for this stock type' }, headers);
  }

  const result = await query(
    `
    INSERT INTO share_transactions (
      entity_id,
      shareholder_id,
      transaction_type,
      transaction_date,
      entity_stock_type_id,
      entity_stock_series_id,
      shares,
      certificate_number,
      notes,
      created_by
    )
    VALUES (
      $1,$2,'ISSUANCE',$3,$4,$5,$6,$7,$8,$9
    )
    RETURNING *
    `,
    [
      user.entity_id,
      shareholder_id,
      transaction_date || new Date(),
      entity_stock_type_id,
      entity_stock_series_id || null,
      shares,
      certificate_number || null,
      notes || null,
      user.id,
    ]
  );

  return json(201, { success:true, transaction: result.rows[0] }, headers);
}

/* =====================================================
   POST: Transfer Shares
===================================================== */
async function handleTransfer(event) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  const body = parseBody(event);
  const {
    from_shareholder_id,
    to_shareholder_id,
    entity_stock_type_id,
    entity_stock_series_id,
    shares,
    transaction_date,
    notes,
  } = body;

  if (!from_shareholder_id || !to_shareholder_id || !entity_stock_type_id || !shares) {
    return json(400, { success:false, error:'Missing required fields' }, headers);
  }

  const result = await query(
    `
    INSERT INTO share_transactions (
      entity_id,
      shareholder_id,
      from_shareholder_id,
      to_shareholder_id,
      transaction_type,
      transaction_date,
      entity_stock_type_id,
      entity_stock_series_id,
      shares,
      notes,
      created_by
    )
    VALUES (
      $1,$2,$3,$4,'TRANSFER',$5,$6,$7,$8,$9,$10
    )
    RETURNING *
    `,
    [
      user.entity_id,
      to_shareholder_id,
      from_shareholder_id,
      to_shareholder_id,
      transaction_date || new Date(),
      entity_stock_type_id,
      entity_stock_series_id || null,
      shares,
      notes || null,
      user.id,
    ]
  );

  return json(201, { success:true, transaction: result.rows[0] }, headers);
}

/* =====================================================
   POST: Cancel Shares
===================================================== */
async function handleCancel(event) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  const body = parseBody(event);
  const {
    shareholder_id,
    entity_stock_type_id,
    entity_stock_series_id,
    shares,
    transaction_date,
    notes,
  } = body;

  if (!shareholder_id || !entity_stock_type_id || !shares) {
    return json(400, { success:false, error:'Missing required fields' }, headers);
  }

  const result = await query(
    `
    INSERT INTO share_transactions (
      entity_id,
      shareholder_id,
      transaction_type,
      transaction_date,
      entity_stock_type_id,
      entity_stock_series_id,
      shares,
      notes,
      created_by
    )
    VALUES (
      $1,$2,'CANCELLATION',$3,$4,$5,$6,$7,$8
    )
    RETURNING *
    `,
    [
      user.entity_id,
      shareholder_id,
      transaction_date || new Date(),
      entity_stock_type_id,
      entity_stock_series_id || null,
      shares,
      notes || null,
      user.id,
    ]
  );

  return json(201, { success:true, transaction: result.rows[0] }, headers);
}