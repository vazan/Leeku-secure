/**
 * Vault orphan cleanup: find and (optionally) delete `.vault` blobs on the
 * storage share that are referenced by NO row in `files` and NO row in
 * `file_versions`.
 *
 * WHY: before the folder-delete fix, deleting a folder unlinked only the
 * CURRENT blob (`files.stored_path`) and then cascaded `file_versions` rows
 * away — but archived-version blobs were never unlinked, leaving them orphaned
 * on disk (the ~25k leftover `.vault` files reported by ops). This script
 * reconciles the vault share against the database and reclaims that space.
 *
 * SAFETY:
 *   - Runs in DRY-RUN by default: only prints candidates, deletes nothing.
 *   - Pass `--apply` to actually unlink orphans (requires confirmation).
 *   - Profile pictures live under `<vault>/users` and are skipped.
 *   - Blobs whose filename does not match the `<32 hex>.vault` scheme are
 *     treated as unrecognized and reported but NEVER deleted automatically.
 *
 * Run:
 *   npx tsx scripts/cleanup-vault-orphans.ts             # dry run
 *   npx tsx scripts/cleanup-vault-orphans.ts --apply     # delete (asks confirm)
 * Env: DB_* and FILE_STORAGE_UNC_PATH (loaded from .env like the server).
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import readline from 'readline';
import { getPool, closePool, getRequest, sql } from '../src/server/db';

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

const VAULT_ROOT = process.env.FILE_STORAGE_UNC_PATH || path.join(process.cwd(), 'vault');
const APPLY = process.argv.includes('--apply');

// Blobs are named `<32 hex chars>.vault` (see generateSecureToken(16) + '.vault').
const BLOB_NAME_RE = /^[0-9a-f]{32}\.vault$/;

interface StoredPathRow { stored_path: string; }

async function main(): Promise<void> {
  await getPool();

  // 1. Collect every vault blob filename referenced by the DB (both current and
  //    archived versions), normalized to a bare filename so a share-relative
  //    path (with or without a leading separator) matches the directory scan.
  const referenced = new Set<string>();
  for (const table of ['files', 'file_versions']) {
    let offset = 0;
    for (;;) {
      const req = await getRequest();
      req.input('offset', sql.Int, offset);
      req.input('batch',  sql.Int, 500);
      const res = await req.query<StoredPathRow>(
        `SELECT stored_path FROM dbo.${table}
         ORDER BY stored_path
         OFFSET @offset ROWS FETCH NEXT @batch ROWS ONLY`
      );
      if (res.recordset.length === 0) break;
      for (const row of res.recordset) {
        const rel = String(row.stored_path || '').replace(/^[\\/]+/, '');
        referenced.add(path.basename(rel));
      }
      offset += res.recordset.length;
    }
  }
  console.log(`[orphan-cleanup] Referenced blobs (files + file_versions): ${referenced.size}`);

  // 2. Scan the vault share root for blob files (skip any subdirectories such
  //    as `users` for profile pictures).
  let blobCount = 0;
  const entries = fs.readdirSync(VAULT_ROOT, { withFileTypes: true });
  const orphans: string[] = [];
  const unrecognized: string[] = [];
  for (const ent of entries) {
    if (!ent.isFile()) continue; // skip subdirs (users/, etc.)
    blobCount++;
    if (!BLOB_NAME_RE.test(ent.name)) {
      unrecognized.push(ent.name);
      continue; // never auto-delete non-blob files
    }
    if (!referenced.has(ent.name)) orphans.push(ent.name);
  }
  console.log(`[orphan-cleanup] Blob files on share root: ${blobCount}`);
  console.log(`[orphan-cleanup] Orphan candidates: ${orphans.length}`);
  if (unrecognized.length) {
    console.log(`[orphan-cleanup] Non-blob files skipped (never auto-deleted): ${unrecognized.length}`);
    for (const n of unrecognized.slice(0, 20)) console.log(`  ? ${n}`);
    if (unrecognized.length > 20) console.log(`  ... and ${unrecognized.length - 20} more`);
  }

  if (orphans.length === 0) {
    console.log('[orphan-cleanup] Nothing to clean up.');
    await closePool();
    return;
  }

  // 3. Report / (optionally) delete.
  for (const name of orphans) {
    const p = path.join(VAULT_ROOT, name);
    const size = fs.statSync(p).size;
    console.log(`  ${APPLY ? 'DELETE' : 'ORPHAN'}  ${name}  (${size} bytes)`);
  }
  const totalBytes = orphans.reduce((sum, name) => sum + fs.statSync(path.join(VAULT_ROOT, name)).size, 0);
  console.log(`[orphan-cleanup] Total reclaimable: ${(totalBytes / (1024 * 1024)).toFixed(1)} MiB across ${orphans.length} files.`);

  if (!APPLY) {
    console.log('[orphan-cleanup] Dry run only — nothing deleted. Re-run with --apply to delete.');
    await closePool();
    return;
  }

  // 4. Confirmation for the destructive pass.
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(`Type "DELETE ${orphans.length}" to permanently remove ${orphans.length} orphaned vault blobs: `, resolve);
  });
  rl.close();
  if (answer.trim() !== `DELETE ${orphans.length}`) {
    console.log('[orphan-cleanup] Confirmation mismatch — aborting, nothing deleted.');
    await closePool();
    return;
  }

  let deleted = 0;
  let failed = 0;
  for (const name of orphans) {
    const p = path.join(VAULT_ROOT, name);
    try {
      await fs.promises.unlink(p);
      deleted++;
    } catch (err) {
      console.error(`[orphan-cleanup] Failed to delete ${name}:`, err);
      failed++;
    }
  }
  console.log(`[orphan-cleanup] Done. Deleted: ${deleted}, failed: ${failed}.`);
  await closePool();
}

main()
  .catch((err) => {
    console.error('[orphan-cleanup] Failed:', err);
    process.exitCode = 1;
  });
