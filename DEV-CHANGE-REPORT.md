---
agent: DevEngineer | date: 2026-11-02 | model: dev-engineer
plan: /memories/session/dev-plan.md
---

## Intention
Replace the manual "Show more" click-through on large file lists (introduced by
M-3 server-side pagination in `5a68939`) with seamless lazy loading: the list
automatically fetches and appends the next page as the user scrolls, so accounts
with thousands of files (requiring ~50 stale clicks before) are now browsed by
simple scrolling.

## Changement
Classe : STANDARD — isolated client-side UX change in a single component, no
public contract or server change.

An `IntersectionObserver` watches a 1px sentinel placed after the file list.
When the sentinel enters a 400px pre-fold margin, it:
- calls the existing `loadMoreFiles()` when the server reports more rows
  (`filesHasMore`), appending the next page and growing the render window; or
- reveals locally-windowed matches (`setVisibleLimit`) when a fully-loaded
  filtered result still has hidden rows.

The observer re-arms whenever the loadable state changes (page loaded, window
grew, folder scope or search change). "Show more" is retained purely as a
fallback for keyboard / screen-reader / non-scroll interaction.

## Fichiers
| Fichier | Raison |
|---|---|
| `src/app/features/files/pages/user-dashboard.tsx` | Add `useRef`, sentinel ref, IntersectionObserver effect, and sentinel JSX |

## Contrats publics impactés
NON — no API, types, or route changes. `GET /api/files`, `loadMoreFiles`,
`setVisibleLimit`, and response shape are unchanged.

## Risques
- Perf : lazy fetch adds one page (100 files) per scroll-to-bottom; bounded by
  server `limit` max (500). No full-set DOM — render window still governed by
  `visibleLimit`.
- Sécu : none — same authenticated owner-scoped endpoint.
- Régression : button behavior preserved as fallback; observer re-arm covers
  scope/search changes; `filesLoading` guard prevents concurrent page fetches.

## Dette observée
MINOR — `pre-existing` `src/server.ts` type errors (42 on base branch) are
unrelated to this change and not addressed here.

## Validation
Build: ✅ (`npm run build` ok)  Lint: field-clean — `tsc --noEmit` reports 0
errors in `user-dashboard.tsx` (remaining errors are pre-existing server.ts on
the base branch).  Type-check: ✅ (per-file)  Smoke: ⚠SKIPPED (no live DB/UI here)

## Approbation CRITICAL
N/A — STANDARD class, no sensitive files.

## Handoff TestEngineer
- Verify scrolling to the bottom of a list with `has_more=true` loads the next
  page automatically (no click).
- Verify search that narrows a fully-loaded page to > visibleLimit reveals more
  matches on scroll without re-fetching.
- Verify rapid/continuous scroll triggers only one fetch at a time
  (`filesLoading` re-entry guard).
- Regression: single "Show more" click still works and appends exactly one page.

## Handoff QaEngineer
- Validation summary: per-file type-check clean, production build green.
- Approbation state: STANDARD; no CRITICAL path. Requires UI smoke test on a
  live account with > 100 files to confirm seamless scroll-driven loading.

---

## Amendment — Root "All Files" view fix (2026-11-02 follow-up)
User tested v1 of the lazy-loading change: sub-folder views auto-loaded
correctly, but the **root** "All Files" view still showed "No matching files"
while reporting "Show More (9623 remaining)" and required ~80 manual clicks.

### Root cause
`currentFolderFiles` at root (`activeFolderId === null`) filtered the server
response to `!file.folder_id` (root-level files only). But `GET /api/files` at
root scope returns the **full inventory across every folder**
(`(@folderId IS NULL OR f.folder_id=@folderId)`), so:
- `filesTotal`/`filesHasMore` correctly reported 9623 files, but
- the root list filtered every sub-folder file out → `visibleFiles.length === 0`
  → "No matching files", and no sentinel rendered → no lazy loading could fire
  (hence the ~80-click workaround as pages loaded enough root files to appear).

### Fix
`currentFolderFiles` at root now keeps **all** files from the server response
(folders remain listed separately via `visibleFolders`). Root "All Files" now
shows the full inventory and lazy-loads automatically on scroll, matching how
sub-folder views already behaved.

---

## Amendment 2 — Root-only scope (2026-11-02 course correction)
User reported v1.1 (showing ALL sub-folder files bundled at root) was wrong —
the root folder has its own files and should **not** display sub-folder files.
Reverted the `: files` root filter back to `!file.folder_id`.

### Correct fix
The root view was starved because the server paginates the **all-folders**
inventory while the client displays only root-level files. Added an opt-in,
backwards-compatible server param `scope=root` to `GET /api/files`:
- `scope=root` (no `folder_id`) → paginate/filter to `folder_id IS NULL`
  (this folder's own files only).
- omitted → historical FULL all-folders inventory (legacy desktop/CLI contract
  preserved — the CRITICAL `2e95019` guarantee stands).

The dashboard now sends `scope=root` from the root "All Files" view (both
initial load and lazy "load more"), and `folder_id=...` inside sub-folders.
Root shows its own files, paginates accurately among them, and lazy-loads on
scroll; sub-folders are unaffected.

---

## Amendment 3 — Larger lazy-load page size (2026-11-02)
After the root fix, large sub-folders still populated slowly — each lazy-load
fetch pulled only 100 files per page. Raised `FILES_SERVER_PAGE` from 100 to
**500** (the server's per-request cap), so each lazy-load fetch returns 5x more
files and the round-trips needed to populate a folder drop ~5x)Skip. The local
render window (`visibleLimit`) is unchanged, so the DOM stays small; the extra
already-fetched files simply reveal as the user scrolls without extra requests.
