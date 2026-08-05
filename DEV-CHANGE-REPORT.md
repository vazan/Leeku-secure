---
agent: DevEngineer | date: 2026-08-02 | model: GitHub Copilot
plan: /memories/session/dev-plan.md
---

---
agent: DevEngineer | date: 2026-08-05 | model: GPT-5.3-Codex
plan: /memories/session/dev-plan.md
---

Intent
Reduced All Files latency for large folder sets by removing eager folder loading at initial dashboard refresh and introducing an explicit move-to-folder dialog that lazy-loads folders only when needed.

Change class
STANDARD

Files changed
- src/app/features/files/pages/user-dashboard.tsx:
  - Split initial refresh to load files + share links only (no eager `/api/file-folders` call).
  - Added lazy folder loader with loaded/loading guards.
  - Replaced per-row folder select controls with a `Move to folder` button and modal dialog.
  - Move dialog now fetches folder options on open and uses existing `POST /api/files/:id/folder` contract.
  - Added explicit `Browse folders` button in All Files controls when folder list has not yet been loaded.
  - Kept desktop folder column readable via `file.folder_name` text without requiring folder list preload.
  - Upload-folder select now lazy-loads folders on first focus.

Public contracts impacted
- No API contract changes.
- Existing endpoint `POST /api/files/:id/folder` remains unchanged.

Validation status
- Build: PASSED (`pnpm run build`)
- Lint: PASSED (`pnpm run lint`)
- Type-check: PASSED (`pnpm exec tsc --noEmit`)

Handoff TestEngineer
- Verify initial dashboard/All Files load no longer triggers `/api/file-folders` until user opens Move dialog, clicks Browse folders, or focuses upload-folder select.
- Verify mobile and desktop move-to-folder flows (open modal, choose destination, move to root and nested folders).
- Verify existing folder operations after lazy load: browse folders, create folder, folder breadcrumbs, and share folder.

Handoff QaEngineer
- Validate performance improvement on accounts with large imported folder trees.
- Confirm UX is clear for first-time folder interactions (explicit Browse folders and modal loading states).

---
agent: DevEngineer | date: 2026-08-03 | model: GPT-5.3-Codex
plan: /memories/session/dev-plan.md
---

Intent
Executed the requested dependency upgrade set (Express, Vite toolchain, TypeScript, esbuild, lucide-react) on branch chore/dependency-major-upgrades with minimal compatibility fixes and full validation.

Change class
STANDARD

Files changed
- package.json, pnpm-lock.yaml:
  - express: 4 -> 5
  - @types/express: 4 -> 5
  - vite: 6 -> 8
  - @vitejs/plugin-react: 5 -> 6
  - typescript: 5 -> 7
  - esbuild: 0.25 -> 0.28
  - lucide-react: 0.x -> 1.x
  - removed @types/multer (replaced by local shim to avoid Express 4/5 type conflict)
- src/server.ts:
  - Added route-param normalization helper for Express 5 typings.
  - Added explicit req.file typing on AuthenticatedRequest.
  - Normalized id/downloadId/token path param uses.
  - Updated SPA fallback route from * to /{*path} for Express 5 compatibility.
- src/server/routes/public-sharing.ts:
  - Added route-param normalization helper.
  - Normalized token/fileId/downloadId param uses.
- src/server/routes/public-folder-sharing.ts:
  - Added route-param normalization helper.
  - Normalized token/fileId/downloadId param uses.
- src/app/shared/utils/client-file-secret.ts:
  - Normalized PBKDF2 salt buffer for TypeScript 7 DOM typings.
- src/app/shared/utils/download-with-progress.ts:
  - Normalized stream chunks for TypeScript 7 BlobPart typing compatibility.
- src/server/routes/maintenance-mode.ts:
  - Tightened log event type to shared SystemLog union.
- src/types/multer.d.ts:
  - Added local module shim for multer import typing.

Public contracts impacted
- No intentional API contract changes.
- Internal Express 5 path syntax change on SPA fallback route only (behavior preserved).

Validation status
- Type-check: PASSED (`pnpm lint`)
- Build: PASSED (`pnpm build`)
- Tests: PASSED (`pnpm exec tsx --test tests/desktop-updates-path.test.ts tests/profile-picture.test.ts tests/syntax-preview.test.ts tests/text-preview.test.ts`)
- Existing non-blocking warnings remain:
  - Vite native config warning about __dirname in vite.config.ts.
  - esbuild warning for import.meta in CJS output.
  - bundle chunk size advisory.

Handoff TestEngineer
- Focus regression checks on:
  - Express 5 route behavior for public share endpoints and vanity URLs.
  - Private download prepare/status/file flows using downloadId path params.
  - Profile picture upload flow (multer path + buffer handling).

Handoff QaEngineer
- Upgrade set is complete and validated at lint/build/test level; runtime smoke on deployed environment should confirm auth/csrf/session cookie flows and reverse-proxy behavior.

---

Intent
Ported theme-aware syntax highlighting for code-file previews to the PostgreSQL branch, preserving plain-text and CSV behavior.

Change class
STANDARD

Files changed
- `src/app/shared/components/common/text-file-preview.tsx`: added explicit Highlight.js grammars, filename-based language detection, escaped highlighted output, and a 512 KiB highlighting guard.
- `src/app/features/files/pages/user-dashboard.tsx`: passes private preview filenames to the shared renderer.
- `src/app/features/sharing/pages/public-download-page.tsx`: passes public preview filenames to the shared renderer.
- `src/index.css`: added dark/light theme syntax token colors.
- `package.json`, `pnpm-lock.yaml`: added Highlight.js and synchronized the pnpm dependency lock.
- `tests/syntax-preview.test.ts`: covers language mapping and escaped HTML rendering.

Public contracts impacted
- `TextFilePreview` requires a `fileName` prop; no HTTP API or database contract changed.

Validation status
- Focused preview tests: PASSED (7/7).
- Production build: PASSED.
- Touched-file diagnostics: PASSED.
- Existing build warnings remain: large Vite chunk and CommonJS `import.meta` warning.
- The legacy `package-lock.json` was already MSSQL-based and out of sync with the PostgreSQL manifest before this task. It remains unchanged; pnpm is the repository's validated package manager and `pnpm install --frozen-lockfile` passed.

Handoff TestEngineer
- Verify HTML, CSS/SCSS, JavaScript/TypeScript, JSON/YAML, SQL, and shell previews in public and authenticated views.
- Verify `.txt` and `.log` remain plain, CSV retains column colors, and code is displayed rather than executed.

Handoff QaEngineer
- Confirm theme contrast in dark, light, and Leeku themes and check a preview larger than 512 KiB falls back to responsive plain rendering.

---

---
agent: DevEngineer | date: 2026-07-25 | model: GPT-5.3-Codex
plan: /memories/session/dev-plan.md
---

Intent
Implemented social embed parity for folder share links so Discord, Meta/Facebook, and X can unfurl folder links with Open Graph/Twitter metadata, aligned with existing file-share behavior.

Change class
🟡 STANDARD

Files changed
- src/server/routes/public-folder-sharing.ts:
  - Added folder OG metadata HTML builder and route: `GET /api/public/folder/:token/og`.
  - Added crawler-aware response behavior: crawlers receive OG/Twitter HTML, non-crawlers auto-redirect to app hash route.
  - Added title/description format:
    - Title: `Folder name - Shared by username`
    - Description: `Folder name · number of files · Shared by username`
- src/server.ts:
  - Added vanity route rewrite: `GET /d/:token` -> internal dispatch to folder OG endpoint.
  - Updated `robots.txt` crawler allow-list to include `/d/` and `/api/public/folder/` alongside existing file-share paths.
- src/app/features/files/pages/user-dashboard.tsx:
  - Switched generated/copy folder share URLs from hash-only `/#d/:token` to crawler-friendly `/d/:token`.

Public contracts impacted
- Added API endpoint: `GET /api/public/folder/:token/og`
- Added vanity route: `GET /d/:token`
- Existing folder share/download APIs remain unchanged.

Validation status
- Build: PASSED (`pnpm build`)
- Type diagnostics for edited files: PASSED

Handoff notes
- TestEngineer focus:
  - Post a folder link using `/d/:token` in Discord, Meta Messenger/Facebook, and X; verify preview title/description now render.
  - Verify preview title matches: folder name plus uploader.
  - Verify preview description matches: folder name plus file count plus uploader.
  - Verify opening the same link in a normal browser redirects to hash route and loads shared folder page.
- QaEngineer focus:
  - Confirm additive route compatibility (legacy `/#d/:token` continues to work in-app).
  - Confirm no regression on file share embed route `/s/:token`.

---

## Intention
Corriger le cas "dossier existe" alors qu'il n'est pas visible dans My Leeku file, en rendant le conflit compréhensible et en éliminant les anciens uniques globaux hérités.

## Changement
Classe : STANDARD — 2 fichiers modifiés, correction ciblée, pas de refactor opportuniste.

## Fichiers
| Fichier | Raison |
|---|---|
| src/server.ts | Gestion fiable des conflits d'unicité PostgreSQL + enrichissement de la réponse 409 + migration de nettoyage des contraintes/index uniques legacy (owner_user_id, name) |
| src/app/features/files/pages/user-dashboard.tsx | En cas de 409 à la création: refresh dossiers, navigation vers le parent existant, message explicite (chemin réel ou zone système cachée) |

## Contrats publics impactés
OUI (additif, rétrocompatible): `POST /api/file-folders` conserve `error` et ajoute éventuellement `existing_folder`, `existing_folder_path`, `existing_folder_hidden_by_system_filter` lors d'un 409.

## Risques
Perf/Sécu/Régression/Compat : Faible / Faible / Faible / Faible.

## Dette observée
MINOR — Base de code avec quelques blocs SQL Server historiques encore présents dans branche PostgreSQL.

## Validation
Build: ✅  Lint: ❌  Type-check: ❌  Smoke: ⚠️SKIPPED

Détail validation:
- `pnpm build` : PASS
- `pnpm lint` (`tsc --noEmit`) : FAIL sur erreur préexistante non liée dans `src/server/routes/desktop-updates.ts` (incompatibilité de type `ISqlTypeWithLength`)

## Approbation CRITICAL
N/A

## Handoff TestEngineer
Surfaces à tester:
- Création dossier déjà existant même parent: vérifier message + absence de faux "disparus".
- Création dossier en conflit avec ancien unique global: vérifier message chemin et navigation parent.
- Conflit dans arborescence système cachée: vérifier message explicite.

## Handoff QaEngineer
Correction STANDARD livrée avec preuve build PASS, et échec type-check global préexistant documenté hors surface modifiée.

---

Intent
Ported the validated Android All Files view rendering fix to the PostgreSQL branch, preventing the files area from overflowing the phone viewport or appearing tiny/left-aligned.

Change class
🟡 STANDARD

Files changed
- src/app/features/files/pages/user-dashboard.tsx:
  - Added `min-w-0` and `overflow-x-hidden` constraints to the dashboard root, main, content shell, and files section.
  - Reduced phone padding around the dashboard content so file cards fit the usable viewport.
  - Forced mobile folder/file grids, cards, and controls to stay within `w-full min-w-0` containers.
  - Tightened mobile card spacing and thumbnail size.
  - Split file metadata into wrapping rows instead of dot-separated single lines.
  - Changed mobile file actions from three fixed columns to a phone-first stacked layout that becomes two columns on wider phones.

Public contracts impacted
- None. File data shape, routes, action handlers, and move-folder behavior remain unchanged.

Risks
- Low: responsive class-only UI change scoped to the dashboard/files layout and mobile All Files cards.
- Visual verification should include narrow Android viewports, long filenames, long file-type labels, and folder selector labels.

Test coverage status + handoff hint for test-engineer
- No automated tests added (out of scope for DevEngineer mode).
- Handoff focus:
  - Verify All Files mobile cards show file name, type, size, status, date, Download, Share, Delete, and folder selector without clipping or horizontal overflow.
  - Verify desktop file table remains unchanged.
  - Verify Download, Share, Delete, and move-folder actions still work from the mobile card.

Validation status
- file diagnostics: PASSED for `src/app/features/files/pages/user-dashboard.tsx`
- build: PASSED (`pnpm run build`)
- lint/type-check: PASSED (`pnpm run lint`)

Approval trail
- Not required (STANDARD change). User validated the MSSQL branch fix and requested the same changes on PostgreSQL on 2026-07-19.

---

Intent
Extended folder organization on the PostgreSQL branch to support nested sub-folders with a maximum depth of 5 (Google Drive-like hierarchy).

Change class
🔴 CRITICAL

Files changed
- src/app/shared/types/index.ts:
  - Added `parent_folder_id` to `FileFolder`.
- src/server.ts:
  - Added parent-aware folder model and depth validation (`MAX_FOLDER_DEPTH = 5`).
  - Updated folder list/create/rename APIs to include `parent_folder_id`.
  - Updated folder delete behavior to include descendants using recursive queries.
  - Updated PostgreSQL runtime schema migration to support parent folders, parent-scoped uniqueness, and parent-aware indexes.
- src/app/features/files/pages/user-dashboard.tsx:
  - Added nested navigation with breadcrumbs.
  - Added create-subfolder behavior in current context.
  - Added hierarchical folder path labels in file move selector.
- Documentation/SQL/postgresql_schema.sql:
  - Added `parent_folder_id` and parent-scoped uniqueness/index definitions for canonical PostgreSQL bootstrap schema.

Public contracts impacted
- Extended `FileFolder` payloads with `parent_folder_id`.
- `POST /api/file-folders` accepts optional `parent_folder_id` and enforces depth <= 5.
- Folder delete endpoint now applies subtree behavior for move/delete modes.

Validation status
- lint/type-check: pending final validation in this task.
- build: pending final validation in this task.

Approval trail
- User requested matching nested-folder support on PostgreSQL branch with max depth 5 on 2026-07-18.

---

Intent
Replicated the All Files folder organization feature onto the PostgreSQL branch with PostgreSQL-native runtime DDL and canonical bootstrap schema support.

Change class
🔴 CRITICAL

Files changed
- src/app/shared/types/index.ts:
  - Added `FileFolder` DTO.
  - Extended `FileMetadata` with nullable `folder_id` and `folder_name`.
- src/server.ts:
  - Added folder list/create/rename/delete APIs using PostgreSQL-compatible queries and `RETURNING`.
  - Added file move API for assigning files to folders or All Files root.
  - Extended file listing/admin listing/upload responses with folder metadata.
  - Added PostgreSQL runtime bootstrap for `file_folders`, `files.folder_id`, FK, and indexes.
- src/app/features/files/pages/user-dashboard.tsx:
  - Added folder navigation, folder cards, create/rename/delete controls, upload-to-current-folder, and per-file move selectors.
- Documentation/SQL/postgresql_schema.sql:
  - Added canonical PostgreSQL `file_folders` table, `files.folder_id`, indexes, and FK for fresh product deployments.

Public contracts impacted
- Added API endpoint: GET /api/file-folders
- Added API endpoint: POST /api/file-folders
- Added API endpoint: POST /api/file-folders/:id/rename
- Added API endpoint: POST /api/file-folders/:id/delete
- Added API endpoint: POST /api/files/:id/folder
- Extended `GET /api/files`, `GET /api/admin/files`, and upload responses with `folder_id` and `folder_name`.
- Extended upload requests with optional `folder_id`.

Risks
- Persistence contract changed; deployed PostgreSQL databases need the runtime bootstrap migration to run or equivalent SQL applied.
- Folder deletion with `delete_files=true` physically removes vault files and file rows for files in that folder.
- Folder names are unique per owner and limited to 120 characters.
- `FK files(folder_id) -> file_folders(id)` uses `ON DELETE NO ACTION`; the app clears or deletes folder files before deleting a folder.

Test coverage status + handoff hint for test-engineer
- No automated tests added (out of scope for DevEngineer mode).
- Handoff focus:
  - Verify create/rename/delete folder flows on PostgreSQL.
  - Verify folder-only delete moves files back to root.
  - Verify folder-plus-files delete removes rows, cascaded share links, vault files, and decrements storage.
  - Verify direct and resumable uploads target the selected folder.
  - Verify users cannot move files into another user's folder.

Validation status
- lint/type-check: PASSED (`pnpm lint`)
- build: PASSED (`pnpm build`)

Approval trail
- User requested replication onto `postgresql` branch on 2026-07-18.

---

Intent
Extended the large secret-protected file fix to private downloads by replacing remaining in-memory client-secret decrypt branches (and their 512 MB limits) with streaming decrypt.

Change class
🟡 STANDARD

Files changed
- src/server.ts:
  - `GET /api/files/:id/download` now uses `decryptClientProtectedFileInPlace(...)` instead of `readFileSync + decryptClientProtectedPayload`.
  - `POST /api/files/:id/download/prepare` background worker now also uses the streaming helper in finalization.
  - Removed hard 512 MB secret-protected guards in these private download paths.

Public contracts impacted
- No route/response shape changes.
- Existing secret-key requirement behavior remains unchanged.

Validation status
- build: PASSED (`pnpm run build`)
- Known unrelated baseline type issues remain in maintenance components / pre-existing server typing.

Handoff notes
- Verify private direct and prepared downloads for secret-protected files larger than 512 MB now succeed with correct secret key.
- Verify wrong secret key still returns the expected 403.

---

Intent
Removed public-sharing limitation that blocked secret-protected files over 512 MB by replacing in-memory decrypt with streaming decrypt in the share-download preparation pipeline.

Change class
🟡 STANDARD

Files changed
- src/server/utils/encryption.ts:
  - Added `decryptClientProtectedFileInPlace(...)` to decrypt client-secret payloads from disk using streaming I/O (ciphertext body stream + trailing GCM tag handling), then replace temp file in place.
- src/server/routes/public-sharing.ts:
  - Replaced in-memory `readFileSync + decryptClientProtectedPayload` logic and hard 512 MB guard with streaming in-place decrypt helper in `POST /api/public/share/:token/download` preparation worker.

Public contracts impacted
- No route/response shape changes.
- Existing secret_key requirement for protected shared files remains unchanged.

Root cause
- Public sharing path explicitly rejected client-secret protected payloads over 512 MB because decryption was implemented as in-memory buffer processing.

Validation status
- build: PASSED (`pnpm run build`)
- file-level compile errors: none in changed files.

Handoff notes
- Verify shared-link download for a secret-protected file larger than 512 MB now prepares and downloads successfully with correct secret key.
- Verify wrong secret key still returns the expected 403.

---

Intent
Follow-up hardening for Firefox large-secret uploads: fully disabled browser-side whole-file secret encryption in upload UI to eliminate observed size-collapse behavior (e.g., 8.4 GB to ~405 MB) and resulting archive corruption.

Change class
🟡 STANDARD

Files changed
- src/app/features/files/pages/user-dashboard.tsx:
  - Removed remaining browser-side secret encryption path (`encryptFileForUploadWithSecret`) from upload flow.
  - Secret-key upload now always sends key-only metadata and keeps original file bytes/sizes client-side.

Public contracts impacted
- No endpoint changes.
- Server-side key-only secret upload mode remains in effect.

Validation status
- build: PASSED (`pnpm run build`)
- type-check: FAILED only on pre-existing unrelated JSX namespace baseline issues.

Handoff notes
- Verify upload progress total no longer changes after selecting a custom secret key in Firefox.
- Verify downloaded archive integrity with correct secret key.

---

Intent
Fixed Firefox-specific corruption risk for large uploads using a custom secret key, where client-side whole-file encryption could produce truncated/corrupted payloads (observed as sudden size drop during upload and broken 7z after download).

Change class
🟡 STANDARD

Files changed
- src/app/features/files/pages/user-dashboard.tsx:
  - Added a size gate for browser-side secret encryption (`CLIENT_SECRET_BROWSER_ENCRYPT_MAX = 256 MB`).
  - For files above this threshold, client sends only `upload_secret_key` and skips whole-file browser encryption.
  - Keeps existing client encryption path for smaller files.
- src/server.ts:
  - Resumable uploads now forward `upload_secret_*` query parameters into `req.body` before shared validation.
  - Upload secret validation now supports key-only mode (no metadata) in addition to legacy metadata mode.
  - Added server-side fallback stage to apply secret payload protection when key is present but client metadata is absent.
- src/server/utils/encryption.ts:
  - Added `encryptClientProtectedFileInPlace(...)` (streaming, constant-memory) to encrypt temp file payload in the same ciphertext+auth-tag format expected by existing decrypt path.

Public contracts impacted
- No endpoint changes.
- Existing secret fields remain valid and backward compatible:
  - `upload_secret_key`
  - `upload_secret_salt_b64`
  - `upload_secret_iv_b64`
  - `upload_secret_iterations`

Root cause
- The custom-secret path encrypted the entire file in-browser (`file.arrayBuffer()` + WebCrypto AES-GCM).
- For very large files on Firefox/runtime combinations, this can cause payload truncation/corruption.
- Result: upload size may suddenly drop and downloaded archives become invalid.

Risks
- Low: Fallback introduces one additional local encryption pass on upload temp files when metadata is absent.
- Compatibility: Legacy clients sending full metadata continue unchanged.

Test coverage status + handoff hint for test-engineer
- No automated tests added (out of scope for DevEngineer mode).
- Handoff focus:
  - Firefox: upload very large file with custom secret key; confirm no mid-upload size collapse and downloaded 7z validates.
  - Confirm large secret-key resumable upload works both from fresh and resumed chunk state.
  - Confirm small secret-key uploads still use legacy client-encrypted metadata path and download decrypts correctly.
  - Confirm wrong secret key still yields the expected 403 behavior.

Validation status
- build: PASSED (`pnpm run build`)
- lint: FAILED (pre-existing baseline JSX namespace issues unrelated to this change)
- type-check: FAILED (same pre-existing baseline issues)

Approval trail
- Not required (STANDARD change).

---

Intent
Implemented GitHub issue #11 by adding an admin workflow to create user accounts with dummy emails and an explicit admin password reset action from the Users tab.

Change class
🟡 STANDARD

Files changed
- src/server.ts: Added admin endpoints for dummy account creation and password reset, including validation, duplicate checks, secure hashing, session revocation, and audit logging.
- src/app/features/files/components/admin-workspace.tsx: Added Users-tab UI for creating dummy users and a dedicated reset-password action button.

Public contracts impacted
- Added API endpoint: POST /api/admin/users/create-dummy
- Request body: { username: string, password: string, quota_id?: string }
- Response success: { success: true, user: User }
- Response errors: 400/500 with { error: string }
- Added API endpoint: POST /api/admin/users/:id/reset-password
- Request body: { password: string }
- Response success: { success: true, user: User }
- Response errors: 400/404/500 with { error: string }

Risks
- Security: Password reset currently uses prompt-based plaintext entry in the browser; functional but not ideal UX/privacy for shared screens.
- Regression: Dummy email derivation uses strict username-driven format; usernames with unsupported characters are rejected intentionally.
- Compatibility: Additive changes only; no existing endpoint contract changed.

Technical debt observed
- MAJOR: Repository lint baseline still reports unrelated JSX namespace issues in maintenance components.

Suggested follow-ups
- XS / MED: Replace prompt-based password reset with a secure modal input field and strength hints.
- S / HIGH: Add integration tests for admin dummy account create/reset flows and permission checks.
- XS / MED: Add server-side rate limiting specific to admin create/reset endpoints.

Test coverage status + handoff hint for test-engineer
- No automated tests were added.
- Handoff focus:
  - Verify admin can create dummy account and resulting email is username@dummy.local.
  - Verify duplicate username rejection and invalid password/username validation.
  - Verify reset-password endpoint revokes active refresh sessions and clears lockout counters.
  - Verify non-admin access is denied for both endpoints.

Validation status
- build: PASSED
  - npm run build completed successfully for frontend and server bundle.
- lint/type-check: UNVERIFIED in this task (known unrelated baseline failures exist in maintenance components).

Approval trail
- Not required (STANDARD change).

---

Intent
Fixed shared-link preview metadata compatibility for Facebook Messenger by making OG canonical URL crawler-safe and tightening HTML escaping in OG metadata output.

Change class
🟡 STANDARD

Files changed
- src/server/routes/public-sharing.ts: Updated OG HTML generation for share links to use a non-fragment preview URL for `og:url` and canonical, added `og:site_name` and `og:locale`, and improved attribute escaping to include `&` and `'`.
  - Second-pass hardening: added generic `og:image`/`twitter:image` fallback from built mascot asset, removed meta-refresh in favor of JS redirect, and added `Cache-Control: no-store` on OG HTML responses.
- src/server.ts: Updated `/s/:token` vanity route to internally dispatch to OG HTML handler instead of returning a `301` redirect, so crawlers receive metadata on first response.
- dist/irule.txt: Expanded social crawler bypass allowlist to include Meta crawler UA variants (`meta-externalagent`, `meta-externalfetcher`) for share preview paths.
  - Additional fix: allow both `GET` and `HEAD` methods for social crawler bypass on share preview paths because Meta unfurlers can send a `HEAD` probe before `GET`.
  - Final hardening: changed bypass to be UA-agnostic for `GET`/`HEAD` on preview-safe public paths (`/s/`, `/api/public/share/`, `/assets/`, `/robots.txt`) so unknown Meta crawler UA variants cannot be blocked by generic bot rules.
- src/server/routes/public-sharing.ts: Expanded crawler UA detection to include Meta crawler UA variants so crawler responses remain metadata-only (no JS redirect script).
- src/server.ts: Added explicit `/robots.txt` text response to prevent SPA HTML fallback at that path and ensure social unfurl crawlers receive a valid robots policy.
- src/server/routes/public-sharing.ts: Added optional `fb:app_id` Open Graph tag support via environment variable (`FACEBOOK_APP_ID` or `FB_APP_ID`) to satisfy Meta debugger requirements.

Public contracts impacted
- No route changes.
- Existing endpoints preserved:
  - GET /s/:token (vanity share URL)
  - GET /api/public/share/:token/og (OG HTML)

Risks
- Low: Messenger should parse metadata more reliably; Discord behavior should remain unchanged.
- Residual: Platforms cache OG metadata aggressively, so old previews may persist until cache refresh.

Technical debt observed
- No new debt introduced.

Suggested follow-ups
- XS / LOW: Add a static fallback `og:image` asset for richer previews across all social platforms.
- S / MED: Add an integration smoke test that validates OG tags for `/s/:token` and `/api/public/share/:token/og`.

Test coverage status + handoff hint for test-engineer
- No automated tests were added (out of scope for DevEngineer mode).
- Handoff focus:
  - Verify Messenger preview now shows title/description for fresh share links.
  - Verify Discord preview remains unchanged.
  - Verify filenames/uploader names containing `&`, `'`, `<`, `>` render correctly in metadata.

Validation status
- build: PASSED (`pnpm build`)
- lint: PASSED (`pnpm lint`)
- type-check: PASSED (`pnpm exec tsc --noEmit`)

Approval trail
- Not required (STANDARD change).