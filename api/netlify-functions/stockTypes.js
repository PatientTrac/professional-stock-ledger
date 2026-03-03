// api/netlify-functions/stockTypes.js
const { query, withTransaction } = require('./utils/db');
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

function resolveTargetEntityId(user, providedEntityId) {
  if ((user.role || '').toUpperCase() === 'SUPER_ADMIN') {
    return providedEntityId || user.entity_id;
  }
  return user.entity_id;
}


function normTypeCode(v) {
  return String(v || '').trim().toUpperCase();
}

const ALLOWED_TYPE_CODES = new Set(['COMMON', 'PREFERRED', 'WARRANT']);

function normalizeSupportsSeries(stock_type, supports_series) {
  const code = normTypeCode(stock_type);

  if (code === 'PREFERRED' || code === 'WARRANT') return true;

  if (code === 'COMMON') return false;

  return Boolean(supports_series);
}

// Governance lock fields - these cannot be changed after shares are issued
const GOVERNANCE_LOCKED_FIELDS = [
  'par_value', 'authorized_shares', 'dividend_rate',
  'liquidation_preference', 'has_voting_rights', 'supports_series'
];

// Check if shares have been issued against a stock type
async function getIssuedShareCount(entityStockTypeId) {
  const res = await query(`
    SELECT COALESCE(SUM(
      CASE
        WHEN transaction_type IN ('ISSUANCE') THEN shares
        WHEN transaction_type IN ('CANCELLATION', 'FORFEITURE') THEN -shares
        ELSE 0
      END
    ), 0) AS issued
    FROM share_transactions
    WHERE entity_stock_type_id = $1
  `, [entityStockTypeId]);
  return parseFloat(res.rows[0].issued || 0);
}

// Check if shares exist using legacy stock_type column (fallback)
async function getIssuedShareCount(entityId, entityStockTypeId) {
  const res = await query(`
    SELECT COALESCE(SUM(
      CASE
        WHEN transaction_type IN ('ISSUANCE') THEN shares
        WHEN transaction_type IN ('CANCELLATION', 'FORFEITURE') THEN -shares
        ELSE 0
      END
    ), 0) AS issued
    FROM share_transactions
    WHERE entity_id = $1 AND entity_stock_type_id = $2
  `, [entityId, entityStockTypeId]);
  return res.rows[0].issued || 0;
}

async function checkGovernanceLock(stockTypeRow) {
  const issued = await getIssuedShareCount(
    stockTypeRow.entity_id,
    stockTypeRow.id
  );

  return issued > 0;
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

  console.log('STOCK_TYPES:', { method: event.httpMethod, action });

  try {
    if (event.httpMethod === 'GET') {
      if (action === 'list-types') return await handleListTypes(event, params);
      if (action === 'get-type') return await handleGetType(event, params);
      if (action === 'list-series') return await handleListSeries(event, params);
      return json(400, { success: false, error: 'Invalid action or method' });
    }

    if (event.httpMethod === 'POST') {
      if (action === 'create-type') return await handleCreateType(event);
      if (action === 'create-series') return await handleCreateSeries(event);
      return json(400, { success: false, error: 'Invalid action or method' });
    }

    if (event.httpMethod === 'PUT') {
      if (action === 'update-type') return await handleUpdateType(event);
      if (action === 'deactivate-type') return await handleDeactivateType(event);
      if (action === 'update-series') return await handleUpdateSeries(event);
      if (action === 'deactivate-series') return await handleDeactivateSeries(event);
      return json(400, { success: false, error: 'Invalid action or method' });
    }

    return json(405, { success: false, error: 'Method not allowed' });
  } catch (e) {
    console.error('STOCK_TYPES ERROR:', e);
    return json(500, { success: false, error: 'Server error: ' + e.message });
  }
};

// ------------------------------------
// GET: list-types (with issued shares computed from ledger)
// ------------------------------------
async function handleListTypes(event, params) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  const entityId = resolveTargetEntityId(user, params.entity_id);
  if (!entityId) return json(400, { success: false, error: 'Entity not resolved' }, headers);

  if (!enforceEntityScope(user, entityId)) {
    return json(403, { success: false, error: 'Forbidden: Cannot access this entity' }, headers);
  }

  const result = await query(`
	 
    SELECT id, entity_id, stock_type, display_name, supports_series,
           par_value, authorized_shares, dividend_rate, liquidation_preference,
           has_voting_rights, is_active, created_at, updated_at
    FROM entity_stock_types
    WHERE entity_id = $1
    ORDER BY stock_type
	  
  `, [entityId]);
	

  // Compute issued shares for each type
  const stockTypes = [];
  for (const row of result.rows) {
    const isLocked = await checkGovernanceLock(row);
    stockTypes.push({
      ...row,
      is_governance_locked: isLocked
    });
  }

  return json(200, { success: true, stock_types: stockTypes }, headers);
}

// GET: get single type
async function handleGetType(event, params) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  const { id } = params;
  if (!id) return json(400, { success: false, error: 'id is required' }, headers);

  const res = await query(`SELECT * FROM entity_stock_types WHERE id = $1`, [id]);
  if (!res.rows.length) return json(404, { success: false, error: 'Not found' }, headers);

  const row = res.rows[0];
  if (!enforceEntityScope(user, row.entity_id)) {
    return json(403, { success: false, error: 'Forbidden' }, headers);
  }

  const isLocked = await checkGovernanceLock(row);
  return json(200, { success: true, stock_type: { ...row, is_governance_locked: isLocked } }, headers);
}

// ------------------------------------
// POST: create-type (with governance fields)
// ------------------------------------
async function handleCreateType(event) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  const canManage = requireRole(['SUPER_ADMIN', 'ADMIN'])(user);
  if (!canManage) return json(403, { success: false, error: 'Forbidden: Insufficient permissions' }, headers);

  const body = parseBody(event);
  const entityId = resolveTargetEntityId(user, body.entity_id);
  if (!entityId) return json(400, { success: false, error: 'Entity not resolved' }, headers);

  if (!enforceEntityScope(user, entityId)) {
    return json(403, { success: false, error: 'Forbidden: Cannot manage this entity' }, headers);
  }

  const stock_type = normTypeCode(body.stock_type);
  const display_name = String(body.display_name || '').trim();
  const is_active = body.is_active === undefined ? true : Boolean(body.is_active);

  if (!stock_type) return json(400, { success: false, error: 'stock_type is required' }, headers);
  if (!ALLOWED_TYPE_CODES.has(stock_type)) {
    return json(400, { success: false, error: 'Invalid stock_type. Allowed: COMMON, PREFERRED, WARRANT' }, headers);
  }
  if (!display_name) return json(400, { success: false, error: 'display_name is required' }, headers);

  const supports_series = normalizeSupportsSeries(stock_type, body.supports_series);
  const par_value = body.par_value !== undefined && body.par_value !== '' ? parseFloat(body.par_value) : null;
  const authorized_shares = body.authorized_shares !== undefined && body.authorized_shares !== '' ? parseInt(body.authorized_shares) : null;
  const dividend_rate = body.dividend_rate !== undefined && body.dividend_rate !== '' ? parseFloat(body.dividend_rate) : null;
  const liquidation_preference = body.liquidation_preference ? String(body.liquidation_preference).trim() : null;
  const has_voting_rights = body.has_voting_rights === undefined ? true : Boolean(body.has_voting_rights);

  const result = await query(`
	 
    INSERT INTO entity_stock_types (entity_id, stock_type, display_name, supports_series, par_value, authorized_shares, dividend_rate, liquidation_preference, has_voting_rights, is_active)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (entity_id, stock_type)
    DO UPDATE SET
      display_name = EXCLUDED.display_name,
      supports_series = EXCLUDED.supports_series,
      par_value = EXCLUDED.par_value,
      authorized_shares = EXCLUDED.authorized_shares,
      dividend_rate = EXCLUDED.dividend_rate,
      liquidation_preference = EXCLUDED.liquidation_preference,
      has_voting_rights = EXCLUDED.has_voting_rights,
      is_active = EXCLUDED.is_active,
      updated_at = NOW()
    RETURNING *
	  
  `, [entityId, stock_type, display_name, supports_series, par_value, authorized_shares, dividend_rate, liquidation_preference, has_voting_rights, is_active]);
	

  return json(201, { success: true, stock_type: result.rows[0] }, headers);
}

// ------------------------------------
// PUT: update-type (with governance lock enforcement)
// ------------------------------------
async function handleUpdateType(event) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  const canManage = requireRole(['SUPER_ADMIN', 'ADMIN'])(user);
  if (!canManage) return json(403, { success: false, error: 'Forbidden: Insufficient permissions' }, headers);

  const body = parseBody(event);
  const { id } = body;
  if (!id) return json(400, { success: false, error: 'id is required' }, headers);

  const existing = await query(`SELECT * FROM entity_stock_types WHERE id = $1`, [id]);
  if (!existing.rows.length) return json(404, { success: false, error: 'Stock type not found' }, headers);

  const row = existing.rows[0];
  if (!enforceEntityScope(user, row.entity_id)) {
    return json(403, { success: false, error: 'Forbidden: Cannot manage this entity' }, headers);
  }

  // Check governance lock
  const isLocked = await checkGovernanceLock(row);

  // If locked, reject changes to governance fields
  if (isLocked) {
    const attemptedLockedFields = GOVERNANCE_LOCKED_FIELDS.filter(f => body[f] !== undefined);
    // Allow authorized_shares INCREASE only (board resolution)
    const filtered = attemptedLockedFields.filter(f => {
      if (f === 'authorized_shares' && body.authorized_shares !== undefined) {
        const newVal = parseInt(body.authorized_shares);
        const oldVal = parseInt(row.authorized_shares || 0);
        return newVal < oldVal; // block decrease only
      }
      return true;
    });
    if (filtered.length > 0) {
      return json(400, {
        success: false,
        error: 'This stock class cannot be modified because shares have already been issued.',
        error_code: 'ERR_STOCK_TYPE_LOCKED_AFTER_ISSUANCE',
        locked_fields: filtered
      }, headers);
    }
  }

  const fields = [];
  const values = [];
  let i = 0;

  if (body.display_name !== undefined) {
    const dn = String(body.display_name).trim();
    if (!dn) return json(400, { success: false, error: 'display_name cannot be blank' }, headers);
    i++; fields.push(`display_name = $${i}`); values.push(dn);
  }

  if (body.is_active !== undefined) {
    i++; fields.push(`is_active = $${i}`); values.push(Boolean(body.is_active));
  }

  if (body.supports_series !== undefined) {
																			
    const normalized = normalizeSupportsSeries(row.stock_type, body.supports_series);
    i++; fields.push(`supports_series = $${i}`); values.push(Boolean(normalized));
  }

  if (body.par_value !== undefined) {
    i++; fields.push(`par_value = $${i}`);
    values.push(body.par_value !== '' && body.par_value !== null ? parseFloat(body.par_value) : null);
  }

  if (body.authorized_shares !== undefined) {
    i++; fields.push(`authorized_shares = $${i}`);
    values.push(body.authorized_shares !== '' && body.authorized_shares !== null ? parseInt(body.authorized_shares) : null);
  }

  if (body.dividend_rate !== undefined) {
    i++; fields.push(`dividend_rate = $${i}`);
    values.push(body.dividend_rate !== '' && body.dividend_rate !== null ? parseFloat(body.dividend_rate) : null);
  }

  if (body.liquidation_preference !== undefined) {
    i++; fields.push(`liquidation_preference = $${i}`);
    values.push(body.liquidation_preference ? String(body.liquidation_preference).trim() : null);
  }

  if (body.has_voting_rights !== undefined) {
    i++; fields.push(`has_voting_rights = $${i}`); values.push(Boolean(body.has_voting_rights));
  }

  if (!fields.length) return json(400, { success: false, error: 'No fields to update' }, headers);
  const turningOffSeries =
    body.supports_series !== undefined &&
    Boolean(row.supports_series) === true &&
    Boolean(normalizeSupportsSeries(row.stock_type, body.supports_series)) === false;

  const result = await withTransaction(async (client) => {

    i++; values.push(id);

    const qText = `
      UPDATE entity_stock_types
      SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${i}
      RETURNING *
    `;
    const updated = await client.query(qText, values);

    if (turningOffSeries) {
      await client.query(
        `UPDATE entity_stock_series SET is_active = FALSE, updated_at = NOW() WHERE entity_stock_type_id = $1`,
        [id]
      );
    }

    return updated.rows[0];
  });

  return json(200, { success: true, stock_type: result }, headers);
   
}

// ------------------------------------
// PUT: deactivate-type
// ------------------------------------
async function handleDeactivateType(event) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  const canManage = requireRole(['SUPER_ADMIN', 'ADMIN'])(user);
  if (!canManage) return json(403, { success: false, error: 'Forbidden: Insufficient permissions' }, headers);

  const body = parseBody(event);
  const { id } = body;
  if (!id) return json(400, { success: false, error: 'id is required' }, headers);

  const existing = await query(`SELECT * FROM entity_stock_types WHERE id = $1`, [id]);
  if (!existing.rows.length) return json(404, { success: false, error: 'Stock type not found' }, headers);

  const row = existing.rows[0];
  if (!enforceEntityScope(user, row.entity_id)) {
    return json(403, { success: false, error: 'Forbidden: Cannot manage this entity' }, headers);
  }

  const result = await withTransaction(async (client) => {
	   
    const updated = await client.query(
      `UPDATE entity_stock_types SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );

    await client.query(
      `UPDATE entity_stock_series SET is_active = FALSE, updated_at = NOW() WHERE entity_stock_type_id = $1`,
      [id]
    );

    return updated.rows[0];
  });

  return json(200, { success: true, stock_type: result }, headers);
   
}

// ------------------------------------
// GET: list-series
// ------------------------------------
async function handleListSeries(event, params) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  const { entity_stock_type_id } = params;
  if (!entity_stock_type_id) {
    return json(400, { success: false, error: 'entity_stock_type_id is required' }, headers);
  }

  const typeRes = await query(
    `SELECT id, entity_id, supports_series FROM entity_stock_types WHERE id = $1`,
    [entity_stock_type_id]
  );
  if (!typeRes.rows.length) return json(404, { success: false, error: 'Stock type not found' }, headers);

  const st = typeRes.rows[0];
  if (!enforceEntityScope(user, st.entity_id)) {
    return json(403, { success: false, error: 'Forbidden' }, headers);
  }

  const seriesRes = await query(`
	 
    SELECT id, entity_stock_type_id, series, authorized_shares, is_active, created_at, updated_at
    FROM entity_stock_series
    WHERE entity_stock_type_id = $1
    ORDER BY series
	  
  `, [entity_stock_type_id]);
	

  return json(200, { success: true, supports_series: st.supports_series, series: seriesRes.rows }, headers);
}

// ------------------------------------
// POST: create-series (with authorized_shares)
// ------------------------------------
async function handleCreateSeries(event) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  const canManage = requireRole(['SUPER_ADMIN', 'ADMIN'])(user);
  if (!canManage) return json(403, { success: false, error: 'Forbidden: Insufficient permissions' }, headers);

  const body = parseBody(event);
  const { entity_stock_type_id } = body;
  const series = String(body.series || '').trim();
  const is_active = body.is_active === undefined ? true : Boolean(body.is_active);
  const authorized_shares = body.authorized_shares !== undefined && body.authorized_shares !== '' ? parseInt(body.authorized_shares) : null;

  if (!entity_stock_type_id) return json(400, { success: false, error: 'entity_stock_type_id is required' }, headers);
  if (!series) return json(400, { success: false, error: 'series is required' }, headers);

  const typeRes = await query(
    `SELECT id, entity_id, supports_series, is_active FROM entity_stock_types WHERE id = $1`,
    [entity_stock_type_id]
  );
  if (!typeRes.rows.length) return json(404, { success: false, error: 'Stock type not found' }, headers);

  const st = typeRes.rows[0];
  if (!enforceEntityScope(user, st.entity_id)) {
    return json(403, { success: false, error: 'Forbidden' }, headers);
  }
  if (!st.is_active) {
    return json(400, { success: false, error: 'Cannot add series to an inactive stock type' }, headers);
  }
  if (!st.supports_series) {
    return json(400, { success: false, error: 'This stock type does not support series' }, headers);
  }

  const res = await query(`
	 
    INSERT INTO entity_stock_series (entity_stock_type_id, series, authorized_shares, is_active)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (entity_stock_type_id, series)
    DO UPDATE SET
      authorized_shares = EXCLUDED.authorized_shares,
      is_active = EXCLUDED.is_active,
      updated_at = NOW()
    RETURNING *
	  
  `, [entity_stock_type_id, series, authorized_shares, is_active]);
	

  return json(201, { success: true, series: res.rows[0] }, headers);
}

// ------------------------------------
// PUT: update-series
// ------------------------------------
async function handleUpdateSeries(event) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  const canManage = requireRole(['SUPER_ADMIN', 'ADMIN'])(user);
  if (!canManage) return json(403, { success: false, error: 'Forbidden: Insufficient permissions' }, headers);

  const body = parseBody(event);
  const { id } = body;
  if (!id) return json(400, { success: false, error: 'id is required' }, headers);

  const existing = await query(`
	 
    SELECT es.*, est.entity_id
    FROM entity_stock_series es
    JOIN entity_stock_types est ON est.id = es.entity_stock_type_id
    WHERE es.id = $1
	  
  `, [id]);
	
  if (!existing.rows.length) return json(404, { success: false, error: 'Series not found' }, headers);

  const row = existing.rows[0];
  if (!enforceEntityScope(user, row.entity_id)) {
    return json(403, { success: false, error: 'Forbidden' }, headers);
  }

  const fields = [];
  const values = [];
  let i = 0;

  if (body.series !== undefined) {
    const s = String(body.series).trim();
    if (!s) return json(400, { success: false, error: 'series cannot be blank' }, headers);
    i++; fields.push(`series = $${i}`); values.push(s);
  }
  if (body.is_active !== undefined) {
    i++; fields.push(`is_active = $${i}`); values.push(Boolean(body.is_active));
  }
  if (body.authorized_shares !== undefined) {
    i++; fields.push(`authorized_shares = $${i}`);
    values.push(body.authorized_shares !== '' && body.authorized_shares !== null ? parseInt(body.authorized_shares) : null);
  }

  if (!fields.length) return json(400, { success: false, error: 'No fields to update' }, headers);

  i++; values.push(id);

  const qText = `
    UPDATE entity_stock_series
    SET ${fields.join(', ')}, updated_at = NOW()
    WHERE id = $${i}
    RETURNING *
  `;

  const updated = await query(qText, values);
  return json(200, { success: true, series: updated.rows[0] }, headers);
}

// ------------------------------------
// PUT: deactivate-series
// ------------------------------------
async function handleDeactivateSeries(event) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  const canManage = requireRole(['SUPER_ADMIN', 'ADMIN'])(user);
  if (!canManage) return json(403, { success: false, error: 'Forbidden: Insufficient permissions' }, headers);

  const body = parseBody(event);
  const { id } = body;
  if (!id) return json(400, { success: false, error: 'id is required' }, headers);

  const existing = await query(`
	 
    SELECT es.*, est.entity_id
    FROM entity_stock_series es
    JOIN entity_stock_types est ON est.id = es.entity_stock_type_id
    WHERE es.id = $1
	  
  `, [id]);
	
  if (!existing.rows.length) return json(404, { success: false, error: 'Series not found' }, headers);

  const row = existing.rows[0];
  if (!enforceEntityScope(user, row.entity_id)) {
    return json(403, { success: false, error: 'Forbidden' }, headers);
  }

  const updated = await query(
    `UPDATE entity_stock_series SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id]
  );

  return json(200, { success: true, series: updated.rows[0] }, headers);
}
