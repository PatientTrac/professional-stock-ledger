/**
 * Audit Log Utility
 * Logs all admin/manager activity to the audit_logs table
 */
const { query } = require('./db');

/**
 * Log an audit event
 * @param {Object} params
 * @param {number} params.user_id - ID of the user performing the action
 * @param {string} params.user_email - Email of the user
 * @param {string} params.user_role - Role of the user
 * @param {number} params.entity_id - Entity context
 * @param {string} params.action - Action performed (e.g. 'CREATE_SHAREHOLDER', 'ISSUE_SHARES')
 * @param {string} params.resource_type - Type of resource (e.g. 'SHAREHOLDER', 'SHARE_TRANSACTION', 'USER', 'ENTITY')
 * @param {number|string} [params.resource_id] - ID of the affected resource
 * @param {Object} [params.details] - Additional details/payload (stored as JSONB)
 * @param {string} [params.ip_address] - Client IP address
 */
async function logAudit({
  user_id,
  user_email,
  user_role,
  entity_id,
  action,
  resource_type,
  resource_id = null,
  details = null,
  ip_address = null,
}) {
  try {
    await query(
      `INSERT INTO audit_logs (
        user_id, user_email, user_role, entity_id,
        action, resource_type, resource_id, details, ip_address
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        user_id,
        user_email,
        user_role,
        entity_id,
        action,
        resource_type,
        resource_id ? String(resource_id) : null,
        details ? JSON.stringify(details) : null,
        ip_address,
      ]
    );
  } catch (err) {
    // Never let audit logging break the main flow
    console.error('⚠️ Audit log failed:', err.message);
  }
}

/**
 * Extract client IP from Netlify event headers
 */
function getClientIp(event) {
  return (
    event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    event.headers['client-ip'] ||
    event.headers['x-real-ip'] ||
    null
  );
}

/**
 * Initialize audit_logs table
 */
async function initAuditTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      user_email VARCHAR(255),
      user_role VARCHAR(50),
      entity_id INTEGER REFERENCES entities(id),
      action VARCHAR(100) NOT NULL,
      resource_type VARCHAR(50) NOT NULL,
      resource_id VARCHAR(100),
      details JSONB,
      ip_address VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);`);
  console.log('✅ Audit logs table ready');
}

module.exports = { logAudit, getClientIp, initAuditTable };
