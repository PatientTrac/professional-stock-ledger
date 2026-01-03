const { query } = require('./utils/db');
const { authMiddleware, requireRole, enforceEntityScope } = require('./middleware/auth');

exports.handler = async (event, context) => {
    // Parse query parameters
    const params = event.queryStringParameters || {};
    const { action } = params;
    
    console.log(`Ledger ${action} request:`, { 
        method: event.httpMethod, 
        action
    });

    // Route the request
    switch (event.httpMethod) {
        case 'POST':
            if (action === 'create-shareholder') {
                return await handleCreateShareholder(event);
            } else if (action === 'issue-shares') {
                return await handleIssueShares(event);
            } else if (action === 'transfer-shares') {
                return await handleTransferShares(event);
            } else if (action === 'cancel-shares') {
                return await handleCancelShares(event);
            }
            break;
            
        case 'GET':
            if (action === 'shareholders') {
                return await handleGetShareholders(event, params);
            } else if (action === 'shareholder') {
                return await handleGetShareholder(event, params);
            } else if (action === 'transactions') {
                return await handleGetTransactions(event, params);
            } else if (action === 'ownership') {
                return await handleGetOwnership(event, params);
            }
            break;
            
        case 'PUT':
            if (action === 'update-shareholder') {
                return await handleUpdateShareholder(event);
            }
            break;
    }
    
    return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            success: false,
            error: 'Invalid action or method' 
        })
    };
};

async function handleCreateShareholder(event) {
    // Authenticate request
    const auth = await authMiddleware(event);
    if (auth.statusCode) return auth;
    
    const { user, headers } = auth;
    
    // Check permissions
    const canCreateShareholders = requireRole(['SUPER_ADMIN', 'ADMIN'])(user);
    if (!canCreateShareholders) {
        return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Forbidden: Insufficient permissions'
            })
        };
    }
    
    const body = JSON.parse(event.body || '{}');
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
    
    // Validate input
    if (!full_name) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Full name is required'
            })
        };
    }
    
    // Determine entity ID
    let targetEntityId;
    if (user.role === 'SUPER_ADMIN') {
        if (!entity_id) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    success: false,
                    error: 'Entity ID is required for SUPER_ADMIN'
                })
            };
        }
        targetEntityId = entity_id;
    } else {
        targetEntityId = user.entity_id;
    }
    
    try {
        // Check if shareholder with same external ID already exists in this entity
        if (external_id) {
            const existingShareholder = await query(`
                SELECT id FROM shareholders 
                WHERE entity_id = $1 AND external_id = $2
            `, [targetEntityId, external_id]);
            
            if (existingShareholder.rows.length > 0) {
                return {
                    statusCode: 409,
                    headers,
                    body: JSON.stringify({ 
                        success: false,
                        error: 'Shareholder with this external ID already exists in this entity'
                    })
                };
            }
        }
        
        // Create shareholder
        const result = await query(`
            INSERT INTO shareholders (
                entity_id, external_id, full_name, address, city,
                state, country, zip_code, tax_id, email, phone,
                shareholder_type, is_active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING *
        `, [
            targetEntityId,
            external_id,
            full_name,
            address,
            city,
            state,
            country || 'US',
            zip_code,
            tax_id,
            email,
            phone,
            shareholder_type || 'INDIVIDUAL',
            true
        ]);
        
        return {
            statusCode: 201,
            headers,
            body: JSON.stringify({
                success: true,
                shareholder: result.rows[0]
            })
        };
    } catch (error) {
        console.error('Create shareholder error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Failed to create shareholder: ' + error.message
            })
        };
    }
}

async function handleGetShareholders(event, params) {
    // Authenticate request
    const auth = await authMiddleware(event);
    if (auth.statusCode) return auth;
    
    const { user, headers } = auth;
    
    const { 
        search, 
        shareholder_type, 
        is_active,
        entity_id
    } = params;
    
    // Check entity scope
    let targetEntityId;
    if (user.role === 'SUPER_ADMIN') {
        targetEntityId = entity_id || user.entity_id;
    } else {
        targetEntityId = user.entity_id;
    }
    
    try {
        let queryText = `
            SELECT 
                s.*,
                COALESCE(
                    (SELECT SUM(shares) 
                     FROM share_transactions st
                     WHERE st.shareholder_id = s.id 
                       AND st.transaction_type IN ('ISSUANCE', 'TRANSFER')
                    ), 0
                ) as current_shares
            FROM shareholders s
            WHERE s.entity_id = $1
        `;
        
        const queryParams = [targetEntityId];
        let paramCount = 1;
        
        if (search) {
            paramCount++;
            queryText += ` AND (
                s.full_name ILIKE $${paramCount} OR
                s.external_id ILIKE $${paramCount} OR
                s.email ILIKE $${paramCount} OR
                s.tax_id ILIKE $${paramCount}
            )`;
            queryParams.push(`%${search}%`);
        }
        
        if (shareholder_type) {
            paramCount++;
            queryText += ` AND s.shareholder_type = $${paramCount}`;
            queryParams.push(shareholder_type);
        }
        
        if (is_active !== undefined) {
            paramCount++;
            queryText += ` AND s.is_active = $${paramCount}`;
            queryParams.push(is_active === 'true');
        }
        
        queryText += ' ORDER BY s.full_name';
        
        const result = await query(queryText, queryParams);
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                shareholders: result.rows
            })
        };
    } catch (error) {
        console.error('Get shareholders error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Failed to get shareholders: ' + error.message
            })
        };
    }
}

async function handleGetShareholder(event, params) {
    // Authenticate request
    const auth = await authMiddleware(event);
    if (auth.statusCode) return auth;
    
    const { user, headers } = auth;
    
    const { shareholderId } = params;
    
    if (!shareholderId) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Shareholder ID is required'
            })
        };
    }
    
    try {
        // Get shareholder with entity information
        const result = await query(`
            SELECT 
                s.*,
                e.name as entity_name
            FROM shareholders s
            LEFT JOIN entities e ON s.entity_id = e.id
            WHERE s.id = $1
        `, [shareholderId]);
        
        if (result.rows.length === 0) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ 
                    success: false,
                    error: 'Shareholder not found'
                })
            };
        }
        
        const shareholder = result.rows[0];
        
        // Check entity scope
        if (!enforceEntityScope(user, shareholder.entity_id)) {
            return {
                statusCode: 403,
                headers,
                body: JSON.stringify({ 
                    success: false,
                    error: 'Forbidden: Cannot access this shareholder'
                })
            };
        }
        
        // Get current shares and transaction history
        const transactionsResult = await query(`
            SELECT 
                st.*,
                fs.full_name as from_shareholder_name,
                ts.full_name as to_shareholder_name
            FROM share_transactions st
            LEFT JOIN shareholders fs ON st.from_shareholder_id = fs.id
            LEFT JOIN shareholders ts ON st.to_shareholder_id = ts.id
            WHERE st.shareholder_id = $1
            ORDER BY st.transaction_date DESC, st.created_at DESC
        `, [shareholderId]);
        
        // Calculate current shares
        const currentShares = transactionsResult.rows.reduce((total, tx) => {
            if (tx.transaction_type === 'ISSUANCE' || 
                (tx.transaction_type === 'TRANSFER' && tx.to_shareholder_id === parseInt(shareholderId))) {
                return total + parseFloat(tx.shares);
            } else if (tx.transaction_type === 'CANCELLATION' || 
                      tx.transaction_type === 'FORFEITURE' ||
                      (tx.transaction_type === 'TRANSFER' && tx.from_shareholder_id === parseInt(shareholderId))) {
                return total - parseFloat(tx.shares);
            }
            return total;
        }, 0);
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                shareholder: {
                    ...shareholder,
                    current_shares: currentShares
                },
                transactions: transactionsResult.rows
            })
        };
    } catch (error) {
        console.error('Get shareholder error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Failed to get shareholder: ' + error.message
            })
        };
    }
}

async function handleIssueShares(event) {
    // Authenticate request
    const auth = await authMiddleware(event);
    if (auth.statusCode) return auth;
    
    const { user, headers } = auth;
    
    // Check permissions
    const canIssueShares = requireRole(['SUPER_ADMIN', 'ADMIN'])(user);
    if (!canIssueShares) {
        return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Forbidden: Insufficient permissions'
            })
        };
    }
    
    const body = JSON.parse(event.body || '{}');
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
    
    // Validate input
    if (!shareholder_id || !transaction_date || !stock_type || !shares) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Shareholder ID, transaction date, stock type, and shares are required'
            })
        };
    }
    
    if (stock_type === 'PREFERRED' && !series) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Series is required for preferred stock'
            })
        };
    }
    
    // Validate shares is positive
    const sharesNum = parseFloat(shares);
    if (isNaN(sharesNum) || sharesNum <= 0) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Shares must be a positive number'
            })
        };
    }
    
    // Determine entity ID
    let targetEntityId;
    if (user.role === 'SUPER_ADMIN') {
        if (!entity_id) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    success: false,
                    error: 'Entity ID is required for SUPER_ADMIN'
                })
            };
        }
        targetEntityId = entity_id;
    } else {
        targetEntityId = user.entity_id;
    }
    
    try {
        // Check if shareholder exists and belongs to the entity
        const shareholderResult = await query(`
            SELECT id, entity_id FROM shareholders 
            WHERE id = $1 AND entity_id = $2 AND is_active = TRUE
        `, [shareholder_id, targetEntityId]);
        
        if (shareholderResult.rows.length === 0) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ 
                    success: false,
                    error: 'Shareholder not found or not active in this entity'
                })
            };
        }
        
        // Create share issuance transaction
        const result = await query(`
            INSERT INTO share_transactions (
                entity_id, shareholder_id, transaction_date,
                stock_type, series, shares, transaction_type,
                certificate_number, price_per_share, notes, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *
        `, [
            targetEntityId,
            shareholder_id,
            transaction_date,
            stock_type,
            series,
            sharesNum,
            'ISSUANCE',
            certificate_number,
            price_per_share ? parseFloat(price_per_share) : null,
            notes,
            user.id
        ]);
        
        return {
            statusCode: 201,
            headers,
            body: JSON.stringify({
                success: true,
                transaction: result.rows[0],
                message: 'Shares issued successfully'
            })
        };
    } catch (error) {
        console.error('Issue shares error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Failed to issue shares: ' + error.message
            })
        };
    }
}

async function handleTransferShares(event) {
    // Authenticate request
    const auth = await authMiddleware(event);
    if (auth.statusCode) return auth;
    
    const { user, headers } = auth;
    
    // Check permissions
    const canTransferShares = requireRole(['SUPER_ADMIN', 'ADMIN'])(user);
    if (!canTransferShares) {
        return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Forbidden: Insufficient permissions'
            })
        };
    }
    
    const body = JSON.parse(event.body || '{}');
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
    
    // Validate input
    if (!from_shareholder_id || !to_shareholder_id || !transaction_date || 
        !stock_type || !shares) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'All required fields must be provided'
            })
        };
    }
    
    if (from_shareholder_id === to_shareholder_id) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Cannot transfer shares to the same shareholder'
            })
        };
    }
    
    if (stock_type === 'PREFERRED' && !series) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Series is required for preferred stock'
            })
        };
    }
    
    // Validate shares is positive
    const sharesNum = parseFloat(shares);
    if (isNaN(sharesNum) || sharesNum <= 0) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Shares must be a positive number'
            })
        };
    }
    
    // Determine entity ID
    let targetEntityId;
    if (user.role === 'SUPER_ADMIN') {
        if (!entity_id) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    success: false,
                    error: 'Entity ID is required for SUPER_ADMIN'
                })
            };
        }
        targetEntityId = entity_id;
    } else {
        targetEntityId = user.entity_id;
    }
    
    try {
        // Check if shareholders exist and belong to the same entity
        const shareholdersResult = await query(`
            SELECT id, entity_id FROM shareholders 
            WHERE id IN ($1, $2) AND entity_id = $3 AND is_active = TRUE
        `, [from_shareholder_id, to_shareholder_id, targetEntityId]);
        
        if (shareholdersResult.rows.length !== 2) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ 
                    success: false,
                    error: 'One or both shareholders not found or not active in this entity'
                })
            };
        }
        
        // Check if from_shareholder has enough shares of the specified type
        const availableSharesResult = await query(`
            SELECT COALESCE(SUM(
                CASE 
                    WHEN transaction_type = 'ISSUANCE' THEN shares
                    WHEN transaction_type = 'TRANSFER' AND to_shareholder_id = $1 THEN shares
                    WHEN transaction_type = 'TRANSFER' AND from_shareholder_id = $1 THEN -shares
                    WHEN transaction_type IN ('CANCELLATION', 'FORFEITURE') THEN -shares
                    ELSE 0
                END
            ), 0) as available_shares
            FROM share_transactions
            WHERE shareholder_id = $1 
              AND stock_type = $2 
              AND (series = $3 OR (stock_type = 'COMMON' AND series IS NULL))
        `, [from_shareholder_id, stock_type, series]);
        
        const availableShares = parseFloat(availableSharesResult.rows[0].available_shares);
        
        if (availableShares < sharesNum) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    success: false,
                    error: `Insufficient shares. Available: ${availableShares}, Requested: ${sharesNum}`
                })
            };
        }
        
        // Start transaction
        await query('BEGIN');
        
        try {
            // Create transfer out transaction
            await query(`
                INSERT INTO share_transactions (
                    entity_id, shareholder_id, transaction_date,
                    stock_type, series, shares, transaction_type,
                    from_shareholder_id, to_shareholder_id,
                    certificate_number, price_per_share, notes, created_by
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            `, [
                targetEntityId,
                from_shareholder_id,
                transaction_date,
                stock_type,
                series,
                -sharesNum,
                'TRANSFER',
                from_shareholder_id,
                to_shareholder_id,
                certificate_number,
                price_per_share ? parseFloat(price_per_share) : null,
                notes,
                user.id
            ]);
            
            // Create transfer in transaction
            const transferInResult = await query(`
                INSERT INTO share_transactions (
                    entity_id, shareholder_id, transaction_date,
                    stock_type, series, shares, transaction_type,
                    from_shareholder_id, to_shareholder_id,
                    certificate_number, price_per_share, notes, created_by
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                RETURNING *
            `, [
                targetEntityId,
                to_shareholder_id,
                transaction_date,
                stock_type,
                series,
                sharesNum,
                'TRANSFER',
                from_shareholder_id,
                to_shareholder_id,
                certificate_number,
                price_per_share ? parseFloat(price_per_share) : null,
                notes,
                user.id
            ]);
            
            await query('COMMIT');
            
            return {
                statusCode: 201,
                headers,
                body: JSON.stringify({
                    success: true,
                    transaction: transferInResult.rows[0],
                    message: 'Shares transferred successfully'
                })
            };
        } catch (error) {
            await query('ROLLBACK');
            throw error;
        }
    } catch (error) {
        console.error('Transfer shares error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Failed to transfer shares: ' + error.message
            })
        };
    }
}

async function handleCancelShares(event) {
    // Authenticate request
    const auth = await authMiddleware(event);
    if (auth.statusCode) return auth;
    
    const { user, headers } = auth;
    
    // Check permissions
    const canCancelShares = requireRole(['SUPER_ADMIN', 'ADMIN'])(user);
    if (!canCancelShares) {
        return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Forbidden: Insufficient permissions'
            })
        };
    }
    
    const body = JSON.parse(event.body || '{}');
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
    
    // Validate input
    if (!shareholder_id || !transaction_date || !stock_type || !shares) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Shareholder ID, transaction date, stock type, and shares are required'
            })
        };
    }
    
    if (stock_type === 'PREFERRED' && !series) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Series is required for preferred stock'
            })
        };
    }
    
    // Validate shares is positive
    const sharesNum = parseFloat(shares);
    if (isNaN(sharesNum) || sharesNum <= 0) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Shares must be a positive number'
            })
        };
    }
    
    // Determine entity ID
    let targetEntityId;
    if (user.role === 'SUPER_ADMIN') {
        if (!entity_id) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    success: false,
                    error: 'Entity ID is required for SUPER_ADMIN'
                })
            };
        }
        targetEntityId = entity_id;
    } else {
        targetEntityId = user.entity_id;
    }
    
    try {
        // Check if shareholder exists and belongs to the entity
        const shareholderResult = await query(`
            SELECT id, entity_id FROM shareholders 
            WHERE id = $1 AND entity_id = $2 AND is_active = TRUE
        `, [shareholder_id, targetEntityId]);
        
        if (shareholderResult.rows.length === 0) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ 
                    success: false,
                    error: 'Shareholder not found or not active in this entity'
                })
            };
        }
        
        // Check if shareholder has enough shares to cancel
        const availableSharesResult = await query(`
            SELECT COALESCE(SUM(
                CASE 
                    WHEN transaction_type = 'ISSUANCE' THEN shares
                    WHEN transaction_type = 'TRANSFER' AND to_shareholder_id = $1 THEN shares
                    WHEN transaction_type = 'TRANSFER' AND from_shareholder_id = $1 THEN -shares
                    WHEN transaction_type IN ('CANCELLATION', 'FORFEITURE') THEN -shares
                    ELSE 0
                END
            ), 0) as available_shares
            FROM share_transactions
            WHERE shareholder_id = $1 
              AND stock_type = $2 
              AND (series = $3 OR (stock_type = 'COMMON' AND series IS NULL))
        `, [shareholder_id, stock_type, series]);
        
        const availableShares = parseFloat(availableSharesResult.rows[0].available_shares);
        
        if (availableShares < sharesNum) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    success: false,
                    error: `Insufficient shares. Available: ${availableShares}, Requested: ${sharesNum}`
                })
            };
        }
        
        // Create cancellation transaction
        const result = await query(`
            INSERT INTO share_transactions (
                entity_id, shareholder_id, transaction_date,
                stock_type, series, shares, transaction_type,
                certificate_number, notes, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *
        `, [
            targetEntityId,
            shareholder_id,
            transaction_date,
            stock_type,
            series,
            -sharesNum,
            'CANCELLATION',
            certificate_number,
            notes,
            user.id
        ]);
        
        return {
            statusCode: 201,
            headers,
            body: JSON.stringify({
                success: true,
                transaction: result.rows[0],
                message: 'Shares cancelled successfully'
            })
        };
    } catch (error) {
        console.error('Cancel shares error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Failed to cancel shares: ' + error.message
            })
        };
    }
}

async function handleGetTransactions(event, params) {
    // Authenticate request
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
    
    // Check entity scope
    let targetEntityId;
    if (user.role === 'SUPER_ADMIN') {
        targetEntityId = entity_id || user.entity_id;
    } else {
        targetEntityId = user.entity_id;
    }
    
    try {
        let queryText = `
            SELECT 
                st.*,
                s.full_name as shareholder_name,
                fs.full_name as from_shareholder_name,
                ts.full_name as to_shareholder_name,
                e.name as entity_name
            FROM share_transactions st
            LEFT JOIN shareholders s ON st.shareholder_id = s.id
            LEFT JOIN shareholders fs ON st.from_shareholder_id = fs.id
            LEFT JOIN shareholders ts ON st.to_shareholder_id = ts.id
            LEFT JOIN entities e ON st.entity_id = e.id
            WHERE st.entity_id = $1
        `;
        
        const queryParams = [targetEntityId];
        let paramCount = 1;
        
        if (shareholder_id) {
            paramCount++;
            queryText += ` AND st.shareholder_id = $${paramCount}`;
            queryParams.push(shareholder_id);
        }
        
        if (stock_type) {
            paramCount++;
            queryText += ` AND st.stock_type = $${paramCount}`;
            queryParams.push(stock_type);
        }
        
        if (series) {
            paramCount++;
            queryText += ` AND st.series = $${paramCount}`;
            queryParams.push(series);
        }
        
        if (transaction_type) {
            paramCount++;
            queryText += ` AND st.transaction_type = $${paramCount}`;
            queryParams.push(transaction_type);
        }
        
        if (start_date) {
            paramCount++;
            queryText += ` AND st.transaction_date >= $${paramCount}`;
            queryParams.push(start_date);
        }
        
        if (end_date) {
            paramCount++;
            queryText += ` AND st.transaction_date <= $${paramCount}`;
            queryParams.push(end_date);
        }
        
        queryText += ' ORDER BY st.transaction_date DESC, st.created_at DESC';
        
        const result = await query(queryText, queryParams);
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                transactions: result.rows
            })
        };
    } catch (error) {
        console.error('Get transactions error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Failed to get transactions: ' + error.message
            })
        };
    }
}

async function handleGetOwnership(event, params) {
    // Authenticate request
    const auth = await authMiddleware(event);
    if (auth.statusCode) return auth;
    
    const { user, headers } = auth;
    
    const { 
        stock_type, 
        series,
        status,
        entity_id
    } = params;
    
    // Check entity scope
    let targetEntityId;
    if (user.role === 'SUPER_ADMIN') {
        targetEntityId = entity_id || user.entity_id;
    } else {
        targetEntityId = user.entity_id;
    }
    
    try {
        let queryText = `
            WITH shareholder_balances AS (
                SELECT 
                    s.id as shareholder_id,
                    s.full_name,
                    s.address,
                    s.city,
                    s.state,
                    s.country,
                    s.zip_code,
                    s.tax_id,
                    s.email,
                    s.phone,
                    s.shareholder_type,
                    s.is_active as shareholder_active,
                    st.stock_type,
                    st.series,
                    COALESCE(SUM(
                        CASE 
                            WHEN st.transaction_type = 'ISSUANCE' THEN st.shares
                            WHEN st.transaction_type = 'TRANSFER' AND st.to_shareholder_id = s.id THEN st.shares
                            WHEN st.transaction_type = 'TRANSFER' AND st.from_shareholder_id = s.id THEN -st.shares
                            WHEN st.transaction_type IN ('CANCELLATION', 'FORFEITURE') THEN -st.shares
                            ELSE 0
                        END
                    ), 0) as current_shares
                FROM shareholders s
                LEFT JOIN share_transactions st ON s.id = st.shareholder_id
                WHERE s.entity_id = $1
        `;
        
        const queryParams = [targetEntityId];
        let paramCount = 1;
        
        if (stock_type) {
            paramCount++;
            queryText += ` AND st.stock_type = $${paramCount}`;
            queryParams.push(stock_type);
        }
        
        if (series) {
            paramCount++;
            queryText += ` AND st.series = $${paramCount}`;
            queryParams.push(series);
        }
        
        queryText += `
                GROUP BY s.id, st.stock_type, st.series
                HAVING COALESCE(SUM(
                    CASE 
                        WHEN st.transaction_type = 'ISSUANCE' THEN st.shares
                        WHEN st.transaction_type = 'TRANSFER' AND st.to_shareholder_id = s.id THEN st.shares
                        WHEN st.transaction_type = 'TRANSFER' AND st.from_shareholder_id = s.id THEN -st.shares
                        WHEN st.transaction_type IN ('CANCELLATION', 'FORFEITURE') THEN -st.shares
                        ELSE 0
                    END
                ), 0) > 0
            )
            SELECT 
                sb.*,
                CASE 
                    WHEN sb.current_shares > 0 THEN 'ACTIVE'
                    ELSE 'INACTIVE'
                END as status
            FROM shareholder_balances sb
            WHERE 1=1
        `;
        
        if (status === 'ACTIVE') {
            queryText += ` AND sb.current_shares > 0`;
        } else if (status === 'INACTIVE') {
            queryText += ` AND sb.current_shares = 0`;
        }
        
        queryText += ` ORDER BY sb.stock_type, sb.series, sb.full_name`;
        
        const result = await query(queryText, queryParams);
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                ownership: result.rows
            })
        };
    } catch (error) {
        console.error('Get ownership error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Failed to get ownership: ' + error.message
            })
        };
    }
}

async function handleUpdateShareholder(event) {
    // Authenticate request
    const auth = await authMiddleware(event);
    if (auth.statusCode) return auth;
    
    const { user, headers } = auth;
    
    // Check permissions
    const canUpdateShareholders = requireRole(['SUPER_ADMIN', 'ADMIN'])(user);
    if (!canUpdateShareholders) {
        return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Forbidden: Insufficient permissions'
            })
        };
    }
    
    const body = JSON.parse(event.body || '{}');
    const { shareholderId, ...updates } = body;
    
    if (!shareholderId) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Shareholder ID is required'
            })
        };
    }
    
    if (Object.keys(updates).length === 0) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'No fields to update'
            })
        };
    }
    
    try {
        // Check if shareholder exists and user has access
        const checkResult = await query(`
            SELECT id, entity_id FROM shareholders WHERE id = $1
        `, [shareholderId]);
        
        if (checkResult.rows.length === 0) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ 
                    success: false,
                    error: 'Shareholder not found'
                })
            };
        }
        
        const shareholder = checkResult.rows[0];
        
        // Check entity scope
        if (!enforceEntityScope(user, shareholder.entity_id)) {
            return {
                statusCode: 403,
                headers,
                body: JSON.stringify({ 
                    success: false,
                    error: 'Forbidden: Cannot update this shareholder'
                })
            };
        }
        
        // Build update query
        const updateFields = [];
        const params = [];
        let paramCount = 0;
        
        const allowedFields = [
            'external_id', 'full_name', 'address', 'city', 'state',
            'country', 'zip_code', 'tax_id', 'email', 'phone',
            'shareholder_type', 'is_active'
        ];
        
        for (const [key, value] of Object.entries(updates)) {
            if (allowedFields.includes(key)) {
                paramCount++;
                updateFields.push(`${key} = $${paramCount}`);
                params.push(value);
            }
        }
        
        if (updateFields.length === 0) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    success: false,
                    error: 'No valid fields to update'
                })
            };
        }
        
        paramCount++;
        updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
        
        paramCount++;
        params.push(shareholderId);
        
        const updateQuery = `
            UPDATE shareholders 
            SET ${updateFields.join(', ')}
            WHERE id = $${paramCount}
            RETURNING *
        `;
        
        const result = await query(updateQuery, params);
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                shareholder: result.rows[0]
            })
        };
    } catch (error) {
        console.error('Update shareholder error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Failed to update shareholder: ' + error.message
            })
        };
    }
}