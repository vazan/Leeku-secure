## DEV-PLAN — File Version History (MSSQL)

Date : 2026-10-31 | Modèle : dev-engineer | Classe : CRITICAL

### Exploration (résumé)
- Fichiers impactés :
  - `Documentation/SQL/2026-10-31-add-file-versioning.sql` (NEW — deliverable for user testing)
  - `src/server.ts` (upload pipeline ~2739–3218; share create ~4313; download/preview routes; delete flows)
  - `src/server/routes/public-sharing.ts` (share resolution joins `files`+`file_encryption_keys`)
  - `src/server/routes/public-folder-sharing.ts`, `desktop-updates.ts` (same join pattern)
  - Frontend `src/app/features/files/pages/user-dashboard.tsx` (file list display "All Files")
- Contrats publics : file/dir upload, `share_links` schema (file_id → add version_id), `files` schema (add current_version_id, file_name_hash), GET/POST routes. DB migration is a public contract change → CRITICAL.
- Tests existants : `tests/desktop-updates-path.test.ts` (only one; no general test runner — GAP-TEST-001).

### Choix de modèle (minimal blast radius)
`files` row = logical file AND current version. `file_versions`/`file_version_keys` = **archived older versions**.
→ Existing SELECTs joining `files`+`file_encryption_keys` keep working for the current version; only upload, new version routes, delete, and share need changing.

### Étapes
| # | Action | Fichier | Classe |
|---|---|---|---|
| 1 | Migration: `files.current_version_id`, `files.file_name_hash`, `file_versions`, `file_version_keys`, `share_links.version_id`, backfill existing rows as version 1 | `Documentation/SQL/2026-10-31-add-file-versioning.sql` | CRITICAL |
| 2 | Upload: same owner+folder+name detection (HMAC hash) → archive current to file_versions, write new current in files | `src/server.ts` | CRITICAL |
| 3 | New endpoints: GET versions, GET download version, POST restore, DELETE version | `src/server.ts` | CRITICAL |
| 4 | Share create accepts optional `version_id` (NULL = current) | `src/server.ts` | STANDARD |
| 5 | Build/lint/type-check + manual SQL smoke via sqlcmd (if reachable) | terminal | — |
| 6 | DEV-CHANGE-REPORT.md + handoff TestEngineer | docs | — |
| 7 | Frontend UI (dashboard): versions drawer + per-version quota/total + restore/share/preview wiring (owner decisions #1–#3) | `src/app/features/files/pages/user-dashboard.tsx`, `src/app/shared/types/index.ts` | STANDARD |

### Critères de succès
- [x] Build & lint (`tsc --noEmit`) propres
- [ ] Migration script runs idempotently & backfills existing rows (⚠ no MSSQL/sqlcmd harness reachable — needs manual smoke)
- [x] Same-name upload creates version; versions list/download/restore work; share pins version (server.ts)
- [x] Frontend dashboard: versions drawer, per-version quota/total, restore/share/preview wiring (§3.4 UI, owner #1–#3)

### State (2026-10-31, resumed session)
Steps 1–6 implemented. Interrupted prior session had already completed Step 1 (migration) + Step 2 (upload
pipeline); this session completed Step 3 (4 new version endpoints), Step 4 (share `version_id`),
Step 5 (tsc OK; esbuild OK; sqlcmd smoke SKIPPED), Step 6 (DEV-CHANGE-REPORT.md).
Step 7 (frontend UI) completed in this session per owner decisions #1–#3 — dashboard-only, full §3.4 UI:
`VersionsDialog` drawer (list current+archived, CURRENT badge, per-version size/date, total quota),
version-count badge + "Versions" buttons (FileCard dropdown / mobile grid / desktop table), and per-version
Download / Restore / Delete / Share (pins `version_id`) / Preview (current only). Validated with
`tsc --noEmit` ✅, `vite build` ✅, `esbuild` server bundle ✅.

FOLLOW-UP (debt, not in plan steps):
- Public share resolution (`public-sharing.ts`, `public-folder-sharing.ts`, `desktop-updates.ts`) does not yet
  honor `share_links.version_id` — a pinned link resolves to the current version until wired.
- `mapShareRow`/`ShareRow` do not surface `version_id` in API response.
- No per-version preview / per-version share backend endpoints yet — UI previews only the current version and
  pins `version_id` on the existing share-create endpoint (owner decision #3 rendered the drawer; backend
  follow-up remains).

### Rollback
- SQL: `DROP TABLE dbo.file_version_keys; DROP TABLE dbo.file_versions; ALTER TABLE dbo.files DROP COLUMN current_version_id, file_name_hash; ALTER TABLE dbo.share_links DROP COLUMN version_id;`
- Code: `git revert` / `git checkout -- src/server.ts src/app/features/files/pages/user-dashboard.tsx src/app/shared/types/index.ts`

### Risques
| Risque | Prob. | Mitigation |
|---|---|---|
| Large surface / no test runner | High | Vertical slice; keep Model B so existing joins unaffected |
| Migration breaks existing rows | Med | Idempotent guards + backfill transaction; verify counts |
| Same-name detection cost (encrypted names) | Med | Add indexed `file_name_hash` (HMAC) column |
