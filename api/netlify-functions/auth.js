const bcrypt = require('bcryptjs');
const { query } = require('./utils/db');
const { generateToken } = require('./middleware/auth');

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const action = params.action;

  let body = {};
  if (event.body) {
    try { body = JSON.parse(event.body); }
    catch { return json(400, { success:false, error:'Invalid JSON in request body' }); }
  }

  console.log('AUTH:', { method: event.httpMethod, action });

  if (event.httpMethod !== 'POST') {
    return json(405, { success:false, error:'Method not allowed' });
  }

  try {
    if (action === 'login') return await handleLogin(body);
    if (action === 'register') return await handleRegister(body);
    if (action === 'logout') return json(200, { success:true, message:'Logged out' });

    return json(400, { success:false, error:'Invalid action or method' });
  } catch (e) {
    console.error('AUTH ERROR:', e);
    return json(500, { success:false, error:'Server error: ' + e.message });
  }
};

async function handleLogin(body) {
  const { email, password } = body;
  if (!email || !password) return json(400, { success:false, error:'Email and password are required' });

  const result = await query(`
    SELECT u.*, e.name as entity_name, e.is_active as entity_is_active
    FROM users u
    LEFT JOIN entities e ON u.entity_id = e.id
    WHERE u.email = $1 AND u.is_active = TRUE
  `, [email.toLowerCase()]);

  if (result.rows.length === 0) return json(401, { success:false, error:'Invalid email or password' });

  const user = result.rows[0];
  if (user.entity_is_active === false) return json(403, { success:false, error:'Entity is inactive' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return json(401, { success:false, error:'Invalid email or password' });

  const token = generateToken(user);

  return json(200, {
    success: true,
    token,
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      entity_id: user.entity_id,
      entity_name: user.entity_name
    }
  });
}

async function handleRegister(body) {
  const { email, password, full_name } = body;
  if (!email || !password || !full_name) {
    return json(400, { success:false, error:'email, password, full_name are required' });
  }

  const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
  if (existing.rows.length) return json(409, { success:false, error:'User already exists' });

  const defaultEntityId = process.env.DEFAULT_ENTITY_ID;
  if (!defaultEntityId) {
    return json(500, { success:false, error:'DEFAULT_ENTITY_ID is not set in environment variables' });
  }

  // Ensure entity exists and active
  const ent = await query('SELECT id, is_active FROM entities WHERE id = $1', [defaultEntityId]);
  if (!ent.rows.length) return json(500, { success:false, error:'DEFAULT_ENTITY_ID does not exist in entities table' });
  if (ent.rows[0].is_active === false) return json(403, { success:false, error:'Default entity is inactive' });

  const hashed = await bcrypt.hash(password, 10);

  const result = await query(`
    INSERT INTO users (entity_id, email, password_hash, full_name, role, is_active)
    VALUES ($1, $2, $3, $4, $5, TRUE)
    RETURNING id, email, full_name, role, entity_id
  `, [defaultEntityId, email.toLowerCase(), hashed, full_name, 'USER']);

  const newUser = result.rows[0];
  const token = generateToken(newUser);

  return json(201, {
    success: true,
    token,
    user: newUser
  });
}
