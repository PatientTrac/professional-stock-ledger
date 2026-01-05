// netlify/functions/stockTypes.js
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

// Decide entity based on role + optional entity_id param/body
function resolveTargetEntityId(user, providedEntityId) {
  if ((user.role || '').toUpperCase() === 'SUPER_ADMIN') {
    return providedEntityId || user.entity_id;
  }
  return user.entity_id;
}

// Normalize codes to match enum/text
function normTypeCode(v) {
  return String(v || '').trim().toUpperCase();
}

exports.handler = async (event) => {
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
      if (action === 'update-series') return await handleUpdateSeries(event);
      return json(400, { success: false, error: 'Invalid action or method' });
    }

    return json(405, { success: false, error: 'Method not allowed' });
  } catch (e) {
    console.error('STOCK_TYPES ERROR:', e);
    return json(500, { success: false, error: 'Server error: ' + e.message });
  }
};

// ------------------------------------
// GET: list-types
// /api/stockTypes?action=list-types&entity_id=123
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

  const result = await query(
    `
    SELECT id, entity_id, stock_type, display_name, supports_series, is_active, created_at, updated_at
    FROM entity_stock_types
    WHERE entity_id = $1
    ORDER BY stock_type
    `,
    [entityId]
  );

  return json(200, { success: true, stock_types: result.rows }, headers);
}

// Optional: get single type
async function handleGetType(event, params) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  const { id } = params;
  if (!id) return json(400, { success: false, error: 'id is required' }, headers);

  const res = await query(
    `SELECT * FROM entity_stock_types WHERE id = $1`,
    [id]
  );
  if (!res.rows.length) return json(404, { success: false, error: 'Not found' }, headers);

  const row = res.rows[0];
  if (!enforceEntityScope(user, row.entity_id)) {
    return json(403, { success: false, error: 'Forbidden' }, headers);
  }

  return json(200, { success: true, stock_type: row }, headers);
}

// ------------------------------------
// POST: create-type
// body: { entity_id?, stock_type, display_name, supports_series, is_active? }
// ------------------------------------
async function handleCreateType(event) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  // Admin and Super Admin can manage types for their entity
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
  const supports_series = Boolean(body.supports_series);
  const is_active = body.is_active === undefined ? true : Boolean(body.is_active);

  if (!stock_type) return json(400, { success: false, error: 'stock_type is required' }, headers);
  if (!display_name) return json(400, { success: false, error: 'display_name is required' }, headers);

  // If you used ENUM stock_type_code, the DB will enforce allowed values.
  const result = await query(
    `
    INSERT INTO entity_stock_types (entity_id, stock_type, display_name, supports_series, is_active)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (entity_id, stock_type)
    DO UPDATE SET
      display_name = EXCLUDED.display_name,
      supports_series = EXCLUDED.supports_series,
      is_active = EXCLUDED.is_active,
      updated_at = NOW()
    RETURNING *
    `,
    [entityId, stock_type, display_name, supports_series, is_active]
  );

  return json(201, { success: true, stock_type: result.rows[0] }, headers);
}

// ------------------------------------
// PUT: update-type
// body: { id, display_name?, supports_series?, is_active? }
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

  const fields = [];
  const values = [];
  let i = 0;

  if (body.display_name !== undefined) {
    i++; fields.push(`display_name = $${i}`); values.push(String(body.display_name).trim());
  }
  if (body.supports_series !== undefined) {
    i++; fields.push(`supports_series = $${i}`); values.push(Boolean(body.supports_series));
  }
  if (body.is_active !== undefined) {
    i++; fields.push(`is_active = $${i}`); values.push(Boolean(body.is_active));
  }

  if (!fields.length) return json(400, { success: false, error: 'No fields to update' }, headers);

  i++; values.push(id);

  const qText = `
    UPDATE entity_stock_types
    SET ${fields.join(', ')}, updated_at = NOW()
    WHERE id = $${i}
    RETURNING *
  `;

  const updated = await query(qText, values);
  return json(200, { success: true, stock_type: updated.rows[0] }, headers);
}

// ------------------------------------
// GET: list-series
// /api/stockTypes?action=list-series&entity_stock_type_id=456
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

  const seriesRes = await query(
    `
    SELECT id, entity_stock_type_id, series, is_active, created_at, updated_at
    FROM entity_stock_series
    WHERE entity_stock_type_id = $1
    ORDER BY series
    `,
    [entity_stock_type_id]
  );

  return json(200, { success: true, supports_series: st.supports_series, series: seriesRes.rows }, headers);
}

// ------------------------------------
// POST: create-series
// body: { entity_stock_type_id, series, is_active? }
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

  if (!entity_stock_type_id) return json(400, { success: false, error: 'entity_stock_type_id is required' }, headers);
  if (!series) return json(400, { success: false, error: 'series is required' }, headers);

  const typeRes = await query(
    `SELECT id, entity_id, supports_series FROM entity_stock_types WHERE id = $1`,
    [entity_stock_type_id]
  );
  if (!typeRes.rows.length) return json(404, { success: false, error: 'Stock type not found' }, headers);

  const st = typeRes.rows[0];
  if (!enforceEntityScope(user, st.entity_id)) {
    return json(403, { success: false, error: 'Forbidden' }, headers);
  }
  if (!st.supports_series) {
    return json(400, { success: false, error: 'This stock type does not support series' }, headers);
  }

  const res = await query(
    `
    INSERT INTO entity_stock_series (entity_stock_type_id, series, is_active)
    VALUES ($1, $2, $3)
    ON CONFLICT (entity_stock_type_id, series)
    DO UPDATE SET
      is_active = EXCLUDED.is_active,
      updated_at = NOW()
    RETURNING *
    `,
    [entity_stock_type_id, series, is_active]
  );

  return json(201, { success: true, series: res.rows[0] }, headers);
}

// ------------------------------------
// PUT: update-series
// body: { id, series?, is_active? }
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

  const existing = await query(
    `
    SELECT es.*, est.entity_id
    FROM entity_stock_series es
    JOIN entity_stock_types est ON est.id = es.entity_stock_type_id
    WHERE es.id = $1
    `,
    [id]
  );
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
