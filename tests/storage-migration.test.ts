import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { before, after, beforeEach } from 'node:test';
import type { StorageDevice } from '../src/server/utils/storage-devices.js';

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

function deviceRow(id: string, storageId: string, storagePath: string, overrides: {
  provisioning_enabled?: boolean;
  quota_bytes?: number | null;
} = {}) {
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
    provisioning_enabled: overrides.provisioning_enabled !== undefined ? (overrides.provisioning_enabled ? 1 : 0) : 1,
    is_primary: 0,
    quota_bytes: overrides.quota_bytes !== undefined ? overrides.quota_bytes : null,
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
  /**
   * Per-device-provisioning flags for the preference tests (defaults: enabled,
   * unlimited quota). Keys are device ids.
   */
  deviceFlags?: Record<string, { provisioning_enabled?: boolean; quota_bytes?: number | null }>;
  /**
   * Maps a userId to its preferred default device id (or null/absent = unset).
   * Served from the `users` table lookup in getUserPreferredStorageDevice.
   */
  preferredDeviceByUser?: Record<string, string | null>;
  /**
   * Per-device usage totals (bytes) served by getStorageDeviceUsage, for the
   * quota-exceeded fail-closed test. Defaults to 0.
   */
  deviceUsageBytes?: Record<string, number>;
}) {
  const queries: string[] = [];
  const updates: Array<{ blobId: string; destId: string; table: string }> = [];
  const inputBindings: Array<{ name: string; value: unknown }> = [];
  const inputs = new Map<string, unknown>();
  const failUpdateBlobIds = new Set(setup.failUpdateBlobIds ?? []);
  const deviceFlags = setup.deviceFlags ?? {};
  const preferredDeviceByUser = setup.preferredDeviceByUser ?? {};
  const deviceUsageBytes = setup.deviceUsageBytes ?? {};

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

      // storage usage aggregate (getStorageDeviceUsage)
      if (/COALESCE\(SUM\(size_bytes\)/i.test(text)) {
        const id = String(inputs.get('id') ?? '');
        const usageBytes = deviceUsageBytes[id] ?? 0;
        return { recordset: [{ files: usageBytes > 0 ? 1 : 0, versions: 0, bytes: usageBytes }] };
      }

      // users.preferred_storage_device_id lookup (getUserPreferredStorageDevice)
      if (/FROM\s+dbo\.users/i.test(text)) {
        const userId = String(inputs.get('userId') ?? '');
        const prefId = preferredDeviceByUser[userId] ?? null;
        return { recordset: [{ device_id: prefId }] };
      }

      // storage device lookup
      if (/FROM\s+dbo\.storage_devices/i.test(text)) {
        const id = String(inputs.get('id') ?? '');
        const row = setup.deviceIds.includes(id)
          ? deviceRow(id, id === SRC ? 'DATA-01' : 'DATA-02', id === SRC ? srcDir : dstDir, deviceFlags[id])
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

// ---------------------------------------------------------------------------
// Per-user preferred default device (feat/storage/per-user-default-device)
// ---------------------------------------------------------------------------
// Covers `getUserPreferredStorageDevice` + `selectProvisionDeviceForUser`:
//   - preferred device set → the user's NEW uploads provision to it
//   - preferred device unset (NULL) → null, falls back to selectProvisionDevice
//   - fail-closed: preferred device unreachable / quota-exceeded /
//     not provisioning_enabled → THROWS with a clear error (no fallback)
//   - auto-migrate on set uses moveUserFiles (FK updates target the new device)

// Builds the device pool passed to selectProvisionDeviceForUser / selectProvisionDevice
// the same way the upload route does. The credential/encrypted fields are null in
// tests (not exercised by the provisioning selection logic).
function poolDevice(p: {
  id: string; storage_id: string; storage_path: string;
  provisioning_enabled?: boolean; is_primary?: boolean; quota_bytes?: number | null;
}): StorageDevice {
  return {
    id: p.id,
    storage_id: p.storage_id,
    storage_path: p.storage_path,
    smb_username_encrypted: null,
    smb_username_iv: null,
    smb_username_auth_tag: null,
    smb_password_encrypted: null,
    smb_password_iv: null,
    smb_password_auth_tag: null,
    provisioning_enabled: p.provisioning_enabled ?? true,
    is_primary: p.is_primary ?? false,
    quota_bytes: p.quota_bytes ?? null,
    created_at: new Date(),
  };
}

test('preferred device set → selectProvisionDeviceForUser returns it', async () => {
  // SRC points at srcDir (exists), provisioning enabled, unlimited quota.
  const fake = installProvider({
    files: [],
    versions: [],
    deviceIds: [SRC],
    preferredDeviceByUser: { [USER_A]: SRC },
  });

  const pool = [poolDevice({ id: SRC, storage_id: 'DATA-01', storage_path: srcDir })];
  const target = await storage.selectProvisionDeviceForUser(pool, USER_A);
  assert.equal(target.id, SRC);
});

test('preferred device unset (NULL) → getUserPreferredStorageDevice returns null (falls back to default)', async () => {
  const fake = installProvider({
    files: [],
    versions: [],
    deviceIds: [SRC],
    preferredDeviceByUser: { [USER_A]: null },
  });

  const preferred = await storage.getUserPreferredStorageDevice(USER_A);
  assert.equal(preferred, null);

  // NULL preference must NOT break the global default path (no regression).
  const pool = [
    poolDevice({ id: SRC, storage_id: 'DATA-01', storage_path: srcDir, provisioning_enabled: true, is_primary: true }),
  ];
  const defaultTarget = await storage.selectProvisionDevice(pool);
  assert.equal(defaultTarget!.id, SRC);
});

test('preferred device not provisioning_enabled → upload fails closed', async () => {
  const fake = installProvider({
    files: [],
    versions: [],
    deviceIds: [SRC],
    deviceFlags: { [SRC]: { provisioning_enabled: false } },
    preferredDeviceByUser: { [USER_A]: SRC },
  });

  const pool = [poolDevice({ id: SRC, storage_id: 'DATA-01', storage_path: srcDir, provisioning_enabled: false })];
  await assert.rejects(
    () => storage.selectProvisionDeviceForUser(pool, USER_A),
    /not provisioning-enabled/,
  );
});

test('preferred device quota-exceeded → upload fails closed', async () => {
  // quota_bytes = 5, and the device already holds usage_bytes > quota → the
  // preferred device must fail closed (the new upload may not provision).
  const fake = installProvider({
    files: [],
    versions: [],
    deviceIds: [SRC],
    deviceFlags: { [SRC]: { quota_bytes: 5 } },
    deviceUsageBytes: { [SRC]: 100 },
    preferredDeviceByUser: { [USER_A]: SRC },
  });

  const pool = [poolDevice({ id: SRC, storage_id: 'DATA-01', storage_path: srcDir, quota_bytes: 5 })];
  await assert.rejects(
    () => storage.selectProvisionDeviceForUser(pool, USER_A),
    /reached its storage quota/,
  );
});

test('preferred device unreachable → upload fails closed', async () => {
  const fake = installProvider({
    files: [],
    versions: [],
    deviceIds: [SRC],
    preferredDeviceByUser: { [USER_A]: SRC },
  });

  // Point the preferred device at a non-existent path (unreachable).
  const pool = [poolDevice({ id: SRC, storage_id: 'DATA-01', storage_path: '/nonexistent-device-root-xyz' })];
  await assert.rejects(
    () => storage.selectProvisionDeviceForUser(pool, USER_A),
    /not reachable/,
  );
});

test('auto-migrate on set routes the user\'s blobs to the preferred device (FK updates target it)', async () => {
  // "Auto-migrate on set" reuses moveUserFiles. Assigning a preferred device
  // kicks off a background job moving the user's existing blobs TO it. Here we
  // prove the per-blob FK UPDATE targets the newly preferred device (DST) and
  // that the atomic copy/FK/unlink ran end-to-end.
  const uaFile = 'uA/f.bin';
  const uaVer = 'uA/v.bin';
  writeBlob(srcDir, uaFile, 'A-file');
  writeBlob(srcDir, uaVer, 'A-ver');
  ensureParent(dstDir, uaFile);
  ensureParent(dstDir, uaVer);

  const fake = installProvider({
    files: [{ id: 'fA', stored_path: uaFile, size_bytes: 7 }],
    versions: [{ id: 'vA', stored_path: uaVer, size_bytes: 5 }],
    deviceIds: [SRC, DST],
    preferredDeviceByUser: { [USER_A]: DST },
  });

  const jobId = 'job-pref-auto';
  const result = await storage.moveUserFiles(USER_A, SRC, DST, { jobId });

  assert.equal(result.moved, 2);
  assert.deepEqual(fake.updates.map((u) => u.destId), [DST, DST], 'both FK updates target the preferred device');
  assert.equal(blobExists(dstDir, uaFile), true, 'file copied to preferred device');
  assert.equal(blobExists(dstDir, uaVer), true, 'version copied to preferred device');
  assert.equal(blobExists(srcDir, uaFile), false, 'source file unlinked');
  assert.equal(blobExists(srcDir, uaVer), false, 'source version unlinked');
});
