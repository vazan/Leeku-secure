---
agent: DevEngineer | date: 2026-11-02 | model: dev-engineer
plan: /memories/session/dev-plan.md
---

## Intention
Fix a regression introduced by the M-3 server-side pagination work (`2e95019`)
in `GET /api/files`: when called **without** `folder_id` (the legacy desktop /
CLI / mobile "full inventory" contract), the route returned only **root-level
files** (`folder_id IS NULL`), silently hiding every file stored inside a
sub-folder. That made the desktop sync engine believe its already-uploaded
files no longer existed remotely, so it re-uploaded them every poll with
`replaceRemoteId`, and the server's version-instead logic archived the current
version and bumped `version_count` on each pass — producing the **version
explosion** (up to 160 versions of a single logical file).

## Changement
Classe : CRITICAL — a one-line SQL predicate in a public route contract whose
failure caused unbounded, destructive data growth (version_count inflation)
and stalled sync. Localized to two WHERE clauses in one handler; validated
both by type-check and by a live production re-verify after deploy.

## Fichiers
| Fichier | Raison |
|---|---|
| `src/server.ts` (`GET /api/files`) | Fix folder-scoping predicate in the primary query and the legacy fallback |

## Contrats publics impactés
OUI — `GET /api/files`:
- No change to response shape/fields (backwards compatible).
- **Behavior fix**: omitting `folder_id` now returns the owner's **full
  inventory across all folders** (restores pre-M-3 contract) instead of only
  root files. Passing `folder_id` still scopes to that folder.
- `limit`/`offset` paging, `total`, `has_more`, `account_file_count` unchanged.

## Risques
- Perf : restoring "all files" when no `folder_id` re-introduces the large
  payload the M-3 pagination sought to bound. Mitigation: desktop/CLI already
  opt-in to `limit`/`offset` where they page; the full-inventory call is the
  documented legacy contract those clients depend on (sync planning needs the
  whole tree). Accounts with very large file sets may page by passing
  `limit`/`offset` — unaffected by this predicate change.
- Sécu : none — same owner scoping, no new data exposed.
- Régression : the only behavior changed is the no-`folder_id` default, which
  was already broken (root-only) since `2e95019`; restoring "all files" fixes
  the desktop loop. Folder-scoped browsing (`folder_id` set) is unchanged.
- Compat	db : predicate is ANSI-standard; no schema dependency.

## Dette observée
MAJOR — the upload version-detection query (lines ~3237, ~3265) still uses the
`((@folderId IS NULL AND folder_id IS NULL) OR folder_id=@folderId)` form,
which is CORRECT there (uploading to root vs a folder), so it was intentionally
left alone. No other inventory endpoint showed the same buggy pattern.

## Validation
Build: ✅ (esbuild/`vite build` unaffected — SQL string only; `tsc --noEmit` EXIT 0)  Lint: ✅ (`tsc --noEmit`)  Type-check: ✅  Smoke: ✅ (**live production re-verify after user deployed**)

Live smoke evidence (test account `admin_god601`):
- Before fix: `GET /api/files` (no folder_id) → 1 file (root only).
- After fix: `GET /api/files` (no folder_id) → **27 files** (23 under `pictures-3ef9f200`, 3 under `direct-sync`, 1 root).
- Sub-folder job `7d145a2e` (`/home/midorica/Pictures/discord` → `Leeku Desktop/pictures-3ef9f200`): after deploy, successive polls at 05:00:19, 05:02:06 show **0 pending operations** — the loop is stopped, no new versions created.

## Approbation CRITICAL
N/A — no sensitive files modified (`src/server.ts` only). Live deploy and
confirmation performed by the user (user: "pushed your change ... desktop app
seems to no longer be looping").

## Handoff TestEngineer
- Add an integration/unit test asserting the `@folderId IS NULL` default
  returns rows across ALL folders (not just `folder_id IS NULL`), for both the
  primary and legacy-fallback queries.
- Regression case: with `folder_id` set, still scopes to exactly that folder
  (and rejects/ignores a `folder_id` the user doesn't own).
- Consider parameterized test over: no params, `folder_id=null`, `folder_id=<subfolder>`, with paging.

## Handoff QaEngineer
- Validation summary: type-check green; **live production re-verify confirms
  the version-explosion loop is fixed** (full inventory returned, sub-folder
  job settled to 0 pending ops across multiple polls).
- Approbation state: CRITICAL class, no sensitive files; user deployed and
  confirmed the fix live. Recommend a follow-up cleanup of existing inflated
  `version_count` rows (the already-created 160-version files) if desired.
