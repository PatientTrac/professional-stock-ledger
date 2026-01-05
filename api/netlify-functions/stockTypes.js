/**
 * netlify/functions/stockTypes.js
 *
 * PURPOSE
 *  - Manage per-entity Stock Types + optional Series (e.g. Common, Preferred(A/B), Warrants(W1/W2))
 *  - Used by index.html to populate:
 *      - Grid Stock Type dropdown
 *      - Grid Series dropdown (only for types that support series)
 *
 * EXPECTED API
 *  GET  /api/stockTypes?action=list-types&entity_id=123
 *     -> { success:true, stock_types:[{ id, entity_id, stock_type, display_name, supports_series, is_active }] }
 *
 *  GET  /api/stockTypes?action=list-series&entity_stock_type_id=456
 *     -> { success:true, series:[{ id, entity_stock_type_id, series, is_active }] }
 *
 *  POST /api/stockTypes?action=upsert-type
 *     body: { id?, entity_id, stock_type, display_name?, supports_series?, is_active? }
 *     -> { success:true, stock_type:{...} }
 *
 *  POST /api/stockTypes?action=upsert-series
 *     body: { id?, entity_stock_type_id, series, is_active? }
 *     -> { success:true, series:{...} }
 *
 *  POST /api/stockTypes?action=toggle-type
 *     body: { id, is_active }
 *  POST /api/stockTypes?action=toggle-series
 *     body: { id, is_active }
 *
 * AUTH / ROLES (simple)
 *  - Requires Authorization: Bearer <jwt>
 *  - JWT payload should include: { user_id, role, entity_id }
 *  - SUPER_ADMIN can manage any entity.
 *  - ADMIN can manage only their entity.
 *  - Any authenticated user can list for their entity (and superadmin can list any).
 *
 * ENV REQUIRED
 *  - DATABASE_URL (Postgres)
 *  - JWT_SECRET
 */

const { Client } = require("pg");
const jwt = require("jsonwebtoken");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...corsHeaders },
    body: JSON.stringify(body),
  };
}

function isTruthy(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

function requireEnv(name) {
  if (!process.env[name]) throw new Error(`Missing env var: ${name}`);
  return process.env[name];
}

function getBearerToken(event) {
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function decodeUser(event) {
  const token = getBearerToken(event);
  if (!token) throw new Error("Missing Authorization Bearer token");
  const secret = requireEnv("JWT_SECRET");
  try {
    const payload = jwt.verify(token, secret);
    const role = String(payload.role || "").toUpperCase();
    return {
      user_id: payload.user_id,
      role,
      entity_id: payload.entity_id ? String(payload.entity_id) : null,
    };
  } catch (e) {
    throw new Error("Invalid or expired token");
  }
}

function canAccessEntity(user, entityId) {
  if (!entityId) return false;
  if (user.role === "SUPER_ADMIN") return true;
  return user.entity_id && String(user.entity_id) === String(entityId);
}

async function withClient(fn) {
  requireEnv("DATABASE_URL");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

function safeUpperCode(code) {
  return String(code || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/[^A-Z0-9_]/g, "");
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  try {
    const user = decodeUser(event);
    const q = event.queryStringParameters || {};
    const action = String(q.action || "").trim();

    if (!action) return json(400, { success: false, error: "Missing action" });

    // ---- GET: list-types
    if (event.httpMethod === "GET" && action === "list-types") {
      const entityId = q.entity_id ? String(q.entity_id) : user.entity_id;
      if (!entityId) return json(400, { success: false, error: "Missing entity_id" });
      if (!canAccessEntity(user, entityId)) return json(403, { success: false, error: "Forbidden" });

      const out = await withClient(async (client) => {
        const { rows } = await client.query(
          `
            SELECT id, entity_id, stock_type, display_name, supports_series, is_active
            FROM entity_stock_types
            WHERE entity_id = $1
            ORDER BY display_name NULLS LAST, stock_type ASC, id ASC
          `,
          [entityId]
        );
        return rows;
      });

      return json(200, { success: true, stock_types: out });
    }

    // ---- GET: list-series
    if (event.httpMethod === "GET" && action === "list-series") {
      const estId = q.entity_stock_type_id ? String(q.entity_stock_type_id) : null;
      if (!estId) return json(400, { success: false, error: "Missing entity_stock_type_id" });

      const out = await withClient(async (client) => {
        // check entity ownership for access control
        const { rows: tRows } = await client.query(
          `SELECT id, entity_id FROM entity_stock_types WHERE id = $1`,
          [estId]
        );
        if (!tRows.length) throw new Error("Stock type not found");

        const entityId = String(tRows[0].entity_id);
        if (!canAccessEntity(user, entityId)) {
          const err = new Error("Forbidden");
          err.statusCode = 403;
          throw err;
        }

        const { rows } = await client.query(
          `
            SELECT id, entity_stock_type_id, series, is_active
            FROM entity_stock_type_series
            WHERE entity_stock_type_id = $1
            ORDER BY series ASC, id ASC
          `,
          [estId]
        );
        return rows;
      });

      return json(200, { success: true, series: out });
    }

    // From here: POST actions
    if (event.httpMethod !== "POST") {
      return json(405, { success: false, error: "Method not allowed" });
    }

    const body = event.body ? JSON.parse(event.body) : {};

    // ---- POST: upsert-type
    if (action === "upsert-type") {
      const entityId = body.entity_id ? String(body.entity_id) : user.entity_id;
      if (!entityId) return json(400, { success: false, error: "Missing entity_id" });

      // ADMIN can only manage their entity; SUPER_ADMIN any
      if (!canAccessEntity(user, entityId)) return json(403, { success: false, error: "Forbidden" });

      const id = body.id ? String(body.id) : null;
      const stock_type = safeUpperCode(body.stock_type);
      if (!stock_type) return json(400, { success: false, error: "Missing stock_type" });

      const display_name = String(body.display_name || stock_type).trim();
      const supports_series = isTruthy(body.supports_series);
      const is_active = body.is_active === undefined ? true : isTruthy(body.is_active);

      const result = await withClient(async (client) => {
        if (id) {
          // ensure same entity
          const { rows: chk } = await client.query(
            `SELECT id, entity_id FROM entity_stock_types WHERE id = $1`,
            [id]
          );
          if (!chk.length) throw new Error("Stock type not found");
          if (!canAccessEntity(user, String(chk[0].entity_id))) {
            const err = new Error("Forbidden");
            err.statusCode = 403;
            throw err;
          }

          const { rows } = await client.query(
            `
              UPDATE entity_stock_types
              SET stock_type = $1,
                  display_name = $2,
                  supports_series = $3,
                  is_active = $4,
                  updated_at = NOW()
              WHERE id = $5
              RETURNING id, entity_id, stock_type, display_name, supports_series, is_active
            `,
            [stock_type, display_name, supports_series, is_active, id]
          );
          return rows[0];
        }

        const { rows } = await client.query(
          `
            INSERT INTO entity_stock_types (entity_id, stock_type, display_name, supports_series, is_active)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, entity_id, stock_type, display_name, supports_series, is_active
          `,
          [entityId, stock_type, display_name, supports_series, is_active]
        );
        return rows[0];
      });

      return json(200, { success: true, stock_type: result });
    }

    // ---- POST: upsert-series
    if (action === "upsert-series") {
      const id = body.id ? String(body.id) : null;
      const entity_stock_type_id = body.entity_stock_type_id ? String(body.entity_stock_type_id) : null;
      if (!entity_stock_type_id && !id) {
        return json(400, { success: false, error: "Missing entity_stock_type_id (or id for update)" });
      }

      const series = String(body.series || "").trim();
      if (!series && !id) return json(400, { success: false, error: "Missing series" });

      const is_active = body.is_active === undefined ? true : isTruthy(body.is_active);

      const result = await withClient(async (client) => {
        // resolve entity ownership
        let estId = entity_stock_type_id;

        if (id) {
          const { rows: sChk } = await client.query(
            `SELECT id, entity_stock_type_id FROM entity_stock_type_series WHERE id = $1`,
            [id]
          );
          if (!sChk.length) throw new Error("Series not found");
          estId = String(sChk[0].entity_stock_type_id);
        }

        const { rows: tRows } = await client.query(
          `SELECT id, entity_id, supports_series FROM entity_stock_types WHERE id = $1`,
          [estId]
        );
        if (!tRows.length) throw new Error("Stock type not found");

        const entityId = String(tRows[0].entity_id);
        if (!canAccessEntity(user, entityId)) {
          const err = new Error("Forbidden");
          err.statusCode = 403;
          throw err;
        }

        if (!tRows[0].supports_series) {
          throw new Error("This stock type does not support series");
        }

        if (id) {
          const { rows } = await client.query(
            `
              UPDATE entity_stock_type_series
              SET series = COALESCE($1, series),
                  is_active = $2,
                  updated_at = NOW()
              WHERE id = $3
              RETURNING id, entity_stock_type_id, series, is_active
            `,
            [series || null, is_active, id]
          );
          return rows[0];
        }

        const { rows } = await client.query(
          `
            INSERT INTO entity_stock_type_series (entity_stock_type_id, series, is_active)
            VALUES ($1, $2, $3)
            RETURNING id, entity_stock_type_id, series, is_active
          `,
          [estId, series, is_active]
        );
        return rows[0];
      });

      return json(200, { success: true, series: result });
    }

    // ---- POST: toggle-type
    if (action === "toggle-type") {
      const id = body.id ? String(body.id) : null;
      if (!id) return json(400, { success: false, error: "Missing id" });
      const is_active = isTruthy(body.is_active);

      const result = await withClient(async (client) => {
        const { rows: chk } = await client.query(
          `SELECT id, entity_id FROM entity_stock_types WHERE id = $1`,
          [id]
        );
        if (!chk.length) throw new Error("Stock type not found");
        if (!canAccessEntity(user, String(chk[0].entity_id))) {
          const err = new Error("Forbidden");
          err.statusCode = 403;
          throw err;
        }

        const { rows } = await client.query(
          `
            UPDATE entity_stock_types
            SET is_active = $1, updated_at = NOW()
            WHERE id = $2
            RETURNING id, entity_id, stock_type, display_name, supports_series, is_active
          `,
          [is_active, id]
        );
        return rows[0];
      });

      return json(200, { success: true, stock_type: result });
    }

    // ---- POST: toggle-series
    if (action === "toggle-series") {
      const id = body.id ? String(body.id) : null;
      if (!id) return json(400, { success: false, error: "Missing id" });
      const is_active = isTruthy(body.is_active);

      const result = await withClient(async (client) => {
        // find parent + entity for ACL
        const { rows: sChk } = await client.query(
          `SELECT id, entity_stock_type_id FROM entity_stock_type_series WHERE id = $1`,
          [id]
        );
        if (!sChk.length) throw new Error("Series not found");

        const estId = String(sChk[0].entity_stock_type_id);

        const { rows: tRows } = await client.query(
          `SELECT id, entity_id FROM entity_stock_types WHERE id = $1`,
          [estId]
        );
        if (!tRows.length) throw new Error("Stock type not found");

        if (!canAccessEntity(user, String(tRows[0].entity_id))) {
          const err = new Error("Forbidden");
          err.statusCode = 403;
          throw err;
        }

        const { rows } = await client.query(
          `
            UPDATE entity_stock_type_series
            SET is_active = $1, updated_at = NOW()
            WHERE id = $2
            RETURNING id, entity_stock_type_id, series, is_active
          `,
          [is_active, id]
        );
        return rows[0];
      });

      return json(200, { success: true, series: result });
    }

    return json(400, { success: false, error: `Unknown action: ${action}` });
  } catch (e) {
    const statusCode = e.statusCode || 500;
    return json(statusCode, { success: false, error: e.message || "Server error" });
  }
};

/**
 * DB TABLES (REFERENCE)
 *
 * -- Stock types per entity
 * CREATE TABLE IF NOT EXISTS entity_stock_types (
 *   id BIGSERIAL PRIMARY KEY,
 *   entity_id BIGINT NOT NULL REFERENCES entities(id),
 *   stock_type TEXT NOT NULL,                 -- e.g. COMMON / PREFERRED / WARRANT
 *   display_name TEXT,
 *   supports_series BOOLEAN NOT NULL DEFAULT FALSE,
 *   is_active BOOLEAN NOT NULL DEFAULT TRUE,
 *   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *   UNIQUE(entity_id, stock_type)
 * );
 *
 * -- Series for types that support series
 * CREATE TABLE IF NOT EXISTS entity_stock_type_series (
 *   id BIGSERIAL PRIMARY KEY,
 *   entity_stock_type_id BIGINT NOT NULL REFERENCES entity_stock_types(id) ON DELETE CASCADE,
 *   series TEXT NOT NULL,                     -- e.g. A / B / W1
 *   is_active BOOLEAN NOT NULL DEFAULT TRUE,
 *   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *   UNIQUE(entity_stock_type_id, series)
 * );
 *
 * -- Optional: start IDs around 1000000
 * -- ALTER SEQUENCE entity_stock_types_id_seq RESTART WITH 1000000;
 * -- ALTER SEQUENCE entity_stock_type_series_id_seq RESTART WITH 1000000;
 */
