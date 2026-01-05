const { query } = require('./utils/db');
const { authMiddleware, requireRole, enforceEntityScope } = require('./middleware/auth');

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

  console.log('LEDGER:', { method: event.httpMethod, action });

  try {
    // ---- ROUTES ----
    if (event.httpMethod === 'GET') {
      if (action === 'shareholders') return await handleGetShareholders(event, params);
      if (action === 'shareholder') return await handleGetShareholder(event, params);
      if (action === 'transactions') return await handleGetTransactions(event, params);
      if (action === 'ownership') return await handleGetOwnership(event, params);

      return json(400, { success: false, error: 'Invalid action or method' });
    }

    if (event.httpMethod === 'POST') {
      if (action === 'create-shareholder') return await handleCreateShareholder(event);
      if (action === 'issue-shares') return await handleIssueShares(event);
      if (action === 'transfer-shares') return await handleTransferShares(event);
      if (action === 'cancel-shares') return await handleCancelShares(event);

      return json(400, { success: false, error: 'Invalid action or method' });
    }

    if (event.httpMethod === 'PUT') {
      if (action === 'update-shareholder') return await handleUpdateShareholder(event);
      return json(400, { success: false, error: 'Invalid action or method' });
    }

    return json(405, { success: false, error: 'Method not allowed' });
  } catch (e) {
    console.error('LEDGER ERROR:', e);
    return json(500, { success: false, error: 'Server error: ' + e.message });
  }
};

// ------------------------------
// Helpers
// ------------------------------
function parseBody(event) {
  if (!event.body) return {};
  try { return JSON.parse(event.body); }
  catch { throw new Error('Invalid JSON in request body'); }
}

function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function upper(x) {
  return String(x ?? '').trim().toUpperCase();
}

function normalizeSeries(x) {
  const s = String(x ?? '').trim();
  return s ? s : null;
}

// Decide entity based on role + optional entity_id param/body
function resolveTargetEntityId(user, providedEntityId) {
  if ((user.role || '').toUpperCase() === 'SUPER_ADMIN') {
    // Super admin may pass entity_id; if not passed, fallback to user's entity_id
    return providedEntityId || user.entity_id;
  }
  // Admin/User are scoped to their entity
  return user.entity_id;
}

/**
 * Validate the stock_type + series against the new tables:
 *  - entity_stock_types (active)
 *  - entity_stock_type_series (active) if supports_series
 *
 * Returns:
 *  {
 *    stock_type_id,
 *    stock_type,
 *    supports_series,
 *    series // normalized (null if not required)
 *  }
 */
async function validateStockTypeAndSeries({ entity_id, stock_type, series }) {
  const st = upper(stock_type);
  if (!st) throw new Error('stock_type is required');

  const tRes = await query(
    `
      SELECT id, stock_type, supports_series, is_active
      FROM entity_stock_types
      WHERE entity_id = $1 AND stock_type = $2
      LIMIT 1
    `,
    [entity_id, st]
  );

  if (!tRes.rows.length) {
    throw new Error(`Invalid stock_type "${st}" for this entity`);
  }
  const typeRow = tRes.rows[0];

  if (typeRow.is_active === false) {
    throw new Error(`Stock type "${st}" is inactive for this entity`);
  }

  const supportsSeries = !!typeRow.supports_series;
  const normSeries = normalizeSeries(series);

  if (supportsSeries) {
    if (!normSeries) {
      throw new Error(`Series is required for stock type "${st}"`);
    }

    const sRes = await query(
      `
        SELECT id, series, is_active
        FROM entity_stock_type_series
        WHERE entity_stock_type_id = $1 AND series = $2
        LIMIT 1
      `,
      [typeRow.id, normSeries]
    );

    if (!sRes.rows.length) {
      throw new Error(`Invalid series "${normSeries}" for stock type "${st}"`);
    }
    if (sRes.rows[0].is_active === false) {
      throw new Error(`Series "${normSeries}" is inactive for stock type "${st}"`);
    }
  } else {
    // If type doesn't support series, force it to NULL to keep data consistent
    if (normSeries) {
      throw new Error(`Series is not allowed for stock type "${st}"`);
    }
  }

  return {
    stock_type_id: typeRow.id,
    stock_type: typeRow.stock_type,
    supports_series: supportsSeries,
    series: supportsSeries ? normSeries : null,
  };
}

// ------------------------------
// CREATE SHAREHOLDER
// ------------------------------
async function handleCreateShareholder(event) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  const canCreate = requireRole(['SUPER_ADMIN', 'ADMIN'])(user);
  if (!canCreate) return json(403, { success:false, error:'Forbidden: Insufficient permissions' }, headers);

  const body = parseBody(event);
  const {
    external_id,
    full_name,
    address,
    city,
    state,
    country,
    zip_code,
    tax_id,
    email,
    phone,
    shareholder_type,
    entity_id
  } = body;

  if (!full_name) return json(400, { success:false, error:'Full name is required' }, headers);

  const targetEntityId = resolveTargetEntityId(user, entity_id);
  if (!targetEntityId) return json(400, { success:false, error:'Entity ID is required' }, headers);

  if (!enforceEntityScope(user, targetEntityId)) {
    return json(403, { success:false, error:'Forbidden: Cannot create in this entity' }, headers);
  }

  try {
    if (external_id) {
      const existing = await query(
        `SELECT id FROM shareholders WHERE entity_id = $1 AND external_id = $2`,
        [targetEntityId, external_id]
      );
      if (existing.rows.length) {
        return json(409, { success:false, error:'Shareholder with this external ID already exists in this entity' }, headers);
      }
    }

    const result = await query(
      `
      INSERT INTO shareholders (
        entity_id, external_id, full_name, address, city,
        state, country, zip_code, tax_id, email, phone,
        shareholder_type, is_active
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *
      `,
      [
        targetEntityId,
        external_id || null,
        full_name,
        address || null,
        city || null,
        state || null,
        country || 'US',
        zip_code || null,
        tax_id || null,
        email || null,
        phone || null,
        shareholder_type || 'INDIVIDUAL',
        true
      ]
    );

    return json(201, { success:true, shareholder: result.rows[0] }, headers);
  } catch (e) {
    console.error('Create shareholder error:', e);
    return json(500, { success:false, error:'Failed to create shareholder: ' + e.message }, headers);
  }
}

// ------------------------------
// GET SHAREHOLDERS (list)
// ------------------------------
async function handleGetShareholders(event, params) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  const { search, shareholder_type, is_active, entity_id } = params;
  const targetEntityId = resolveTargetEntityId(user, entity_id);
  if (!targetEntityId) return json(400, { success:false, error:'Entity not resolved' }, headers);

  try {
    let queryText = `
      SELECT
        s.*,
        COALESCE((
          SELECT SUM(st.shares)
          FROM share_transactions st
          WHERE st.shareholder_id = s.id
        ), 0) AS current_shares
      FROM shareholders s
      WHERE s.entity_id = $1
    `;

    const queryParams = [targetEntityId];
    let i = 1;

    if (search) {
      i++;
      queryText += ` AND (
        s.full_name ILIKE $${i} OR
        s.external_id ILIKE $${i} OR
        s.email ILIKE $${i} OR
        s.tax_id ILIKE $${i}
      )`;
      queryParams.push(`%${search}%`);
    }

    if (shareholder_type) {
      i++;
      queryText += ` AND s.shareholder_type = $${i}`;
      queryParams.push(shareholder_type);
    }

    if (is_active !== undefined) {
      i++;
      queryText += ` AND s.is_active = $${i}`;
      queryParams.push(is_active === 'true');
    }

    queryText += ` ORDER BY s.full_name`;

    const result = await query(queryText, queryParams);
    return json(200, { success:true, shareholders: result.rows }, headers);
  } catch (e) {
    console.error('Get shareholders error:', e);
    return json(500, { success:false, error:'Failed to get shareholders: ' + e.message }, headers);
  }
}

// ------------------------------
// GET SHAREHOLDER (detail + tx)
// ------------------------------
async function handleGetShareholder(event, params) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  const { shareholderId } = params;
  if (!shareholderId) return json(400, { success:false, error:'Shareholder ID is required' }, headers);

  try {
    const result = await query(
      `
      SELECT s.*, e.name AS entity_name
      FROM shareholders s
      LEFT JOIN entities e ON s.entity_id = e.id
      WHERE s.id = $1
      `,
      [shareholderId]
    );

    if (!result.rows.length) return json(404, { success:false, error:'Shareholder not found' }, headers);

    const shareholder = result.rows[0];

    if (!enforceEntityScope(user, shareholder.entity_id)) {
      return json(403, { success:false, error:'Forbidden: Cannot access this shareholder' }, headers);
    }

    const tx = await query(
      `
      SELECT
        st.*,
        fs.full_name AS from_shareholder_name,
        ts.full_name AS to_shareholder_name
      FROM share_transactions st
      LEFT JOIN shareholders fs ON st.from_shareholder_id = fs.id
      LEFT JOIN shareholders ts ON st.to_shareholder_id = ts.id
      WHERE st.shareholder_id = $1
      ORDER BY st.transaction_date DESC, st.created_at DESC
      `,
      [shareholderId]
    );

    const currentShares = tx.rows.reduce((total, row) => total + Number(row.shares || 0), 0);

    return json(200, {
      success: true,
      shareholder: { ...shareholder, current_shares: currentShares },
      transactions: tx.rows
    }, headers);
  } catch (e) {
    console.error('Get shareholder error:', e);
    return json(500, { success:false, error:'Failed to get shareholder: ' + e.message }, headers);
  }
}

// ------------------------------
// ISSUE SHARES
// ------------------------------
async function handleIssueShares(event) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  const canIssue = requireRole(['SUPER_ADMIN', 'ADMIN'])(user);
  if (!canIssue) return json(403, { success:false, error:'Forbidden: Insufficient permissions' }, headers);

  const body = parseBody(event);
  const {
    shareholder_id,
    transaction_date,
    stock_type,
    series,
    shares,
    certificate_number,
    price_per_share,
    notes,
    entity_id
  } = body;

  if (!shareholder_id || !transaction_date || !stock_type || shares === undefined) {
    return json(400, { success:false, error:'shareholder_id, transaction_date, stock_type, shares are required' }, headers);
  }

  const sharesNum = toNumber(shares);
  if (sharesNum === null || sharesNum <= 0) {
    return json(400, { success:false, error:'Shares must be a positive number' }, headers);
  }

  const targetEntityId = resolveTargetEntityId(user, entity_id);
  if (!targetEntityId) return json(400, { success:false, error:'Entity not resolved' }, headers);

  try {
    const sh = await query(
      `SELECT id, entity_id FROM shareholders WHERE id = $1 AND entity_id = $2 AND is_active = TRUE`,
      [shareholder_id, targetEntityId]
    );
    if (!sh.rows.length) {
      return json(404, { success:false, error:'Shareholder not found or not active in this entity' }, headers);
    }

    // ✅ validate stock_type + series from DB
    const v = await validateStockTypeAndSeries({
      entity_id: targetEntityId,
      stock_type,
      series
    });

    const result = await query(
      `
      INSERT INTO share_transactions (
        entity_id, shareholder_id, transaction_date,
        stock_type, series, shares, transaction_type,
        certificate_number, price_per_share, notes, created_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,'ISSUANCE',$7,$8,$9,$10)
      RETURNING *
      `,
      [
        targetEntityId,
        shareholder_id,
        transaction_date,
        v.stock_type,
        v.series,
        sharesNum,
        certificate_number || null,
        price_per_share !== undefined && price_per_share !== null ? toNumber(price_per_share) : null,
        notes || null,
        user.id
      ]
    );

    return json(201, { success:true, transaction: result.rows[0], message:'Shares issued successfully' }, headers);
  } catch (e) {
    console.error('Issue shares error:', e);
    return json(500, { success:false, error:'Failed to issue shares: ' + e.message }, headers);
  }
}

// ------------------------------
// TRANSFER SHARES
// ------------------------------
async function handleTransferShares(event) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  const canTransfer = requireRole(['SUPER_ADMIN', 'ADMIN'])(user);
  if (!canTransfer) return json(403, { success:false, error:'Forbidden: Insufficient permissions' }, headers);

  const body = parseBody(event);
  const {
    from_shareholder_id,
    to_shareholder_id,
    transaction_date,
    stock_type,
    series,
    shares,
    certificate_number,
    price_per_share,
    notes,
    entity_id
  } = body;

  if (!from_shareholder_id || !to_shareholder_id || !transaction_date || !stock_type || shares === undefined) {
    return json(400, { success:false, error:'from_shareholder_id, to_shareholder_id, transaction_date, stock_type, shares are required' }, headers);
  }

  if (String(from_shareholder_id) === String(to_shareholder_id)) {
    return json(400, { success:false, error:'Cannot transfer shares to the same shareholder' }, headers);
  }

  const sharesNum = toNumber(shares);
  if (sharesNum === null || sharesNum <= 0) {
    return json(400, { success:false, error:'Shares must be a positive number' }, headers);
  }

  const targetEntityId = resolveTargetEntityId(user, entity_id);
  if (!targetEntityId) return json(400, { success:false, error:'Entity not resolved' }, headers);

  try {
    const holders = await query(
      `SELECT id FROM shareholders WHERE id IN ($1,$2) AND entity_id = $3 AND is_active = TRUE`,
      [from_shareholder_id, to_shareholder_id, targetEntityId]
    );
    if (holders.rows.length !== 2) {
      return json(404, { success:false, error:'One or both shareholders not found or not active in this entity' }, headers);
    }

    // ✅ validate stock_type + series from DB
    const v = await validateStockTypeAndSeries({
      entity_id: targetEntityId,
      stock_type,
      series
    });

    // Available shares for FROM holder in that stock/series:
    const avail = await query(
      `
      SELECT COALESCE(SUM(st.shares), 0) AS available_shares
      FROM share_transactions st
      WHERE st.shareholder_id = $1
        AND st.stock_type = $2
        AND ( ($3::text IS NULL AND st.series IS NULL) OR (st.series = $3::text) )
      `,
      [from_shareholder_id, v.stock_type, v.series]
    );

    const availableShares = Number(avail.rows[0].available_shares || 0);
    if (availableShares < sharesNum) {
      return json(400, { success:false, error:`Insufficient shares. Available: ${availableShares}, Requested: ${sharesNum}` }, headers);
    }

    await query('BEGIN');

    try {
      // OUT entry (negative)
      await query(
        `
        INSERT INTO share_transactions (
          entity_id, shareholder_id, transaction_date,
          stock_type, series, shares, transaction_type,
          from_shareholder_id, to_shareholder_id,
          certificate_number, price_per_share, notes, created_by
        )
        VALUES ($1,$2,$3,$4,$5,$6,'TRANSFER',$7,$8,$9,$10,$11,$12)
        `,
        [
          targetEntityId,
          from_shareholder_id,
          transaction_date,
          v.stock_type,
          v.series,
          -sharesNum,
          from_shareholder_id,
          to_shareholder_id,
          certificate_number || null,
          price_per_share !== undefined && price_per_share !== null ? toNumber(price_per_share) : null,
          notes || null,
          user.id
        ]
      );

      // IN entry (positive)
      const transferIn = await query(
        `
        INSERT INTO share_transactions (
          entity_id, shareholder_id, transaction_date,
          stock_type, series, shares, transaction_type,
          from_shareholder_id, to_shareholder_id,
          certificate_number, price_per_share, notes, created_by
        )
        VALUES ($1,$2,$3,$4,$5,$6,'TRANSFER',$7,$8,$9,$10,$11,$12)
        RETURNING *
        `,
        [
          targetEntityId,
          to_shareholder_id,
          transaction_date,
          v.stock_type,
          v.series,
          sharesNum,
          from_shareholder_id,
          to_shareholder_id,
          certificate_number || null,
          price_per_share !== undefined && price_per_share !== null ? toNumber(price_per_share) : null,
          notes || null,
          user.id
        ]
      );

      await query('COMMIT');

      return json(201, { success:true, transaction: transferIn.rows[0], message:'Shares transferred successfully' }, headers);
    } catch (e) {
      await query('ROLLBACK');
      throw e;
    }
  } catch (e) {
    console.error('Transfer shares error:', e);
    return json(500, { success:false, error:'Failed to transfer shares: ' + e.message }, headers);
  }
}

// ------------------------------
// CANCEL SHARES
// ------------------------------
async function handleCancelShares(event) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  const canCancel = requireRole(['SUPER_ADMIN', 'ADMIN'])(user);
  if (!canCancel) return json(403, { success:false, error:'Forbidden: Insufficient permissions' }, headers);

  const body = parseBody(event);
  const {
    shareholder_id,
    transaction_date,
    stock_type,
    series,
    shares,
    certificate_number,
    notes,
    entity_id
  } = body;

  if (!shareholder_id || !transaction_date || !stock_type || shares === undefined) {
    return json(400, { success:false, error:'shareholder_id, transaction_date, stock_type, shares are required' }, headers);
  }

  const sharesNum = toNumber(shares);
  if (sharesNum === null || sharesNum <= 0) {
    return json(400, { success:false, error:'Shares must be a positive number' }, headers);
  }

  const targetEntityId = resolveTargetEntityId(user, entity_id);
  if (!targetEntityId) return json(400, { success:false, error:'Entity not resolved' }, headers);

  try {
    const sh = await query(
      `SELECT id FROM shareholders WHERE id = $1 AND entity_id = $2 AND is_active = TRUE`,
      [shareholder_id, targetEntityId]
    );
    if (!sh.rows.length) {
      return json(404, { success:false, error:'Shareholder not found or not active in this entity' }, headers);
    }

    // ✅ validate stock_type + series from DB
    const v = await validateStockTypeAndSeries({
      entity_id: targetEntityId,
      stock_type,
      series
    });

    // Available shares for that holder/stock/series:
    const avail = await query(
      `
      SELECT COALESCE(SUM(st.shares), 0) AS available_shares
      FROM share_transactions st
      WHERE st.shareholder_id = $1
        AND st.stock_type = $2
        AND ( ($3::text IS NULL AND st.series IS NULL) OR (st.series = $3::text) )
      `,
      [shareholder_id, v.stock_type, v.series]
    );

    const availableShares = Number(avail.rows[0].available_shares || 0);
    if (availableShares < sharesNum) {
      return json(400, { success:false, error:`Insufficient shares. Available: ${availableShares}, Requested: ${sharesNum}` }, headers);
    }

    const result = await query(
      `
      INSERT INTO share_transactions (
        entity_id, shareholder_id, transaction_date,
        stock_type, series, shares, transaction_type,
        certificate_number, notes, created_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,'CANCELLATION',$7,$8,$9)
      RETURNING *
      `,
      [
        targetEntityId,
        shareholder_id,
        transaction_date,
        v.stock_type,
        v.series,
        -sharesNum,
        certificate_number || null,
        notes || null,
        user.id
      ]
    );

    return json(201, { success:true, transaction: result.rows[0], message:'Shares cancelled successfully' }, headers);
  } catch (e) {
    console.error('Cancel shares error:', e);
    return json(500, { success:false, error:'Failed to cancel shares: ' + e.message }, headers);
  }
}

// ------------------------------
// GET TRANSACTIONS
// ------------------------------
async function handleGetTransactions(event, params) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  const {
    shareholder_id,
    stock_type,
    series,
    transaction_type,
    start_date,
    end_date,
    entity_id
  } = params;

  const targetEntityId = resolveTargetEntityId(user, entity_id);
  if (!targetEntityId) return json(400, { success:false, error:'Entity not resolved' }, headers);

  try {
    let qText = `
      SELECT
        st.*,
        s.full_name AS shareholder_name,
        fs.full_name AS from_shareholder_name,
        ts.full_name AS to_shareholder_name,
        e.name AS entity_name
      FROM share_transactions st
      LEFT JOIN shareholders s ON st.shareholder_id = s.id
      LEFT JOIN shareholders fs ON st.from_shareholder_id = fs.id
      LEFT JOIN shareholders ts ON st.to_shareholder_id = ts.id
      LEFT JOIN entities e ON st.entity_id = e.id
      WHERE st.entity_id = $1
    `;

    const qParams = [targetEntityId];
    let i = 1;

    if (shareholder_id) { i++; qText += ` AND st.shareholder_id = $${i}`; qParams.push(shareholder_id); }
    if (stock_type)     { i++; qText += ` AND st.stock_type = $${i}`; qParams.push(upper(stock_type)); }
    if (series)         { i++; qText += ` AND st.series = $${i}`; qParams.push(series); }
    if (transaction_type){ i++; qText += ` AND st.transaction_type = $${i}`; qParams.push(upper(transaction_type)); }
    if (start_date)     { i++; qText += ` AND st.transaction_date >= $${i}`; qParams.push(start_date); }
    if (end_date)       { i++; qText += ` AND st.transaction_date <= $${i}`; qParams.push(end_date); }

    qText += ` ORDER BY st.transaction_date DESC, st.created_at DESC`;

    const result = await query(qText, qParams);
    return json(200, { success:true, transactions: result.rows }, headers);
  } catch (e) {
    console.error('Get transactions error:', e);
    return json(500, { success:false, error:'Failed to get transactions: ' + e.message }, headers);
  }
}

// ------------------------------
// GET OWNERSHIP (used by grid)
// ------------------------------
async function handleGetOwnership(event, params) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  const { stock_type, series, status, entity_id } = params;

  const targetEntityId = resolveTargetEntityId(user, entity_id);
  if (!targetEntityId) return json(400, { success:false, error:'Entity not resolved' }, headers);

  try {
    // Important: keep LEFT JOIN, but put stock_type/series filters in JOIN condition
    // so shareholders still show even if they have no transactions.
    let qText = `
      WITH balances AS (
        SELECT
          s.id AS shareholder_id,
          s.full_name,
          s.email,
          s.tax_id,
          s.shareholder_type,
          s.is_active AS shareholder_active,
          st.stock_type,
          st.series,
          COALESCE(SUM(st.shares), 0) AS current_shares
        FROM shareholders s
        LEFT JOIN share_transactions st
          ON st.shareholder_id = s.id
          AND st.entity_id = $1
    `;

    const qParams = [targetEntityId];
    let i = 1;

    if (stock_type) {
      i++;
      qText += ` AND st.stock_type = $${i}`;
      qParams.push(upper(stock_type));
    }

    if (series) {
      i++;
      qText += ` AND st.series = $${i}`;
      qParams.push(series);
    }

    qText += `
        WHERE s.entity_id = $1
        GROUP BY s.id, st.stock_type, st.series
      )
      SELECT
        b.*,
        CASE WHEN b.current_shares > 0 THEN 'ACTIVE' ELSE 'INACTIVE' END AS status
      FROM balances b
      WHERE 1=1
    `;

    if (status === 'ACTIVE') qText += ` AND b.current_shares > 0`;
    if (status === 'INACTIVE') qText += ` AND b.current_shares = 0`;

    qText += ` ORDER BY b.stock_type NULLS FIRST, b.series NULLS FIRST, b.full_name`;

    const result = await query(qText, qParams);
    return json(200, { success:true, ownership: result.rows }, headers);
  } catch (e) {
    console.error('Get ownership error:', e);
    return json(500, { success:false, error:'Failed to get ownership: ' + e.message }, headers);
  }
}

// ------------------------------
// UPDATE SHAREHOLDER
// ------------------------------
async function handleUpdateShareholder(event) {
  const auth = await authMiddleware(event);
  if (auth.statusCode) return auth;
  const { user, headers } = auth;

  const canUpdate = requireRole(['SUPER_ADMIN', 'ADMIN'])(user);
  if (!canUpdate) return json(403, { success:false, error:'Forbidden: Insufficient permissions' }, headers);

  const body = parseBody(event);
  const { shareholderId, ...updates } = body;

  if (!shareholderId) return json(400, { success:false, error:'Shareholder ID is required' }, headers);

  const allowedFields = new Set([
    'external_id','full_name','address','city','state','country','zip_code',
    'tax_id','email','phone','shareholder_type','is_active'
  ]);

  const keys = Object.keys(updates).filter(k => allowedFields.has(k));
  if (!keys.length) return json(400, { success:false, error:'No valid fields to update' }, headers);

  try {
    const check = await query(`SELECT id, entity_id FROM shareholders WHERE id = $1`, [shareholderId]);
    if (!check.rows.length) return json(404, { success:false, error:'Shareholder not found' }, headers);

    if (!enforceEntityScope(user, check.rows[0].entity_id)) {
      return json(403, { success:false, error:'Forbidden: Cannot update this shareholder' }, headers);
    }

    const sets = [];
    const params = [];
    let i = 0;

    for (const k of keys) {
      i++;
      sets.push(`${k} = $${i}`);
      params.push(updates[k]);
    }

    sets.push(`updated_at = CURRENT_TIMESTAMP`);

    i++;
    params.push(shareholderId);

    const qText = `
      UPDATE shareholders
      SET ${sets.join(', ')}
      WHERE id = $${i}
      RETURNING *
    `;

    const result = await query(qText, params);
    return json(200, { success:true, shareholder: result.rows[0] }, headers);
  } catch (e) {
    console.error('Update shareholder error:', e);
    return json(500, { success:false, error:'Failed to update shareholder: ' + e.message }, headers);
  }
}
