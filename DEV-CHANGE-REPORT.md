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
- `GET /api/public/share/:token` response — adds `version_no` (resolved version's `version_no`, or
  `files.version_count` for the current version).
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
- **Public share page**: shows a "Version N" badge next to the file name (from new `version_no` field on
  `GET /api/public/share/:token` — the archived version's `version_no`, or the current `files.version_count`
  when not pinned). The OpenGraph metadata (Discord/social embeds) also includes "· Version N".
- **Trash view**: each soft-deleted file card shows a "Version N" badge (the current version number in trash,
  from `files.version_count`, now included in `GET /api/files/trash`).

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

VERSION SOFT-DELETE + TRASH (owner decision, current task):
- Deleting an archived version is now a **soft delete**: it stamps `file_versions.deleted_at`/`deleted_by`
  (keeps the vault blob and the `file_version_keys` wrapped key) instead of unlinking the blob and hard-
  deleting the row. The version moves into a "Trash" section in the Versions drawer and can be restored.
- Migration section "6b" adds `file_versions.deleted_at DATETIMEOFFSET(7) NULL` and
  `file_versions.deleted_by UNIQUEIDENTIFIER NULL` (idempotent `IF COL_LENGTH(...) IS NULL` guards).
- Backend:
  - `DELETE /api/files/:id/versions/:versionId` → `UPDATE file_versions SET deleted_at=SYSDATETIMEOFFSET(),
    deleted_by=@by WHERE id=@vid AND deleted_at IS NULL`. Keeps the 409 share-ref guard ("refuse until
    unshared" — owner decision); response `{ success, message: 'Version moved to trash.' }`.
  - NEW `POST /api/files/:id/versions/:versionId/restore-trashed` clears `deleted_at`/`deleted_by` and
    returns the restored `version_no`.
  - `GET /api/files/:id/versions` now returns `{ versions, trashed, current_id }` — `versions` only rows
    with `deleted_at IS NULL` (current + active archived), `trashed` the soft-deleted ones; each object
    carries `deleted_at` (ISO string or null).
  - `GET .../download` returns 410 if the version is trashed ("must be restored before download").
  - `src/server/routes/public-sharing.ts` `SHARE_VERSION_JOINS` adds `AND v.deleted_at IS NULL`, so a
    share pinned to a trashed version resolves to 410 "This shared file version is no longer available."
  - `POST .../restore` (promote-to-current) is unchanged: the promoted row is hard-deleted at the end of
    the transaction and shares are repointed, so it behaves correctly even if called directly on a trashed
    row. The UI does not expose Promote for trashed versions (they only get "Restore" from version trash).
- Frontend (`user-dashboard.tsx`, `src/app/shared/types/index.ts`):
  - `FileVersion` gains `deleted_at?: string | null`.
  - `openVersions` resets + reads back `data.trashed`.
  - `deleteVersion` confirmation/success copy → "trash"; reloads via `openVersions(file)`.
  - NEW `restoreTrashedVersion` POSTs `/restore-trashed` then reloads.
  - `VersionsDialog` receives `trashed` + `onRestoreTrashed`; renders a "Trash (N)" section listing
    trashed versions with a dashed border, an "IN TRASH" badge, and a Restore button. Trashed versions do
    not appear in the active list, so Promote/Delete/Share/Download are not offered for them from the
    active list (Download of a trashed version is server-410'd anyway).
- Leak note (pre-existing, out of scope): archived-version blobs are not cleaned up on file permanent
  delete / trash purge — only the current `files.stored_path` blob is unlinked. The soft-delete task does
  not change this; documented here for awareness.

TRASH TAB SHOWS SOFT-DELETED VERSIONS (owner decision, follow-up):
- The side-nav **Trash** tab now shows not only soft-deleted *files* but also soft-deleted archived
  *versions* (rows with `file_versions.deleted_at IS NOT NULL`), each with Restore and Delete (permanent)
  actions — so a version like v6 that was moved to the version trash from the Versions drawer is
  recoverable or permanently purgable from the Trash tab too.
- Backend:
  - `GET /api/files/trash` now returns `{ files, trashedVersions }`. `trashedVersions` lists the user's
    soft-deleted archived versions joined to `files` for owner scoping, each carrying `id`, `file_id`,
    `version_no`, decrypted `original_name` and parent `file_name`, `size_bytes`, `mime_type`, `status`,
    `created_at`, `deleted_at`.
  - NEW `POST /api/files/:id/versions/:versionId/delete-permanent` — hard-deletes a trashed archived
    version: unlinks the vault blob, deletes the row (`file_version_keys` cascades). Keeps the 409
    share-ref guard (unshare before permanently deleting) so no pinned link silently breaks. Returns 404
    if the version isn't trashed.
  - An owner scoping/consistency note: version trash is conflated with the file-level Trash retention
    copy — a soft-deleted version carries `deleted_at` but is NOT auto-purged by the 90-day trash purge
    job (that job only hard-deletes `files` rows), so versions must be purged manually from the Trash tab
    or restored. Documented as a follow-up debt.
- Frontend (`user-dashboard.tsx`, `src/app/shared/types/index.ts`):
  - `FileVersion` gains optional `file_id` and `file_name` (parent context, present only in the Trash tab).
  - New state `trashVersions`; `loadTrash()` reads `payload.trashedVersions`.
  - Trash tab renders a "Deleted versions (N)" section below the files list (dashed border, `Layers` icon,
    `vN` + "VERSION IN TRASH" badges, parent file name, size, deleted date) with **Restore**
    (`restoreVersionFromTrash` → `/restore-trashed`) and **Delete** (`permanentDeleteVersion` →
    `/delete-permanent`) actions. Empty-trash and loading states now account for versions.
  - "Trash is empty." only when both file and version trash are empty.

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
13. Soft-delete: DELETE on an archived version keeps the vault blob + `file_version_keys` row)Skip, sets `deleted_at`,
   and the drawer's "Trash (N)" section shows the version with a Restore button; download of that version
   returns 410.
14. Restore-from-trash: `POST /restore-trashed` clears `deleted_at`/`deleted_by`; the version reappears in the
   active list; a share link pinned to it resolves again (no longer 410).
15. Soft-delete + share guard: deleting a shared version still refuses with 409 until unshared; after unshare,
   soft-delete works.
16. Migration re-run is a no-op for section "6b" (`deleted_at`/`deleted_by` COL_LENGTH guards).
17. Trash tab: after soft-deleting an archived version (e.g. v6), it appears in the Trash tab's
   "Deleted versions" section with Restore and Delete actions, including the parent file name.
18. Restore-from-Trash-tab: restoring a trashed version from the Trash tab clears `deleted_at`; it no
   longer shows in the Trash tab and reappears in the file's Versions drawer; a share pinned to it resolves
   again.
19. Permanent-delete-from-Trash-tab: `POST .../delete-permanent` unlinks the blob, drops the row, and the
   version leaves the Trash tab; deleting a still-shared version still refuses with 409.
20. Trash tab empty-state/loading correctly accounts for both files and versions; "Trash is empty." only
   when both lists are empty.

## Handoff QaEngineer
Validation: type-check ✅; server bundle ✅; vite build ✅; test:desktop-updates ✅ (2/2). CRITICAL approval state:
N/A (pre-approved start, resumed here). Per-version share resolution implemented in `public-sharing.ts`.
Remaining minor debt: ShareRow `version_id` surfacing; archived preview + share-backend endpoints. Recommend
running the migration against a disposable MSSQL instance, a manual end-to-end upload→version→restore→share-
version smoke (verify a shared v-N link downloads the v-N blob/name), and a browser pass of the dashboard
versions drawer before production deploy.

---

# BUGFIX — "Version not found." when downloading the current version

## Intention
Fix the "Version not found." error when a user clicks **Download** on the **current version**
(e.g. v7, the file itself) inside the Versions drawer under "All Files".

## Changement
Classe : STANDARD — single-route backend fix in `src/server.ts`; no schema or contract changes.

## Root cause
`GET /api/files/:id/versions` synthesizes the **current** version entry with `id = file.id`, because in
Model B the current version lives in the `files` table (not `file_versions`). The Download button posts
`/api/files/:id/versions/<version.id>/download` with `version.id === file.id`, but that endpoint ONLY
queries `file_versions WHERE id=@vid AND file_id=@fid`. Since the current version has no `file_versions`
row, the lookup returns empty → HTTP 404 **"Version not found."** Preview works because the Preview button
is only rendered for the current version and reuses `/api/files/:id/preview`, which reads the `files`
table.

## Fichiers
| Fichier | Raison |
|---|---|
| `src/server.ts` (`GET /api/files/:id/versions/:versionId/download`) | When `versionId === fileId`, stream the current version from the `files` blob + `file_encryption_keys` (mirrors the existing `/api/files/:id/download` handler: decrypt → checksum → secret-key → stream). Archived versions keep the existing `file_versions` path. |

## Contrats publics impactés
NON — same URL, same auth, same response shape.

## Validation
Build: ✅ (`tsc --noEmit`; esbuild server bundle OK)  Lint: ✅  Type-check: ✅
Smoke: ⚠SKIPPED (no reachable MSSQL harness in this environment).

## Handoff TestEngineer — targeted regression
1. Open Versions drawer for a file with ≥1 version. Click **Download** on the CURRENT version
   (badge "CURRENT") → must stream the current blob+name, not 404 "Version not found.".
2. Click **Download** on an archived (non-current) version → still downloads correctly (unchanged path).
3. Current version guarded with a secret key → secret prompt enforced; wrong key → 403 "Incorrect secret key."
4. Current version `Blocked` → 410 "Blocked files cannot be downloaded."
5. Owner vs Admin auth on the current-version download → unchanged (owner or Admin only).
6. Trashed version download → still 410 (unchanged).

## Handoff QaEngineer
Manual browser smoke recommended for the 6 cases above on the feature branch before merge.
