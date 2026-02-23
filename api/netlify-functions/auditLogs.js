/**
 * AegisIQ Stock Ledger - Audit Logs API
 * Read-only endpoint for viewing audit trail
 */
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
  if (event.httpMethod === 'OPTIONS') {
    return json(200, { success: true }, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    });
  }

  if (event.httpMethod !== 'GET') {
    return json(405, { success: false, error: 'Method not allowed' });
  }

  const params = event.queryStringParameters || {};
  const action = params.action;

  try {
    if (action === 'list') return await handleListAuditLogs(event, params);
    return json(400, { success: false, error: 'Invalid action' });
  } catch (e) {
    console.error('AUDIT LOGS ERROR:', e);
    return json(500, { success: false, error: 'Server error: ' + e.message });
  }
};

async function handleListAuditLogs(event, params) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  // Only SUPER_ADMIN and ENTITY_ADMIN can view audit logs
  if (!requireRole(['SUPER_ADMIN', 'ENTITY_ADMIN'])(user)) {
    return json(403, { success: false, error: 'Forbidden' }, headers);
  }

  const limit = Math.min(parseInt(params.limit) || 100, 500);
  const offset = parseInt(params.offset) || 0;
  const filterAction = params.filter_action || null;
  const filterResource = params.filter_resource || null;
  const filterUserId = params.filter_user_id || null;
  const dateFrom = params.date_from || null;
  const dateTo = params.date_to || null;

  let q = `
    SELECT 
      al.id, al.user_id, al.user_email, al.user_role,
      al.entity_id, al.action, al.resource_type, al.resource_id,
      al.details, al.ip_address, al.created_at
    FROM audit_logs al
    WHERE 1=1
  `;
  const qParams = [];
  let i = 0;

  // Scope by entity for non-super admins
  if (user.role !== 'SUPER_ADMIN') {
    i++; q += ` AND al.entity_id = $${i}`; qParams.push(user.entity_id);
  } else if (params.entity_id) {
    i++; q += ` AND al.entity_id = $${i}`; qParams.push(params.entity_id);
  }

  if (filterAction) { i++; q += ` AND al.action = $${i}`; qParams.push(filterAction); }
  if (filterResource) { i++; q += ` AND al.resource_type = $${i}`; qParams.push(filterResource); }
  if (filterUserId) { i++; q += ` AND al.user_id = $${i}`; qParams.push(filterUserId); }
  if (dateFrom) { i++; q += ` AND al.created_at >= $${i}`; qParams.push(dateFrom); }
  if (dateTo) { i++; q += ` AND al.created_at <= $${i}`; qParams.push(dateTo); }

  q += ` ORDER BY al.created_at DESC`;
  i++; q += ` LIMIT $${i}`; qParams.push(limit);
  i++; q += ` OFFSET $${i}`; qParams.push(offset);

  const result = await query(q, qParams);

  // Get total count for pagination
  let countQ = `SELECT COUNT(*) as total FROM audit_logs al WHERE 1=1`;
  const countParams = [];
  let ci = 0;
  if (user.role !== 'SUPER_ADMIN') {
    ci++; countQ += ` AND al.entity_id = $${ci}`; countParams.push(user.entity_id);
  } else if (params.entity_id) {
    ci++; countQ += ` AND al.entity_id = $${ci}`; countParams.push(params.entity_id);
  }

  const countResult = await query(countQ, countParams);

  return json(200, {
    success: true,
    audit_logs: result.rows,
    total: parseInt(countResult.rows[0].total),
    limit,
    offset,
  }, headers);
}
