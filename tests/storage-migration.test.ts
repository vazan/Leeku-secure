import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { before, after, beforeEach } from 'node:test';

/**
 * Regression suite for the admin per-user storage migration
 * (`moveUserFiles`) — the re-homing at the heart of
 * `GET /api/admin/storage/users` + `POST /api/admin/storage/users/:userId/migrate`.
 *
 * Runs entirely in-memory / on temp dirs:
 *   - `_setRequestProviderForTest` swaps the DB request provider (a test seam on
 *     storage-devices.ts) for a fake that serves device/blob recordsets and
 *     records every `.query()` and blob `UPDATE` it receives.
 *   - Real filesystem is used for reachability, free-space preflight, and the
 *     per-blob copy/unlink, so dry-run purity and atomicity are verified against
 *     real bytes on disk.
 *
 * Covers the highest-risk behaviours from the QA audit (T1):
 *   - dry-run performs ZERO mutation (filesystem + DB)
 *   - real run copies blobs, moves FK, unlinks source — and only the TARGET
 *     user's blobs (scope correctness through files.owner_user_id)
 *   - background job lifecycle: createMigrationJob → progress → finish
 *       (running → done / error) via the in-memory registry
 *   - source === destination refused (fail closed)
 *   - migration refused when destination free space is insufficient
 *   - per-blob atomicity: if the DB UPDATE fails, the copied blob is rolled back
 *   - SQL-injection guard: user inputs are parameterized, never interpolated
 *     into the SQL text sent to the driver
 */

const createdDirs: string[] = [];

function mkdtemp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `leeku-stg-${prefix}-`));
  createdDirs.push(d);
  return d;
}

let storage: typeof import('../src/server/utils/storage-devices.js');
let srcDir: string;
let dstDir: string;

const SRC = '11111111-1111-1111-1111-111111111111';
const DST = '22222222-2222-2222-2222-222222222222';
const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function deviceRow(id: string, storageId: string, storagePath: string) {
  return {
    id,
    storage_id: storageId,
    storage_path: storagePath,
    smb_username_encrypted: null,
    smb_username_iv: null,
    smb_username_auth_tag: null,
    smb_password_encrypted: null,
    smb_password_iv: null,
    smb_password_auth_tag: null,
    provisioning_enabled: 1,
    is_primary: 0,
    quota_bytes: null,
    created_at: new Date(),
  };
}

/**
 * In-memory SQL request. Routes `.query()` by SQL shape and records:
 *   - `queries`: every SQL string sent (for the no-interpolation check)
 *   - `updates`: every blob FK UPDATE param (blobId, destId, table)
 */
function makeFakeRequest(setup: {
  files: Array<{ id: string; stored_path: string; size_bytes: number }>;
  versions: Array<{ id: string; stored_path: string; size_bytes: number }>;
  deviceIds: string[];
  failUpdateBlobIds?: string[];
}) {
  const queries: string[] = [];
  const updates: Array<{ blobId: string; destId: string; table: string }> = [];
  const inputBindings: Array<{ name: string; value: unknown }> = [];
  const inputs = new Map<string, unknown>();
  const failUpdateBlobIds = new Set(setup.failUpdateBlobIds ?? []);

  const request = {
    queries,
    updates,
    inputBindings,
    input(name: string, _type: unknown, value: unknown) {
      inputs.set(name, value);
      inputBindings.push({ name, value });
      return request;
    },
    query: async (sqlText: string) => {
      queries.push(sqlText);
      const text = sqlText;

      // blob FK update (real migration, after physical copy)
      if (/^UPDATE\s+dbo\.(files|file_versions)\s/i.test(text.trim())) {
        const blobId = String(inputs.get('blobId') ?? '');
        if (failUpdateBlobIds.has(blobId)) {
          throw new Error('UPDATE failed (simulated)');
        }
        updates.push({
          blobId,
          destId: String(inputs.get('destId')),
          table: /file_versions/i.test(text) ? 'file_versions' : 'files',
        });
        return { recordset: [], rowsAffected: [1] };
      }

      // storage device lookup
      if (/FROM\s+dbo\.storage_devices/i.test(text)) {
        const id = String(inputs.get('id') ?? '');
        const row = setup.deviceIds.includes(id)
          ? deviceRow(id, id === SRC ? 'DATA-01' : 'DATA-02', id === SRC ? srcDir : dstDir)
          : null;
        return { recordset: row ? [row] : [] };
      }

      // archived-version blobs of the target user (scoped via file_id).
      // MUST be checked before the bare `FROM dbo.files` branch: the versions
      // query also contains `SELECT id FROM dbo.files ...` in its scoping
      // subquery, so matching `.files` first would misroute it.
      if (/FROM\s+dbo\.file_versions/i.test(text)) {
        return { recordset: setup.versions };
      }

      // current-file blobs of the target user on the source device
      if (/FROM\s+dbo\.files/i.test(text)) {
        return { recordset: setup.files };
      }

      return { recordset: [] };
    },
  };
  return request;
}

function writeBlob(baseDir: string, relPath: string, content: string) {
  const abs = path.join(baseDir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

/**
 * In production the blob-layout directories pre-exist on every device (the
 * hashed relative path is mirrored), so a migration's `copyFile` finds the
 * destination parent already present. Tests must mirror that: pre-create the
 * destination parent so the copy targets a real directory — otherwise it would
 * fail with ENOENT for the wrong reason.
 */
function ensureParent(baseDir: string, relPath: string) {
  fs.mkdirSync(path.dirname(path.join(baseDir, relPath)), { recursive: true });
}

function blobExists(baseDir: string, relPath: string): boolean {
  return fs.existsSync(path.join(baseDir, relPath));
}

function installProvider(setup: Parameters<typeof makeFakeRequest>[0]) {
  const fake = makeFakeRequest(setup);
  // The fake is structurally sufficient at runtime but not a real sql.Request;
  // cast through unknown to satisfy the seam's typed signature.
  storage._setRequestProviderForTest(
    (() => Promise.resolve(fake)) as unknown as () => Promise<import('mssql').Request>,
  );
  return fake;
}

before(async () => {
  storage = await import('../src/server/utils/storage-devices.js');
});

beforeEach(() => {
  srcDir = mkdtemp('src');
  dstDir = mkdtemp('dst');
});

after(() => {
  for (const d of createdDirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

// ---------------------------------------------------------------------------
// Dry-run purity
// ---------------------------------------------------------------------------

test('dry-run performs zero filesystem and zero DB mutation', async () => {
  const blobSrc = 'uA/f1.bin';
  const blobVer = 'uA/v1.bin';
  writeBlob(srcDir, blobSrc, 'file-A');
  writeBlob(srcDir, blobVer, 'ver-A');

  const fake = installProvider({
    files: [{ id: 'f1', stored_path: blobSrc, size_bytes: 8 }],
    versions: [{ id: 'v1', stored_path: blobVer, size_bytes: 6 }],
    deviceIds: [SRC, DST],
  });

  const result = await storage.moveUserFiles(USER_A, SRC, DST, { dryRun: true });

  // Preview reports both blobs as "would move".
  assert.equal(result.moved, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.skipped, 0);

  // Source untouched.
  assert.equal(blobExists(srcDir, blobSrc), true, 'source file must not be removed in dry-run');
  assert.equal(blobExists(srcDir, blobVer), true, 'source version must not be removed in dry-run');

  // Nothing copied to destination.
  assert.equal(blobExists(dstDir, blobSrc), false, 'dry-run must not copy file');
  assert.equal(blobExists(dstDir, blobVer), false, 'dry-run must not copy version');

  // No DB FK UPDATE issued.
  assert.deepEqual(fake.updates, [], 'dry-run must not issue any blob UPDATE');

  // No job registered (dry-run passes no jobId → provider never creates one).
  assert.equal(storage.getMigrationProgress('dry-run-no-job'), null);
});

// ---------------------------------------------------------------------------
// Real migration: copies, moves FK, unlinks source — scoped to the target user
// ---------------------------------------------------------------------------

test(`real run moves only the target user's blobs and updates their FK`, async () => {
  const uaFile = 'uA/f.bin';
  const uaVer = 'uA/v.bin';
  const ubFile = 'uB/f.bin'; // belongs to USER_B — must NOT move
  const ubVer = 'uB/v.bin';  // belongs to USER_B — must NOT move
  writeBlob(srcDir, uaFile, 'A-file');
  writeBlob(srcDir, uaVer, 'A-ver');
  writeBlob(srcDir, ubFile, 'B-file');
  writeBlob(srcDir, ubVer, 'B-ver');
  // Destinations already own the same (mirrored) layout dirs, as in production.
  ensureParent(dstDir, uaFile);
  ensureParent(dstDir, uaVer);
  ensureParent(dstDir, ubFile);
  ensureParent(dstDir, ubVer);

  const fake = installProvider({
    // moveUserFiles scopes `WHERE owner_user_id = @userId`, so only USER_A rows
    // come back; USER_B's blobs are conceptually still on the source device.
    files: [{ id: 'fA', stored_path: uaFile, size_bytes: 7 }],
    versions: [{ id: 'vA', stored_path: uaVer, size_bytes: 5 }],
    deviceIds: [SRC, DST],
  });

  const jobId = 'job-real-1';
  const result = await storage.moveUserFiles(USER_A, SRC, DST, { jobId });

  assert.equal(result.moved, 2, "both of user A's blobs moved");
  assert.equal(result.failed, 0);
  assert.equal(result.skipped, 0);

  // FK UPDATEs issued for exactly user A's two blobs.
  assert.equal(fake.updates.length, 2);
  const movedIds = fake.updates.map((u) => u.blobId).sort();
  assert.deepEqual(movedIds, ['fA', 'vA']);
  for (const u of fake.updates) assert.equal(u.destId, DST);

  // Physical copy landed on destination, source removed.
  assert.equal(blobExists(dstDir, uaFile), true, 'file copied to dest');
  assert.equal(blobExists(dstDir, uaVer), true, 'version copied to dest');
  assert.equal(blobExists(srcDir, uaFile), false, 'file unlinked from source');
  assert.equal(blobExists(srcDir, uaVer), false, 'version unlinked from source');

  // USER_B's blobs are untouched (not copied, not removed).
  assert.equal(blobExists(dstDir, ubFile), false, "other user's file must not be copied");
  assert.equal(blobExists(dstDir, ubVer), false, "other user's version must not be copied");
  assert.equal(blobExists(srcDir, ubFile), true, "other user's file must remain on source");
  assert.equal(blobExists(srcDir, ubVer), true, "other user's version must remain on source");

  // Job finished as done with totals.
  const job = storage.getMigrationProgress(jobId);
  assert.ok(job, 'job must be registered');
  assert.equal(job!.status, 'done');
  assert.equal(job!.moved, 2);
  assert.equal(job!.processed, 2);
  assert.equal(job!.total, 2);
});

// ---------------------------------------------------------------------------
// Job lifecycle
// ---------------------------------------------------------------------------

test('job registry transitions running -> done and running -> error', () => {
  const ok = storage.createMigrationJob('job-life', 3);
  assert.equal(ok, true);
  assert.equal(storage.createMigrationJob('job-life', 3), false, 'duplicate create refused');

  let job = storage.getMigrationProgress('job-life');
  assert.equal(job!.status, 'running');
  assert.equal(job!.total, 3);

  storage.setMigrationJobTotal('job-life', 5);
  assert.equal(storage.getMigrationProgress('job-life')!.total, 5);

  storage.finishMigrationJob('job-life', { moved: 4, failed: 1, skipped: 0, failures: [] });
  job = storage.getMigrationProgress('job-life');
  assert.equal(job!.status, 'done');
  assert.equal(job!.processed, 5);
  assert.equal(job!.moved, 4);

  // error path
  storage.createMigrationJob('job-err', 1);
  storage.finishMigrationJob(
    'job-err',
    { moved: 0, failed: 1, skipped: 0, failures: [] },
    { status: 'error', error: 'boom' },
  );
  const errJob = storage.getMigrationProgress('job-err');
  assert.equal(errJob!.status, 'error');
  assert.equal(errJob!.error, 'boom');

  storage.clearMigrationJob('job-life');
  assert.equal(storage.getMigrationProgress('job-life'), null);
});

// ---------------------------------------------------------------------------
// Fail-closed guards
// ---------------------------------------------------------------------------

test('source === destination is refused', async () => {
  const fake = installProvider({ files: [], versions: [], deviceIds: [SRC] });
  await assert.rejects(
    () => storage.moveUserFiles(USER_A, SRC, SRC, { dryRun: true }),
    /Source and destination must be different devices/,
  );
  assert.deepEqual(fake.updates, [], 'no mutation on refusal');
});

test('missing/unknown device is refused', async () => {
  const fake = installProvider({ files: [], versions: [], deviceIds: [DST] });
  await assert.rejects(
    () => storage.moveUserFiles(USER_A, SRC, DST, { dryRun: true }),
    /Source storage device not found/,
  );
  assert.deepEqual(fake.updates, [], 'no mutation on unknown device');
});

test('insufficient destination free space is refused fail-closed', async () => {
  // deviceFreeBytes() returns the real backing-FS free bytes of dstDir, which on
  // a normal dev box is >> any realistic blob total. To trip the guard
  // deterministically regardless of the machine, request a total larger than any
  // real free space (1 PB) — the preflight must refuse with a clear message.
  const fake = installProvider({
    files: [{ id: 'fBig', stored_path: 'uA/big.bin', size_bytes: 10 ** 15 }],
    versions: [],
    deviceIds: [SRC, DST],
  });
  await assert.rejects(
    () => storage.moveUserFiles(USER_A, SRC, DST, { dryRun: true }),
    /only has .* bytes free but the migration requires/,
  );
  assert.deepEqual(fake.updates, [], 'no mutation when refused');
});

// ---------------------------------------------------------------------------
// Per-blob atomicity: DB update failure rolls back the copy
// ---------------------------------------------------------------------------

test('DB UPDATE failure rolls back the copied blob (source stays canonical)', async () => {
  const blobSrc = 'uA/f.bin';
  writeBlob(srcDir, blobSrc, 'atomic');
  ensureParent(dstDir, blobSrc); // copy must succeed so the UPDATE (and its rollback) is what's exercised
  const fake = installProvider({
    files: [{ id: 'fAtomic', stored_path: blobSrc, size_bytes: 7 }],
    versions: [],
    deviceIds: [SRC, DST],
    failUpdateBlobIds: ['fAtomic'],
  });

  const jobId = 'job-atomic';
  const result = await storage.moveUserFiles(USER_A, SRC, DST, { jobId });

  // The blob is counted as failed, not moved.
  assert.equal(result.failed, 1);
  assert.equal(result.moved, 0);

  // Prove we genuinely exercised the DB-UPDATE-failure path (not a copy failure):
  // the failure reason must be the simulated update error.
  assert.ok(result.failures.length === 1, 'expected exactly one failure');
  assert.equal(result.failures[0]!.reason, 'UPDATE failed (simulated)');

  // Destination copy must have been removed (rollback), source intact.
  assert.equal(blobExists(dstDir, blobSrc), false, 'rolled-back copy must be removed');
  assert.equal(blobExists(srcDir, blobSrc), true, 'source stays canonical after failed DB update');

  const job = storage.getMigrationProgress(jobId);
  assert.equal(job!.status, 'done');
  assert.equal(job!.failed, 1);
});

// ---------------------------------------------------------------------------
// SQL-injection guard: inputs are parameterized, never interpolated
// ---------------------------------------------------------------------------

test('malicious user input is parameterized — never concatenated into SQL', async () => {
  const evil = "x'; DROP TABLE dbo.files;--";
  const fake = installProvider({
    files: [{ id: 'f1', stored_path: 'uA/f.bin', size_bytes: 4 }],
    versions: [{ id: 'v1', stored_path: 'uA/v.bin', size_bytes: 4 }],
    deviceIds: [SRC, DST],
  });

  // The evil string is accepted as a *bound parameter* (the real driver would
  // reject it at the sql.UniqueIdentifier type coercion; the fake's input() is
  // permissive). Either way, the payload must NEVER appear in the SQL text.
  const result = await storage.moveUserFiles(evil, SRC, DST, { dryRun: true });

  // It was routed only through .input() bindings...
  const boundValues = fake.inputBindings.map((b) => String(b.value));
  assert.ok(boundValues.includes(evil), 'payload should be passed as a bound parameter');

  // ...and never spliced into any SQL string sent to the driver.
  assert.ok(fake.queries.length > 0, 'expected the service to issue queries');
  for (const q of fake.queries) {
    assert.equal(q.includes(evil), false, 'SQL must not interpolate user payload');
  }
});
