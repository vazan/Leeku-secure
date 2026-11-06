---
agent: DevEngineer | date: 2026-11-05 | model: dev-engineer
plan: /memories/session/dev-plan.md
---

## Intention
Port the **mssql share-link fix** (`139e70b`) to the `postgresql` branch. On this branch,
creating or updating a share link crashed with `ERR_INVALID_ARG_TYPE` in `decryptColumn`
because `mapShareRow()` received `undefined` IV/authTag/ciphertext — the three queries in
`POST /api/files/:id/share` never fetched the file's encrypted-name columns.

## Changement
Classe : STANDARD — minimal SQL projection fix inside the share POST route. No public
contract change; only the missing columns are now supplied so the existing decryption path
works)Skip.

Postgres uses `RETURNING` (not T-SQL `OUTPUT`), and live-validation on PG16 showed that
`RETURNING` cannot reference `INSERT … SELECT … FROM files f` columns directly (`missing
FROM-clause entry for table "f"`), whereas `UPDATE … FROM … RETURNING` can. So:

| # | Query | Change |
|---|---|---|
| 1 | Existing-share SELECT | `INNER JOIN files f ON sl.file_id=f.id` + select `f.original_name_encrypted/iv/auth_tag` (mirrors `GET /api/sharing/links`) |
| 2 | INSERT … RETURNING | `VALUES(...)` → `SELECT @fid,… FROM files f WHERE f.id=@fid`; add the 3 name columns via **correlated subqueries** on `files` (only form PG allows here) |
| 3 | UPDATE … RETURNING | `FROM files f`, `WHERE share_links.file_id=f.id AND share_links.id=@id`; add the 3 name columns as `f.*` (PG allows FROM columns in UPDATE RETURNING) |

## Fichiers
| Fichier | Raison |
|---|---|
| src/server.ts | Fixed the three queries of `POST /api/files/:id/share` to source the encrypted-name columns from `files` |

## Contrats publics impactés
NON. `ShareLink.original_name` is already an optional server-provided field (shared types) and is
already returned by `GET /api/sharing/links`. This fix only makes the POST response populate it
(alongside `success:true`) instead of throwing. Response shape unchanged.

## Risques
- Perf: negligible — the INSERT adds three single-row correlated subqueries on the `files` PK.
- Sécu: none — same already-shipped encrypted blobs used by `GET /api/sharing/links`.
- Régression: UPDATE `FROM files f` is joined on `share_links.file_id = f.id` (1:1 via file PK), so
  no cartesian blow-up; name resolves from current file exactly like the management list. Public
  download routes (`public-sharing.ts`) keep their own version-aware `COALESCE` untouched.
- Compat: validated verbatim against a live **PostgreSQL 16** container (schema + seed + all three
  statements) before finalising.

## Dette observée
AUCUNE new — `tsc` is clean on this branch (0 errors); the only build warning is the pre-existing
`import.meta` esbuild message at server.ts:79.

## Validation
Build: ✅ (vite + esbuild server bundle clean; pre-existing `import.meta` warning only)
Lint: ✅ (tsc --noEmit, 0 errors)
Type-check: ✅
Smoke: ✅ SQL-level — all three statements executed successfully on PostgreSQL 16 and returned the
decrypted-name bytea columns; full HTTP path not run (no app env / vault in this workspace).

## Approbation CRITICAL
N/A.

## Handoff TestEngineer
Surfaces to test:
- POST `/api/files/:id/share` on a file with NO existing link → 200 with `link.original_name` (decrypted).
- POST on a file that ALREADY has a link (update path, with/without a change) → 200, no crash.
- Existing links list (`GET /api/sharing/links`) unaffected.
- Non-ASCII / emoji names (round-trip through decryptColumn).
Case limits/risks:
- Link pinned to an archived `version_id` (name resolves from current file, matching the management
  list; public routes keep version-aware name).
- Blocked / missing-in-vault files are rejected before this path (unchanged).
- Ownership 403 path unchanged.

## Handoff QaEngineer
Bug-fix validated on the `postgresql` branch: lint clean, build clean, and the exact SQL forms
live-tested on PostgreSQL 16. Needs an integration smoke against a real Leeku PG instance to
confirm end-to-end (`link.original_name` populated on create and update).
