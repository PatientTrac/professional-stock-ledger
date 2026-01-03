const jwt = require('jsonwebtoken');
const { query } = require('../utils/db');

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secure-jwt-secret-change-in-production';

function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        return null;
    }
}

async function authenticateUser(token) {
    if (!token) return null;
    
    const decoded = verifyToken(token);
    if (!decoded) return null;
    
    try {
        const result = await query(`
            SELECT 
                u.id, u.email, u.full_name, u.role, u.entity_id,
                u.is_active,
                e.name as entity_name,
                e.is_active as entity_is_active
            FROM users u
            LEFT JOIN entities e ON u.entity_id = e.id
            WHERE u.id = $1 AND u.is_active = TRUE
        `, [decoded.userId]);
        
        if (result.rows.length === 0) return null;
        
        const user = result.rows[0];
        
        // Check if entity is active
        if (!user.entity_is_active) return null;
        
        return {
            id: user.id,
            email: user.email,
            full_name: user.full_name,
            role: user.role,
            entity_id: user.entity_id,
            entity_name: user.entity_name
        };
    } catch (error) {
        console.error('Authentication error:', error);
        return null;
    }
}

function generateToken(user) {
    return jwt.sign(
        { 
            userId: user.id, 
            email: user.email, 
            role: user.role,
            entityId: user.entity_id 
        },
        JWT_SECRET,
        { expiresIn: '8h' }
    );
}

// Middleware for Netlify Functions
async function authMiddleware(event) {
    // Set CORS headers
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    };

    // Handle preflight OPTIONS request
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }

    // Check for Authorization header
    const authHeader = event.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return {
            statusCode: 401,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Unauthorized: No token provided' 
            })
        };
    }

    const token = authHeader.split(' ')[1];
    const user = await authenticateUser(token);
    
    if (!user) {
        return {
            statusCode: 401,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Unauthorized: Invalid or expired token' 
            })
        };
    }

    return { user, headers };
}

// Role-based authorization middleware
function requireRole(allowedRoles) {
    return (user) => {
        if (!user) return false;
        if (!allowedRoles.includes(user.role)) return false;
        return true;
    };
}

// Entity scope enforcement
function enforceEntityScope(user, requestedEntityId) {
    if (!user) return false;
    
    // SUPER_ADMIN can access all entities
    if (user.role === 'SUPER_ADMIN') return true;
    
    // ADMIN and USER can only access their assigned entity
    return user.entity_id === parseInt(requestedEntityId);
}

module.exports = {
    verifyToken,
    authenticateUser,
    generateToken,
    authMiddleware,
    requireRole,
    enforceEntityScope
};