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