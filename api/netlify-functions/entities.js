const { query } = require('./utils/db');
const { authMiddleware, requireRole } = require('./middleware/auth');

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const action = params.action;

  console.log('ENTITIES:', { method: event.httpMethod, action });

  try {
    if (event.httpMethod === 'GET') {
      if (action === 'list') return await handleListEntities(event, params);
      if (action === 'get') return await handleGetEntity(event, params);
      return json(400, { success: false, error: 'Invalid action or method' });
    }

    if (event.httpMethod === 'POST') {
      if (action === 'create') return await handleCreateEntity(event);
      return json(400, { success: false, error: 'Invalid action or method' });
    }

    if (event.httpMethod === 'PUT') {
      if (action === 'update') return await handleUpdateEntity(event);
      return json(400, { success: false, error: 'Invalid action or method' });
    }

    if (event.httpMethod === 'DELETE') {
      if (action === 'delete') return await handleDeleteEntity(event, params);
      return json(400, { success: false, error: 'Invalid action or method' });
    }

    return json(405, { success: false, error: 'Method not allowed' });
  } catch (e) {
    console.error('ENTITIES ERROR:', e);
    return json(500, { success: false, error: 'Server error: ' + e.message });
  }
};

function parseBody(event) {
  if (!event.body) return {};
  try { return JSON.parse(event.body); }
  catch { throw new Error('Invalid JSON in request body'); }
}

// -----------------------------------
// POST create (SUPER_ADMIN only)
// -----------------------------------
async function handleCreateEntity(event) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  if (!requireRole(['SUPER_ADMIN'])(user)) {
    return json(403, { success:false, error:'Forbidden: Only SUPER_ADMIN can create entities' }, headers);
  }

  const body = parseBody(event);
  const {
    name,
    legal_name,
    tax_id,
    address,
    city,
    state,
    country,
    zip_code,
    phone,
    email
  } = body;

  if (!name) return json(400, { success:false, error:'Entity name is required' }, headers);

  try {
    const existing = await query('SELECT id FROM entities WHERE name = $1', [name]);
    if (existing.rows.length) {
      return json(409, { success:false, error:'Entity already exists' }, headers);
    }

    const result = await query(
      `
      INSERT INTO entities (
        name, legal_name, tax_id, address, city,
        state, country, zip_code, phone, email, is_active
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE)
      RETURNING *
      `,
      [
        name,
        legal_name || name,
        tax_id || null,
        address || null,
        city || null,
        state || null,
        country || 'US',
        zip_code || null,
        phone || null,
        email || null,
      ]
    );

    return json(201, { success:true, entity: result.rows[0] }, headers);
  } catch (e) {
    console.error('Create entity error:', e);
    return json(500, { success:false, error:'Failed to create entity: ' + e.message }, headers);
  }
}

// -----------------------------------
// GET list
// - SUPER_ADMIN: all entities (optionally include_inactive=true)
// - others: only their entity
// -----------------------------------
async function handleListEntities(event, params) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  const includeInactive = params.include_inactive === 'true';

  try {
    let q = `
      SELECT id, name, legal_name, tax_id, is_active,
             address, city, state, country, zip_code,
             phone, email, created_at, updated_at
      FROM entities
      WHERE 1=1
    `;
    const qParams = [];
    let i = 0;

    // Non-super admins only see their own entity
    if (user.role !== 'SUPER_ADMIN') {
      i++;
      q += ` AND id = $${i}`;
      qParams.push(user.entity_id);
    } else {
      // SUPER_ADMIN can see all. default: active only unless includeInactive=true
      if (!includeInactive) {
        q += ` AND is_active = TRUE`;
      }
    }

    q += ` ORDER BY name`;

    const result = await query(q, qParams);
    return json(200, { success:true, entities: result.rows }, headers);
  } catch (e) {
    console.error('List entities error:', e);
    return json(500, { success:false, error:'Failed to list entities: ' + e.message }, headers);
  }
}

// -----------------------------------
// GET get&entityId=
// -----------------------------------
async function handleGetEntity(event, params) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  const { entityId } = params;
  if (!entityId) return json(400, { success:false, error:'Entity ID is required' }, headers);

  // Non-super admins can only access their entity
  if (user.role !== 'SUPER_ADMIN' && String(user.entity_id) !== String(entityId)) {
    return json(403, { success:false, error:'Forbidden: Cannot access this entity' }, headers);
  }

  try {
    const result = await query(
      `
      SELECT id, name, legal_name, tax_id, is_active,
             address, city, state, country, zip_code,
             phone, email, created_at, updated_at
      FROM entities
      WHERE id = $1
      `,
      [entityId]
    );

    if (!result.rows.length) return json(404, { success:false, error:'Entity not found' }, headers);

    return json(200, { success:true, entity: result.rows[0] }, headers);
  } catch (e) {
    console.error('Get entity error:', e);
    return json(500, { success:false, error:'Failed to get entity: ' + e.message }, headers);
  }
}

// -----------------------------------
// PUT update (SUPER_ADMIN only)
// -----------------------------------
async function handleUpdateEntity(event) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  if (!requireRole(['SUPER_ADMIN'])(user)) {
    return json(403, { success:false, error:'Forbidden: Only SUPER_ADMIN can update entities' }, headers);
  }

  const body = parseBody(event);
  const { entityId, ...updates } = body;

  if (!entityId) return json(400, { success:false, error:'Entity ID is required' }, headers);

  const allowedFields = new Set([
    'name','legal_name','tax_id','address','city','state','country','zip_code','phone','email','is_active'
  ]);

  const keys = Object.keys(updates).filter(k => allowedFields.has(k));
  if (!keys.length) return json(400, { success:false, error:'No valid fields to update' }, headers);

  try {
    const check = await query('SELECT id FROM entities WHERE id = $1', [entityId]);
    if (!check.rows.length) return json(404, { success:false, error:'Entity not found' }, headers);

    const sets = [];
    const paramsArr = [];
    let i = 0;

    for (const k of keys) {
      i++;
      sets.push(`${k} = $${i}`);
      paramsArr.push(updates[k]);
    }

    sets.push(`updated_at = CURRENT_TIMESTAMP`);

    i++;
    paramsArr.push(entityId);

    const q = `
      UPDATE entities
      SET ${sets.join(', ')}
      WHERE id = $${i}
      RETURNING *
    `;

    const result = await query(q, paramsArr);
    return json(200, { success:true, entity: result.rows[0] }, headers);
  } catch (e) {
    console.error('Update entity error:', e);
    return json(500, { success:false, error:'Failed to update entity: ' + e.message }, headers);
  }
}

// -----------------------------------
// DELETE delete (SUPER_ADMIN only)
// -----------------------------------
async function handleDeleteEntity(event, params) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  if (!requireRole(['SUPER_ADMIN'])(user)) {
    return json(403, { success:false, error:'Forbidden: Only SUPER_ADMIN can delete entities' }, headers);
  }

  const id = params.id;
  if (!id) return json(400, { success:false, error:'Entity ID is required' }, headers);

  try {
    const existing = await query('SELECT id FROM entities WHERE id = $1', [id]);
    if (!existing.rows.length) return json(404, { success:false, error:'Entity not found' }, headers);

    // Check for associated users/shareholders - deactivate instead
    const users = await query('SELECT id FROM users WHERE entity_id = $1 AND is_active = TRUE LIMIT 1', [id]);
    if (users.rows.length) {
      await query('UPDATE entities SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
      return json(200, { success:true, message:'Entity deactivated (has active users)' }, headers);
    }

    // No active users - deactivate (safe approach)
    await query('UPDATE entities SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
    return json(200, { success:true, message:'Entity deactivated' }, headers);
  } catch (e) {
    console.error('Delete entity error:', e);
    return json(500, { success:false, error:'Failed to delete entity: ' + e.message }, headers);
  }
}
