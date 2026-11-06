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
import { getRequest, sql } from '../db.js';
import { encryptColumn, decryptColumn } from './encryption.js';

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
}

export interface StorageDeviceInput {
  storage_id: string;
  storage_path: string;
  smb_username?: string | null;
  smb_password?: string | null;
  provisioning_enabled?: boolean;
  is_primary?: boolean;
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
  created_at: Date;
};

// ──────────────────────────────────────────────────────────────
// Registry queries
// ──────────────────────────────────────────────────────────────

const SELECT_COLS = `
  id, storage_id, storage_path,
  smb_username_encrypted, smb_username_iv, smb_username_auth_tag,
  smb_password_encrypted, smb_password_iv, smb_password_auth_tag,
  provisioning_enabled, is_primary, created_at
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

  await req.query(`
    BEGIN TRANSACTION;
    IF @primary = 1
      UPDATE dbo.storage_devices SET is_primary = 0 WHERE is_primary = 1;
    INSERT INTO dbo.storage_devices (
      id, storage_id, storage_path,
      smb_username_encrypted, smb_username_iv, smb_username_auth_tag,
      smb_password_encrypted, smb_password_iv, smb_password_auth_tag,
      provisioning_enabled, is_primary
    ) VALUES (
      @id, @storageId, @storagePath,
      @userEnc, @userIv, @userTag,
      @passEnc, @passIv, @passTag,
      @enabled, @primary
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
  return {
    id: device.id,
    storage_id: device.storage_id,
    storage_path: device.storage_path,
    provisioning_enabled: device.provisioning_enabled,
    is_primary: device.is_primary,
    has_smb_credentials: !!device.smb_username_encrypted || !!device.smb_password_encrypted,
    reachable: await isDeviceReachable(device.storage_path),
    created_at: device.created_at,
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
 *   2. Prefer is_primary = 1 if reachable.
 *   3. Otherwise order by ascending free-space ratio (most free space first),
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

  const reachable: StorageDevice[] = [];
  for (const d of enabled) {
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
// Startup migration + backfill
// ──────────────────────────────────────────────────────────────

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

