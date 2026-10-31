/**
 * One-time backfill: populate `files.file_name_hash` for rows created before the
 * versioning migration.
 *
 * WHY: the DB cannot derive the HMAC of an encrypted filename, so the migration
 * deliberately left `file_name_hash` NULL for pre-existing rows. Same-name
 * detection (`file_name_hash = hashColumnForLookup(name)` on upload) can then
 * never match those rows, so re-uploading a changed copy of a pre-existing file
 * created a duplicate row instead of a new version.
 *
 * This script runs inside the Node app (it has MASTER_KEY_BASE64 + the encryption
 * utils) — it decrypts each NULL-hash name and stores the derived HMAC, converging
 * the whole table onto the fast indexed detection path.
 *
 * Run:  npx tsx scripts/backfill-file-hashes.ts
 * Env:  DB_* and MASTER_KEY_BASE64 (loaded from .env like the server).
 *
 * Idempotent: only rows with file_name_hash IS NULL are touched; re-running is a no-op.
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { getPool, closePool, getRequest, sql } from '../src/server/db';
import { decryptColumn, hashColumnForLookup } from '../src/server/utils/encryption';

// ── Load .env the same way src/server.ts does ─────────────────
const runtimeDir = (() => {
  if (typeof __dirname === 'string') return __dirname;
  return process.cwd();
})();
const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(runtimeDir, '../.env'),
];
const envPath = envCandidates.find((candidate) => fs.existsSync(candidate));
if (envPath) dotenv.config({ path: envPath });
else dotenv.config();

const BATCH_SIZE = 500;

interface HashlessRow {
  id: string;
  original_name_encrypted: Buffer;
  original_name_iv: Buffer;
  original_name_auth_tag: Buffer;
}

async function main(): Promise<void> {
  await getPool();

  const totalReq = await getRequest();
  const totalRes = await totalReq.query<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM dbo.files WHERE file_name_hash IS NULL AND deleted_at IS NULL`
  );
  const total = Number(totalRes.recordset[0]?.cnt ?? 0);
  console.log(`[backfill] Files with NULL file_name_hash (active): ${total}`);
  if (total === 0) {
    console.log('[backfill] Nothing to do.');
    await closePool();
    return;
  }

  let updated = 0;
  let undecryptable = 0;

  // Scan in pages of active, NULL-hash rows.
  let offset = 0;
  for (;;) {
    const pageReq = await getRequest();
    pageReq.input('offset', sql.Int, offset);
    pageReq.input('batch',  sql.Int, BATCH_SIZE);
    const pageRes = await pageReq.query<HashlessRow>(
      `SELECT id, original_name_encrypted, original_name_iv, original_name_auth_tag
       FROM dbo.files
       WHERE file_name_hash IS NULL AND deleted_at IS NULL
       ORDER BY created_at
       OFFSET @offset ROWS FETCH NEXT @batch ROWS ONLY`
    );
    const rows = pageRes.recordset;
    if (rows.length === 0) break;

    for (const row of rows) {
      let name: string;
      try {
        name = decryptColumn(row.original_name_encrypted, row.original_name_iv, row.original_name_auth_tag);
      } catch {
        undecryptable++;
        continue; // skip rows we cannot decrypt (wrong key / tampered)
      }
      const hash = hashColumnForLookup(name);
      const updReq = await getRequest();
      updReq.input('id',   sql.UniqueIdentifier, row.id);
      updReq.input('hash', sql.Char(64), hash);
      await updReq.query('UPDATE dbo.files SET file_name_hash=@hash WHERE id=@id');
      updated++;
    }

    offset += rows.length;
    if (updated % BATCH_SIZE === 0) {
      console.log(`[backfill] ... ${updated}/${total} updated`);
    }
  }

  console.log(`[backfill] Done. Updated: ${updated}, undecryptable/skipped: ${undecryptable}.`);
  await closePool();
}

main()
  .catch((err) => {
    console.error('[backfill] Failed:', err);
    process.exitCode = 1;
  });
