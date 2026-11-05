---
agent: DevEngineer | date: 2026-11-05 | model: (dev)
plan: /memories/session/dev-plan.md
---

## Intention
Fix the crash on `POST /api/files/:id/share` — `mapShareRow()` tried to decrypt the shared
file's name but the create/update queries never fetched the encrypted-name columns, so the IV
arrived `undefined` → `ERR_INVALID_ARG_TYPE`.

## Changement
Classe : STANDARD — minimal SQL projection fix inside the share POST route. No public contract
change; only the missing columns are now supplied so the existing decryption path works.

## Fichiers
| Fichier | Raison |
|---|---|
| src/server.ts | Joined `files` and selected `original_name_encrypted/iv/auth_tag` in the three queries of `POST /api/files/:id/share` (existing-share SELECT, INSERT…OUTPUT, UPDATE…OUTPUT) so `mapShareRow()` can decrypt the name. |

## Contrats publics impactés
NON. `ShareLink.original_name` is already an optional server-provided field (types/index.ts:86)
and is already returned by `GET /api/sharing/links`. This fix only makes the POST response
populate it (alongside `success:true`) instead of throwing. Response shape unchanged.

## Risques
- Perf: negligible (the POST already joined `files` implicitly; we add three columns).
- Sécu: none — columns are the same already-shipped encrypted blobs used by `GET /api/sharing/links`.
- Régression: name resolution now matches `GET /api/sharing/links` (current-file name). For links
  pinned to an archived version the management dashboard already shows the current name; no
  behaviour change vs. shipping code. The public download routes (`public-sharing.ts`) keep their
  own version-aware `COALESCE` resolution untouched.
- Compat: the three rewritten statements are standard T-SQL; `INSERT…OUTPUT…FROM share_links
  INNER JOIN files` target form and `UPDATE…OUTPUT…FROM` target form are valid.

## Dette observée
MINOR — pre-existing `tsc` noise (52 errors: missing `mssql` type declarations + unrelated
implicit-any) is unrelated to this change and present on baseline. Not introduced here.

## Validation
Build: ✅ (esbuild bundles server.cjs cleanly; pre-existing `import.meta` warning only)
Lint: ✅ (tsc 52 errors before = 52 after; none in edited regions)
Type-check: ✅ (no new errors; pre-existing baseline errors only)
Smoke: ⚠ SKIPPED — no running SQL Server instance in this workspace.

## Approbation CRITICAL
N/A.

## Handoff TestEngineer
Surfaces to test:
- POST `/api/files/:id/share` on a file with NO existing link → 200 with `link.original_name` (decrypted).
- POST on a file that ALREADY has a link (update path, with/without a change) → 200, no crash.
- Existing links list (`GET /api/sharing/links`) unaffected.
- Files whose name contains non-ASCII / emoji (round-trip through decryptColumn).
Case limits/risks:
- Link pinned to an archived `version_id` (name resolved from current file, matching the
  management list; public routes keep version-aware name).
- Blocked/missing-in-vault files are rejected before this path (already covered).
- Regression: creating/updating a link on a file the owner owns only (403 path unchanged).

## Handoff QaEngineer
Bug-fix validated: build/lint clean vs baseline; no contract change; only the share POST
projection was repaired. Needs a live-SQL integration smoke to confirm the query executes.
