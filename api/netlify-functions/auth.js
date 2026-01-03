// netlify/functions/auth.js
const bcrypt = require("bcryptjs");
const { query } = require("./utils/db");
const { generateToken, authMiddleware } = require("./middleware/auth");

/**
 * Helpers
 */
function corsHeaders() {
  // If you set CORS_ORIGIN in Netlify env vars, it will use that.
  // Otherwise it allows all origins (ok for testing, tighten for production).
  const origin = process.env.CORS_ORIGIN || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  };
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
    body: JSON.stringify(body),
  };
}

function getAction(event) {
  return (event.queryStringParameters && event.queryStringParameters.action) || "";
}

function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    return null;
  }
}

exports.handler = async (event) => {
  // Preflight (CORS)
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: { ...corsHeaders() },
      body: "",
    };
  }

  const action = getAction(event);
  const body = parseBody(event);

  if (body === null) {
    return json(400, { success: false, error: "Invalid JSON in request body" });
  }

  console.log("AUTH:", { method: event.httpMethod, action });

  try {
    // -------------------
    // POST routes
    // -------------------
    if (event.httpMethod === "POST") {
      if (action === "login") return await handleLogin(body);
      if (action === "register") return await handleRegister(body);
      if (action === "logout") return json(200, { success: true, message: "Logged out" });

      return json(400, { success: false, error: "Invalid action or method" });
    }

    // -------------------
    // GET routes
    // -------------------
    if (event.httpMethod === "GET") {
      if (action === "verify") return await handleVerify(event);
      return json(400, { success: false, error: "Invalid action or method" });
    }

    return json(405, { success: false, error: "Method not allowed" });
  } catch (e) {
    console.error("AUTH ERROR:", e);
    return json(500, { success: false, error: "Server error: " + e.message });
  }
};

/**
 * LOGIN
 * POST /api/auth?action=login
 * body: { email, password }
 */
async function handleLogin(body) {
  const { email, password } = body || {};
  if (!email || !password) {
    return json(400, { success: false, error: "Email and password are required" });
  }

  const result = await query(
    `
    SELECT 
      u.*,
      e.name as entity_name,
      e.is_active as entity_is_active
    FROM users u
    LEFT JOIN entities e ON u.entity_id = e.id
    WHERE u.email = $1 AND u.is_active = TRUE
  `,
    [email.toLowerCase()]
  );

  if (result.rows.length === 0) {
    return json(401, { success: false, error: "Invalid email or password" });
  }

  const user = result.rows[0];

  if (user.entity_is_active === false) {
    return json(403, { success: false, error: "Entity is inactive" });
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return json(401, { success: false, error: "Invalid email or password" });
  }

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
      entity_name: user.entity_name,
    },
  });
}

/**
 * REGISTER (PUBLIC)
 * POST /api/auth?action=register
 * body: { email, password, full_name }
 *
 * Creates a USER under DEFAULT_ENTITY_ID
 */
async function handleRegister(body) {
  const { email, password, full_name } = body || {};

  if (!email || !password || !full_name) {
    return json(400, { success: false, error: "email, password, full_name are required" });
  }

  const existing = await query("SELECT id FROM users WHERE email = $1", [email.toLowerCase()]);
  if (existing.rows.length) {
    return json(409, { success: false, error: "User already exists" });
  }

  const defaultEntityId = process.env.DEFAULT_ENTITY_ID;
  if (!defaultEntityId) {
    return json(500, {
      success: false,
      error: "DEFAULT_ENTITY_ID is not set in environment variables",
    });
  }

  // Ensure entity exists and active
  const ent = await query("SELECT id, is_active, name FROM entities WHERE id = $1", [defaultEntityId]);
  if (!ent.rows.length) {
    return json(500, { success: false, error: "DEFAULT_ENTITY_ID does not exist in entities table" });
  }
  if (ent.rows[0].is_active === false) {
    return json(403, { success: false, error: "Default entity is inactive" });
  }

  const hashed = await bcrypt.hash(password, 10);

  const created = await query(
    `
    INSERT INTO users (entity_id, email, password_hash, full_name, role, is_active)
    VALUES ($1, $2, $3, $4, $5, TRUE)
    RETURNING id, email, full_name, role, entity_id
  `,
    [defaultEntityId, email.toLowerCase(), hashed, full_name, "USER"]
  );

  const newUser = created.rows[0];

  // If your generateToken expects more fields, you can fetch full row; but this works in most setups:
  const token = generateToken({
    id: newUser.id,
    email: newUser.email,
    role: newUser.role,
    entity_id: newUser.entity_id,
  });

  return json(201, {
    success: true,
    token,
    user: newUser,
  });
}

/**
 * VERIFY
 * GET /api/auth?action=verify
 * header: Authorization: Bearer <token>
 */
async function handleVerify(event) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) {
    // authMiddleware should already return proper JSON; if not, wrap it:
    return auth;
  }

  const { user, headers } = auth;

  // Ensure CORS headers exist even if middleware sets its own headers
  return {
    statusCode: 200,
    headers: { ...(headers || {}), ...corsHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        entity_id: user.entity_id,
        entity_name: user.entity_name,
      },
    }),
  };
}
