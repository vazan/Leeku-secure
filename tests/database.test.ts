/**
 * @license SPDX-License-Identifier: Apache-2.0
 *
 * Leeku Secure — Database Adapter Tests
 * Tests the PostgreSQL database adapter in src/server/db.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { sql, PgRequest, buildConfig, translateQuery, translateTopClause } = await import('../src/server/db.js');

test('sql type descriptors', () => {
  // Test scalar types
  assert.strictEqual(sql.Bit.kind, 'bit');
  assert.strictEqual(sql.BigInt.kind, 'bigint');
  assert.strictEqual(sql.DateTimeOffset.kind, 'timestamptz');
  assert.strictEqual(sql.Int.kind, 'int');
  assert.strictEqual(sql.UniqueIdentifier.kind, 'uuid');
  assert.strictEqual(sql.Char.kind, 'char');
  assert.strictEqual(sql.NVarChar.kind, 'text');
  assert.strictEqual(sql.VarBinary.kind, 'bytea');

  // Test sized types
  assert.strictEqual(sql.Char(50).kind, 'char');
  assert.strictEqual(sql.NVarChar(100).kind, 'text');
  assert.strictEqual(sql.VarBinary(500).kind, 'bytea');
});

test('sql type descriptor size', () => {
  const charType = sql.Char(25);
  assert.strictEqual(charType.kind, 'char');
  assert.strictEqual(charType.size, 25);

  const nvarcharType = sql.NVarChar(200);
  assert.strictEqual(nvarcharType.kind, 'text');
  assert.strictEqual(nvarcharType.size, 200);
});

test('PgRequest input method', () => {
  const req = new PgRequest();
  
  // Test input with just value
  req.input('@userId', '123e4567-e89b-12d3-a456-426614174000');
  
  // Test input with type and value
  req.input('@email', sql.NVarChar(100), 'test@example.com');
  
  // Verify params are stored
  assert.strictEqual(req['params'].size, 2);
});

test('translateQuery - MSSQL to PostgreSQL', () => {
  const req = new PgRequest();
  req.input('userId', '123e4567-e89b-12d3-a456-426614174000');

  // Test bracketed identifiers → quoted identifiers
  const { text: text1 } = req.translateQuery('SELECT [id], [name] FROM [users] WHERE [id] = @userId', req['params']);
  assert.ok(text1.includes('"users"'));
  assert.ok(text1.includes('"id"'));
  assert.ok(text1.includes('"name"'));

  // Test @param → $param
  const { text: text2 } = req.translateQuery('SELECT * FROM users WHERE id = @userId', req['params']);
  assert.ok(text2.includes('$1'));
});

test('translateQuery - ISNULL to COALESCE', () => {
  const req = new PgRequest();
  req.input('id', 'test-id');

  const { text } = req.translateQuery('SELECT ISNULL(email, username) FROM users WHERE id = @id', req['params']);
  assert.ok(text.includes('COALESCE'));
});

test('translateQuery - GETDATE to CURRENT_TIMESTAMP', () => {
  const req = new PgRequest();
  req.input('id', 'test-id');

  const { text } = req.translateQuery('SELECT * FROM users WHERE created_at > GETDATE()', req['params']);
  assert.ok(text.includes('CURRENT_TIMESTAMP'));
});

test('translateQuery - TOP to LIMIT', () => {
  const req = new PgRequest();
  req.input('id', 'test-id');

  const { text } = req.translateQuery('SELECT TOP (10) * FROM users ORDER BY created_at', req['params']);
  assert.ok(text.includes('LIMIT 10'));
});

test('translateQuery - DATEADD with SYSDATETIMEOFFSET', () => {
  const req = new PgRequest();
  req.input('id', 'test-id');

  // Test positive days
  const { text: text1 } = req.translateQuery(
    "SELECT * FROM tokens WHERE expires_at > DATEADD(day, 7, SYSDATETIMEOFFSET())",
    req['params']
  );
  assert.ok(text1.includes("CURRENT_TIMESTAMP + INTERVAL '7 day'"));

  // Test negative days
  const { text: text2 } = req.translateQuery(
    "SELECT * FROM tokens WHERE expires_at > DATEADD(day, -1, SYSDATETIMEOFFSET())",
    req['params']
  );
  assert.ok(text2.includes("CURRENT_TIMESTAMP - INTERVAL '1 day'"));
});

test('translateQuery - N prefix removal', () => {
  const req = new PgRequest();

  const { text } = req.translateQuery("SELECT * FROM users WHERE name = N'Test'", req['params']);
  
  assert.ok(text.includes("'Test'"));
  assert.ok(!text.includes("N'Test'"));
});

test('translateQuery - BIT to BOOLEAN', () => {
  const req = new PgRequest();

  const { text } = req.translateQuery("SELECT CAST(CASE WHEN active = 1 THEN 1 ELSE 0 END AS bit) FROM users", req['params']);
  
  assert.ok(text.includes('TRUE ELSE FALSE'));
});

test('translateTopClause function', () => {
  // Test TOP clause translation
  const result1 = translateTopClause('SELECT TOP (10) * FROM users');
  assert.strictEqual(result1, 'SELECT * FROM users LIMIT 10');
  
  // Test without TOP clause
  const result2 = translateTopClause('SELECT * FROM users');
  assert.strictEqual(result2, 'SELECT * FROM users');
});

test('translateTopClause with whitespace', () => {
  const result = translateTopClause('  SELECT TOP (5) * FROM users  ');
  assert.ok(result.includes('LIMIT 5'));
  assert.ok(result.includes('SELECT'));
});

test('buildConfig - environment variables', () => {
  process.env.DB_SERVER = 'localhost';
  process.env.DB_PORT = '5432';
  process.env.DB_NAME = 'leeku_test';
  process.env.DB_USER = 'test_user';
  process.env.DB_PASSWORD = 'test_pass';

  const config = buildConfig();
  
  assert.strictEqual(config.host, 'localhost');
  assert.strictEqual(config.port, 5432);
  assert.strictEqual(config.database, 'leeku_test');
  assert.strictEqual(config.user, 'test_user');
  assert.strictEqual(config.password, 'test_pass');
});

test('buildConfig - missing credentials throws error', () => {
  // Clean environment
  delete process.env.DB_USER;
  delete process.env.DB_PASSWORD;

  assert.throws(() => {
    buildConfig();
  }, /DB_USER and DB_PASSWORD must be set/);
});

test('buildConfig - SSL configuration', () => {
  // Clean environment first
  delete process.env.DB_SSL;
  delete process.env.DB_ENCRYPT;
  delete process.env.DB_TRUST_SERVER_CERTIFICATE;
  
  process.env.DB_SERVER = 'localhost';
  process.env.DB_PORT = '5432';
  process.env.DB_NAME = 'leeku_test';
  process.env.DB_USER = 'test_user';
  process.env.DB_PASSWORD = 'test_pass';
  process.env.DB_SSL = 'true';
  process.env.DB_TRUST_SERVER_CERTIFICATE = 'false';

  const config = buildConfig();
  // When DB_SSL=true, config.ssl should be an object with rejectUnauthorized
  assert.ok(typeof config.ssl === 'object' && config.ssl !== null);
  assert.strictEqual((config.ssl as any).rejectUnauthorized, true);
});

test('buildConfig - connection pool settings', () => {
  process.env.DB_SERVER = 'localhost';
  process.env.DB_PORT = '5432';
  process.env.DB_NAME = 'leeku_test';
  process.env.DB_USER = 'test_user';
  process.env.DB_PASSWORD = 'test_pass';
  process.env.DB_POOL_MIN = '5';
  process.env.DB_POOL_MAX = '20';
  process.env.DB_CONNECTION_TIMEOUT_MS = '60000';

  const config = buildConfig();
  
  assert.strictEqual(config.min, 5);
  assert.strictEqual(config.max, 20);
  assert.strictEqual(config.connectionTimeoutMillis, 60000);
  assert.strictEqual(config.idleTimeoutMillis, 30000);
});

test('buildConfig - default values', () => {
  // Clean environment
  delete process.env.DB_SERVER;
  delete process.env.DB_PORT;
  delete process.env.DB_NAME;
  delete process.env.DB_POOL_MIN;
  delete process.env.DB_POOL_MAX;

  const config = buildConfig();
  
  assert.strictEqual(config.host, 'localhost');
  assert.strictEqual(config.port, 5432);
  assert.strictEqual(config.database, 'LeekuSecure');
  assert.strictEqual(config.min, 2);
  assert.strictEqual(config.max, 10);
});

test('BigInt type parser - PostgreSQL numeric parsing', async () => {
  // Verify that BigInt columns are parsed as Number wrapper
  const { types } = await import('pg');
  const originalParser = types.getTypeParser(20, 'text');
  
  // Test parsing
  const parsed = originalParser('9223372036854775807');
  assert.strictEqual(parsed, 9223372036854775807);
  assert.strictEqual(typeof parsed, 'number');
});

test('getPool - pool creation and connection', async () => {
  process.env.DB_SERVER = 'localhost';
  process.env.DB_PORT = '5432';
  process.env.DB_NAME = 'leeku_test';
  process.env.DB_USER = 'test_user';
  process.env.DB_PASSWORD = 'test_pass';

  const { getPool, closePool } = await import('../src/server/db.js');

  // This test requires a real database connection
  // In CI/CD environment, this should be skipped or mocked
  try {
    const pool = await getPool();
    assert.ok(pool);
    await closePool();
  } catch (err: any) {
    // Skip if no database available - this is expected in CI
    console.log('[SKIP] getPool test requires database connection:', err.message);
  }
});

test('Pool error handling', async () => {
  process.env.DB_SERVER = 'invalid-host';
  process.env.DB_PORT = '5432';
  process.env.DB_NAME = 'leeku_test';
  process.env.DB_USER = 'test_user';
  process.env.DB_PASSWORD = 'test_pass';

  const { closePool } = await import('../src/server/db.js');
  
  // Clean up any existing pool first
  await closePool();

  const { getPool } = await import('../src/server/db.js');

  try {
    await getPool();
    assert.fail('Should have failed with invalid host');
  } catch (err: any) {
    assert.ok(err.message.includes('getaddrinfo') || err.message.includes('ENOTFOUND'));
  } finally {
    await closePool();
  }
});
