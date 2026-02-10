/**
 * AegisIQ Stock Ledger - Users API
 * CRUD operations for user management
 */
const bcrypt = require('bcryptjs');
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

  console.log('USERS:', { method: event.httpMethod, action });

  try {
    if (event.httpMethod === 'GET' && action === 'list') return await handleListUsers(event, params);
    if (event.httpMethod === 'POST' && action === 'create') return await handleCreateUser(event);
    if (event.httpMethod === 'PUT' && action === 'update') return await handleUpdateUser(event);
    if (event.httpMethod === 'DELETE' && action === 'delete') return await handleDeleteUser(event, params);

    return json(400, { success: false, error: 'Invalid action or method' });
  } catch (e) {
    console.error('USERS ERROR:', e);
    return json(500, { success: false, error: 'Server error: ' + e.message });
  }
};

// -----------------------------------
// GET list - List users
// -----------------------------------
async function handleListUsers(event, params) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  if (!requireRole(['SUPER_ADMIN', 'ADMIN'])(user)) {
    return json(403, { success: false, error: 'Forbidden: Insufficient permissions' }, headers);
  }

  try {
    let q, qParams;

    if (user.role === 'SUPER_ADMIN') {
      // SUPER_ADMIN can filter by entity_id or see all
      const entityId = params.entity_id;
      if (entityId) {
        q = `
          SELECT u.id, u.email, u.full_name, u.role, u.entity_id, u.is_active, u.created_at,
                 e.name as entity_name
          FROM users u
          LEFT JOIN entities e ON u.entity_id = e.id
          WHERE u.entity_id = $1
          ORDER BY u.full_name
        `;
        qParams = [entityId];
      } else {
        q = `
          SELECT u.id, u.email, u.full_name, u.role, u.entity_id, u.is_active, u.created_at,
                 e.name as entity_name
          FROM users u
          LEFT JOIN entities e ON u.entity_id = e.id
          ORDER BY u.full_name
        `;
        qParams = [];
      }
    } else {
      // ADMIN can only see users in their entity
      q = `
        SELECT u.id, u.email, u.full_name, u.role, u.entity_id, u.is_active, u.created_at,
               e.name as entity_name
        FROM users u
        LEFT JOIN entities e ON u.entity_id = e.id
        WHERE u.entity_id = $1
        ORDER BY u.full_name
      `;
      qParams = [user.entity_id];
    }

    const result = await query(q, qParams);
    return json(200, { success: true, users: result.rows }, headers);
  } catch (e) {
    console.error('List users error:', e);
    return json(500, { success: false, error: 'Failed to list users: ' + e.message }, headers);
  }
}

// -----------------------------------
// POST create - Create new user
// -----------------------------------
async function handleCreateUser(event) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  if (!requireRole(['SUPER_ADMIN', 'ADMIN'])(user)) {
    return json(403, { success: false, error: 'Forbidden: Insufficient permissions' }, headers);
  }

  const body = parseBody(event);
  const { email, password, full_name, role, entity_id } = body;

  if (!email || !password || !full_name || !role) {
    return json(400, { success: false, error: 'Email, password, full name, role are required' }, headers);
  }

  const validRoles = ['SUPER_ADMIN', 'ADMIN', 'USER'];
  if (!validRoles.includes(role)) {
    return json(400, { success: false, error: 'Invalid role' }, headers);
  }

  // Determine target entity
  let targetEntityId = entity_id;
  if (user.role !== 'SUPER_ADMIN') {
    targetEntityId = user.entity_id;
  } else if (!targetEntityId) {
    return json(400, { success: false, error: 'Entity id is required' }, headers);
  }

  try {
    const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length) {
      return json(409, { success: false, error: 'User already exists' }, headers);
    }

    const hashed = await bcrypt.hash(password, 10);

    const result = await query(`
      INSERT INTO users (entity_id, email, password_hash, full_name, role, is_active, created_by)
      VALUES ($1, $2, $3, $4, $5, TRUE, $6)
      RETURNING id, email, full_name, role, entity_id, is_active
    `, [targetEntityId, email.toLowerCase(), hashed, full_name, role, user.id]);

    return json(201, { success: true, user: result.rows[0] }, headers);
  } catch (e) {
    console.error('Create user error:', e);
    return json(500, { success: false, error: 'Failed to create user: ' + e.message }, headers);
  }
}

// -----------------------------------
// PUT update - Update user
// -----------------------------------
async function handleUpdateUser(event) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  if (!requireRole(['SUPER_ADMIN', 'ADMIN'])(user)) {
    return json(403, { success: false, error: 'Forbidden: Insufficient permissions' }, headers);
  }

  const body = parseBody(event);
  const { id, password, ...updates } = body;

  if (!id) {
    return json(400, { success: false, error: 'User ID is required' }, headers);
  }

  // Check user exists
  const existing = await query('SELECT id, entity_id FROM users WHERE id = $1', [id]);
  if (!existing.rows.length) {
    return json(404, { success: false, error: 'User not found' }, headers);
  }

  // ADMIN can only update users in their entity
  if (user.role !== 'SUPER_ADMIN' && existing.rows[0].entity_id !== user.entity_id) {
    return json(403, { success: false, error: 'Forbidden: Cannot update this user' }, headers);
  }

  const allowedFields = new Set(['full_name', 'email', 'role', 'entity_id', 'is_active']);
  const keys = Object.keys(updates).filter(k => allowedFields.has(k));

  try {
    const sets = [];
    const paramsArr = [];
    let i = 0;

    for (const k of keys) {
      i++;
      sets.push(`${k} = $${i}`);
      paramsArr.push(k === 'email' ? updates[k].toLowerCase() : updates[k]);
    }

    // Hash password if provided
    if (password) {
      i++;
      sets.push(`password_hash = $${i}`);
      paramsArr.push(await bcrypt.hash(password, 10));
    }

    if (!sets.length) {
      return json(400, { success: false, error: 'No valid fields to update' }, headers);
    }

    sets.push('updated_at = CURRENT_TIMESTAMP');
    i++;
    paramsArr.push(id);

    const q = `
      UPDATE users SET ${sets.join(', ')} WHERE id = $${i}
      RETURNING id, email, full_name, role, entity_id, is_active
    `;

    const result = await query(q, paramsArr);
    return json(200, { success: true, user: result.rows[0] }, headers);
  } catch (e) {
    console.error('Update user error:', e);
    return json(500, { success: false, error: 'Failed to update user: ' + e.message }, headers);
  }
}

// -----------------------------------
// DELETE delete - Delete/deactivate user
// -----------------------------------
async function handleDeleteUser(event, params) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  if (!requireRole(['SUPER_ADMIN', 'ADMIN'])(user)) {
    return json(403, { success: false, error: 'Forbidden: Insufficient permissions' }, headers);
  }

  const id = params.id;
  if (!id) return json(400, { success: false, error: 'User ID is required' }, headers);

  try {
    const existing = await query('SELECT id, entity_id FROM users WHERE id = $1', [id]);
    if (!existing.rows.length) return json(404, { success: false, error: 'User not found' }, headers);

    // ADMIN can only delete users in their entity
    if (user.role !== 'SUPER_ADMIN' && existing.rows[0].entity_id !== user.entity_id) {
      return json(403, { success: false, error: 'Forbidden: Cannot delete this user' }, headers);
    }

    // Prevent deleting yourself
    if (String(existing.rows[0].id) === String(user.id)) {
      return json(400, { success: false, error: 'Cannot delete your own account' }, headers);
    }

    // Deactivate instead of hard delete
    await query('UPDATE users SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
    return json(200, { success: true, message: 'User deactivated' }, headers);
  } catch (e) {
    console.error('Delete user error:', e);
    return json(500, { success: false, error: 'Failed to delete user: ' + e.message }, headers);
  }
}
