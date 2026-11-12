// PostgreSQL access: one shared pool, a retrying startup check and a tiny migration runner.
'use strict';
const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');

// DATE columns as plain 'YYYY-MM-DD' strings: a JS Date would shift them by the server's timezone.
types.setTypeParser(1082, (v) => v);
const config = require('./config');

// With no DATABASE_URL, pg reads the standard PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE
// variables — handy in compose, where the password never needs URL-encoding.
const pool = new Pool(Object.assign({ max: 10, idleTimeoutMillis: 30000 },
  config.databaseUrl ? { connectionString: config.databaseUrl } : {}));
pool.on('error', (e) => console.error('[db] idle client error:', e.message));

const query = (text, params) => pool.query(text, params);

async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (e2) { /* connection already gone */ }
    throw e;
  } finally { client.release(); }
}

// The database container can take a few seconds to accept connections after `compose up`.
async function waitForDb(attempts = 30, delayMs = 2000) {
  for (let i = 1; ; i++) {
    try { await query('SELECT 1'); return; }
    catch (e) {
      if (i >= attempts) throw new Error(`Database non raggiungibile dopo ${attempts} tentativi: ${e.message}`);
      console.log(`[db] in attesa del database (${i}/${attempts}): ${e.code || e.message}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function migrate() {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const client = await pool.connect();
  try {
    // Session-level advisory lock: if several app instances start together, only one migrates.
    await client.query('SELECT pg_advisory_lock(727275)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    for (const f of files) {
      if (done.has(f)) continue;
      console.log(`[db] applico migrazione ${f}`);
      try {
        await client.query('BEGIN');
        await client.query(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Migrazione ${f} fallita: ${e.message}`);
      }
    }
  } finally {
    try { await client.query('SELECT pg_advisory_unlock(727275)'); } catch (e) { /* ignore */ }
    client.release();
  }
}

// Expired login sessions are dead weight: prune them.
async function cleanup() {
  try {
    await query('DELETE FROM auth_sessions WHERE expires_at < now()');
  } catch (e) { console.error('[db] cleanup fallito:', e.message); }
}

module.exports = { pool, query, withTx, waitForDb, migrate, cleanup };
