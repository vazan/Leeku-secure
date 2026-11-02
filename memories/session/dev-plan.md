## DEV-PLAN — Routes & Performance audit fixes (M-1, M-3, H-1)
Date : 2026-11-01 | Modèle : dev-engineer | Classe : STANDARD

### Exploration (résumé subagent)
- Fichiers impactés :
  - `src/server.ts` (route `/api/files`, `mergeChunks`, removed per-request COUNT in `authenticateUser`)
  - `src/server/merge-chunks.ts` (NEW — extracted streaming merge for unit-testability)
  - `src/app/features/files/pages/user-dashboard.tsx` (client-side server pagination)
  - `tests/merge-chunks.test.ts` (NEW — unit test for H-1)
- Contrats publics :
  - `GET /api/files` — now accepts `limit`, `offset`, `folder_id`; response adds `total`, `has_more`, `account_file_count` (backwards compatible: old fields preserved)
  - `user.files_used` — now 0 on auth path (was populated by a per-request COUNT); unused by frontend
- Tests existants couvrant : `tests/desktop-updates-path.test.ts`, `tests/merge-chunks.test.ts` (new). Note: `tests/syntax-preview.test.ts` fails on base `mssql` too (pre-existing `.tsx` ESM issue, unrelated).

### Étapes
| # | Action | Fichier | Classe |
|---|---|---|---|
| 1 | M-1 : remove `(SELECT COUNT(*) ... ) AS files_used` subquery from `authenticateUser` | `src/server.ts` | STANDARD |
| 2 | M-3 : server-side pagination (`limit`/`offset`/`folder_id`, `COUNT(*) OVER()`, OFFSET/FETCH) on `GET /api/files` | `src/server.ts` | STANDARD |
| 3 | M-3 : client uses paginated endpoint — fetch per folder scope, "Show more" loads next page, totals from server | `user-dashboard.tsx` | STANDARD |
| 4 | H-1 : streaming chunk-merge via `stream/promises` + extract to unit-testable module | `src/server/merge-chunks.ts`, `src/server.ts` | STANDARD |
| 5 | Test & validate : type-check, build, unit tests, DEV-CHANGE-REPORT | — | STANDARD |

### Critères de succès
- [x] `tsc --noEmit` and `npm run build` clean
- [x] New `tests/merge-chunks.test.ts` passes (merge correctness + missing-chunk cleanup)
- [x] No new test regressions (existing suite minus pre-existing `syntax-preview` failure)
- [x] `/api/files` payload bounded by `limit` instead of returning the whole account file set

### Rollback
```bash
git checkout refactor/routes-perf-m1-m3-h1
git revert  <merge-commit>   # or: git checkout mssql -- src/server.ts src/app/features/files/pages/user-dashboard.tsx
git rm src/server/merge-chunks.ts tests/merge-chunks.test.ts
```

---

## DEV-PLAN — Fix M-3 folder-scoping regression in GET /api/files (version-explosion)
Date : 2026-11-02 | Modèle : dev-engineer | Classe : CRITICAL (data: version explosion, up to 160 versions)

### Bug (reproduced live)
- `GET /api/files` with **no `folder_id`** (the legacy desktop/CLI contract) returned **only root-level files** (`folder_id IS NULL`), silently excluding every file inside a sub-folder.
- Desktop sync engine calls `/api/files` without `folder_id` to build its FULL remote inventory → could never see already-uploaded files under a sub-folder remoteRoot → `findRemoteMatch` returned null → re-upload with `replaceRemoteId` each poll → server's "version-instead" archived the current version and bumped `version_count` → version explosion (160 versions).
- Reproduced live with test account `admin_god601`: root-folder job stable, sub-folder job (`Leeku Desktop/pictures-3ef9f200`) looped infinitely. Live SMOKE: `WITH folder_id → 23 files (version_count 22)` vs `WITHOUT folder_id → 1 file (root only)`.

### Root cause
Introduced by `2e95019` (server-side pagination, M-3): the new unconditional folder-scope predicate
`(f.folder_id=@folderId OR (@folderId IS NULL AND f.folder_id IS NULL))`
reduces to `f.folder_id IS NULL` when `@folderId` is NULL — breaking the "all files" default.

### Fix (applied & deployed by user)
Change the predicate to `(@folderId IS NULL OR f.folder_id=@folderId)` in BOTH the primary query and the legacy fallback — no `folder_id` ⇒ return all folders; folder_id ⇒ scope to that folder.

### Validation
- `tsc --noEmit` : EXIT 0.
- Live re-verify after deploy: `GET /api/files` (no folder_id) returns full inventory (27 files incl. sub-folder), sub-folder job `7d145a2e` shows 0 pending ops across successive polls (`last_sync_at` advancing, no operations queued).


### Risques
| Risque | Prob. | Mitigation |
|---|---|---|
| Search on server side impossible (original_name is encrypted) | — | Search stays client-side over loaded pages; documented |
| Root scope semantics (folder_id NULL) mismatch client "All Files root" | Low | Server filters `folder_id IS NULL` at root to match client model |
| Client folder nav across many `setActiveFolderId` call sites | Med | Centralized `[activeFolderId]` effect refetches page 0; removed duplicate calls |
| Merge path consistency between server.ts and extracted module | Low | Both compute `UPLOAD_TEMP` from the same env var + fallback |
