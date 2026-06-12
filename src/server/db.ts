/**
 * @license SPDX-License-Identifier: Apache-2.0
 *
 * Leeku Secure — SQL Server 2022 Database Connection
 *
 * Uses the `mssql` package (Microsoft's official Node.js driver).
 * Required: npm install mssql && npm install --save-dev @types/mssql
 *
 * Environment variables (all required in production):
 *   DB_SERVER                 — hostname or IP of SQL Server (default: localhost)
 *   DB_PORT                   — TCP port (default: 1433)
 *   DB_NAME                   — database name (default: LeekuSecure)
 *   DB_USER                   — SQL Server login name
 *   DB_PASSWORD               — SQL Server login password
 *   DB_POOL_MIN               — minimum pool connections (default: 2)
 *   DB_POOL_MAX               — maximum pool connections (default: 10)
 *   DB_REQUEST_TIMEOUT_MS     — query timeout in ms (default: 15 000)
 *   DB_CONNECTION_TIMEOUT_MS  — connect timeout in ms (default: 30 000)
 *   DB_ENCRYPT                — "true" to force TLS for the connection
 *   DB_TRUST_SERVER_CERTIFICATE — "true" only for dev with self-signed certs
 */

import sql from 'mssql';

// ──────────────────────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────────────────────

function buildConfig(): sql.config {
  const user     = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;

  if (!user || !password) {
    throw new Error('[database] DB_USER and DB_PASSWORD must be set in the environment.');
  }

  return {
    server:   process.env.DB_SERVER   || 'localhost',
    port:     parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME     || 'LeekuSecure',
    user,
    password,
    pool: {
      min:  parseInt(process.env.DB_POOL_MIN || '2',  10),
      max:  parseInt(process.env.DB_POOL_MAX || '10', 10),
      idleTimeoutMillis: 30_000,
    },
    requestTimeout:    parseInt(process.env.DB_REQUEST_TIMEOUT_MS    || '15000', 10),
    connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '30000', 10),
    options: {
      encrypt:                  process.env.DB_ENCRYPT === 'true',
      trustServerCertificate:   process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
      enableArithAbort:         true,
    },
  };
}

// ──────────────────────────────────────────────────────────────
// Singleton connection pool
// ──────────────────────────────────────────────────────────────

let pool: sql.ConnectionPool | null = null;

/**
 * Returns the singleton connection pool, creating and connecting it
 * on the first call. Subsequent calls return the same pool instance.
 */
export async function getPool(): Promise<sql.ConnectionPool> {
  if (pool && pool.connected) {
    return pool;
  }

  const config = buildConfig();
  pool = new sql.ConnectionPool(config);

  pool.on('error', (err: Error) => {
    console.error('[database] Pool error:', err);
  });

  await pool.connect();
  console.log(
    `[database] Connected to SQL Server ${config.server}:${config.port} → ${config.database}`
  );

  return pool;
}

/**
 * Closes the connection pool gracefully.
 * Call on application shutdown (SIGTERM, SIGINT).
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
    console.log('[database] Connection pool closed.');
  }
}

/**
 * Convenience wrapper: returns a new Request bound to the pool.
 * Use for parameterised queries.
 *
 * @example
 *   const request = await getRequest();
 *   request.input('emailHash', sql.Char(64), hash);
 *   const result = await request.query('SELECT * FROM users WHERE email_hash = @emailHash');
 */
export async function getRequest(): Promise<sql.Request> {
  const p = await getPool();
  return p.request();
}

/**
 * Executes a parameterised query and returns the first result set.
 *
 * @example
 *   const rows = await query<UserRow>(
 *     'SELECT id, role FROM users WHERE email_hash = @emailHash',
 *     (req) => req.input('emailHash', sql.Char(64), hash)
 *   );
 */
export async function query<T>(
  queryText:   string,
  bindParams?: (req: sql.Request) => void
): Promise<T[]> {
  const req = await getRequest();
  if (bindParams) bindParams(req);
  const result = await req.query<T>(queryText);
  return result.recordset;
}

/**
 * Executes a stored procedure by name.
 *
 * @example
 *   const rows = await execProc<ExpiredFileRow>(
 *     'sp_GetExpiredFiles'
 *   );
 */
export async function execProc<T>(
  procName:    string,
  bindParams?: (req: sql.Request) => void
): Promise<T[]> {
  const req = await getRequest();
  if (bindParams) bindParams(req);
  const result = await req.execute<T>(procName);
  return result.recordset;
}

// Re-export sql types so callers don't need to import mssql directly
export { sql };
