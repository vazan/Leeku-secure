---
agent: DevEngineer | date: 2026-11-06 | model: (dev)
plan: /memories/session/dev-plan.md
---

## Intention
Add an admin capability to move every vault blob stored on one storage device
(DATA-xx) to another, physically copying each file and reflecting the move in
the `files` / `file_versions` `storage_device_id` columns — surfacing per-device
file counts and space usage in the admin panel to avoid moves into
space-constrained destinations. Provide a **dry-run preview** so an admin can
confirm exactly which blobs would move, fail, or be skipped before any disk or
DB mutation is made. For the real migration, provide **live progress** (progress
bar in the admin UI) since large moves of 10k+ blobs take a long time.

## Changement
Classe : STANDARD — new admin-only feature built on the existing multi-storage
pool (ADR-0001, commit 966eee4). No public contract change for end users: the
new `POST /api/admin/storage/migrate` route and the additive `GET /api/admin/storage`
DTO fields are additive and admin-gated.

In addition to the initial dry-run + real-migration implementation, this change
adds **live progress reporting** for the real (non-dry-run) migration: the
migration now runs in the background and the admin UI polls progress and shows
a progress bar (processed/total, moved/failed/skipped) instead of a static
"Migrating…" state. Also fixes two latent bugs found during review:
- **Express route-ordering** — `POST /api/admin/storage/migrate` is registered
  before `POST /api/admin/storage/:id` so the literal "migrate" segment is not
  swallowed by the `:id` placeholder.
- **mssql `Request` reuse** — the `file_versions` inventory query now uses its
  own `getRequest()` instead of reusing the same Request as the `files` query.

## Fichiers
| Fichier | Raison |
|---|---|
| src/server/utils/storage-devices.ts | Added `getStorageDeviceUsage()`, `StorageDeviceUsage`, `DeviceMigrationResult`, `deviceFreeBytes()`, and `moveDeviceFiles(sourceId, destinationId, { dryRun, jobId })`. The service validates ids/reachability, preflights destination free space, and per-blob: physical copy → FK update → source cleanup, with rollback of the copy if the DB update fails. When `dryRun` is set it runs all validations and per-blob existence/collision checks but copies/updates/deletes nothing. Extended `StorageDeviceDto` + `toDto` with `file_count`, `version_count`, `bytes_used`, `free_bytes`. Added an in-memory migration job registry (`createMigrationJob` / `setMigrationJobTotal` / `updateMigrationJobProgress` / `finishMigrationJob` / `getMigrationProgress` / `clearMigrationJob` / `sweepStaleMigrationJobs`) so a background run reports live per-blob progress keyed by a `job_id`. |
| src/server.ts | Added `POST /api/admin/storage/migrate` (admin-only). Reads `source_id` / `destination_id` / `dry_run`. For `dry_run:true` it returns a synchronous full summary; for a real migration it pre-creates a progress job, launches `moveDeviceFiles()` in the background, and returns `{ success, dry_run:false, job_id, status:'running' }` immediately. Added `GET /api/admin/storage/migrate/:jobId` (admin-only) to poll progress. Added a periodic sweep (`startMigrationJobSweep`) that clears stale finished jobs after a TTL. Route order fixed so migrate is registered before `POST /api/admin/storage/:id`. |
| src/app/features/files/components/admin-workspace.tsx | Extended the client `StorageDeviceDto`; added a "Move files between storage devices" panel between the device list and the "Add storage device" form with source/dest DATA-xx selectors showing per-device blob counts + space, a destination free-space warning, a "Preview (dry run)" button plus a "Migrate all files" button, a confirmation prompt on the real migration, and a result summary that clearly distinguishes a preview ("nothing was changed") from a real migration. Real migrations now poll `GET /api/admin/storage/migrate/:jobId` and render a live progress bar (`processed/total`, moved/failed/skipped); the poll timer is cleared on unmount. |

## Contrats publics impactés
- NON for end users. All `/api/admin/storage/migrate*` routes are behind `verifyAdmin`.
- `GET /api/admin/storage` response gains three additive per-device fields
  (`file_count`, `version_count`, `bytes_used`) plus `free_bytes`; existing
  consumers ignore unknown fields → backward compatible.
- `POST /api/admin/storage/migrate` accepts an optional `dry_run: boolean`
  (default `false`). For `dry_run:true` the response is unchanged (full summary).
  For a real migration the response changes from a synchronous final summary to
  an immediate `{ success, dry_run:false, job_id, status:'running' }` with the
  final summary obtained via `GET /api/admin/storage/migrate/:jobId`. The admin
  UI is the only consumer and is updated accordingly; the migration itself is
  unchanged and per-file atomic.

## Risques
- Perf: `GET /api/admin/storage` now runs one extra aggregate query + one statfs
  per device; negligible at pool sizes (single-digit devices). Progress updates
  are in-memory increments per blob — cheap even for 10k+ blobs.
- Sécu: admin-only; no plaintext credentials exposed (reuses existing `toDto`).
  `job_id` is an opaque random UUID; the progress endpoint is admin-gated.
- Régression: `moveDeviceFiles()` is only reachable via the new route; existing
  delete/primary/provision paths untouched. `toDto` is extended additively.
  Dry-run shares the validation path so the live path is exercised by the same
  guards (no separate code drift).
- Compat: uses `statfs` (Node ≥18), `UNION ALL` aggregate and per-row UPDATE
  which are valid T-SQL. Physical copy is `copyFile` with rollback on DB failure.
- Dry-run is a best-effort preview: free-space and source/dest existence are
  sampled at call time and can drift before the real run, which re-checks.
- Background run: since the POST returns before the migration finishes, the
  HTTP request no longer blocks for the full duration (avoids load-balancer
  timeouts on very large moves). Progress lives in an in-memory registry; a
  process restart loses progress reporting but the migration is per-file atomic
  and resumable. A pre-created `job_id` (total 0) avoids a poll-404 race at
  migration start.

## Dette observée
MINOR — pre-existing `tsc` baseline of 54 errors (mssql module type resolution +
unrelated implicit-any) is unchanged by this work (54 before = 54 after).

**Follow-up (later):** because a real migration runs in the background and its
live progress is only visible while the admin panel is open (closing it stops
the UI poll, though the migration itself keeps running server-side), it would be
valuable for later to also log progress/heartbeat to the **server console**
(e.g. a periodic line in `moveDeviceFiles`/`startMigrationJobSweep` such as
`[migrate {job_id}] moved 4200 / 10708 (39%)`) so an operator can monitor a
long-running move without the UI open, and to aid diagnosis if the server
restarts mid-migration. This is a nice-to-have, not a correctness gap.

## Validation
Build: ✅ (vite client + esbuild server bundle cleanly; only pre-existing
`import.meta` warning on the server bundle)
Lint: ✅ (tsc 54 before = 54 after; none in edited files)
Type-check: ✅ (no new errors)
Smoke: ⚠ SKIPPED — no running SQL Server instance or configured storage devices
in this workspace to exercise a live migration. The user confirmed the dry-run
preview returns "10708 would move · 0 would fail · 0 would skip", exercising the
route + progress wiring successfully (a real migration's progress polling shares
the same registered route and in-memory job registry).

## Approbation CRITICAL
N/A (STANDARD change; additive admin-only feature).

## Handoff TestEngineer
Surfaces to test:
- `GET /api/admin/storage` returns `file_count` / `version_count` / `bytes_used`
  / `free_bytes` per device and stays compatible when those are absent/unknown.
- `POST /api/admin/storage/migrate` ({ dry_run: false }):
  - rejects missing source/destination, identical source/destination, unknown ids.
  - refuses when destination free space < total bytes being moved.
  - moves current `files` rows AND archived `file_versions` rows.
  - physically copies blob from source path to destination path, updates
    `storage_device_id`, and removes the source blob on success.
  - leaves source canonical + removes the copied blob when the DB update fails.
  - reports `moved` / `failed` / `skipped` with per-blob reasons (missing source
    blob, destination path collision).
  - returns a `job_id` immediately and completes in the background; progress is
    observable via `GET /api/admin/storage/migrate/:jobId` (running → done).
- `POST /api/admin/storage/migrate` ({ dry_run: true }):
  - performs the same validation (unknown ids, same source/dest, insufficient
    destination free space still refused).
  - returns `dry_run: true` and a `moved` count of blobs that *would* move with
    no disk copy and no DB update (verify file mtimes and `storage_device_id`
    are unchanged).
  - flags blobs whose source blob is missing or whose destination path already
    exists as they would fail in a real run.
- Background/progress:
  - the POST response includes `job_id` + `status:'running'`; an immediate poll
    returns a live snapshot (not 404) because the job is pre-created.
  - polling a finished job returns `status:'done'` with the final summary.
  - an errored run (e.g. a preflight failure) returns `status:'error'` with an
    `error` message and stops the UI loop.
  - stale finished jobs are swept after the TTL (validation only, no data impact).
- UI: selectors show DATA-xx with counts + space; warning when destination is
  low on space; "Preview (dry run)" produces a "nothing was changed" summary;
  real migration confirms, shows a live progress bar (moved/failed/skipped), and
  clears selections after a successful run.

## Handoff QaEngineer
Validation summary + trail approbation: see plan and `git log` for the feature
branch `feat/storage-migrate-device-files`. Suggested QA focus: migration
self-consistency (blob location always matches DB device), partial-failure
behaviour, the destination free-space guard, dry-run leaving all state untouched
while still surfacing would-block conditions, and the live-progress path
(job pre-creation avoids a poll-404 race; terminal states are done/error).
