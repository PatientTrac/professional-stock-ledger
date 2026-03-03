/**
 * Database Connection Utility for Local & Production
 * Connects to Neon PostgreSQL database
 * 
 * For local development:
 * 1. Create a .env file with DATABASE_URL=your_neon_connection_string
 * 2. Run: npm install dotenv @neondatabase/serverless
 * 3. Use this module to query the database
 */

require('dotenv').config();
const { Pool, neonConfig } = require('@neondatabase/serverless');
const ws = require('ws');

// Enable WebSocket for local development (required for Neon serverless driver)
neonConfig.webSocketConstructor = ws;

let pool = null;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;
    
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required. Create a .env file with your Neon connection string.');
    }
    
    console.log('🔌 Connecting to Neon database...');
    
    pool = new Pool({
      connectionString: connectionString,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    // Test connection on first use
    pool.on('connect', () => {
      console.log('✅ Connected to Neon PostgreSQL');
    });

    pool.on('error', (err) => {
      console.error('❌ Unexpected database error:', err);
    });
  }
  return pool;
}

/**
 * Execute a database query
 * @param {string} text - SQL query text
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>} Query result
 */
async function query(text, params = []) {
  const start = Date.now();
  const pool = getPool();
  
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    
    if (process.env.DEBUG === 'true') {
      console.log('Query executed:', { 
        text: text.substring(0, 80) + (text.length > 80 ? '...' : ''),
        duration: `${duration}ms`,
        rows: result.rowCount
      });
    }
    
    return result;
  } catch (err) {
    console.error('Database query error:', {
      error: err.message,
      query: text.substring(0, 150),
      params: params
    });
    throw new Error(`Database error: ${err.message}`);
  }
}

/**
 * Get a dedicated client from the pool for transactions.
 * MUST call client.release() when done.
 * Usage:
 *   const client = await getClient();
 *   try {
 *     await client.query('BEGIN');
 *     await client.query('INSERT ...', [...]);
 *     await client.query('COMMIT');
 *   } catch (err) {
 *     await client.query('ROLLBACK');
 *     throw err;
 *   } finally {
 *     client.release();
 *   }
 */
async function getClient() {
  const pool = getPool();
  return pool.connect();
}

/**
 * Run a function inside a transaction with a dedicated client.
 * Automatically handles BEGIN, COMMIT, ROLLBACK, and client.release().
 * @param {Function} fn - async function receiving (client) => { ... }
 * @returns {*} return value of fn
 */
async function withTransaction(fn) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Close the database connection pool
 */
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('🔌 Database connection closed');
  }
}

module.exports = { query, getPool, getClient, withTransaction, closePool };