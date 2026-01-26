const { query } = require('./utils/db');
const { authMiddleware, requireRole, enforceEntityScope } = require('./middleware/auth');

exports.handler = async (event, context) => {
    // Parse query parameters
    const params = event.queryStringParameters || {};
    const { action } = params;
    
    console.log(`Reports ${action} request:`, { 
        method: event.httpMethod, 
        action
    });

    // Route the request
    switch (event.httpMethod) {
        case 'GET':
            if (action === 'ownership-report') {
                return await handleOwnershipReport(event, params);
            } else if (action === 'transaction-history') {
                return await handleTransactionHistory(event, params);
            } else if (action === 'capital-stock') {
                return await handleCapitalStockReport(event, params);
            } else if (action === 'shareholder-statement') {
                return await handleShareholderStatement(event, params);
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

async function handleOwnershipReport(event, params) {
    // Authenticate request
    const auth = await authMiddleware(event);
    if (auth.statusCode) return auth;
    
    const { user, headers } = auth;
    
    const { 
        entity_id,
        entity_stock_type_id,
        entity_stock_series_id,
        status,
        format = 'json'
    } = params;
    
    // Check entity scope
    let targetEntityId;
    if (user.role === 'SUPER_ADMIN') {
        targetEntityId = entity_id || user.entity_id;
    } else {
        targetEntityId = user.entity_id;
    }
    
    try {
        // Get entity information
        const entityResult = await query(`
            SELECT id, name, legal_name, address, city, state, 
                   country, zip_code, phone, email
            FROM entities
            WHERE id = $1
        `, [targetEntityId]);
        
        if (entityResult.rows.length === 0) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ 
                    success: false,
                    error: 'Entity not found'
                })
            };
        }
        
        const entity = entityResult.rows[0];

        // Get all active stock types for this entity (for dynamic columns)
        const stockTypesResult = await query(`
            SELECT est.id, est.stock_type, est.display_name, est.supports_series
            FROM entity_stock_types est
            WHERE est.entity_id = $1 AND est.is_active = TRUE
            ORDER BY 
                CASE est.stock_type 
                    WHEN 'COMMON' THEN 1 
                    WHEN 'PREFERRED' THEN 2 
                    WHEN 'WARRANT' THEN 3 
                    ELSE 4 
                END
        `, [targetEntityId]);

        // Get all active series for this entity's stock types
        const seriesResult = await query(`
            SELECT ess.id, ess.entity_stock_type_id, ess.series, est.stock_type
            FROM entity_stock_series ess
            JOIN entity_stock_types est ON est.id = ess.entity_stock_type_id
            WHERE est.entity_id = $1 AND ess.is_active = TRUE AND est.is_active = TRUE
            ORDER BY est.stock_type, ess.series
        `, [targetEntityId]);
        
        // Build column definitions for grid (stock_types + series)
        const columns = [];
        stockTypesResult.rows.forEach(st => {
            if (st.supports_series) {
                // Add series columns under this stock type
                const seriesForType = seriesResult.rows.filter(s => s.entity_stock_type_id === st.id);
                seriesForType.forEach(s => {
                    columns.push({
                        id: `${st.id}_${s.id}`,
                        entity_stock_type_id: st.id,
                        entity_stock_series_id: s.id,
                        stock_type: st.stock_type,
                        display_name: st.display_name,
                        series: s.series,
                        header: `${st.display_name} ${s.series}`,
                        supports_series: true
                    });
                });
            } else {
                // No series - single column for this stock type
                columns.push({
                    id: `${st.id}_null`,
                    entity_stock_type_id: st.id,
                    entity_stock_series_id: null,
                    stock_type: st.stock_type,
                    display_name: st.display_name,
                    series: null,
                    header: st.display_name,
                    supports_series: false
                });
            }
        });

        // Get ownership data grouped by shareholder, stock type, and series (using IDs)
        let queryText = `
            WITH shareholder_balances AS (
                SELECT 
                    s.id as shareholder_id,
                    s.external_id,
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
                    st.entity_stock_type_id,
                    st.entity_stock_series_id,
                    COALESCE(SUM(
                        CASE 
                            WHEN st.transaction_type = 'ISSUANCE' THEN st.shares
                            WHEN st.transaction_type = 'TRANSFER' AND st.to_shareholder_id = s.id THEN st.shares
                            WHEN st.transaction_type = 'TRANSFER' AND st.from_shareholder_id = s.id THEN -st.shares
                            WHEN st.transaction_type IN ('CANCELLATION', 'FORFEITURE') THEN -st.shares
                            ELSE 0
                        END
                    ), 0) as current_shares,
                    MIN(CASE 
                        WHEN st.transaction_type = 'ISSUANCE' THEN st.transaction_date
                        ELSE NULL
                    END) as first_issue_date
                FROM shareholders s
                LEFT JOIN share_transactions st ON s.id = st.shareholder_id
                WHERE s.entity_id = $1
        `;
        
        const queryParams = [targetEntityId];
        let paramCount = 1;
        
        if (entity_stock_type_id) {
            paramCount++;
            queryText += ` AND st.entity_stock_type_id = $${paramCount}`;
            queryParams.push(entity_stock_type_id);
        }
        
        if (entity_stock_series_id) {
            paramCount++;
            queryText += ` AND st.entity_stock_series_id = $${paramCount}`;
            queryParams.push(entity_stock_series_id);
        }
        
        queryText += `
                GROUP BY s.id, st.entity_stock_type_id, st.entity_stock_series_id
            )
            SELECT 
                sb.*,
                est.stock_type,
                est.display_name as stock_type_name,
                ess.series,
                CASE 
                    WHEN sb.current_shares > 0 THEN 'ACTIVE'
                    ELSE 'INACTIVE'
                END as status
            FROM shareholder_balances sb
            LEFT JOIN entity_stock_types est ON est.id = sb.entity_stock_type_id
            LEFT JOIN entity_stock_series ess ON ess.id = sb.entity_stock_series_id
            WHERE 1=1
        `;
        
        if (status === 'ACTIVE') {
            queryText += ` AND sb.current_shares > 0`;
        } else if (status === 'INACTIVE') {
            queryText += ` AND sb.current_shares = 0`;
        }
        
        queryText += ` ORDER BY sb.full_name, est.stock_type, ess.series`;
        
        const result = await query(queryText, queryParams);
        
        // Transform data into grid-friendly format: one row per shareholder with holdings per column
        const shareholderMap = new Map();
        
        result.rows.forEach(row => {
            if (!shareholderMap.has(row.shareholder_id)) {
                shareholderMap.set(row.shareholder_id, {
                    shareholder_id: row.shareholder_id,
                    external_id: row.external_id,
                    full_name: row.full_name,
                    address: row.address,
                    city: row.city,
                    state: row.state,
                    country: row.country,
                    zip_code: row.zip_code,
                    tax_id: row.tax_id,
                    email: row.email,
                    phone: row.phone,
                    shareholder_type: row.shareholder_type,
                    shareholder_active: row.shareholder_active,
                    first_issue_date: row.first_issue_date,
                    holdings: {},  // keyed by column id (entity_stock_type_id_entity_stock_series_id)
                    total_shares: 0
                });
            }
            
            const sh = shareholderMap.get(row.shareholder_id);
            const colKey = `${row.entity_stock_type_id}_${row.entity_stock_series_id || 'null'}`;
            const shares = parseFloat(row.current_shares) || 0;
            
            if (shares > 0) {
                sh.holdings[colKey] = shares;
                sh.total_shares += shares;
            }
        });
        
        // Convert to array and filter out zero-total shareholders if needed
        let shareholders = Array.from(shareholderMap.values());
        if (status === 'ACTIVE') {
            shareholders = shareholders.filter(sh => sh.total_shares > 0);
        }

        // Calculate column totals
        const columnTotals = {};
        let grandTotal = 0;
        
        columns.forEach(col => {
            columnTotals[col.id] = 0;
        });
        
        shareholders.forEach(sh => {
            columns.forEach(col => {
                const shares = sh.holdings[col.id] || 0;
                columnTotals[col.id] += shares;
            });
            grandTotal += sh.total_shares;
        });

        // Build report data
        const reportData = {
            entity: entity,
            as_of_date: new Date().toISOString().split('T')[0],
            generated_by: user.full_name,
            generated_at: new Date().toISOString(),
            report_type: 'Ownership Report',
            columns: columns,
            shareholders: shareholders,
            column_totals: columnTotals,
            grand_total: grandTotal,
            total_shareholders: shareholders.length
        };
        
        // Format response based on requested format
        if (format === 'csv') {
            const csvRows = [];
            
            // CSV header
            const headerCols = ['Account #', 'Shareholder Name', 'Address'];
            columns.forEach(col => headerCols.push(col.header));
            headerCols.push('Total Shares', '%');
            csvRows.push(headerCols.map(c => `"${c}"`).join(','));
            
            // CSV data
            shareholders.forEach(sh => {
                const row = [
                    sh.external_id || sh.shareholder_id,
                    sh.full_name,
                    [sh.address, sh.city, sh.state, sh.zip_code].filter(Boolean).join(', ')
                ];
                columns.forEach(col => {
                    row.push(sh.holdings[col.id] || 0);
                });
                row.push(sh.total_shares);
                row.push(grandTotal > 0 ? ((sh.total_shares / grandTotal) * 100).toFixed(2) + '%' : '0%');
                csvRows.push(row.map(c => typeof c === 'string' ? `"${c}"` : c).join(','));
            });
            
            // Totals row
            const totalsRow = ['', 'TOTALS', ''];
            columns.forEach(col => totalsRow.push(columnTotals[col.id]));
            totalsRow.push(grandTotal, '100%');
            csvRows.push(totalsRow.join(','));
            
            const csvContent = csvRows.join('\n');
            
            return {
                statusCode: 200,
                headers: {
                    'Content-Type': 'text/csv',
                    'Content-Disposition': `attachment; filename="ownership_report_${targetEntityId}_${new Date().toISOString().split('T')[0]}.csv"`,
                    'Access-Control-Allow-Origin': '*'
                },
                body: csvContent
            };
        } else {
            // Return JSON
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    report: reportData
                })
            };
        }
    } catch (error) {
        console.error('Ownership report error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Failed to generate ownership report: ' + error.message
            })
        };
    }
}

async function handleTransactionHistory(event, params) {
    // Authenticate request
    const auth = await authMiddleware(event);
    if (auth.statusCode) return auth;
    
    const { user, headers } = auth;
    
    const { 
        entity_id,
        shareholder_id,
        stock_type,
        series,
        start_date,
        end_date,
        format = 'json'
    } = params;
    
    // Check entity scope
    let targetEntityId;
    if (user.role === 'SUPER_ADMIN') {
        targetEntityId = entity_id || user.entity_id;
    } else {
        targetEntityId = user.entity_id;
    }
    
    try {
        // Get entity information
        const entityResult = await query(`
            SELECT name, legal_name
            FROM entities
            WHERE id = $1
        `, [targetEntityId]);
        
        if (entityResult.rows.length === 0) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ 
                    success: false,
                    error: 'Entity not found'
                })
            };
        }
        
        const entity = entityResult.rows[0];
        
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
        
        // Prepare report data
        const reportData = {
            entity: entity,
            as_of_date: new Date().toISOString().split('T')[0],
            generated_by: user.full_name,
            generated_at: new Date().toISOString(),
            report_type: 'Transaction History',
            filters: {
                shareholder_id,
                stock_type,
                series,
                start_date,
                end_date
            },
            transactions: result.rows
        };
        
        // Format response based on requested format
        if (format === 'csv') {
            const csvRows = [];
            
            // CSV header
            csvRows.push([
                'Transaction Date', 'Transaction Type', 'Stock Type', 'Series',
                'Shareholder', 'From Shareholder', 'To Shareholder',
                'Shares', 'Certificate Number', 'Price Per Share', 'Notes'
            ].join(','));
            
            // CSV data
            result.rows.forEach(tx => {
                csvRows.push([
                    tx.transaction_date,
                    tx.transaction_type,
                    tx.stock_type,
                    tx.series || '',
                    `"${tx.shareholder_name}"`,
                    `"${tx.from_shareholder_name || ''}"`,
                    `"${tx.to_shareholder_name || ''}"`,
                    tx.shares,
                    `"${tx.certificate_number || ''}"`,
                    tx.price_per_share || '',
                    `"${tx.notes || ''}"`
                ].join(','));
            });
            
            const csvContent = csvRows.join('\n');
            
            return {
                statusCode: 200,
                headers: {
                    'Content-Type': 'text/csv',
                    'Content-Disposition': `attachment; filename="transaction_history_${targetEntityId}_${new Date().toISOString().split('T')[0]}.csv"`,
                    'Access-Control-Allow-Origin': '*'
                },
                body: csvContent
            };
        } else {
            // Return JSON
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    report: reportData
                })
            };
        }
    } catch (error) {
        console.error('Transaction history error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Failed to generate transaction history: ' + error.message
            })
        };
    }
}

async function handleCapitalStockReport(event, params) {
    // Authenticate request
    const auth = await authMiddleware(event);
    if (auth.statusCode) return auth;
    
    const { user, headers } = auth;
    
    const { 
        entity_id,
        as_of_date,
        format = 'json'
    } = params;
    
    // Check entity scope
    let targetEntityId;
    if (user.role === 'SUPER_ADMIN') {
        targetEntityId = entity_id || user.entity_id;
    } else {
        targetEntityId = user.entity_id;
    }
    
    const reportDate = as_of_date || new Date().toISOString().split('T')[0];
    
    try {
        // Get entity information
        const entityResult = await query(`
            SELECT name, legal_name, address, city, state, 
                   country, zip_code, phone, email
            FROM entities
            WHERE id = $1
        `, [targetEntityId]);
        
        if (entityResult.rows.length === 0) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ 
                    success: false,
                    error: 'Entity not found'
                })
            };
        }
        
        const entity = entityResult.rows[0];
        
        // Get capital stock summary
        const summaryQuery = `
            SELECT 
                stock_type,
                series,
                COUNT(DISTINCT shareholder_id) as shareholder_count,
                SUM(CASE 
                    WHEN transaction_type = 'ISSUANCE' THEN shares
                    WHEN transaction_type = 'TRANSFER' AND to_shareholder_id = shareholder_id THEN shares
                    WHEN transaction_type = 'TRANSFER' AND from_shareholder_id = shareholder_id THEN -shares
                    WHEN transaction_type IN ('CANCELLATION', 'FORFEITURE') THEN -shares
                    ELSE 0
                END) as total_shares_outstanding,
                MIN(CASE 
                    WHEN transaction_type = 'ISSUANCE' THEN transaction_date
                    ELSE NULL
                END) as first_issue_date,
                MAX(CASE 
                    WHEN transaction_type = 'ISSUANCE' THEN transaction_date
                    ELSE NULL
                END) as last_issue_date
            FROM share_transactions
            WHERE entity_id = $1 
              AND transaction_date <= $2
            GROUP BY stock_type, series
            HAVING SUM(CASE 
                WHEN transaction_type = 'ISSUANCE' THEN shares
                WHEN transaction_type = 'TRANSFER' AND to_shareholder_id = shareholder_id THEN shares
                WHEN transaction_type = 'TRANSFER' AND from_shareholder_id = shareholder_id THEN -shares
                WHEN transaction_type IN ('CANCELLATION', 'FORFEITURE') THEN -shares
                ELSE 0
            END) > 0
            ORDER BY stock_type, series
        `;
        
        const summaryResult = await query(summaryQuery, [targetEntityId, reportDate]);
        
        // Get top shareholders
        const topShareholdersQuery = `
            WITH shareholder_balances AS (
                SELECT 
                    s.id as shareholder_id,
                    s.full_name,
                    s.shareholder_type,
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
                  AND st.transaction_date <= $2
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
                shareholder_id,
                full_name,
                shareholder_type,
                stock_type,
                series,
                current_shares
            FROM shareholder_balances
            ORDER BY current_shares DESC
            LIMIT 10
        `;
        
        const topShareholdersResult = await query(topShareholdersQuery, [targetEntityId, reportDate]);
        
        // Prepare report data
        const reportData = {
            entity: entity,
            as_of_date: reportDate,
            generated_by: user.full_name,
            generated_at: new Date().toISOString(),
            report_type: 'Capital Stock Report',
            summary: summaryResult.rows,
            top_shareholders: topShareholdersResult.rows
        };
        
        // Format response based on requested format
        if (format === 'csv') {
            const csvRows = [];
            
            // CSV header for summary
            csvRows.push(['Capital Stock Summary as of ' + reportDate]);
            csvRows.push('');
            csvRows.push(['Stock Type', 'Series', 'Shareholder Count', 'Total Shares Outstanding', 'First Issue Date', 'Last Issue Date'].join(','));
            
            // CSV data for summary
            summaryResult.rows.forEach(row => {
                csvRows.push([
                    row.stock_type,
                    row.series || '',
                    row.shareholder_count,
                    row.total_shares_outstanding,
                    row.first_issue_date || '',
                    row.last_issue_date || ''
                ].join(','));
            });
            
            csvRows.push('');
            csvRows.push(['Top 10 Shareholders']);
            csvRows.push('');
            csvRows.push(['Rank', 'Shareholder Name', 'Shareholder Type', 'Stock Type', 'Series', 'Shares Held'].join(','));
            
            // CSV data for top shareholders
            topShareholdersResult.rows.forEach((row, index) => {
                csvRows.push([
                    index + 1,
                    `"${row.full_name}"`,
                    row.shareholder_type,
                    row.stock_type,
                    row.series || '',
                    row.current_shares
                ].join(','));
            });
            
            const csvContent = csvRows.join('\n');
            
            return {
                statusCode: 200,
                headers: {
                    'Content-Type': 'text/csv',
                    'Content-Disposition': `attachment; filename="capital_stock_report_${targetEntityId}_${reportDate.replace(/-/g, '')}.csv"`,
                    'Access-Control-Allow-Origin': '*'
                },
                body: csvContent
            };
        } else {
            // Return JSON
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    report: reportData
                })
            };
        }
    } catch (error) {
        console.error('Capital stock report error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Failed to generate capital stock report: ' + error.message
            })
        };
    }
}

async function handleShareholderStatement(event, params) {
    // Authenticate request
    const auth = await authMiddleware(event);
    if (auth.statusCode) return auth;
    
    const { user, headers } = auth;
    
    const { 
        entity_id,
        shareholder_id,
        format = 'json'
    } = params;
    
    if (!shareholder_id) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Shareholder ID is required'
            })
        };
    }
    
    // Check entity scope
    let targetEntityId;
    if (user.role === 'SUPER_ADMIN') {
        targetEntityId = entity_id || user.entity_id;
    } else {
        targetEntityId = user.entity_id;
    }
    
    try {
        // Get entity information
        const entityResult = await query(`
            SELECT name, legal_name, address, city, state, 
                   country, zip_code, phone, email
            FROM entities
            WHERE id = $1
        `, [targetEntityId]);
        
        if (entityResult.rows.length === 0) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ 
                    success: false,
                    error: 'Entity not found'
                })
            };
        }
        
        const entity = entityResult.rows[0];
        
        // Get shareholder information
        const shareholderResult = await query(`
            SELECT *
            FROM shareholders
            WHERE id = $1 AND entity_id = $2
        `, [shareholder_id, targetEntityId]);
        
        if (shareholderResult.rows.length === 0) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ 
                    success: false,
                    error: 'Shareholder not found in this entity'
                })
            };
        }
        
        const shareholder = shareholderResult.rows[0];
        
        // Get transaction history for this shareholder
        const transactionsQuery = `
            SELECT 
                st.*,
                fs.full_name as from_shareholder_name,
                ts.full_name as to_shareholder_name
            FROM share_transactions st
            LEFT JOIN shareholders fs ON st.from_shareholder_id = fs.id
            LEFT JOIN shareholders ts ON st.to_shareholder_id = ts.id
            WHERE st.shareholder_id = $1
              AND st.entity_id = $2
            ORDER BY st.transaction_date, st.created_at
        `;
        
        const transactionsResult = await query(transactionsQuery, [shareholder_id, targetEntityId]);
        
        // Calculate current holdings by stock type and series
        const holdingsQuery = `
            SELECT 
                stock_type,
                series,
                COALESCE(SUM(
                    CASE 
                        WHEN transaction_type = 'ISSUANCE' THEN shares
                        WHEN transaction_type = 'TRANSFER' AND to_shareholder_id = $1 THEN shares
                        WHEN transaction_type = 'TRANSFER' AND from_shareholder_id = $1 THEN -shares
                        WHEN transaction_type IN ('CANCELLATION', 'FORFEITURE') THEN -shares
                        ELSE 0
                    END
                ), 0) as current_shares
            FROM share_transactions
            WHERE shareholder_id = $1
              AND entity_id = $2
            GROUP BY stock_type, series
            HAVING COALESCE(SUM(
                CASE 
                    WHEN transaction_type = 'ISSUANCE' THEN shares
                    WHEN transaction_type = 'TRANSFER' AND to_shareholder_id = $1 THEN shares
                    WHEN transaction_type = 'TRANSFER' AND from_shareholder_id = $1 THEN -shares
                    WHEN transaction_type IN ('CANCELLATION', 'FORFEITURE') THEN -shares
                    ELSE 0
                END
            ), 0) > 0
        `;
        
        const holdingsResult = await query(holdingsQuery, [shareholder_id, targetEntityId]);
        
        // Prepare statement data
        const statementData = {
            entity: entity,
            shareholder: shareholder,
            as_of_date: new Date().toISOString().split('T')[0],
            generated_by: user.full_name,
            generated_at: new Date().toISOString(),
            report_type: 'Shareholder Statement',
            current_holdings: holdingsResult.rows,
            transaction_history: transactionsResult.rows,
            summary: {
                total_stock_types: holdingsResult.rows.length,
                total_shares: holdingsResult.rows.reduce((sum, row) => sum + parseFloat(row.current_shares), 0)
            }
        };
        
        // Format response based on requested format
        if (format === 'pdf') {
            // For PDF, return JSON that can be used to generate PDF on frontend
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    statement: statementData,
                    pdf_instructions: 'Use this data to generate PDF on the frontend'
                })
            };
        } else if (format === 'csv') {
            const csvRows = [];
            
            // CSV header
            csvRows.push(['Shareholder Statement for ' + shareholder.full_name + ' as of ' + statementData.as_of_date]);
            csvRows.push('');
            csvRows.push(['Entity: ' + entity.name]);
            csvRows.push(['Generated: ' + new Date().toLocaleString()]);
            csvRows.push('');
            csvRows.push(['Current Holdings']);
            csvRows.push(['Stock Type', 'Series', 'Current Shares'].join(','));
            
            // CSV data for current holdings
            holdingsResult.rows.forEach(row => {
                csvRows.push([
                    row.stock_type,
                    row.series || '',
                    row.current_shares
                ].join(','));
            });
            
            csvRows.push('');
            csvRows.push(['Transaction History']);
            csvRows.push(['Date', 'Type', 'Stock Type', 'Series', 'Shares', 'From/To', 'Certificate', 'Notes'].join(','));
            
            // CSV data for transactions
            transactionsResult.rows.forEach(tx => {
                let fromTo = '';
                if (tx.transaction_type === 'TRANSFER') {
                    if (tx.from_shareholder_id === parseInt(shareholder_id)) {
                        fromTo = `To: ${tx.to_shareholder_name}`;
                    } else {
                        fromTo = `From: ${tx.from_shareholder_name}`;
                    }
                }
                
                csvRows.push([
                    tx.transaction_date,
                    tx.transaction_type,
                    tx.stock_type,
                    tx.series || '',
                    tx.shares,
                    `"${fromTo}"`,
                    `"${tx.certificate_number || ''}"`,
                    `"${tx.notes || ''}"`
                ].join(','));
            });
            
            const csvContent = csvRows.join('\n');
            
            return {
                statusCode: 200,
                headers: {
                    'Content-Type': 'text/csv',
                    'Content-Disposition': `attachment; filename="shareholder_statement_${shareholder_id}_${statementData.as_of_date.replace(/-/g, '')}.csv"`,
                    'Access-Control-Allow-Origin': '*'
                },
                body: csvContent
            };
        } else {
            // Return JSON
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    statement: statementData
                })
            };
        }
    } catch (error) {
        console.error('Shareholder statement error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Failed to generate shareholder statement: ' + error.message
            })
        };
    }
}