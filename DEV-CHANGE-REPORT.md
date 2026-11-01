---
agent: DevEngineer | date: 2026-11-01 | model: dev-engineer
plan: /memories/session/dev-plan.md
---

## Intention
Implement the Route & Performance audit fixes M-1 (remove the per-request
`COUNT(*) FROM files` subquery from `authenticateUser`), M-3 (server-side
pagination of `GET /api/files` so a bounded page, not the whole account file
set, is transferred and held in the client), and H-1 (streaming chunk-merge for
resumable uploads so large files don't block the event loop), all behind a
feature branch and validated by build/lint/tests.

## Changement
Classe : STANDARD — touches the auth middleware, a public route contract, the
file-dashboard client, and the resumable-upload merge path; each of the three
changes is localized and CI-validated.

## Fichiers
| Fichier | Raison |
|---|---|
| `src/server.ts` | M-1 (auth COUNT removal), M-3 (paginated `/api/files`), H-1 (call `mergeChunks` from extracted module, drop local def) |
| `src/server/merge-chunks.ts` | NEW — H-1 streaming merge extracted from `server.ts` so it is unit-testable without booting the server |
| `src/app/features/files/pages/user-dashboard.tsx` | M-3 — fetch per-folder-scope pages, "Show more" loads next server page, totals/quota from server; folder nav via centralized `[activeFolderId]` refetch |
| `tests/merge-chunks.test.ts` | NEW — H-1 unit tests (merge correctness, chunk cleanup, missing-chunk cleanup) |
| `memories/session/dev-plan.md` | Plan artifact |

## Contrats publics impactés
OUI
- `GET /api/files` : added query params `limit` (default 200, clamp 1–500),
  `offset`, `folder_id`; response adds `total`, `has_more`, `account_file_count`.
  Backwards compatible — existing `files`/`trash_retention_days` fields kept.
- `User.files_used` : now always 0 on the auth path (was a per-request COUNT).
  Frontend does not consume it, so no functional impact.
- Search is **not** executed server-side (the filename column is AES-256-GCM
  encrypted); the client still filters the loaded/decrypted pages locally.

## Risques
- Perf : ✅ — removed the per-request COUNT (M-1); `/api/files` now OFFSET/FETCH
  pages (M-3); merge streams with backpressure (H-1).
- Sécu : ✅ — no new trust boundary; folder scoping is owner-scoped; an
  extra account-wide COUNT runs only once per list load, not per request.
- Régression : ⚠ — client folder navigation re-wired through a centralized
  `[activeFolderId]` effect; root scope semantics aligned with the client's
  "All Files root". Needs QaEngineer manual pass on folder nav + multi-select.
- Compat : ✅ — old `/api/files` callers still work (params optional).

## Dette observée
MAJOR — `tests/syntax-preview.test.ts` fails on base `mssql` and on this branch
(both pre-existing; Node ESM cannot load the `.tsx` component in this test
runner). Not introduced here, but the suite can't be fully green until fixed
(TestEngineer/QaEngineer to triage separately).

## Validation
Build: ✅  Lint: ✅ (`tsc --noEmit`)  Type-check: ✅  Tests: 15/16 (the 1
failure, `syntax-preview`, is pre-existing on base `mssql`) + 2/2 new `merge-chunks`.

## Approbation CRITICAL
N/A — no sensitive files (`**/.env`, keys) modified. M-3 choice of "full
server-side pagination" was approved by the user via ask_user in the audit
handoff; H-1 was explicitly allowed by the user ("can be attempted ... as long
as a branch is created and properly tested").

## Handoff TestEngineer
- H-1 new tests live in `tests/merge-chunks.test.ts` (2 cases). Consider adding
  an idempotency case (re-run merge is a no-op) and a case where a chunk result
  is non-sequential (e.g. gaps).
- M-3 has **no automated test** (no HTTP integration harness exists). Recommend
  standing up an integration harness for `GET /api/files` asserting: default
  page size, `offset` paging, `folder_id` scoping vs root, `total`/`has_more`
  correctness, and `limit` clamping.
- The `syntax-preview.test.ts` failure is pre-existing but should be triaged so
  the suite can go fully green.

## Handoff QaEngineer
- Validation summary: build + lint + type-check green; new H-1 tests pass; the
  one failing test (`syntax-preview`) is pre-existing on base `mssql`.
- To re-validate manually: folder navigation (root ↔ subfolders ↔ breadcrumb),
  "Show more" paging with >100 files, header count and quota display, search
  over loaded pages, multi-select across pages, resumable upload completion.
- Approbation state: M-3 full server-side pagination approved via ask_user;
  H-1 approved on condition of branch + tests (met).
