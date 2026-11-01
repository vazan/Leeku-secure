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

### Risques
| Risque | Prob. | Mitigation |
|---|---|---|
| Search on server side impossible (original_name is encrypted) | — | Search stays client-side over loaded pages; documented |
| Root scope semantics (folder_id NULL) mismatch client "All Files root" | Low | Server filters `folder_id IS NULL` at root to match client model |
| Client folder nav across many `setActiveFolderId` call sites | Med | Centralized `[activeFolderId]` effect refetches page 0; removed duplicate calls |
| Merge path consistency between server.ts and extracted module | Low | Both compute `UPLOAD_TEMP` from the same env var + fallback |
