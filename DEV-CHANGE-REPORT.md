---
agent: DevEngineer | date: 2026-10-31 | model: dev-engineer
plan: /memories/session/dev-plan.md
---

## Intention
Implement MSSQL file version history: uploading the same filename into the same folder creates a
new VERSION of the same logical file instead of a duplicate, with endpoints to list / download /
restore / delete older versions of, and per-version share pinning.

## Changement
Classe : CRITICAL — DB migration (public schema contract) + new routes in `src/server.ts`.

## Fichiers
| Fichier | Raison |
|---|---|
| `Documentation/SQL/2026-10-31-add-file-versioning.sql` | Idempotent migration: `files.file_name_hash/version_count/current_version_id`, `file_versions`, `file_version_keys`, `share_links.version_id`, FK + index, verify queries |
| `src/server.ts` | Upload pipeline version-instead logic; 4 new version endpoints; share `version_id` |
| `src/app/shared/types/index.ts` | `version_count?` on `FileMetadata`; new `FileVersion` interface |
| `src/app/features/files/pages/user-dashboard.tsx` | Full §3.4 UI: versions drawer, per-version quota/total, restore/share/preview wiring, version-pinned ShareDialog hint |
| `scripts/backfill-file-hashes.ts` (+ `package.json` script) | One-time backfill: populate `files.file_name_hash` for pre-migration rows (NULL hash) so same-name versioning works for all existing files |
| `src/server.ts` | Upload same-name detection fallback for pre-migration rows with NULL hash (bounded scan by decrypted name) |
| `src/server/routes/public-sharing.ts` | Version-aware public share resolution: metadata, preview, download, OG, and embed honor `share_links.version_id` (COALESCE archived version over current) |

## Contrats publics impactés
OUI (schema):
- `files`: +`file_name_hash CHAR(64) NULL`, +`version_count INT NOT NULL DEFAULT 1`, +`current_version_id UNIQUEIDENTIFIER NULL`.
- New `file_versions`, `file_version_keys` (archived older versions; Model B — current version stays in `files`).
- `share_links`: +`version_id UNIQUEIDENTIFIER NULL` (FK → `file_versions`, nullable = resolve-to-current).
- New HTTP routes (auth'd):
  - `GET /api/files/:id/versions`
  - `GET /api/files/:id/versions/:versionId/download`
  - `POST /api/files/:id/versions/:versionId/restore`
  - `DELETE /api/files/:id/versions/:versionId`
- `POST /api/files/:id/share` — optional body `version_id` (pinned archive version) on INSERT/UPDATE.
- No change to `GET`/`POST` upload shapes; `files`+`file_encryption_keys` joins unchanged for current version.

## UI (Frontend, feature branch `feat/file-version-history-mssql`)
Scoped per owner decisions #1–#3: dashboard-only (no extra backend endpoints), full §3.4 UI.

- **Versions drawer** (`VersionsDialog`): lists the current version first, then archived versions desc by
  `version_no`, with a CURRENT badge, per-version size/date, and a total per-version quota line
  (sum of archived sizes — quota double-counting with `files.size` is by design per owner #1).
- **Buttons**: "Versions" entry + version-count badge in the FileCard dropdown, mobile card action grid,
  and desktop table Actions cell.
- **Per-version actions**: Download (streams the archived blob with its own wrapped key), Restore
  (archives current, promotes archived → current), Delete (archived only), Share (pins the version on the
  share-create request; current version = `version_id` NULL), Preview (current version only → reuses
  existing audio/video/image/text handlers; archived shows a notice).
- **ShareDialog**: shows a "Sharing pinned version vN" hint when a version is pinned.

## Risques
Perf: new `IX_files_owner_name_hash` index covers same-name detection (HMAC-SHA256 hex, CHAR(64)).
Sécu: no plaintext names stored; HMAC via existing `hashColumnForLookup`; per-version wrapped keys remain
decodable under the deterministic HKDF sub-key (no re-key). Restore/archive all keep the user owner check
+ `Blocked` guard.
Regressão: existing SELECTs on `files`/`share_links` without the new columns are unaffected; only INSERT into
`share_links` now references `version_id` (column must be migrated before this server version is deployed).
Compat: MSSQL-only; PostgreSQL parity deferred.

## Dette observée
RESOLVED (this session) — Public share resolution now honors `share_links.version_id` in
`src/server/routes/public-sharing.ts`: the metadata, text-preview, download, OpenGraph, and external
media-embed handlers resolve a pinned share to the archived `file_versions` / `file_version_keys` row
(COALESCE over the current `files` / `file_encryption_keys` when `version_id IS NULL`). Guards (Blocked,
secret-key, password, expiry, download-limit) all apply to the resolved version's own data. `desktop-updates.ts`
needs no change (no `share_links` versioning); `public-folder-sharing.ts` shares folders, not versions.

REMAINING — `mapShareRow`/`ShareRow` do not surface `version_id` in the authenticated API response (the value
already round-trips into share-create). Minor; the version id is not needed to resolve the share downstream.

BACKEND debt (follow-up, session owner decisions #1–#3 scoped frontend-only):
- The archived-version text preview still goes through the generic share preview endpoint (no dedicated
  per-version preview route exists), which now correctly resolves the pinned version's bytes.
- A share pinned to a version that is later deleted returns 410 "This shared file version is no longer
  available." across metadata, preview, download, OG, and embed handlers (the version-missing guard) rather
  than silently serving the current version or 404ing without explanation.

FRONTEND debt (documented in code comments):
- Preview of archived versions shows a notice ("Preview is only available for the current version right now.")
  awaiting the backend per-version preview endpoint.

DELETE-FLOW FK BLOCKER (found in validation) — fixed:
- `FK_share_links_version` (`share_links.version_id → file_versions.id`) was created with NO ON DELETE action.
  Reproducer (user-confirmed): share version 4 of a file, then attempt to permanently delete the file —
  `DELETE FROM files` cascades into `file_versions`, but a share row still pinned to version 4 violates the
  NO-ACTION FK, so the delete was blocked and the file/version were left in a broken half-deleted state
  (the shared link reported the generic "link may have expired or the file may have moved"). The user could
  only delete the file after manually removing the v4 share link.
- FIXED across all delete paths — single soft delete (`POST /api/files/:id/delete`), bulk soft delete
  (`POST /api/files/delete`), permanent delete (`POST /api/files/:id/delete-permanent`), folder delete with
  `delete_files` (user + admin), and the `runTrashPurgeCycle()` job — by explicitly removing share rows
  (`DELETE FROM share_links WHERE file_id=@id`, or batched by file_id for the folder-delete paths) so no
  version_id pins survive to block the file_versions cascade during the hard delete. Soft delete now drops
  share rows entirely (rather than only setting `is_active=0`). `FK_share_links_files` is ON DELETE CASCADE;
  the extra version FK was what blocked the version cascade-stack.

FRONTEND ERROR-DISPLAY FIX (public share page) — added:
- `public-download-page.tsx` previously rendered the generic `ErrorScreen code={404}` ("The link may have
  expired or the file may have moved.") whenever the metadata fetch failed (`!meta`), because the `if (!meta)`
  check ran before the `{error && …}` render — hiding the server's specific message. Now, when the metadata
  fetch fails, an explicit error branch renders the exact returned message (e.g. 410 "This shared file version
  is no longer available.") with a Go back action before falling back to the generic 404 screen.

PRE-EXISTING-FILE GAP (found in validation) — fixed:
- Files created before the versioning migration have `file_name_hash = NULL` and cannot be versioned by the
  indexed same-name lookup (the DB can't HMAC an encrypted name). Previously this silently created a duplicate
  row. Fixed two ways:
  1. Runtime fallback in upload detection (scans ≤20 same-folder NULL-hash rows, matches by decrypted name,
     heals the hash) — `src/server.ts`.
  2. One-time backfill `scripts/backfill-file-hashes.ts` (`npm run backfill:file-hashes`) that rehashes all
     active NULL-hash rows server-side.

## Validation
Build: ✅ (`tsc --noEmit`; `vite build` ✓ 494ms; esbuild server bundle OK)  Lint: ✅  Type-check: ✅
Smoke: ⚠SKIPPED (no reachable MSSQL/sqlcmd harness in this environment; existing test
`tests/desktop-updates-path.test.ts` passes 2/2)

## Approbation CRITICAL
N/A — plan pre-approved and work was already in progress from a prior interrupted session
(Step 2 upload + migration committed-to-working-tree before this session resumed). Steps 3–6 completed here.
⚠ If strict GO re-approval is required for CRITICAL before deploy, obtain it before merging.

## Handoff TestEngineer
Surfaces / cas-limites / risques:
1. Same-name upload → version-instead (no new row; `version_count` increments; old blob+key archived).
2. Version list ordering (current first, then archived desc by `version_no`).
3. Version download: integrity check, secret-key protected archive versions, `Blocked` guard, owner/Admin only.
4. Restore: current→archive (unique version_no via `MAX(version_count, max archived)+1`), key swap, verify no
   UNIQUE collision across repeated restore cycles.
5. Delete archived version: vault blob removed, `file_version_keys` cascade, only non-current deletable.
6. Share `version_id`: validate it belongs to the file; pin on create; clear on update (`null`); current version
   when omitted.
7. Edge: version_count default 1 for pre-existing files (backfill is app-populated, `file_name_hash` NULL until
   next write).
8. Migration idempotency: re-run must be a no-op (guards on COL_LENGTH / OBJECT_ID / sys.foreign_keys / sys.indexes).
9. Frontend versions drawer: correct ordering (current first), version-count badge matches API, total quota line.
10. Per-version share: ShareDialog pin hint shows for archived, absent for current; `version_id` NULL on current.
11. Restore from UI: after restore the drawer refreshes (`openVersions`) and the moved version gets a fresh version_no
   (no UNIQUE collision across repeated restore cycles).
12. Preview: current version opens the existing previewer; archived shows the notification notice.

## Handoff QaEngineer
Validation: type-check ✅; server bundle ✅; vite build ✅; test:desktop-updates ✅ (2/2). CRITICAL approval state:
N/A (pre-approved start, resumed here). Per-version share resolution implemented in `public-sharing.ts`.
Remaining minor debt: ShareRow `version_id` surfacing; archived preview + share-backend endpoints. Recommend
running the migration against a disposable MSSQL instance, a manual end-to-end upload→version→restore→share-
version smoke (verify a shared v-N link downloads the v-N blob/name), and a browser pass of the dashboard
versions drawer before production deploy.
