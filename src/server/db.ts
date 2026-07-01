/**
 * @license SPDX-License-Identifier: Apache-2.0
 *
 * Leeku Secure — PostgreSQL Database Connection
 *
 * This branch keeps the existing request/input call sites mostly intact by
 * exposing a lightweight adapter with an `mssql`-like API backed by `pg`.
 */

import { Pool, types, type PoolConfig, type QueryResultRow } from 'pg';

const MAX = Symbol('MAX');

types.setTypeParser(20, (value) => Number(value));

type SqlTypeDescriptor = { kind: string; size?: number | symbol };

function scalarType(kind: string): SqlTypeDescriptor {
  return { kind };
}

function sizedType(kind: string) {
  const factory = (size?: number | symbol): SqlTypeDescriptor => ({ kind, size });
  return Object.assign(factory, { kind });
}

type SqlInputType =
  | SqlTypeDescriptor
  | ReturnType<typeof sizedType>
  | undefined;

export const sql = {
  MAX,
  Bit: scalarType('bit'),
  BigInt: scalarType('bigint'),
  DateTimeOffset: scalarType('timestamptz'),
  Int: scalarType('int'),
  UniqueIdentifier: scalarType('uuid'),
  Char: sizedType('char'),
  NVarChar: sizedType('text'),
  VarBinary: sizedType('bytea'),
};

export interface QueryResponse<T> {
  recordset: T[];
  rowsAffected: number[];
}

type BoundValue = {
  type?: SqlTypeDescriptor | ReturnType<typeof sizedType>;
  value: unknown;
};

class PgRequest {
  private readonly params = new Map<string, BoundValue>();

  input(name: string, type: SqlTypeDescriptor | ReturnType<typeof sizedType>, value: unknown): this;
  input(name: string, value: unknown): this;
  input(name: string, typeOrValue: unknown, maybeValue?: unknown): this {
    if (arguments.length === 2) {
      this.params.set(name, { value: typeOrValue });
      return this;
    }

    this.params.set(name, {
      type: resolveTypeDescriptor(typeOrValue),
      value: maybeValue,
    });
    return this;
  }

  async query<T extends QueryResultRow = QueryResultRow>(queryText: string): Promise<QueryResponse<T>> {
    const { text, values } = translateQuery(queryText, this.params);
    const result = await executeQuery<T>(text, values);
    return {
      recordset: result.rows as T[],
      rowsAffected: [result.rowCount ?? 0],
    };
  }

  async execute<T extends QueryResultRow = QueryResultRow>(_procName: string): Promise<QueryResponse<T>> {
    throw new Error('[database] Stored procedures are not supported on the PostgreSQL branch.');
  }
}

function resolveTypeDescriptor(typeOrValue: unknown): SqlTypeDescriptor | ReturnType<typeof sizedType> | undefined {
  if (!typeOrValue || typeof typeOrValue !== 'object' && typeof typeOrValue !== 'function') {
    return undefined;
  }

  if ('kind' in (typeOrValue as Record<string, unknown>)) {
    return typeOrValue as SqlTypeDescriptor | ReturnType<typeof sizedType>;
  }

  return undefined;
}

function normalizeValue(type: SqlInputType, value: unknown): unknown {
  const descriptor = typeof type === 'function' ? { kind: type.kind } : type;

  if (!descriptor) return value;

  if (descriptor.kind === 'bit') {
    if (typeof value === 'boolean' || value == null) return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true';
  }

  return value;
}

function buildConfig(): PoolConfig {
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;

  if (!user || !password) {
    throw new Error('[database] DB_USER and DB_PASSWORD must be set in the environment.');
  }

  const sslEnabled = process.env.DB_SSL
    ? process.env.DB_SSL === 'true'
    : process.env.DB_ENCRYPT === 'true';
  const rejectUnauthorized = process.env.DB_TRUST_SERVER_CERTIFICATE !== 'true';

  return {
    host: process.env.DB_SERVER || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'LeekuSecure',
    user,
    password,
    min: parseInt(process.env.DB_POOL_MIN || '2', 10),
    max: parseInt(process.env.DB_POOL_MAX || '10', 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '30000', 10),
    ssl: sslEnabled ? { rejectUnauthorized } : false,
  };
}

let pool: Pool | null = null;

export async function getPool(): Promise<Pool> {
  if (pool) {
    return pool;
  }

  const config = buildConfig();
  pool = new Pool(config);
  pool.on('error', (err: Error) => {
    console.error('[database] Pool error:', err);
  });

  await pool.query('SELECT 1');
  console.log(`[database] Connected to PostgreSQL ${config.host}:${config.port} -> ${config.database}`);

  return pool;
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = null;
  console.log('[database] Connection pool closed.');
}

export async function getRequest(): Promise<PgRequest> {
  await getPool();
  return new PgRequest();
}

export async function query<T>(
  queryText: string,
  bindParams?: (req: PgRequest) => void
): Promise<T[]> {
  const req = await getRequest();
  if (bindParams) bindParams(req);
  const result = await req.query<T & QueryResultRow>(queryText);
  return result.recordset;
}

export async function execProc<T>(
  procName: string,
  bindParams?: (req: PgRequest) => void
): Promise<T[]> {
  const req = await getRequest();
  if (bindParams) bindParams(req);
  const result = await req.execute<T & QueryResultRow>(procName);
  return result.recordset;
}

async function executeQuery<T extends QueryResultRow>(text: string, values: unknown[]) {
  const activePool = await getPool();
  return activePool.query<T>({ text, values });
}

function translateQuery(queryText: string, params: Map<string, BoundValue>): { text: string; values: unknown[] } {
  let text = queryText
    .replace(/\r/g, '')
    .replace(/\[dbo\]\./gi, '')
    .replace(/\[([^\]]+)\]/g, '"$1"')
    .replace(/N'([^']*)'/g, "'$1'")
    .replace(/\bISNULL\s*\(/gi, 'COALESCE(')
    .replace(/GETDATE\(\)/gi, 'CURRENT_TIMESTAMP')
    .replace(/DATEADD\(day,\s*(-?\d+),\s*SYSDATETIMEOFFSET\(\)\)/gi, (_match, days) => {
      const amount = Number(days);
      if (amount === 0) return 'CURRENT_TIMESTAMP';
      return amount > 0
        ? `CURRENT_TIMESTAMP + INTERVAL '${amount} day'`
        : `CURRENT_TIMESTAMP - INTERVAL '${Math.abs(amount)} day'`;
    })
    .replace(/SYSDATETIMEOFFSET\(\)/gi, 'CURRENT_TIMESTAMP')
    .replace(/CAST\(CASE WHEN([\s\S]+?)THEN 1 ELSE 0 END AS bit\)/gi, 'CASE WHEN$1THEN TRUE ELSE FALSE END');

  text = translateTopClause(text);

  const orderedNames: string[] = [];
  const indexByName = new Map<string, number>();
  text = text.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (_match, name) => {
    if (!indexByName.has(name)) {
      indexByName.set(name, orderedNames.length + 1);
      orderedNames.push(name);
    }

    return `$${indexByName.get(name)}`;
  });

  const values = orderedNames.map((name) => {
    const bound = params.get(name);
    if (!bound) {
      throw new Error(`[database] Missing bound parameter: ${name}`);
    }
    return normalizeValue(bound.type, bound.value);
  });

  return { text, values };
}

function translateTopClause(text: string): string {
  const match = text.match(/^\s*SELECT\s+TOP\s*\(([^)]+)\)\s+/i);
  if (!match) return text;

  const limitExpr = match[1].trim();
  const withoutTop = text.replace(/^(\s*SELECT)\s+TOP\s*\(([^)]+)\)\s+/i, '$1 ');
  return `${withoutTop} LIMIT ${limitExpr}`;
}
