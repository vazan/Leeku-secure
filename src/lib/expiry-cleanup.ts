/**
 * @license SPDX-License-Identifier: Apache-2.0
 *
 * Leeku Secure — File Expiry & Auto-Deletion Service
 *
 * Supported TTL values (hours): 1, 4, 24, 48, 120, 168
 * corresponding to:             1h, 4h, 1d, 2d, 5d,  7d
 *
 * How it works:
 *   1. A background interval fires every EXPIRY_CLEANUP_INTERVAL_MS.
 *   2. It queries the data layer for files whose expires_at <= NOW()
 *      and whose status is still 'Available'.
 *   3. For each expired file it deletes the encrypted vault file from
 *      the UNC share (physical deletion).
 *   4. It then calls back into the data layer to mark the DB records
 *      as 'Expired' and set deleted_at = NOW().
 *   5. All deletions are logged via the system log callback.
 *
 * The module is data-layer agnostic — it receives the query and
 * update callbacks at startup so it works with both the current
 * JSON store and the future SQL Server implementation.
 *
 * Environment variables:
 *   EXPIRY_CLEANUP_INTERVAL_MS  — poll interval in ms (default 60 000)
 */

import fs   from 'fs';
import path from 'path';

// ──────────────────────────────────────────────────────────────
// TTL Constants
// ──────────────────────────────────────────────────────────────

/** All permitted file TTL values, expressed in hours. */
export const VALID_TTL_HOURS = [1, 4, 24, 48, 120, 168] as const;

export type TtlHours = (typeof VALID_TTL_HOURS)[number];

/** Human-readable labels for the UI picker. */
export const TTL_LABELS: Record<TtlHours, string> = {
  1:   '1 hour',
  4:   '4 hours',
  24:  '1 day',
  48:  '2 days',
  120: '5 days',
  168: '7 days',
};

/** Returns true if the given number is a valid TTL. */
export function isValidTtl(hours: number): hours is TtlHours {
  return (VALID_TTL_HOURS as readonly number[]).includes(hours);
}

/**
 * Computes the absolute expiry timestamp from the current time.
 * @param ttlHours  One of the VALID_TTL_HOURS values.
 * @returns         ISO 8601 string of the expiry datetime.
 */
export function computeExpiresAt(ttlHours: TtlHours): string {
  const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);
  return expiresAt.toISOString();
}

// ──────────────────────────────────────────────────────────────
// Types: data-layer callbacks
// ──────────────────────────────────────────────────────────────

/** Minimal representation of an expired file, returned by the data layer. */
export interface ExpiredFileRecord {
  id:           string;
  storedPath:   string;   // Absolute UNC or local path to the vault file
  ownerId:      string;
  originalName: string;   // For logging only (encrypted in DB — pass decrypted form)
  expiresAt:    string;
  sizeBytes:    number;
}

/**
 * Function provided by the data layer to retrieve files that have expired.
 * Must return records where expires_at <= NOW() and status = 'Available'.
 */
export type GetExpiredFilesFn = () => Promise<ExpiredFileRecord[]>;

/**
 * Function provided by the data layer to mark a set of files as 'Expired'
 * after their vault files have been physically deleted from disk.
 * @param fileIds  Array of file IDs that were successfully deleted.
 */
export type MarkFilesExpiredFn = (fileIds: string[]) => Promise<void>;

/**
 * Optional callback for logging deletion events to the system log.
 */
export type LogExpiredFileFn = (file: ExpiredFileRecord) => Promise<void>;

// ──────────────────────────────────────────────────────────────
// Cleanup service
// ──────────────────────────────────────────────────────────────

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Starts the background expiry cleanup job.
 * Safe to call multiple times — subsequent calls are no-ops.
 *
 * @param getExpiredFiles  Data-layer function to fetch expired file records.
 * @param markExpired      Data-layer function to mark records as 'Expired'.
 * @param logDeletion      Optional callback to write a system log entry per deletion.
 */
export function startExpiryCleanup(
  getExpiredFiles: GetExpiredFilesFn,
  markExpired:     MarkFilesExpiredFn,
  logDeletion?:    LogExpiredFileFn
): void {
  if (cleanupTimer) return;

  const intervalMs = parseInt(
    process.env.EXPIRY_CLEANUP_INTERVAL_MS || '60000',
    10
  );

  console.log(`[expiry-cleanup] Service started. Checking every ${intervalMs / 1000}s.`);

  cleanupTimer = setInterval(() => {
    runCleanupCycle(getExpiredFiles, markExpired, logDeletion).catch((err) => {
      console.error('[expiry-cleanup] Unhandled error in cleanup cycle:', err);
    });
  }, intervalMs);
}

/** Stops the background cleanup job. */
export function stopExpiryCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
    console.log('[expiry-cleanup] Service stopped.');
  }
}

// ──────────────────────────────────────────────────────────────
// Internal: single cleanup cycle
// ──────────────────────────────────────────────────────────────

async function runCleanupCycle(
  getExpiredFiles: GetExpiredFilesFn,
  markExpired:     MarkFilesExpiredFn,
  logDeletion?:    LogExpiredFileFn
): Promise<void> {
  const expired = await getExpiredFiles();

  if (expired.length === 0) return;

  console.log(`[expiry-cleanup] Found ${expired.length} expired file(s). Processing...`);

  const successfullyDeleted: string[] = [];

  for (const file of expired) {
    const deleted = deleteVaultFile(file.storedPath);

    if (deleted) {
      successfullyDeleted.push(file.id);
      console.log(`[expiry-cleanup] Deleted vault file: ${path.basename(file.storedPath)} (owner: ${file.ownerId})`);

      if (logDeletion) {
        await logDeletion(file).catch((err) => {
          console.error('[expiry-cleanup] Failed to write deletion log:', err);
        });
      }
    } else {
      // File was already missing from disk (e.g., manual admin deletion).
      // Still mark it expired in the DB to keep the state consistent.
      successfullyDeleted.push(file.id);
      console.warn(`[expiry-cleanup] Vault file not found on disk (already removed?): ${file.storedPath}`);
    }
  }

  if (successfullyDeleted.length > 0) {
    await markExpired(successfullyDeleted);
    console.log(`[expiry-cleanup] Marked ${successfullyDeleted.length} file(s) as Expired in DB.`);
  }
}

/**
 * Deletes the physical vault file from the UNC share / local disk.
 * Returns true if the file was deleted, false if it was already absent.
 * Throws if the deletion fails for a reason other than file-not-found.
 */
function deleteVaultFile(storedPath: string): boolean {
  try {
    if (!fs.existsSync(storedPath)) {
      return false;
    }
    fs.unlinkSync(storedPath);
    return true;
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'ENOENT') {
      return false; // race condition — already deleted
    }
    // Permission errors or network share issues — propagate so they're logged
    throw new Error(
      `[expiry-cleanup] Cannot delete vault file "${storedPath}": ${nodeErr.message}`
    );
  }
}
