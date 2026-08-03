---

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
Reduced oversized Home "Recent files" tiles on phone screens by applying compact mobile-first sizing while preserving the existing desktop layout.

Change class
🟡 STANDARD

Files changed
- src/app/features/files/pages/user-dashboard.tsx:
  - Reduced mobile Recent files grid gap.
  - Switched FileCard to compact mobile spacing/padding.
  - Reduced mobile thumbnail height and corner overlay/control footprint.
  - Slightly reduced mobile filename/meta typography for denser cards.
  - Kept previous dimensions from `sm` and above.

Public contracts impacted
- None. No API, shared type, or route changes.

Validation status
- Edited file diagnostics: PASSED.
- Build: PASSED (`pnpm run build`).
- Workspace lint/type-check: FAILED only on existing unrelated baseline JSX namespace errors in maintenance components:
  - `src/app/shared/components/maintenance-mode-banner.tsx`
  - `src/app/shared/components/maintenance-mode-control.tsx`

Handoff notes
- TestEngineer focus:
  - Verify Home > Recent files on narrow Android/iOS widths displays smaller, denser tiles with no clipping.
  - Verify tile controls (menu, download) remain tappable and functional.
  - Verify desktop/tablet tile sizing remains unchanged.
- QaEngineer focus:
  - Validate no visual regression in non-Home file surfaces.
  - Confirm change is style-only and does not affect navigation/actions.

Approval trail
- Not required (STANDARD change).

---

Intent
Executed a low-risk dependency safe pass on `mssql` by updating `argon2` to the latest compatible release and applying the minimum TypeScript compatibility fix required by upstream type export changes.

Change class
🟡 STANDARD

Files changed
- package.json:
  - Updated `argon2` from `^0.44.0` to `^0.45.1`.
- pnpm-lock.yaml:
  - Refreshed lockfile for updated dependency graph.
- src/server/utils/encryption.ts:
  - Switched argon2 option typings from `argon2.Options` to `argon2.HashOptions` to align with `argon2@0.45.x` type exports.

Public contracts impacted
- None. No API endpoint, payload, or shared DTO changes.

Validation status
- Type-check: PASSED (`pnpm run lint`).
- Build: PASSED (`pnpm run build`).
- Tests: PASSED (`pnpm exec tsx --test tests/*.test.ts`) — 11 passed, 0 failed.

Deferred updates (higher risk)
- `express` 4 -> 5
- `@vitejs/plugin-react` 5 -> 6
- `vite` 6 -> 8
- `typescript` 5 -> 7
- `lucide-react` 0.x -> 1.x
- `esbuild` 0.25 -> 0.28 (0.x line; treat as migration)
- `@types/node` 22 -> 26
- `@types/express` 4 -> 5

Approval trail
- Not required (STANDARD change).

---

Intent
Aligned account email-change UX with security behavior by forcing immediate sign-out when re-verification is required.

Change class
🟡 STANDARD

Files changed
- src/server.ts:
  - For POST /api/users/me/update, when SMTP-enabled email change occurs and verification is reset, now revokes all refresh sessions, clears auth cookies, and returns `requires_reauth: true` with a user-facing message.
- src/app/features/files/pages/user-dashboard.tsx:
  - Updated profile-save handler to parse response payload.
  - If `requires_reauth` is true, show message and immediately run logout flow instead of showing generic “Profile updated.”

Public contracts impacted
- Response payload for successful `/api/users/me/update` now may include:
  - `requires_reauth: true`
  - `message: string`

Validation status
- Type-check: PASSED (`pnpm run lint`).
- Build: PASSED (`pnpm run build`).
- Tests: PASSED (`pnpm exec tsx --test tests/*.test.ts`) — 11 passed, 0 failed.

Handoff notes
- TestEngineer focus:
  - Change email in settings with SMTP enabled; verify success message and immediate logout.
  - Verify old session is invalidated and user must verify new email before login.
  - Verify username-only or password-only updates do not force logout unexpectedly.

Approval trail
- Not required (STANDARD change).

---

Intent
Fixed account settings email updates so changing a user email now triggers the confirmation workflow and sends a verification email.

Change class
🟡 STANDARD

Files changed
- src/server.ts:
  - Updated POST /api/users/me/update email branch to detect actual email changes.
  - Added MX validation for changed emails.
  - When SMTP is enabled, now regenerates verification token/expiry, marks email as unverified, and stores verification state.
  - Added async verification email send after successful update (non-blocking response path).

Public contracts impacted
- No route shape changes.
- Behavioral change: changing account email now requires re-verification when SMTP is enabled.

Validation status
- Type-check: PASSED (pnpm run lint).
- Build: PASSED (pnpm run build).
- Tests: PASSED (pnpm exec tsx --test tests/*.test.ts) — 11 passed, 0 failed.

Handoff notes
- TestEngineer focus:
  - Change email in Account Settings to a valid domain and confirm verification email is received.
  - Open verification link and confirm account can log in afterward.
  - Try invalid/no-MX domains and confirm update is rejected with clear error.
  - Confirm unchanged email submissions do not trigger a new verification cycle.
- QaEngineer focus:
  - Confirm no regression in username/password-only account updates.
  - Confirm SMTP-disabled environments keep existing behavior (no verification requirement).

Approval trail
- Not required (STANDARD change).

---

Intent
Patched the high-severity Nodemailer advisory by upgrading to a non-vulnerable version and re-validating the full project.

Change class
🟡 STANDARD

Files changed
- package.json:
  - Upgraded `nodemailer` from `^8.0.11` to `^9.0.3`.
- pnpm-lock.yaml:
  - Refreshed lockfile to resolve `nodemailer@9.0.3`.

Security advisory addressed
- GHSA-p6gq-j5cr-w38f
- Issue: message-level raw option bypass could allow arbitrary file-read and SSRF in delivered message construction.
- Vulnerable range: `<=9.0.0`
- Patched range: `>=9.0.1`

Public contracts impacted
- None. Existing email utility and API endpoint contracts remain unchanged.

Validation status
- Security audit: PASSED (`pnpm audit --json`) with zero vulnerabilities.
- Build: PASSED (`pnpm run build`).
- Type-check: PASSED (`pnpm run lint`).
- Tests: PASSED (`pnpm exec tsx --test tests/*.test.ts`) — 11 passed, 0 failed.
- Note: existing non-blocking build warning remains about `import.meta` in CJS output.

Handoff notes
- TestEngineer focus:
  - Smoke-check verification email, quota-change notification email, and account deletion confirmation email flows against staging SMTP.
- QaEngineer focus:
  - Confirm vulnerability closure evidence from audit output and dependency lock update.

Approval trail
- Not required (STANDARD change).

---

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

---

Intent
Added admin-side folder navigation in the Admin Files panel so admins can browse root folders, open subfolders by clicking, and delete folders/subtrees.

Change class
🟡 STANDARD

Files changed
- src/app/shared/types/index.ts:
  - Added `AdminFileFolder` shared type (`FileFolder` + owner username).
- src/server.ts:
  - Added `GET /api/admin/file-folders` to return folder tree metadata for all owners with decrypted owner usernames.
  - Added `POST /api/admin/file-folders/:id/delete` for admin folder-tree deletion with `delete_files` option.
- src/app/features/files/pages/user-dashboard.tsx:
  - Added admin folder data loading in `loadAdmin` and passed folders to AdminWorkspace.
- src/app/features/files/components/admin-workspace.tsx:
  - Added folder breadcrumb navigation state in Admin Files tab.
  - Added current-level folder cards with click-to-open behavior.
  - Added folder delete action with choice: delete contained files or move them to owner root.
  - Scoped file table to active folder context.

Public contracts impacted
- Added API endpoint: GET /api/admin/file-folders
- Added API endpoint: POST /api/admin/file-folders/:id/delete

Validation status
- Type diagnostics for edited files: PASSED.
- Workspace type-check: FAILED only on existing unrelated baseline JSX namespace issues in maintenance components.

Handoff notes
- Verify Admin > Files root shows only root-level folders.
- Verify opening folders reveals only direct subfolders and files in that folder.
- Verify deleting folder with files removal updates owner storage usage.
- Verify deleting folder without files moves files to the owner's root.

---

Intent
Fixed production startup crash caused by PostgreSQL SQL syntax accidentally present in MSSQL runtime queries.

Change class
🟡 STANDARD

Files changed
- src/server.ts:
  - Replaced PostgreSQL-only SQL with MSSQL syntax in startup migration helpers and route queries.
  - Restored MSSQL forms for recursive CTEs, duplicate-folder conflict queries, upsert quotas, and INSERT/UPDATE return payloads.
  - Restored SQL Server startup log wording.

Root cause
- Startup bootstrap executed `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` which is PostgreSQL syntax and invalid in SQL Server, causing fatal boot error near `client_secret_hash`.

Validation status
- Type diagnostics: PASSED for edited file.
- Build: PASSED (`pnpm build`).

Operational note
- Existing MSSQL environments should still run:
  - Documentation/SQL/2026-07-25-mssql-folder-and-share-migration.sql

---

Intent
Added and documented an idempotent MSSQL migration script based on the two modified files (`src/server.ts`, `src/app/features/files/pages/user-dashboard.tsx`) and aligned MSSQL schema documentation references/counts.

Change class
🟡 STANDARD

Files changed
- Documentation/SQL/2026-07-25-mssql-folder-and-share-migration.sql:
  - New idempotent migration script for `file_folders` parent-aware uniqueness, `files.folder_id` relation/index, optional file secret columns, and `share_links.allow_external_preview` integrity.
- Documentation/SQL/README.md:
  - Added migration script as documented patch step.
  - Updated schema counts and FK list to include folder hierarchy objects.
- Documentation/SQL/VALIDATION.md:
  - Updated expected counts (tables/procedures/FKs).
  - Added dedicated validation checks for folder hierarchy constraints and FKs.
- Documentation/SQL/production_schema.sql:
  - Fixed execution header filename reference and added note about the targeted migration script for existing environments.

Public contracts impacted
- None. Documentation and migration guidance only.

Validation status
- Manual consistency review completed for edited SQL documentation and migration script.

Intent
Fixed the Android All Files view rendering issue where the files area could overflow the phone viewport and appear tiny, left-aligned, or horizontally stretched.

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
- lint/type-check: FAILED only on existing unrelated JSX namespace baseline issues in maintenance components.

Approval trail
- Not required (STANDARD change).

---

Intent
Added user-managed folders inside All Files so users can organize files into per-user folders, move files between folders/root, upload directly into the selected folder, and choose folder-only or folder-plus-files deletion.

Change class
🔴 CRITICAL

Files changed
- src/app/shared/types/index.ts:
  - Added `FileFolder` DTO.
  - Extended `FileMetadata` with nullable `folder_id` and `folder_name`.
- src/server.ts:
  - Added file folder schema bootstrap for `file_folders` and `files.folder_id`.
  - Added folder list/create/rename/delete APIs.
  - Added `POST /api/files/:id/folder` to move files to a folder or All Files root.
  - Updated file listing/admin listing/upload mapping to include folder metadata.
  - Updated direct and resumable uploads to accept `folder_id`.
- src/app/features/files/pages/user-dashboard.tsx:
  - Added folder navigation in All Files, folder cards, create/rename/delete controls, upload-to-current-folder, and per-file move selectors.
- Documentation/SQL/production_schema.sql:
  - Added canonical `file_folders` table, `files.folder_id`, indexes, defaults, and foreign keys.

Public contracts impacted
- Added API endpoint: GET /api/file-folders
- Added API endpoint: POST /api/file-folders
- Added API endpoint: POST /api/file-folders/:id/rename
- Added API endpoint: POST /api/file-folders/:id/delete
- Added API endpoint: POST /api/files/:id/folder
- Extended `GET /api/files`, `GET /api/admin/files`, and upload responses with `folder_id` and `folder_name`.
- Extended upload requests with optional `folder_id`.

Risks
- Persistence contract changed; deployed databases need the bootstrap migration to run or equivalent SQL applied.
- Folder deletion with `delete_files=true` physically removes vault files and file rows for files in that folder.
- Folder names are unique per owner and limited to 120 characters.
- SQL Server does not allow `ON DELETE SET NULL` here because `users -> files` and `users -> file_folders -> files` create multiple cascade paths; `FK_files_file_folders` intentionally uses `ON DELETE NO ACTION`, and the app clears/moves folder files before deleting a folder.

Test coverage status + handoff hint for test-engineer
- No automated tests added (out of scope for DevEngineer mode).
- Handoff focus:
  - Verify creating, renaming, and deleting folders as a normal user.
  - Verify deleting only grouping moves files back to All Files root.
  - Verify deleting folder plus files removes file rows, vault files, share links via cascade, and decrements user storage usage.
  - Verify direct and resumable uploads target the selected folder.
  - Verify users cannot move files into another user's folder.

Validation status
- build: PASSED (`pnpm build`, rerun after SQL Server FK action correction)
- lint/type-check: FAILED only on existing unrelated JSX namespace baseline issues in maintenance components.

Approval trail
- User explicitly approved CRITICAL contract change with `GO` on 2026-07-18.

---

Intent
Updated project dependencies to current safe versions (patch/minor within existing major ranges), removed unused packages, and validated build/type-check/test stability.

Change class
🟡 STANDARD

Files changed
- package.json:
  - Removed unused dependencies: `date-fns`, `autoprefixer`.
  - Removed duplicate runtime `vite` entry from dependencies (kept in devDependencies).
  - Updated multiple dependency ranges to current releases within the same major.
- pnpm-lock.yaml:
  - Refreshed lockfile after dependency update and removals.
- src/app/shared/components/maintenance-mode-banner.tsx:
  - Added `type JSX` import from React to preserve JSX return typing compatibility with updated React type packages.
- src/app/shared/components/maintenance-mode-control.tsx:
  - Added `type JSX` import from React to preserve JSX return typing compatibility with updated React type packages.

Public contracts impacted
- None. No API route shape, request/response schema, or shared DTO contract changes.

Deferred updates (intentional)
- Left major-version upgrades for a dedicated migration pass due higher regression risk:
  - `express` 4 -> 5
  - `@vitejs/plugin-react` 5 -> 6
  - `vite` 6 -> 8
  - `typescript` 5 -> 7
  - `nodemailer` 8 -> 9
  - `lucide-react` 0.x -> 1.x

Validation status
- Build: PASSED (`pnpm run build`).
- Type-check: PASSED (`pnpm run lint`).
- Tests: PASSED (`pnpm exec tsx --test tests/*.test.ts`) — 11 passed, 0 failed.
- Note: existing non-blocking build warning remains about `import.meta` in CJS bundle output.

Handoff notes
- TestEngineer focus:
  - Run full app smoke checks on auth, file operations, sharing, admin maintenance controls, and email flows due dependency drift on core packages.
  - Confirm no runtime issue around updated `mssql`, `multer`, `express-rate-limit`, and `@google/genai` integrations.
- QaEngineer focus:
  - Validate release risk remains low because only non-major updates were applied and all current automated checks pass.
  - Track deferred major upgrades as a separate migration workstream.

Approval trail
- Not required (STANDARD change).

---

Intent
Extended All Files folders to support nested sub-folders on the MSSQL branch with a maximum depth of 5 (Google Drive-like hierarchy), plus recursive folder deletion behavior.

Change class
🔴 CRITICAL

Files changed
- src/app/shared/types/index.ts:
  - Added `parent_folder_id` to `FileFolder`.
- src/server.ts:
  - Added parent-aware folder model and max-depth enforcement (`MAX_FOLDER_DEPTH = 5`).
  - Updated folder list/create/rename APIs to include `parent_folder_id` and parent validation.
  - Updated folder delete API to operate on full descendant tree (move files to root or delete files recursively).
  - Updated runtime MSSQL schema bootstrap for `parent_folder_id`, self-FK, and parent-scoped uniqueness/indexing.
- src/app/features/files/pages/user-dashboard.tsx:
  - Added nested folder navigation with breadcrumbs.
  - Added create sub-folder behavior in current folder context.
  - Added hierarchical folder labels in move-file selector.
- Documentation/SQL/production_schema.sql:
  - Added `file_folders.parent_folder_id`, self-FK, and parent-scoped unique/index definitions.

Public contracts impacted
- Extended folder payloads (`/api/file-folders`) with `parent_folder_id`.
- `POST /api/file-folders` now accepts optional `parent_folder_id` and enforces max depth 5.
- Folder delete endpoints now apply to subtree descendants.

Validation status
- lint/type-check: FAILED only on existing unrelated baseline JSX namespace issues in maintenance components.
- build: PASSED (`pnpm build`)

Approval trail
- User approved CRITICAL nested folder change and requested max depth of 5 on 2026-07-18.

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