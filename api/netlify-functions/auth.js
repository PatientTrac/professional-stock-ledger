const bcrypt = require('bcryptjs');
const { query } = require('./utils/db');
const { generateToken, authMiddleware, requireRole } = require('./middleware/auth');

exports.handler = async (event, context) => {
    // Parse query parameters
    const params = event.queryStringParameters || {};
    const { action } = params;
    
    // Parse body
    let body = {};
    if (event.body) {
        try {
            body = JSON.parse(event.body);
        } catch (e) {
            console.error('Error parsing JSON:', e);
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    success: false,
                    error: 'Invalid JSON in request body'
                })
            };
        }
    }

    console.log(`Auth ${action} request:`, { 
        method: event.httpMethod, 
        action
    });

    // Route the request
    switch (event.httpMethod) {
        case 'POST':
            if (action === 'login') {
                return await handleLogin(body);
            } else if (action === 'create-user') {
                return await handleCreateUser(event);
            } else if (action === 'logout') {
                return await handleLogout();
            }
            break;
            
        case 'GET':
            if (action === 'verify') {
                return await handleVerify(event);
            } else if (action === 'users') {
                return await handleGetUsers(event);
            }
            break;
            
        case 'PUT':
            if (action === 'update-user') {
                return await handleUpdateUser(event, body);
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

async function handleLogin(body) {
    const { email, password } = body;
    
    if (!email || !password) {
        return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                success: false,
                error: 'Email and password are required'
            })
        };
    }
    
    try {
        // Find user with entity information
        const result = await query(`
            SELECT 
                u.*,
                e.name as entity_name,
                e.is_active as entity_is_active
            FROM users u
            LEFT JOIN entities e ON u.entity_id = e.id
            WHERE u.email = $1 AND u.is_active = TRUE
        `, [email.toLowerCase()]);
        
        if (result.rows.length === 0) {
            return {
                statusCode: 401,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    success: false,
                    error: 'Invalid email or password'
                })
            };
        }
        
        const user = result.rows[0];
        
        // Check if entity is active
        if (!user.entity_is_active) {
            return {
                statusCode: 403,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    success: false,
                    error: 'Entity is inactive'
                })
            };
        }
        
        // Verify password
        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) {
            return {
                statusCode: 401,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    success: false,
                    error: 'Invalid email or password'
                })
            };
        }
        
        // Generate token
        const token = generateToken(user);
        
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
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
            })
        };
    } catch (error) {
        console.error('Login error:', error);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                success: false,
                error: 'Login failed. Please try again.'
            })
        };
    }
}

async function handleCreateUser(event) {
    // Authenticate request
    const auth = await authMiddleware(event);
    if (auth.statusCode) return auth;
    
    const { user, headers } = auth;
    
    // Check if user has permission to create users
    const canCreateUsers = requireRole(['SUPER_ADMIN', 'ADMIN'])(user);
    if (!canCreateUsers) {
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
    const { email, password, full_name, role, entity_id } = body;
    
    // Validate input
    if (!email || !password || !full_name || !role) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Email, password, full name, and role are required'
            })
        };
    }
    
    // Validate role
    const validRoles = ['SUPER_ADMIN', 'ADMIN', 'USER'];
    if (!validRoles.includes(role)) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Invalid role. Must be SUPER_ADMIN, ADMIN, or USER'
            })
        };
    }
    
    try {
        // Determine entity ID
        let targetEntityId = entity_id;
        
        // SUPER_ADMIN can create users for any entity
        if (user.role === 'SUPER_ADMIN') {
            if (!targetEntityId) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ 
                        success: false,
                        error: 'Entity ID is required for SUPER_ADMIN'
                    })
                };
            }
        } else {
            // ADMIN can only create users for their own entity
            targetEntityId = user.entity_id;
        }
        
        // Check if user already exists
        const existingUser = await query(
            'SELECT id FROM users WHERE email = $1',
            [email.toLowerCase()]
        );
        
        if (existingUser.rows.length > 0) {
            return {
                statusCode: 409,
                headers,
                body: JSON.stringify({ 
                    success: false,
                    error: 'User already exists'
                })
            };
        }
        
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Create user
        const result = await query(`
            INSERT INTO users (
                entity_id, email, password_hash, full_name, 
                role, is_active, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id, email, full_name, role, entity_id, is_active
        `, [
            targetEntityId,
            email.toLowerCase(),
            hashedPassword,
            full_name,
            role,
            true,
            user.id
        ]);
        
        const newUser = result.rows[0];
        
        return {
            statusCode: 201,
            headers,
            body: JSON.stringify({
                success: true,
                user: newUser
            })
        };
    } catch (error) {
        console.error('Create user error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Failed to create user: ' + error.message
            })
        };
    }
}

async function handleVerify(event) {
    const auth = await authMiddleware(event);
    if (auth.statusCode) return auth;
    
    const { user, headers } = auth;
    
    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
            success: true,
            user: {
                id: user.id,
                email: user.email,
                full_name: user.full_name,
                role: user.role,
                entity_id: user.entity_id,
                entity_name: user.entity_name
            }
        })
    };
}

async function handleGetUsers(event) {
    const auth = await authMiddleware(event);
    if (auth.statusCode) return auth;
    
    const { user, headers } = auth;
    
    // Check permissions
    const canViewUsers = requireRole(['SUPER_ADMIN', 'ADMIN'])(user);
    if (!canViewUsers) {
        return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Forbidden: Insufficient permissions'
            })
        };
    }
    
    try {
        let queryText = `
            SELECT 
                u.id, u.email, u.full_name, u.role, u.is_active,
                u.created_at, u.updated_at,
                e.name as entity_name
            FROM users u
            LEFT JOIN entities e ON u.entity_id = e.id
            WHERE 1=1
        `;
        
        const queryParams = [];
        
        // SUPER_ADMIN can see all users, others only see their entity's users
        if (user.role !== 'SUPER_ADMIN') {
            queryText += ' AND u.entity_id = $1';
            queryParams.push(user.entity_id);
        }
        
        queryText += ' ORDER BY u.full_name';
        
        const result = await query(queryText, queryParams);
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                users: result.rows
            })
        };
    } catch (error) {
        console.error('Get users error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Failed to get users: ' + error.message
            })
        };
    }
}

async function handleUpdateUser(event, body) {
    const auth = await authMiddleware(event);
    if (auth.statusCode) return auth;
    
    const { user, headers } = auth;
    
    // Check permissions
    const canUpdateUsers = requireRole(['SUPER_ADMIN', 'ADMIN'])(user);
    if (!canUpdateUsers) {
        return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Forbidden: Insufficient permissions'
            })
        };
    }
    
    const { userId, full_name, role, is_active } = body;
    
    if (!userId) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'User ID is required'
            })
        };
    }
    
    try {
        // Check if target user exists and user has permission to update them
        let checkQuery = `
            SELECT u.id, u.entity_id, u.role
            FROM users u
            WHERE u.id = $1
        `;
        
        const checkResult = await query(checkQuery, [userId]);
        
        if (checkResult.rows.length === 0) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ 
                    success: false,
                    error: 'User not found'
                })
            };
        }
        
        const targetUser = checkResult.rows[0];
        
        // SUPER_ADMIN can update anyone, ADMIN can only update users in their entity
        if (user.role !== 'SUPER_ADMIN' && user.entity_id !== targetUser.entity_id) {
            return {
                statusCode: 403,
                headers,
                body: JSON.stringify({ 
                    success: false,
                    error: 'Forbidden: Cannot update users from other entities'
                })
            };
        }
        
        // Build update query
        const updates = [];
        const params = [];
        let paramCount = 0;
        
        if (full_name !== undefined) {
            paramCount++;
            updates.push(`full_name = $${paramCount}`);
            params.push(full_name);
        }
        
        if (role !== undefined) {
            // Only SUPER_ADMIN can change roles
            if (user.role !== 'SUPER_ADMIN') {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({ 
                        success: false,
                        error: 'Forbidden: Only SUPER_ADMIN can change roles'
                    })
                };
            }
            paramCount++;
            updates.push(`role = $${paramCount}`);
            params.push(role);
        }
        
        if (is_active !== undefined) {
            paramCount++;
            updates.push(`is_active = $${paramCount}`);
            params.push(is_active);
        }
        
        if (updates.length === 0) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    success: false,
                    error: 'No fields to update'
                })
            };
        }
        
        paramCount++;
        updates.push(`updated_at = CURRENT_TIMESTAMP`);
        
        paramCount++;
        params.push(userId);
        
        const updateQuery = `
            UPDATE users 
            SET ${updates.join(', ')}
            WHERE id = $${paramCount}
            RETURNING id, email, full_name, role, is_active, entity_id
        `;
        
        const result = await query(updateQuery, params);
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                user: result.rows[0]
            })
        };
    } catch (error) {
        console.error('Update user error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Failed to update user: ' + error.message
            })
        };
    }
}

async function handleLogout() {
    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            success: true, 
            message: 'Logged out successfully' 
        })
    };
}