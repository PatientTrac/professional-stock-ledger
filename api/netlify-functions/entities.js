const { query } = require('./utils/db');
const { authMiddleware, requireRole } = require('./middleware/auth');

exports.handler = async (event, context) => {
    // Parse query parameters
    const params = event.queryStringParameters || {};
    const { action } = params;
    
    console.log(`Entities ${action} request:`, { 
        method: event.httpMethod, 
        action
    });

    // Route the request
    switch (event.httpMethod) {
        case 'POST':
            if (action === 'create') {
                return await handleCreateEntity(event);
            }
            break;
            
        case 'GET':
            if (action === 'list') {
                return await handleListEntities(event);
            } else if (action === 'get') {
                return await handleGetEntity(event, params);
            }
            break;
            
        case 'PUT':
            if (action === 'update') {
                return await handleUpdateEntity(event);
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

async function handleCreateEntity(event) {
    // Authenticate request
    const auth = await authMiddleware(event);
    if (auth.statusCode) return auth;
    
    const { user, headers } = auth;
    
    // Only SUPER_ADMIN can create entities
    if (!requireRole(['SUPER_ADMIN'])(user)) {
        return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Forbidden: Only SUPER_ADMIN can create entities'
            })
        };
    }
    
    const body = JSON.parse(event.body || '{}');
    const { name, legal_name, tax_id, address, city, state, country, zip_code, phone, email } = body;
    
    if (!name) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Entity name is required'
            })
        };
    }
    
    try {
        // Check if entity already exists
        const existingEntity = await query(
            'SELECT id FROM entities WHERE name = $1',
            [name]
        );
        
        if (existingEntity.rows.length > 0) {
            return {
                statusCode: 409,
                headers,
                body: JSON.stringify({ 
                    success: false,
                    error: 'Entity already exists'
                })
            };
        }
        
        // Create entity
        const result = await query(`
            INSERT INTO entities (
                name, legal_name, tax_id, address, city, 
                state, country, zip_code, phone, email, is_active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *
        `, [
            name,
            legal_name || name,
            tax_id,
            address,
            city,
            state,
            country || 'US',
            zip_code,
            phone,
            email,
            true
        ]);
        
        return {
            statusCode: 201,
            headers,
            body: JSON.stringify({
                success: true,
                entity: result.rows[0]
            })
        };
    } catch (error) {
        console.error('Create entity error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Failed to create entity: ' + error.message
            })
        };
    }
}

async function handleListEntities(event) {
    // Authenticate request
    const auth = await authMiddleware(event);
    if (auth.statusCode) return auth;
    
    const { user, headers } = auth;
    
    try {
        let queryText = `
            SELECT id, name, legal_name, tax_id, is_active,
                   address, city, state, country, zip_code,
                   phone, email, created_at, updated_at
            FROM entities
            WHERE is_active = TRUE
        `;
        
        const queryParams = [];
        
        // SUPER_ADMIN can see all entities, others only see their assigned entity
        if (user.role !== 'SUPER_ADMIN') {
            queryText += ' AND id = $1';
            queryParams.push(user.entity_id);
        }
        
        queryText += ' ORDER BY name';
        
        const result = await query(queryText, queryParams);
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                entities: result.rows
            })
        };
    } catch (error) {
        console.error('List entities error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Failed to list entities: ' + error.message
            })
        };
    }
}

async function handleGetEntity(event, params) {
    // Authenticate request
    const auth = await authMiddleware(event);
    if (auth.statusCode) return auth;
    
    const { user, headers } = auth;
    
    const { entityId } = params;
    
    if (!entityId) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Entity ID is required'
            })
        };
    }
    
    // Check if user has access to this entity
    if (user.role !== 'SUPER_ADMIN' && user.entity_id !== parseInt(entityId)) {
        return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Forbidden: Cannot access this entity'
            })
        };
    }
    
    try {
        const result = await query(`
            SELECT id, name, legal_name, tax_id, is_active,
                   address, city, state, country, zip_code,
                   phone, email, created_at, updated_at
            FROM entities
            WHERE id = $1
        `, [entityId]);
        
        if (result.rows.length === 0) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ 
                    success: false,
                    error: 'Entity not found'
                })
            };
        }
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                entity: result.rows[0]
            })
        };
    } catch (error) {
        console.error('Get entity error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Failed to get entity: ' + error.message
            })
        };
    }
}

async function handleUpdateEntity(event) {
    // Authenticate request
    const auth = await authMiddleware(event);
    if (auth.statusCode) return auth;
    
    const { user, headers } = auth;
    
    // Only SUPER_ADMIN can update entities
    if (!requireRole(['SUPER_ADMIN'])(user)) {
        return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Forbidden: Only SUPER_ADMIN can update entities'
            })
        };
    }
    
    const body = JSON.parse(event.body || '{}');
    const { entityId, ...updates } = body;
    
    if (!entityId) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Entity ID is required'
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
        // Check if entity exists
        const checkResult = await query(
            'SELECT id FROM entities WHERE id = $1',
            [entityId]
        );
        
        if (checkResult.rows.length === 0) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ 
                    success: false,
                    error: 'Entity not found'
                })
            };
        }
        
        // Build update query
        const updateFields = [];
        const params = [];
        let paramCount = 0;
        
        const allowedFields = [
            'name', 'legal_name', 'tax_id', 'address', 'city',
            'state', 'country', 'zip_code', 'phone', 'email', 'is_active'
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
        params.push(entityId);
        
        const updateQuery = `
            UPDATE entities 
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
                entity: result.rows[0]
            })
        };
    } catch (error) {
        console.error('Update entity error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Failed to update entity: ' + error.message
            })
        };
    }
}