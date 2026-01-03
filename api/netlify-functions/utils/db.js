






require('dotenv').config();
const { Pool } = require('@neondatabase/serverless');

let pool;

function getPool() {
    if (!pool) {
        const connectionString = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;
        
        if (!connectionString) {
            throw new Error('DATABASE_URL environment variable is required');
        }
        
        pool = new Pool({
            connectionString: connectionString,
            ssl: { rejectUnauthorized: false },
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000,
        });
    }
    return pool;
}

// Core query function
async function query(text, params = []) {
    const start = Date.now();
    const pool = getPool();
    
    try {
        console.log('Executing query:', { 
            text: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
            params: params.length > 0 ? params : 'none'
        });
        
        const result = await pool.query(text, params);
        const duration = Date.now() - start;
        
        console.log('Query executed successfully:', { 
            duration: `${duration}ms`,
            rows: result.rowCount
        });
        
        return result;
    } catch (err) {
        console.error('Database query error:', {
            error: err.message,
            query: text.substring(0, 200),
            params: params
        });
        throw new Error(`Database error: ${err.message}`);
    }
}

// Initialize database tables
async function initDb() {
    try {
        console.log('🔄 Initializing database tables...');
         // Uncomment to reset database (for development only)
    // await query(`DROP TABLE IF EXISTS ledger CASCADE`);
    // await query(`DROP TABLE IF EXISTS transactions CASCADE`);
    // await query(`DROP TABLE IF EXISTS users CASCADE`);
    // await query(`DROP TABLE IF EXISTS shareholders CASCADE`);
        // Entities table
        await query(`
            CREATE TABLE IF NOT EXISTS entities (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL UNIQUE,
                legal_name VARCHAR(255),
                tax_id VARCHAR(50),
                address VARCHAR(500),
                city VARCHAR(100),
                state VARCHAR(50),
                country VARCHAR(50) DEFAULT 'US',
                zip_code VARCHAR(20),
                phone VARCHAR(50),
                email VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT TRUE
            );
        `);
        console.log('✅ Entities table ready');

        // Users table
        await query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                entity_id INTEGER REFERENCES entities(id) ON DELETE CASCADE,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                full_name VARCHAR(255) NOT NULL,
                role VARCHAR(20) NOT NULL CHECK (role IN ('SUPER_ADMIN', 'ADMIN', 'USER')),
                is_active BOOLEAN DEFAULT TRUE,
                created_by INTEGER REFERENCES users(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Users table ready');

        // Shareholders table
        await query(`
            CREATE TABLE IF NOT EXISTS shareholders (
                id SERIAL PRIMARY KEY,
                entity_id INTEGER REFERENCES entities(id) ON DELETE CASCADE NOT NULL,
                external_id VARCHAR(100),
                full_name VARCHAR(255) NOT NULL,
                address VARCHAR(500),
                city VARCHAR(100),
                state VARCHAR(50),
                country VARCHAR(50) DEFAULT 'US',
                zip_code VARCHAR(20),
                tax_id VARCHAR(50),
                email VARCHAR(255),
                phone VARCHAR(255),
                shareholder_type VARCHAR(20) CHECK (shareholder_type IN ('INDIVIDUAL', 'CORPORATION', 'PARTNERSHIP', 'TRUST')),
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(entity_id, external_id)
            );
        `);
        console.log('✅ Shareholders table ready');

        // Share transactions table
        await query(`
            CREATE TABLE IF NOT EXISTS share_transactions (
                id SERIAL PRIMARY KEY,
                entity_id INTEGER REFERENCES entities(id) ON DELETE CASCADE NOT NULL,
                shareholder_id INTEGER REFERENCES shareholders(id) ON DELETE CASCADE NOT NULL,
                transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
                stock_type VARCHAR(20) NOT NULL CHECK (stock_type IN ('COMMON', 'PREFERRED')),
                series VARCHAR(50),
                shares DECIMAL(20,4) NOT NULL,
                transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('ISSUANCE', 'TRANSFER', 'CANCELLATION', 'FORFEITURE', 'CONVERSION')),
                from_shareholder_id INTEGER REFERENCES shareholders(id),
                to_shareholder_id INTEGER REFERENCES shareholders(id),
                certificate_number VARCHAR(100),
                price_per_share DECIMAL(20,4),
                notes TEXT,
                created_by INTEGER REFERENCES users(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CHECK (
                    (transaction_type = 'ISSUANCE' AND from_shareholder_id IS NULL) OR
                    (transaction_type = 'TRANSFER' AND from_shareholder_id IS NOT NULL AND to_shareholder_id IS NOT NULL) OR
                    (transaction_type = 'CANCELLATION' AND to_shareholder_id IS NULL) OR
                    (transaction_type = 'FORFEITURE' AND to_shareholder_id IS NULL) OR
                    (transaction_type = 'CONVERSION' AND to_shareholder_id IS NULL)
                ),
                CHECK (
                    (stock_type = 'PREFERRED' AND series IS NOT NULL) OR
                    (stock_type = 'COMMON' AND series IS NULL)
                )
            );
        `);
        console.log('✅ Share transactions table ready');

        // Shareholder import raw table
        await query(`
            CREATE TABLE IF NOT EXISTS shareholder_import_raw (
                id SERIAL PRIMARY KEY,
                entity_id INTEGER REFERENCES entities(id) ON DELETE CASCADE NOT NULL,
                import_batch_id VARCHAR(100) NOT NULL,
                row_data JSONB NOT NULL,
                status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSED', 'ERROR')),
                error_message TEXT,
                processed_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_by INTEGER REFERENCES users(id)
            );
        `);
        console.log('✅ Shareholder import raw table ready');

        // Create indexes for performance
        await query(`CREATE INDEX IF NOT EXISTS idx_users_entity_id ON users(entity_id);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_shareholders_entity_id ON shareholders(entity_id);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_share_transactions_entity_id ON share_transactions(entity_id);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_share_transactions_shareholder_id ON share_transactions(shareholder_id);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_share_transactions_date ON share_transactions(transaction_date);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_share_transactions_stock_type ON share_transactions(stock_type, series);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_import_raw_entity_batch ON shareholder_import_raw(entity_id, import_batch_id);`);
        
        console.log('✅ Database initialization complete');
        
        // Create default SUPER_ADMIN if no users exist
        const usersCheck = await query('SELECT COUNT(*) as count FROM users');
        if (parseInt(usersCheck.rows[0].count) === 0) {
            console.log('🔄 Creating default entity and super admin...');
            
            // Create default entity
            const entityResult = await query(`
                INSERT INTO entities (name, legal_name, is_active)
                VALUES ($1, $2, $3)
                RETURNING id
            `, ['Default Entity', 'Default Entity LLC', true]);
            
            const entityId = entityResult.rows[0].id;
            
            // Create super admin (password: Admin123!)
            const bcrypt = require('bcryptjs');
            const hashedPassword = await bcrypt.hash('Admin123!', 10);
            
            await query(`
                INSERT INTO users (entity_id, email, password_hash, full_name, role, is_active)
                VALUES ($1, $2, $3, $4, $5, $6)
            `, [
                entityId,
                'admin@company.com',
                hashedPassword,
                'System Administrator',
                'SUPER_ADMIN',
                true
            ]);
            
            console.log('✅ Default entity and super admin created');
        }
    } catch (err) {
        console.error('❌ Database initialization failed:', err);
        throw err;
    }
}

// Initialize on module load
if (process.env.NODE_ENV !== 'test') {
    initDb().catch(console.error);
}

module.exports = { query, initDb };