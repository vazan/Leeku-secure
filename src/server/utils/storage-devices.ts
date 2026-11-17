/**
 * @license SPDX-License-Identifier: Apache-2.0
 *
 * Leeku Secure — Storage Device Service
 *
 * Replaces the single-path vault root (FILE_STORAGE_UNC_PATH) with a
 * database-backed multi-storage availability group (ADR-0001).
 *
 * Responsibilities:
 *   - Storage device registry CRUD (used by the admin /api/admin/storage API).
 *   - Storage device selection (auto-balancing) for new uploads.
 *   - Blob path resolution: (device.storage_path, stored_path) -> absolute path.
 *   - Startup migration: seed the initial device from legacy env vars and
 *     backfill existing files/file_versions rows (app-computed because the
 *     SMB credentials must be column-encrypted with MASTER_KEY_BASE64).
 *   - Per-device reachability check (replaces the global UNC monitor).
 *
 * Design notes:
 *   - `stored_path` stays a RELATIVE logical name per device; the device
 *     identity is the new FK, not embedded in the path.
 *   - SMB credentials are encrypted at rest via encryptColumn()/decryptColumn()
 *     and are never returned plaintext by the admin API.
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getRequest as dbGetRequest, sql } from '../db.js';
import { encryptColumn, decryptColumn } from './encryption.js';

// ──────────────────────────────────────────────────────────────
// Test seam
// ──────────────────────────────────────────────────────────────
// All DB access in this module flows through a single `getRequest()` indirection
// so tests can substitute an in-memory request (no live SQL Server). Production
// behaviour is unchanged: the provider defaults to the real `db.getRequest`.
let requestProvider: () => Promise<sql.Request> = dbGetRequest;

/** @internal Test-only: swap the request provider (restore by passing undefined). */
export function _setRequestProviderForTest(provider?: () => Promise<sql.Request>): void {
  requestProvider = provider ?? dbGetRequest;
}

function getRequest(): Promise<sql.Request> {
  return requestProvider();
}

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

export interface StorageDevice {
  id: string;
  storage_id: string;
  storage_path: string;
  smb_username_encrypted: Buffer | null;
  smb_username_iv: Buffer | null;
  smb_username_auth_tag: Buffer | null;
  smb_password_encrypted: Buffer | null;
  smb_password_iv: Buffer | null;
  smb_password_auth_tag: Buffer | null;
  provisioning_enabled: boolean;
  is_primary: boolean;
  /** Soft storage cap in bytes for this device; null means unlimited. */
  quota_bytes: number | null;
  created_at: Date;
}

/** Safe shape returned to the admin API (no encrypted blobs, no plaintext). */
export interface StorageDeviceDto {
  id: string;
  storage_id: string;
  storage_path: string;
  provisioning_enabled: boolean;
  is_primary: boolean;
  has_smb_credentials: boolean;
  reachable: boolean;
  created_at: Date;
  /** Soft storage cap in bytes for this device; null means unlimited. */
  quota_bytes: number | null;
  /** Per-device usage ratio (0..1+) against quota; null when quota is unset. */
  quota_usage: number | null;
  /** Number of current-file blobs physically stored on this device (ADR-0001). */
  file_count: number;
  /** Number of archived-version blobs physically stored on this device (ADR-0001). */
  version_count: number;
  /** Total size in bytes of the blobs physically stored on this device. */
  bytes_used: number;
  /** Estimated free space (bytes) on the device root, null when unknown. */
  free_bytes: number | null;
}

export interface StorageDeviceInput {
  storage_id: string;
  storage_path: string;
  smb_username?: string | null;
  smb_password?: string | null;
  provisioning_enabled?: boolean;
  is_primary?: boolean;
  /** Soft storage cap in bytes; null/undefined means unlimited. */
  quota_bytes?: number | null;
}

type SelectRow = {
  id: string;
  storage_id: string;
  storage_path: string;
  smb_username_encrypted: Buffer | null;
  smb_username_iv: Buffer | null;
  smb_username_auth_tag: Buffer | null;
  smb_password_encrypted: Buffer | null;
  smb_password_iv: Buffer | null;
  smb_password_auth_tag: Buffer | null;
  provisioning_enabled: boolean;
  is_primary: boolean;
  quota_bytes: number | null;
  created_at: Date;
};

// ──────────────────────────────────────────────────────────────
// Registry queries
// ──────────────────────────────────────────────────────────────

const SELECT_COLS = `
  id, storage_id, storage_path,
  smb_username_encrypted, smb_username_iv, smb_username_auth_tag,
  smb_password_encrypted, smb_password_iv, smb_password_auth_tag,
  provisioning_enabled, is_primary, quota_bytes, created_at
`;

function mapRow(row: SelectRow): StorageDevice {
  return {
    id: row.id,
    storage_id: row.storage_id,
    storage_path: row.storage_path,
    smb_username_encrypted: row.smb_username_encrypted,
    smb_username_iv: row.smb_username_iv,
    smb_username_auth_tag: row.smb_username_auth_tag,
    smb_password_encrypted: row.smb_password_encrypted,
    smb_password_iv: row.smb_password_iv,
    smb_password_auth_tag: row.smb_password_auth_tag,
    provisioning_enabled: !!row.provisioning_enabled,
    is_primary: !!row.is_primary,
    quota_bytes: row.quota_bytes != null ? Number(row.quota_bytes) : null,
    created_at: row.created_at,
  };
}

/** Lists all storage devices ordered by is_primary DESC, storage_id ASC. */
export async function listStorageDevices(): Promise<StorageDevice[]> {
  const req = await getRequest();
  const result = await req.query<SelectRow>(
    `SELECT ${SELECT_COLS} FROM dbo.storage_devices ORDER BY is_primary DESC, storage_id ASC`
  );
  return result.recordset.map(mapRow);
}

/** Returns a device by id, or null. */
export async function getStorageDevice(id: string): Promise<StorageDevice | null> {
  const req = await getRequest();
  req.input('id', sql.UniqueIdentifier, id);
  const result = await req.query<SelectRow>(
    `SELECT TOP 1 ${SELECT_COLS} FROM dbo.storage_devices WHERE id = @id`
  );
  return result.recordset.length ? mapRow(result.recordset[0]) : null;
}

function encryptValue(value: string): { encrypted: Buffer; iv: Buffer; authTag: Buffer } {
  const enc = encryptColumn(value);
  return { encrypted: enc.ciphertext, iv: enc.iv, authTag: enc.authTag };
}

/**
 * Creates a storage device. SMB credentials are column-encrypted before being
 * stored. If is_primary is requested, other devices' primary flag is cleared.
 */
export async function createStorageDevice(input: StorageDeviceInput): Promise<StorageDevice> {
  const id = randomUUID();
  const req = await getRequest();

  req.input('id', sql.UniqueIdentifier, id);
  req.input('storageId', sql.NVarChar(64), input.storage_id);
  req.input('storagePath', sql.NVarChar(1000), input.storage_path);

  const username = input.smb_username != null ? encryptValue(input.smb_username) : null;
  const password = input.smb_password != null ? encryptValue(input.smb_password) : null;

  req.input('userEnc', sql.VarBinary, username?.encrypted ?? null);
  req.input('userIv', sql.VarBinary, username?.iv ?? null);
  req.input('userTag', sql.VarBinary, username?.authTag ?? null);
  req.input('passEnc', sql.VarBinary, password?.encrypted ?? null);
  req.input('passIv', sql.VarBinary, password?.iv ?? null);
  req.input('passTag', sql.VarBinary, password?.authTag ?? null);
  req.input('enabled', sql.Bit, input.provisioning_enabled ? 1 : 0);
  req.input('primary', sql.Bit, input.is_primary ? 1 : 0);
  const quotaBytes = input.quota_bytes != null ? Math.floor(input.quota_bytes) : null;
  if (quotaBytes != null && quotaBytes <= 0) throw new Error('quota_bytes must be a positive byte count when set.');
  req.input('quotaBytes', sql.BigInt, quotaBytes);

  await req.query(`
    BEGIN TRANSACTION;
    IF @primary = 1
      UPDATE dbo.storage_devices SET is_primary = 0 WHERE is_primary = 1;
    INSERT INTO dbo.storage_devices (
      id, storage_id, storage_path,
      smb_username_encrypted, smb_username_iv, smb_username_auth_tag,
      smb_password_encrypted, smb_password_iv, smb_password_auth_tag,
      provisioning_enabled, is_primary, quota_bytes
    ) VALUES (
      @id, @storageId, @storagePath,
      @userEnc, @userIv, @userTag,
      @passEnc, @passIv, @passTag,
      @enabled, @primary, @quotaBytes
    );
    COMMIT;
  `);

  const created = await getStorageDevice(id);
  if (!created) throw new Error('Failed to read back created storage device.');
  return created;
}

/** Decrypts the SMB username of a device, or null. */
export function decryptedUsername(device: StorageDevice): string | null {
  if (!device.smb_username_encrypted || !device.smb_username_iv || !device.smb_username_auth_tag) {
    return null;
  }
  return decryptColumn(device.smb_username_encrypted, device.smb_username_iv, device.smb_username_auth_tag);
}

/** Decrypts the SMB password of a device, or null. */
export function decryptedPassword(device: StorageDevice): string | null {
  if (!device.smb_password_encrypted || !device.smb_password_iv || !device.smb_password_auth_tag) {
    return null;
  }
  return decryptColumn(device.smb_password_encrypted, device.smb_password_iv, device.smb_password_auth_tag);
}

// ──────────────────────────────────────────────────────────────
// Reachability
// ──────────────────────────────────────────────────────────────

/** Checks a device root is readable (used by per-device health monitor + admin). */
export async function isDeviceReachable(storagePath: string): Promise<boolean> {
  try {
    await fs.promises.access(storagePath, fs.constants.R_OK);
    await fs.promises.readdir(storagePath);
    return true;
  } catch {
    return false;
  }
}

/** Builds a safe admin DTO (no encrypted blobs, no plaintext credentials). */
export async function toDto(device: StorageDevice): Promise<StorageDeviceDto> {
  const usage = await getStorageDeviceUsage(device.id);
  const quotaRatio =
    device.quota_bytes != null && device.quota_bytes > 0
      ? usage.totalBytes / device.quota_bytes
      : null;
  return {
    id: device.id,
    storage_id: device.storage_id,
    storage_path: device.storage_path,
    provisioning_enabled: device.provisioning_enabled,
    is_primary: device.is_primary,
    has_smb_credentials: !!device.smb_username_encrypted || !!device.smb_password_encrypted,
    reachable: await isDeviceReachable(device.storage_path),
    created_at: device.created_at,
    quota_bytes: device.quota_bytes,
    quota_usage: quotaRatio,
    file_count: usage.files,
    version_count: usage.versions,
    bytes_used: usage.totalBytes,
    free_bytes: await deviceFreeBytes(device.storage_path),
  };
}

// ──────────────────────────────────────────────────────────────
// Blob path resolution (device-aware)
// ──────────────────────────────────────────────────────────────

/**
 * Resolves the absolute vault path for a blob on a given device.
 * storage_path is the device root; stored_path is a relative name.
 */
export function resolveBlobPath(device: StorageDevice, storedPath: string): string {
  return path.join(device.storage_path, storedPath);
}

// ──────────────────────────────────────────────────────────────
// Device selection (auto-balancing)
// ──────────────────────────────────────────────────────────────

/**
 * Selects the target device for a new upload.
 *
 * Auto-balancing rules:
 *   1. Filter devices with provisioning_enabled = 1.
 *   2. Filter out devices that have already reached their per-device quota
 *      (quota_bytes set AND usage >= quota). Devices with a NULL quota are
 *      treated as unlimited.
 *   3. Prefer is_primary = 1 if reachable and within quota.
 *   4. Otherwise order by ascending free-space ratio (most free space first),
 *      falling back to round-robin among reachable enabled devices.
 *
 * Free-space is derived from `statfs` (available_blocks * block_size);
 * devices that fail the stat are treated as full (ranked last).
 *
 * Returns null when no provisionable+reachable device exists — the caller
 * must fail the upload closed.
 */
export async function selectProvisionDevice(devices: StorageDevice[]): Promise<StorageDevice | null> {
  const enabled = devices.filter((d) => d.provisioning_enabled);
  if (enabled.length === 0) return null;

  // Filter out devices that have already reached their quota (NULL = unlimited).
  const withinQuota: StorageDevice[] = [];
  for (const d of enabled) {
    if (d.quota_bytes == null || d.quota_bytes <= 0) {
      withinQuota.push(d);
      continue;
    }
    const usage = await getStorageDeviceUsage(d.id);
    if (usage.totalBytes < d.quota_bytes) withinQuota.push(d);
  }
  if (withinQuota.length === 0) return null;

  const reachable: StorageDevice[] = [];
  for (const d of withinQuota) {
    if (await isDeviceReachable(d.storage_path)) reachable.push(d);
  }
  if (reachable.length === 0) return null;

  const primary = reachable.find((d) => d.is_primary);
  if (primary) return primary;

  // Most free space first.
  const freeSpace = await Promise.all(
    reachable.map(async (d) => {
      try {
        const st = await fs.promises.statfs(d.storage_path);
        return st.bavail * st.bsize;
      } catch {
        return -1;
      }
    })
  );

  let best = reachable[0];
  let bestFree = -1;
  for (let i = 0; i < reachable.length; i++) {
    if (freeSpace[i] > bestFree) {
      best = reachable[i];
      bestFree = freeSpace[i];
    }
  }
  return best;
}

// ──────────────────────────────────────────────────────────────
// Per-user preferred default device (provisioning override)
// ──────────────────────────────────────────────────────────────

/**
 * Resolves the user's preferred default storage device, or null when unset.
 *
 * A per-user preference overrides the server-wide default provisioning for NEW
 * uploads only. Returns null when the column is NULL (falls back to the global
 * `selectProvisionDevice`) or when the referenced device no longer exists
 * (e.g. deleted — ON DELETE SET NULL keeps this from surfacing normally).
 */
export async function getUserPreferredStorageDevice(userId: string): Promise<StorageDevice | null> {
  const req = await getRequest();
  req.input('userId', sql.UniqueIdentifier, userId);
  const result = await req.query<{ device_id: string | null }>(
    `SELECT TOP 1 preferred_storage_device_id AS device_id
       FROM dbo.users WHERE id = @userId`
  );
  const deviceId = result.recordset.length ? result.recordset[0]!.device_id : null;
  if (!deviceId) return null;
  return getStorageDevice(deviceId);
}

/**
 * Selects the provisioning target for a user who has a preferred default
 * device set. Fail-closed: the preferred device MUST be provisioning-enabled
 * AND within its per-device quota AND reachable — otherwise this THROWS so the
 * upload fails clearly instead of silently falling back to the global default.
 *
 * Mirrors the checks in `selectProvisionDevice` (quota usage, reachability) but
 * only ever evaluates the single preferred device — there is no auto-balancing
 * fallback within this function.
 */
export async function selectProvisionDeviceForUser(
  devices: StorageDevice[],
  userId: string,
): Promise<StorageDevice> {
  const preferred = await getUserPreferredStorageDevice(userId);
  if (!preferred) {
    throw new Error('No preferred storage device is set for this user — fall back to server default provisioning.');
  }

  const enabled = devices.find((d) => d.id === preferred.id);
  if (!enabled || !enabled.provisioning_enabled) {
    throw new Error(
      `Preferred storage device is not provisioning-enabled for this user's uploads. ` +
      `Enable provisioning for the device or clear the user's preferred device in the admin panel.`,
    );
  }
  if (enabled.quota_bytes != null && enabled.quota_bytes > 0) {
    const usage = await getStorageDeviceUsage(enabled.id);
    if (usage.totalBytes >= enabled.quota_bytes) {
      throw new Error(
        `Preferred storage device has reached its storage quota for this user's uploads. ` +
        `Raise the device quota or clear the user's preferred device in the admin panel.`,
      );
    }
  }
  if (!(await isDeviceReachable(enabled.storage_path))) {
    throw new Error(
      `Preferred storage device is not reachable for this user's uploads. ` +
      `Restore the device or clear the user's preferred device in the admin panel.`,
    );
  }
  return enabled;
}

// ──────────────────────────────────────────────────────────────
// CRUD: update / delete
// ──────────────────────────────────────────────────────────────

/**
 * Updates a device. Only the provided fields are changed. SMB credentials are
 * re-encrypted when a non-empty new value is supplied; supply an explicit
 * empty string to clear stored credentials, or undefined to leave unchanged.
 */
export async function updateStorageDevice(
  id: string,
  patch: Partial<Omit<StorageDeviceInput, 'storage_id'>> & { storage_id?: string }
): Promise<StorageDevice> {
  const existing = await getStorageDevice(id);
  if (!existing) throw new Error('Storage device not found.');

  const sets: string[] = [];
  const req = await getRequest();

  if (patch.storage_id !== undefined) {
    req.input('storageId', sql.NVarChar(64), patch.storage_id);
    sets.push('storage_id = @storageId');
  }
  if (patch.storage_path !== undefined) {
    req.input('storagePath', sql.NVarChar(1000), patch.storage_path);
    sets.push('storage_path = @storagePath');
  }
  if (patch.provisioning_enabled !== undefined) {
    req.input('enabled', sql.Bit, patch.provisioning_enabled ? 1 : 0);
    sets.push('provisioning_enabled = @enabled');
  }
  if (patch.is_primary !== undefined) {
    req.input('primary', sql.Bit, patch.is_primary ? 1 : 0);
    sets.push('is_primary = @primary');
  }
  if (patch.quota_bytes !== undefined) {
    // POURQUOI : allow both setting a positive cap and clearing it back to
    // "unlimited" (null). Undefined (not present) leaves the field untouched.
    const qb = patch.quota_bytes != null ? Math.floor(patch.quota_bytes) : null;
    if (qb != null && qb <= 0) throw new Error('quota_bytes must be a positive byte count when set.');
    req.input('quotaBytes', sql.BigInt, qb);
    sets.push('quota_bytes = @quotaBytes');
  }

  if (patch.smb_username != null && patch.smb_username !== '') {
    const u = encryptValue(patch.smb_username);
    req.input('uEnc', sql.VarBinary, u.encrypted);
    req.input('uIv', sql.VarBinary, u.iv);
    req.input('uTag', sql.VarBinary, u.authTag);
    sets.push(
      'smb_username_encrypted = @uEnc, smb_username_iv = @uIv, smb_username_auth_tag = @uTag'
    );
  } else if (patch.smb_username === '') {
    sets.push(
      'smb_username_encrypted = NULL, smb_username_iv = NULL, smb_username_auth_tag = NULL'
    );
  }
  if (patch.smb_password != null && patch.smb_password !== '') {
    const p = encryptValue(patch.smb_password);
    req.input('pEnc', sql.VarBinary, p.encrypted);
    req.input('pIv', sql.VarBinary, p.iv);
    req.input('pTag', sql.VarBinary, p.authTag);
    sets.push(
      'smb_password_encrypted = @pEnc, smb_password_iv = @pIv, smb_password_auth_tag = @pTag'
    );
  } else if (patch.smb_password === '') {
    sets.push(
      'smb_password_encrypted = NULL, smb_password_iv = NULL, smb_password_auth_tag = NULL'
    );
  }

  if (sets.length === 0) return existing;

  req.input('id', sql.UniqueIdentifier, id);

  // When the patch sets is_primary = 1, clear the primary flag on other devices
  // in the same transaction so the partial unique index is never violated.
  const settingPrimary = patch.is_primary === true;
  const primaryGuard = settingPrimary
    ? `
      UPDATE dbo.storage_devices SET is_primary = 0 WHERE id != @id AND is_primary = 1;
    `
    : '';

  const setClause = sets.join(', ');
  await req.query(`
    BEGIN TRANSACTION;
    ${primaryGuard}
    UPDATE dbo.storage_devices SET ${setClause} WHERE id = @id;
    COMMIT;
  `);

  const updated = await getStorageDevice(id);
  if (!updated) throw new Error('Storage device disappeared during update.');
  return updated;
}

/**
 * Deletes a device. Refuses when any files or file_versions reference it.
 */
export async function deleteStorageDevice(id: string): Promise<void> {
  const req = await getRequest();
  req.input('id', sql.UniqueIdentifier, id);

  const countResult = await req.query<{ c: number }>(
    `SELECT
       (SELECT COUNT(*) FROM dbo.files WHERE storage_device_id = @id)
       + (SELECT COUNT(*) FROM dbo.file_versions WHERE storage_device_id = @id) AS c`
  );
  const refCount = Number(countResult.recordset[0]?.c ?? 0);
  if (refCount > 0) {
    throw new Error(`Cannot delete storage device: ${refCount} blob(s) still reference it.`);
  }

  await req.query(`DELETE FROM dbo.storage_devices WHERE id = @id`);
}

// ──────────────────────────────────────────────────────────────
// Per-device usage + migration (ADR-0001)
// ──────────────────────────────────────────────────────────────

export interface StorageDeviceUsage {
  files: number;
  versions: number;
  totalBytes: number;
}

/**
 * Returns how many current-file blobs, archived-version blobs, and total
 * bytes reference a device. Used by the admin panel to report per-device
 * usage and to guard migrations against space-constrained destinations.
 */
export async function getStorageDeviceUsage(id: string): Promise<StorageDeviceUsage> {
  const req = await getRequest();
  req.input('id', sql.UniqueIdentifier, id);
  const result = await req.query<{ files: number; versions: number; bytes: number | null }>(
    `SELECT
       (SELECT COUNT(*) FROM dbo.files         WHERE storage_device_id = @id) AS files,
       (SELECT COUNT(*) FROM dbo.file_versions WHERE storage_device_id = @id) AS versions,
       (SELECT COALESCE(SUM(size_bytes), 0)
          FROM (
            SELECT size_bytes FROM dbo.files         WHERE storage_device_id = @id
            UNION ALL
            SELECT size_bytes FROM dbo.file_versions WHERE storage_device_id = @id
          ) t) AS bytes`
  );
  const row = result.recordset[0];
  return {
    files: Number(row?.files ?? 0),
    versions: Number(row?.versions ?? 0),
    totalBytes: Number(row?.bytes ?? 0),
  };
}

export interface DeviceMigrationResult {
  moved: number;
  failed: number;
  skipped: number;
  failures: Array<{ kind: 'file' | 'version'; id: string; stored_path: string; reason: string }>;
}

// ──────────────────────────────────────────────────────────────
// Migration progress tracking
// ──────────────────────────────────────────────────────────────

export type MigrationStatus = 'running' | 'done' | 'error';

/** Live progress snapshot for a running/finished device-migration job. */
export interface MigrationProgress {
  status: MigrationStatus;
  total: number;      // number of blobs (files + versions) to process
  processed: number;  // blobs processed so far (moved + failed + skipped)
  moved: number;
  failed: number;
  skipped: number;
  failures: Array<DeviceMigrationResult['failures'][number]>;
  error?: string;     // set only when status === 'error'
  updatedAt: number;  // epoch ms of last update, for staleness cleanup
}

/**
 * In-process registry of active/recent device-migration jobs, keyed by an
 * opaque job id handed back to the admin UI so it can poll progress.
 * In-memory (not persisted): a job that outlives a process restart simply
 * loses its progress reporting, but the migration itself is per-file atomic
 * and resumable via a fresh run.
 */
const migrationJobs = new Map<string, MigrationProgress>();

/** Snapshot of a migration job's progress, or null when unknown/expired. */
export function getMigrationProgress(jobId: string): MigrationProgress | null {
  return migrationJobs.get(jobId) ?? null;
}

/** Creates a new running job entry. Returns false if one already exists. */
export function createMigrationJob(jobId: string, total: number): boolean {
  if (migrationJobs.has(jobId)) return false;
  migrationJobs.set(jobId, {
    status: 'running',
    total,
    processed: 0,
    moved: 0,
    failed: 0,
    skipped: 0,
    failures: [],
    updatedAt: Date.now(),
  });
  return true;
}

/**
 * Updates the expected total blob count of a running job (used when the route
 * pre-creates a job before the worker knows the true total). No-op when the
 * job is absent or no longer running.
 */
export function setMigrationJobTotal(jobId: string, total: number): void {
  const job = migrationJobs.get(jobId);
  if (job && job.status === 'running') job.total = total;
}

/** Marks a migration job as finished with a summary. */
export function finishMigrationJob(
  jobId: string,
  result: DeviceMigrationResult,
  options?: { status?: MigrationStatus; error?: string },
): void {
  const job = migrationJobs.get(jobId);
  if (!job) return;
  job.status = options?.status ?? 'done';
  job.error = options?.error;
  job.processed = result.moved + result.failed + result.skipped;
  job.moved = result.moved;
  job.failed = result.failed;
  job.skipped = result.skipped;
  job.failures = result.failures;
  job.updatedAt = Date.now();
}

/** Applies a per-blob result delta to a live job (no-op when job is absent). */
function updateMigrationJobProgress(
  jobId: string | null | undefined,
  outcome: { moved?: boolean; failed?: boolean; skipped?: boolean; failure?: DeviceMigrationResult['failures'][number] },
): void {
  if (!jobId) return;
  const job = migrationJobs.get(jobId);
  if (!job || job.status !== 'running') return;
  if (outcome.moved) job.moved += 1;
  else if (outcome.failed) job.failed += 1;
  else if (outcome.skipped) job.skipped += 1;
  if (outcome.failure) job.failures.push(outcome.failure);
  job.processed += 1;
  job.updatedAt = Date.now();
}

/** Removes a finished/errored migration job, freeing memory. */
export function clearMigrationJob(jobId: string): void {
  migrationJobs.delete(jobId);
}

/**
 * Removes all migration jobs that have been terminal (done/error) for longer
 * than `ttlMs`. Used by a periodic sweep so the in-memory registry does not
 * grow unbounded across many migrations. Returns the number removed.
 */
export function sweepStaleMigrationJobs(ttlMs: number): number {
  const cutoff = Date.now() - ttlMs;
  let removed = 0;
  for (const [jobId, job] of migrationJobs) {
    if (job.status !== 'running' && job.updatedAt < cutoff) {
      migrationJobs.delete(jobId);
      removed += 1;
    }
  }
  return removed;
}

/**
 * Checks how much free space (in bytes) a device root has via statfs.
 * Returns null when it cannot be determined so the caller can decide
 * whether to fail open or fail closed.
 */
async function deviceFreeBytes(storagePath: string): Promise<number | null> {
  try {
    const st = await fs.promises.statfs(storagePath);
    return st.bavail * st.bsize;
  } catch {
    return null;
  }
}

/**
 * Moves a single blob (current file or archived version) from one device to
 * another, atomically. Shared by the device-level migration (`moveDeviceFiles`)
 * and the per-user migration (`moveUserFiles`) so both paths use identical
 * copy / FK-update / source-unlink semantics — no drift between the two.
 *
 * Guarantees:
 *   - Source blob must exist (else counted as skipped, not failed).
 *   - Never overwrites an existing destination path (reported as a failure).
 *   - Dry-run: only the existence/collision checks above run; nothing is
 *     copied, updated, or deleted.
 *   - The physical copy is made first; only once confirmed does the DB
 *     `storage_device_id` update run. If the DB update fails, the copy is
 *     removed so the source stays canonical and the row never points at a
 *     device it does not physically live on.
 *   - After a successful copy + DB update, the source blob is removed; if
 *     that unlink fails, the destination copy is already the canonical blob
 *     and the leftover source becomes an orphan a vault-cleanup can reclaim.
 */
async function moveBlobToDevice(
  kind: 'file' | 'version',
  blob: { id: string; stored_path: string },
  source: StorageDevice,
  destination: StorageDevice,
  result: DeviceMigrationResult,
  options?: { dryRun?: boolean; jobId?: string },
): Promise<void> {
  const dryRun = !!options?.dryRun;
  const jobId = options?.jobId;
  const srcPath = resolveBlobPath(source, blob.stored_path);
  const dstPath = resolveBlobPath(destination, blob.stored_path);

  let srcExists = false;
  try {
    srcExists = !!(await fs.promises.stat(srcPath));
  } catch {
    srcExists = false;
  }
  if (!srcExists) {
    result.skipped += 1;
    const failure = { kind, id: blob.id, stored_path: blob.stored_path, reason: 'source blob missing on disk' };
    result.failures.push(failure);
    updateMigrationJobProgress(jobId, { skipped: true, failure });
    return;
  }

  // Never clobber an existing destination blob.
  let dstExists = false;
  try {
    dstExists = !!(await fs.promises.stat(dstPath));
  } catch {
    dstExists = false;
  }
  if (dstExists) {
    result.failed += 1;
    const failure = { kind, id: blob.id, stored_path: blob.stored_path, reason: 'destination path already exists' };
    result.failures.push(failure);
    updateMigrationJobProgress(jobId, { failed: true, failure });
    return;
  }

  // Dry-run: existence + collision checks above are the only work done.
  if (dryRun) {
    result.moved += 1;
    updateMigrationJobProgress(jobId, { moved: true });
    return;
  }

  // 1) Physically copy the ciphertext blob to the destination.
  try {
    await fs.promises.copyFile(srcPath, dstPath);
  } catch (err: any) {
    result.failed += 1;
    const failure = { kind, id: blob.id, stored_path: blob.stored_path, reason: err?.message || 'Copy failed' };
    result.failures.push(failure);
    updateMigrationJobProgress(jobId, { failed: true, failure });
    return;
  }

  // 2) Move the DB reference to the destination device entity for the blob.
  //    Only now that the physical copy is confirmed do we touch the DB row.
  try {
    const mreq = await getRequest();
    mreq.input('blobId', sql.UniqueIdentifier, blob.id);
    mreq.input('destId', sql.UniqueIdentifier, destination.id);
    const table = kind === 'file' ? 'dbo.files' : 'dbo.file_versions';
    await mreq.query(`UPDATE ${table} SET storage_device_id = @destId WHERE id = @blobId`);
  } catch (err: any) {
    // DB update failed — remove the copy so the source stays canonical and
    // no duplicate/orphan blob is left behind.
    try { await fs.promises.unlink(dstPath); } catch { /* best effort */ }
    result.failed += 1;
    const failure = { kind, id: blob.id, stored_path: blob.stored_path, reason: err?.message || 'DB update failed' };
    result.failures.push(failure);
    updateMigrationJobProgress(jobId, { failed: true, failure });
    return;
  }

  // 3) Blob copy + DB update both succeeded — safe to remove the source blob.
  //    If the source unlink fails the destination blob remains valid; the
  //    leftover source copy is an orphan a vault-cleanup script can reclaim.
  try {
    await fs.promises.unlink(srcPath);
  } catch {
    /* best effort — destination blob is already the canonical copy */
  }
  result.moved += 1;
  updateMigrationJobProgress(jobId, { moved: true });
}

/**
 * Moves every blob (current files + archived versions) that physically
 * resides on `sourceId` to `destinationId` (ADR-0001).
 *
 * When `dryRun` is true, execution stops before any physical or DB mutation:
 * validation (ids, reachability, destination free space) and per-blob
 * existence/collision checks run, but nothing is copied, updated, or deleted.
 * The returned summary reports how many blobs would move and any that would
 * fail or be skipped.
 *
 * Guarantees:
 *   - Rejects when source === destination.
 *   - Rejects when either device is missing or unreachable.
 *   - Preflights destination free space: refuses the whole migration when the
 *     destination's statfs-derived free space is insufficient for the total
 *     bytes being moved (or cannot be determined — fail closed).
 *   - Per-blob atomicity: the physical copy is only made once confirmed to the
 *     destination; if the DB `storage_device_id` update fails, the copy is
 *     removed so the source blob stays canonical and the row never points at a
 *     device it does not physically live on.
 *   - Never overwrites a destination path that already exists (reported as a
 *     per-blob failure rather than clobbered).
 *
 * Returns a summary of blobs moved, skipped, and failed.
 */
export async function moveDeviceFiles(
  sourceId: string,
  destinationId: string,
  options?: { dryRun?: boolean; jobId?: string },
): Promise<DeviceMigrationResult> {
  const dryRun = !!options?.dryRun;
  const jobId = options?.jobId;
  if (!sourceId || !destinationId) throw new Error('Source and destination device ids are required.');
  if (sourceId === destinationId) throw new Error('Source and destination must be different devices.');

  const source = await getStorageDevice(sourceId);
  const destination = await getStorageDevice(destinationId);
  if (!source) throw new Error('Source storage device not found.');
  if (!destination) throw new Error('Destination storage device not found.');

  if (!(await isDeviceReachable(source.storage_path)))
    throw new Error(`Source device ${source.storage_id} is not reachable.`);
  if (!(await isDeviceReachable(destination.storage_path)))
    throw new Error(`Destination device ${destination.storage_id} is not reachable.`);

  const req = await getRequest();
  req.input('sourceId', sql.UniqueIdentifier, sourceId);

  // Current-file blobs and archived-version blobs that physically live on the source.
  const filesRes = await req.query<{ id: string; stored_path: string; size_bytes: number }>(
    `SELECT id, stored_path, size_bytes FROM dbo.files WHERE storage_device_id = @sourceId`,
  );
  const versionsReq = await getRequest();
  versionsReq.input('sourceId', sql.UniqueIdentifier, sourceId);
  const versionsRes = await versionsReq.query<{ id: string; stored_path: string; size_bytes: number }>(
    `SELECT id, stored_path, size_bytes FROM dbo.file_versions WHERE storage_device_id = @sourceId`,
  );

  const fileBlobs = filesRes.recordset as Array<{ id: string; stored_path: string; size_bytes: number }>;
  const versionBlobs = versionsRes.recordset as Array<{ id: string; stored_path: string; size_bytes: number }>;
  const totalBlobs = fileBlobs.length + versionBlobs.length;
  const totalBytes =
    fileBlobs.reduce((sum: number, b) => sum + Number(b.size_bytes || 0), 0) +
    versionBlobs.reduce((sum: number, b) => sum + Number(b.size_bytes || 0), 0);

  // Register/refresh the progress job. The POST route pre-creates the job
  // (with total 0) so a client polling immediately cannot 404; once the true
  // total is known we update it. createMigrationJob is a no-op if the route
  // already created the entry.
  if (jobId) {
    createMigrationJob(jobId, totalBlobs);
    setMigrationJobTotal(jobId, totalBlobs);
  }

  // ---- Preflight: destination must have room for everything we will move. ---
  const destFree = await deviceFreeBytes(destination.storage_path);
  if (destFree === null) {
    throw new Error(`Cannot determine free space on destination ${destination.storage_id}. Migration refused.`);
  }
  if (destFree < totalBytes) {
    throw new Error(
      `Destination ${destination.storage_id} only has ${destFree} bytes free but the migration requires ${totalBytes} bytes. Migration refused.`,
    );
  }

  const result: DeviceMigrationResult = { moved: 0, failed: 0, skipped: 0, failures: [] };
  const opts = { dryRun, jobId };

  try {
    for (const blob of fileBlobs) {
      await moveBlobToDevice('file', blob, source, destination, result, opts);
    }
    for (const blob of versionBlobs) {
      await moveBlobToDevice('version', blob, source, destination, result, opts);
    }
  } catch (err: any) {
    // Unexpected error that escaped the per-blob handling (e.g. DB outage
    // mid-loop). Mark the job as errored so the UI stops polling and shows
    // the failure instead of hanging at "running".
    if (jobId) {
      finishMigrationJob(jobId, result, { status: 'error', error: err?.message || 'Migration failed unexpectedly.' });
    }
    throw err;
  }

  // Finalize the job as done once every blob has been processed. Per-blob
  // failures/skips still produce a "done" state — the UI surfaces the
  // breakdown and can offer a retry for any failures.
  if (jobId) {
    finishMigrationJob(jobId, result, { status: 'done' });
  }

  return result;
}

// ──────────────────────────────────────────────────────────────
// Per-user storage migration (move a single user's data between devices)
// ──────────────────────────────────────────────────────────────

/**
 * Moves every blob (current files + archived versions) owned by `userId` from
 * `sourceId` to `destinationId` (per-user re-homing).
 *
 * Shares the same atomic per-blob semantics as the device-level migration via
 * `moveBlobToDevice`, and the same preflight guarantees:
 *   - Rejects when source === destination.
 *   - Rejects when either device is missing or unreachable.
 *   - Rejects the user/user-owner mismatch up front (the user must exist).
 *   - Preflights destination free space (fail closed when undeterminable or
 *     insufficient for the total bytes being moved).
 *   - Per-blob atomicity: copy → FK update → source unlink; a failed DB update
 *     removes the copy so the source stays canonical.
 *
 * When `dryRun` is true, execution stops before any physical or DB mutation —
 * validation and per-blob existence/collision checks run, but nothing is
 * copied, updated, or deleted.
 *
 * Only blobs of the targeted user are touched — `file_versions` rows are scoped
 * through `files.owner_user_id` so other users' versions are never re-homed.
 */
export async function moveUserFiles(
  userId: string,
  sourceId: string,
  destinationId: string,
  options?: { dryRun?: boolean; jobId?: string },
): Promise<DeviceMigrationResult> {
  const dryRun = !!options?.dryRun;
  const jobId = options?.jobId;
  if (!userId || !sourceId || !destinationId) throw new Error('User and source/destination device ids are required.');
  if (sourceId === destinationId) throw new Error('Source and destination must be different devices.');

  const source = await getStorageDevice(sourceId);
  const destination = await getStorageDevice(destinationId);
  if (!source) throw new Error('Source storage device not found.');
  if (!destination) throw new Error('Destination storage device not found.');

  if (!(await isDeviceReachable(source.storage_path)))
    throw new Error(`Source device ${source.storage_id} is not reachable.`);
  if (!(await isDeviceReachable(destination.storage_path)))
    throw new Error(`Destination device ${destination.storage_id} is not reachable.`);

  const req = await getRequest();
  req.input('userId', sql.UniqueIdentifier, userId);
  req.input('sourceId', sql.UniqueIdentifier, sourceId);

  // Current-file blobs and archived-version blobs owned by this user that live
  // on the source device. Versions are scoped through files.owner_user_id.
  const filesRes = await req.query<{ id: string; stored_path: string; size_bytes: number }>(
    `SELECT id, stored_path, size_bytes FROM dbo.files
      WHERE owner_user_id = @userId AND storage_device_id = @sourceId`,
  );
  const versionsReq = await getRequest();
  versionsReq.input('userId', sql.UniqueIdentifier, userId);
  versionsReq.input('sourceId', sql.UniqueIdentifier, sourceId);
  const versionsRes = await versionsReq.query<{ id: string; stored_path: string; size_bytes: number }>(
    `SELECT id, stored_path, size_bytes FROM dbo.file_versions
      WHERE storage_device_id = @sourceId
        AND file_id IN (SELECT id FROM dbo.files WHERE owner_user_id = @userId)`,
  );

  const fileBlobs = filesRes.recordset as Array<{ id: string; stored_path: string; size_bytes: number }>;
  const versionBlobs = versionsRes.recordset as Array<{ id: string; stored_path: string; size_bytes: number }>;
  const totalBlobs = fileBlobs.length + versionBlobs.length;
  const totalBytes =
    fileBlobs.reduce((sum: number, b) => sum + Number(b.size_bytes || 0), 0) +
    versionBlobs.reduce((sum: number, b) => sum + Number(b.size_bytes || 0), 0);

  // Register/refresh the progress job (mirrors the device-level migration).
  if (jobId) {
    createMigrationJob(jobId, totalBlobs);
    setMigrationJobTotal(jobId, totalBlobs);
  }

  // ---- Preflight: destination must have room for everything we will move. ---
  const destFree = await deviceFreeBytes(destination.storage_path);
  if (destFree === null) {
    throw new Error(`Cannot determine free space on destination ${destination.storage_id}. Migration refused.`);
  }
  if (destFree < totalBytes) {
    throw new Error(
      `Destination ${destination.storage_id} only has ${destFree} bytes free but the migration requires ${totalBytes} bytes. Migration refused.`,
    );
  }

  const result: DeviceMigrationResult = { moved: 0, failed: 0, skipped: 0, failures: [] };
  const opts = { dryRun, jobId };

  try {
    for (const blob of fileBlobs) {
      await moveBlobToDevice('file', blob, source, destination, result, opts);
    }
    for (const blob of versionBlobs) {
      await moveBlobToDevice('version', blob, source, destination, result, opts);
    }
  } catch (err: any) {
    if (jobId) {
      finishMigrationJob(jobId, result, { status: 'error', error: err?.message || 'Migration failed unexpectedly.' });
    }
    throw err;
  }

  if (jobId) {
    finishMigrationJob(jobId, result, { status: 'done' });
  }

  return result;
}

/**
 * Seeds the initial storage device from the legacy env vars and backfills
 * existing files/file_versions rows to reference it.
 *
 * Called at bootstrap after the DB pool is connected. It is idempotent:
 *   - If storage_devices is empty AND the legacy env vars are present, a seed
 *     device is created (column-encrypting STORAGE_NET_USE_USER/PASS).
 *   - If the legacy FILE_STORAGE_UNC_PATH is set and files rows have NULL
 *     storage_device_id, they are backfilled to the seed (or single existing)
 *     device.
 */
export async function migrateLegacyStorage(legacyEnv: {
  fileStorageUncPath?: string;
  storageNetUseUser?: string;
  storageNetUsePassword?: string;
}): Promise<void> {
  const devices = await listStorageDevices();

  if (devices.length === 0) {
    if (!legacyEnv.fileStorageUncPath) {
      console.log('[storage] No storage devices registered and no legacy FILE_STORAGE_UNC_PATH — deferred to admin provisioning.');
      return;
    }
    const seedId = await createStorageDevice({
      storage_id: 'DATA-00',
      storage_path: legacyEnv.fileStorageUncPath,
      smb_username: legacyEnv.storageNetUseUser || null,
      smb_password: legacyEnv.storageNetUsePassword || null,
      provisioning_enabled: true,
      is_primary: true,
    });
    console.log(`[storage] Seeded initial storage device DATA-00 from legacy env.`);
    await backfillNullDeviceIds(seedId.id);
    return;
  }

  // Device pool already exists — backfill any rows still missing a device id.
  await backfillNullDeviceIds(devices[0].id);
}

async function backfillNullDeviceIds(deviceId: string): Promise<void> {
  const req = await getRequest();
  req.input('deviceId', sql.UniqueIdentifier, deviceId);
  const result = await req.query(`
    UPDATE dbo.files SET storage_device_id = @deviceId WHERE storage_device_id IS NULL;
    UPDATE dbo.file_versions SET storage_device_id = @deviceId WHERE storage_device_id IS NULL;
  `);
  // Swallow result; mssql UPDATE counts vary by driver version.
  void result;
  console.log('[storage] Backfilled existing vault rows to seed device.');
}

