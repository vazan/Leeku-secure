/**
 * @license SPDX-License-Identifier: Apache-2.0
 *
 * Leeku Secure — Trash Purge Service
 *
 * Permanently removes files that have been in the Trash (soft-deleted via
 * `files.deleted_at`) for longer than TRASH_RETENTION_DAYS.
 *
 * How it works:
 *   1. A background interval fires every 60 minutes (configurable).
 *   2. It asks the data layer for soft-deleted files whose deleted_at is
 *      older than the retention cutoff.
 *   3. For each such file it calls `purgeFile` (vault-blob deletion, share
 *      link removal, DB row deletion, and system-log entry).
 *
 * The module is data-layer agnostic — it receives the query and purge
 * callbacks at startup, matching the expiry-cleanup service pattern.
 *
 * Environment variables:
 *   TRASH_RETENTION_DAYS  — how many days a trashed file is kept (default 90)
 */

// ──────────────────────────────────────────────────────────────
// Retention constant
// ──────────────────────────────────────────────────────────────

/** Retention window (days) before a soft-deleted file is permanently purged. */
export const TRASH_RETENTION_DAYS = parseInt(
  process.env.TRASH_RETENTION_DAYS || '90',
  10
);

// ──────────────────────────────────────────────────────────────
// Types: data-layer callbacks
// ──────────────────────────────────────────────────────────────

/** A soft-deleted file that is eligible for permanent purge. */
export interface TrashedFileRecord {
  id: string;
  storedPath: string;          // Absolute vault path
  ownerId: string;
  originalName: string;        // Decrypted, for logging only
  deletedAt: Date;
  sizeBytes: number;
}

/** Returns files with deleted_at <= cutoff (older than the retention window). */
export type GetTrashedFilesFn = (cutoff: Date) => Promise<TrashedFileRecord[]>;

/** Permanently deletes one trashed file (vault blob, shares, DB row, log). */
export type PurgeFileFn = (file: TrashedFileRecord) => Promise<void>;

// ──────────────────────────────────────────────────────────────
// Purge service
// ──────────────────────────────────────────────────────────────

let purgeTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Starts the background Trash purge job. Safe to call multiple times.
 * @param getTrashed  Data-layer function returning eligible soft-deleted files.
 * @param purgeFile   Data-layer function that permanently deletes one file.
 * @param intervalMs  Optional polling interval (default 60 minutes).
 */
export function startTrashPurge(
  getTrashed: GetTrashedFilesFn,
  purgeFile:  PurgeFileFn,
  intervalMs: number = 60 * 60_000
): void {
  if (purgeTimer) return;
  purgeTimer = setInterval(() => {
    runTrashPurgeCycle(getTrashed, purgeFile).catch((err) => {
      console.error('[trash-purge] Unhandled error in purge cycle:', err);
    });
  }, intervalMs);
  console.log(`[trash-purge] Service started. Files in trash for >${TRASH_RETENTION_DAYS} days will be permanently deleted.`);
}

/** Stops the background Trash purge job. */
export function stopTrashPurge(): void {
  if (purgeTimer) {
    clearInterval(purgeTimer);
    purgeTimer = null;
    console.log('[trash-purge] Service stopped.');
  }
}

// ──────────────────────────────────────────────────────────────
// Internal: single purge cycle
// ──────────────────────────────────────────────────────────────

/**
 * Runs one purge cycle: fetch eligible files and permanently delete each.
 * Never throws for individual files — a failing purge is logged and skipped.
 */
export async function runTrashPurgeCycle(
  getTrashed: GetTrashedFilesFn,
  purgeFile:  PurgeFileFn
): Promise<{ purged: number; failed: number }> {
  const retentionMs = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - retentionMs);

  let eligible: TrashedFileRecord[] = [];
  try {
    eligible = await getTrashed(cutoff);
  } catch (err) {
    console.error('[trash-purge] Failed to query trashed files:', err);
    return { purged: 0, failed: 0 };
  }

  if (eligible.length === 0) return { purged: 0, failed: 0 };

  let purged = 0;
  let failed = 0;

  for (const file of eligible) {
    try {
      await purgeFile(file);
      purged += 1;
      console.log(`[trash-purge] Purged trashed file ${file.id} (${file.originalName}).`);
    } catch (err) {
      failed += 1;
      console.error(`[trash-purge] Failed to purge file ${file.id}:`, err);
    }
  }

  console.log(`[trash-purge] Purged ${purged} trashed file(s), ${failed} failed.`);
  return { purged, failed };
}
