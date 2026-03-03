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
            connectionTimeoutMillis: 10000,
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

        // Entity stock types table (governance-grade)
        await query(`
            CREATE TABLE IF NOT EXISTS entity_stock_types (
                id SERIAL PRIMARY KEY,
                entity_id INTEGER REFERENCES entities(id) ON DELETE CASCADE NOT NULL,
                stock_type VARCHAR(20) NOT NULL,
                display_name VARCHAR(255) NOT NULL,
                supports_series BOOLEAN DEFAULT FALSE,
                par_value NUMERIC(20,6),
                authorized_shares NUMERIC(20,0),
                dividend_rate NUMERIC(10,4),
                liquidation_preference TEXT,
                has_voting_rights BOOLEAN DEFAULT TRUE,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(entity_id, stock_type)
            );
        `);
        console.log('✅ Entity stock types table ready');

        // Entity stock series table
        await query(`
            CREATE TABLE IF NOT EXISTS entity_stock_series (
                id SERIAL PRIMARY KEY,
                entity_stock_type_id INTEGER REFERENCES entity_stock_types(id) ON DELETE CASCADE NOT NULL,
                series VARCHAR(100) NOT NULL,
                authorized_shares NUMERIC(20,0),
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(entity_stock_type_id, series)
            );
        `);
        console.log('✅ Entity stock series table ready');

        // Add governance columns if they don't exist (migration for existing DBs)
        const govCols = [
            { table: 'entity_stock_types', col: 'par_value', type: 'NUMERIC(20,6)' },
            { table: 'entity_stock_types', col: 'authorized_shares', type: 'NUMERIC(20,0)' },
            { table: 'entity_stock_types', col: 'dividend_rate', type: 'NUMERIC(10,4)' },
            { table: 'entity_stock_types', col: 'liquidation_preference', type: 'TEXT' },
            { table: 'entity_stock_types', col: 'has_voting_rights', type: 'BOOLEAN DEFAULT TRUE' },
            { table: 'entity_stock_series', col: 'authorized_shares', type: 'NUMERIC(20,0)' }
        ];
        for (const g of govCols) {
            await query(`
                DO $$ BEGIN
                    ALTER TABLE ${g.table} ADD COLUMN ${g.col} ${g.type};
                EXCEPTION WHEN duplicate_column THEN NULL;
                END $$;
            `);
        }
        console.log('✅ Governance columns ensured');

        // Create indexes for performance
        await query(`CREATE INDEX IF NOT EXISTS idx_users_entity_id ON users(entity_id);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_shareholders_entity_id ON shareholders(entity_id);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_share_transactions_entity_id ON share_transactions(entity_id);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_share_transactions_shareholder_id ON share_transactions(shareholder_id);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_share_transactions_date ON share_transactions(transaction_date);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_share_transactions_stock_type ON share_transactions(stock_type, series);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_import_raw_entity_batch ON shareholder_import_raw(entity_id, import_batch_id);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_entity_stock_types_entity ON entity_stock_types(entity_id);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_entity_stock_series_type ON entity_stock_series(entity_stock_type_id);`);

        // Transaction documents table (metadata for files in Supabase Storage)
await query(`
  CREATE TABLE IF NOT EXISTS transaction_documents (
    id SERIAL PRIMARY KEY,

    transaction_id INTEGER NOT NULL,
    entity_id INTEGER NOT NULL,

    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT,
    content_type TEXT,

    uploaded_by INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_tx_docs_transaction
      FOREIGN KEY (transaction_id)
      REFERENCES share_transactions(id)
      ON DELETE CASCADE,

    CONSTRAINT fk_tx_docs_entity
      FOREIGN KEY (entity_id)
      REFERENCES entities(id)
      ON DELETE CASCADE,

    CONSTRAINT fk_tx_docs_user
      FOREIGN KEY (uploaded_by)
      REFERENCES users(id)
      ON DELETE SET NULL
  );
`);

await query(`
  CREATE INDEX IF NOT EXISTS idx_transaction_docs_txn
  ON transaction_documents(transaction_id, entity_id);
`);

await query(`
  CREATE INDEX IF NOT EXISTS idx_transaction_docs_entity
  ON transaction_documents(entity_id);
`);
        // Stock certificates table
        await query(`
          CREATE TABLE IF NOT EXISTS stock_certificates (
            id SERIAL PRIMARY KEY,
            entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE RESTRICT,
            shareholder_id INTEGER NOT NULL REFERENCES shareholders(id) ON DELETE RESTRICT,
            share_transaction_id INTEGER REFERENCES share_transactions(id) ON DELETE SET NULL,
            entity_stock_type_id INTEGER REFERENCES entity_stock_types(id) ON DELETE RESTRICT,
            entity_stock_series_id INTEGER REFERENCES entity_stock_series(id) ON DELETE SET NULL,
            certificate_number VARCHAR(100) NOT NULL,
            shares NUMERIC(20,4) NOT NULL,
            issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
            status VARCHAR(20) NOT NULL DEFAULT 'ISSUED',
            cancelled_at TIMESTAMP,
            cancelled_reason TEXT,
            replaced_by_certificate_id INTEGER REFERENCES stock_certificates(id) ON DELETE SET NULL,
            signed_by_name TEXT,
            signed_by_title TEXT,
            countersigned_by_name TEXT,
            countersigned_by_title TEXT,
            pdf_path TEXT,
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
        console.log('✅ Stock certificates table ready');

        // Ensure status check constraint includes REPLACED
        await query(`
          DO $$ BEGIN
            ALTER TABLE stock_certificates DROP CONSTRAINT IF EXISTS stock_certificates_status_check;
            ALTER TABLE stock_certificates ADD CONSTRAINT stock_certificates_status_check
              CHECK (status IN ('ISSUED', 'CANCELLED', 'REPLACED'));
          EXCEPTION WHEN others THEN NULL;
          END $$;
        `);
        console.log('✅ Stock certificates status constraint updated');

        // Certificate sequences table (per-entity sequential numbering)
        await query(`
          CREATE TABLE IF NOT EXISTS certificate_sequences (
            entity_id INTEGER PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
            next_seq BIGINT NOT NULL DEFAULT 1,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
        console.log('✅ Certificate sequences table ready');

        // Certificate indexes
        await query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_cert_entity_number ON stock_certificates(entity_id, certificate_number);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_cert_shareholder ON stock_certificates(shareholder_id);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_cert_entity ON stock_certificates(entity_id);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_cert_status ON stock_certificates(status);`);

        // Add lost certificate columns (migration for existing DBs)
        const lostCertCols = [
            { col: 'lost_certificate_number', type: 'TEXT' },
            { col: 'lost_certificate_id', type: 'INTEGER REFERENCES stock_certificates(id) ON DELETE SET NULL' },
        ];
        for (const lc of lostCertCols) {
            await query(`
                DO $$ BEGIN
                    ALTER TABLE stock_certificates ADD COLUMN ${lc.col} ${lc.type};
                EXCEPTION WHEN duplicate_column THEN NULL;
                END $$;
            `);
        }
        await query(`CREATE INDEX IF NOT EXISTS idx_cert_lost_number ON stock_certificates(lost_certificate_number);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_cert_lost_id ON stock_certificates(lost_certificate_id);`);
        console.log('✅ Lost certificate columns ensured');

        // Add certificate date tracking & source lineage columns (transfer agent model)
        const certDateCols = [
            { col: 'original_issue_date', type: 'DATE' },
            { col: 'transfer_date', type: 'DATE' },
            { col: 'source_certificate_id', type: 'INTEGER REFERENCES stock_certificates(id) ON DELETE SET NULL' },
        ];
        for (const dc of certDateCols) {
            await query(`
                DO $$ BEGIN
                    ALTER TABLE stock_certificates ADD COLUMN ${dc.col} ${dc.type};
                EXCEPTION WHEN duplicate_column THEN NULL;
                END $$;
            `);
        }
        // Backfill original_issue_date from issue_date where NULL
        await query(`UPDATE stock_certificates SET original_issue_date = issue_date WHERE original_issue_date IS NULL`);
        await query(`CREATE INDEX IF NOT EXISTS idx_cert_source ON stock_certificates(source_certificate_id);`);
        console.log('✅ Certificate date/source lineage columns ensured');

        // Certificate documents table (affidavits etc.)
        await query(`
          CREATE TABLE IF NOT EXISTS certificate_documents (
            id SERIAL PRIMARY KEY,
            entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE RESTRICT,
            certificate_id INTEGER REFERENCES stock_certificates(id) ON DELETE SET NULL,
            lost_certificate_id INTEGER REFERENCES stock_certificates(id) ON DELETE SET NULL,
            replacement_certificate_id INTEGER REFERENCES stock_certificates(id) ON DELETE SET NULL,
            document_type TEXT NOT NULL CHECK (document_type IN ('LOST_CERTIFICATE_AFFIDAVIT')),
            title TEXT NOT NULL DEFAULT 'Lost Certificate Affidavit',
            pdf_path TEXT,
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
        await query(`CREATE INDEX IF NOT EXISTS idx_cert_docs_entity ON certificate_documents(entity_id);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_cert_docs_certificate ON certificate_documents(certificate_id);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_cert_docs_lost ON certificate_documents(lost_certificate_id);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_cert_docs_replacement ON certificate_documents(replacement_certificate_id);`);
        console.log('✅ Certificate documents table ready');

        // Audit logs table
        const { initAuditTable } = require('./auditLog');
        await initAuditTable();
        
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