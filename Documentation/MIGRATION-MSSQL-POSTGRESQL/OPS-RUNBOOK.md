# DocOps — Migration Runbook & Operations : Soft-deletion & File versioning (MSSQL → PostgreSQL)

> Owner: DocOps | date: 2026-10-31 | input: `ARCHITECTURE.md`, `ENGINEER-SCHEMA-PARITY.md`

## 1. Preconditions
- Confirm current branch: `postgresql`.
- Back up the database (pg_dump) **before** applying schema — irreversible once run.
- Freeze uploads/deletes during the schema+backfill window (maintenance mode flag is
  available in-tree).
- Env to add: `TRASH_RETENTION_DAYS=90` (`.env.example` + deployed `.env`).

## 2. Migration steps (ordered)

### 2.1 Schema
```bash
psql "$DATABASE_URL" -f Documentation/SQL/2026-10-31-postgresql-file-versioning.sql
```
Verify: `\d file_versions`, `\d file_version_keys`, `\d share_links` shows `version_id`
and FK `fk_share_links_version`.

### 2.2 Backfill file hashes (app-side, needs MASTER_KEY_BASE64)
```bash
npx tsx scripts/backfill-file-hashes.ts   # or: npm run backfill:file-hashes
```
- Idempotent — only rows where `file_name_hash IS NULL AND deleted_at IS NULL`.
- Re-run is a no-op. Required before same-name versioning works for pre-existing files.

### 2.3 Deploy code
- Build: `npm run build` → `dist/server.cjs` (production `start`).
- Development: `npm run dev`.
- Run `npm run lint` (`tsc --noEmit`) before ship.

### 2.4 Smoke test
1. Upload file `a.txt` twice into same folder → expect `version_count=2`, one version entry.
2. Delete file → appears in Trash; vault blob still on disk.
3. Wait none: purge job only affects items older than `TRASH_RETENTION_DAYS`.
4. Create share link, set `version_id` to an archived version → preview/download shows that
   version.
5. Restore a soft-deleted version → `deleted_at` cleared, downloadable again.

## 3. Operational behavior after migration

### 3.1 Trash purge job
- Port: `startTrashPurge(intervalMs)` + `runTrashPurgeCycle()` (mssql `server.ts:6055`).
- Interval default: 60 min; retention `TRASH_RETENTION_DAYS` (default 90).
- Purge deletes rows + vault blobs + cascade `file_versions`/`file_version_keys` where
  FK `ON DELETE CASCADE` applies. Share-link `version_id` pins are cleared before purge
  (ADR-4).

### 3.2 Backfill idempotency & re-runs
- Safe to re-run; converges `file_name_hash` on newly-seen NULL rows.

### 3.3 Rollback
- Restore pg_dump backup → schema + data revert.
- Code rollback: revert to pre-migration commit rebuild (`git checkout` + `npm run build`).
- Trash purge job must be stopped before rollback of the job code to avoid stray cycles:
  disable env flag / remove the `startTrashPurge()` call.

## 4. Security & compliance notes
- No plaintext filenames stored; `file_name_hash` is HMAC-SHA256 keyed by MASTER_KEY — do
  not log it.
- `share_links.version_id` exposes version lineage; ensure owner/admin checks on version
  endpoints match file-level auth (mssql behavior).
- Redact any captured output (keys/tokens) before pasting into reports.

## 5. Ops artifacts to keep current
- `Documentation/SQL/QUERIES-REFERENCE.md` and `README.md` — add new tables/indexes.
- `DEV-CHANGE-REPORT.md` — record the migration as a change entry.
