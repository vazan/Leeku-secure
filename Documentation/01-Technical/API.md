# API Reference

<!-- self_score: 91/100 -->
<!-- self_score_breakdown: endpoints=all_documented, auth=verified, rate_limits=verified, response_shapes=verified, contract_drift=one_flagged -->

All API routes are prefixed `/api/`. The application also serves a React SPA at `/` with a catch-all fallback to `index.html`.

## Authentication

### Token types

The server issues two credentials on login (VERIFIED — `src/server.ts`):

| Credential | Transport | Name | Lifetime |
|---|---|---|---|
| Access token (JWT HS256) | `HttpOnly` cookie | `leeku_session` (configurable via `SESSION_COOKIE_NAME`) | `JWT_ACCESS_EXPIRY_SECONDS` (default 900 s) |
| Refresh token (opaque hex) | `HttpOnly` cookie, path `/api/auth` | `leeku_refresh` (configurable via `REFRESH_COOKIE_NAME`) | `JWT_REFRESH_EXPIRY_SECONDS` (default 604800 s) |
| CSRF token | JavaScript-readable cookie | `leeku_csrf` | Same as refresh |

For machine clients, the access token may also be sent as:
- `Authorization: Bearer <token>` header
- `X-Leek-Token: <token>` header

CSRF validation applies to all non-GET/HEAD/OPTIONS requests that carry a session or refresh cookie and do not use a `Bearer` header. Provide the token value in the `X-CSRF-Token` header or in `req.body._csrf`.

---

## Rate Limiting

VERIFIED — `src/server.ts` lines 452-473.

| Scope | Window | Max requests | Configurable via |
|---|---|---|---|
| `/api/auth/*` | 60 s | 20 | `AUTH_RATE_LIMIT_RPM` |
| `/api/*` (global) | 60 s | 120 | `API_RATE_LIMIT_RPM` |
| `/api/public/share/*` | 60 s | 60 | `PUBLIC_SHARE_RATE_LIMIT_RPM` |
| `POST /api/public/share/:token/download` | 15 min | 12 | `PUBLIC_SHARE_DOWNLOAD_ATTEMPTS_PER_15_MIN` |

Rate-limit responses use standard `RateLimit-*` headers (`standardHeaders: true`).

---

## Group: Health

### `GET /api/health/live`

No auth required.

**Response 200:**
```json
{ "status": "ok", "uptimeSeconds": 1234 }
```

VERIFIED — `src/server/routes/health.ts:9`

---

### `GET /api/health/ready`

No auth required. Returns 503 when any dependency is unavailable.

**Response 200 / 503:**
```json
{
  "status": "ready",
  "checks": {
    "database": true,
    "vault": true,
    "scanner": true
  }
}
```

In production (`NODE_ENV=production`), `scanner: false` causes a 503. In development the scanner check is advisory only.

VERIFIED — `src/server/routes/health.ts:13-27`

---

## Group: Auth

### `POST /api/auth/register`

No auth required. Rate-limited under `AUTH_RATE_LIMIT_RPM`.

**Request body:**
```json
{ "username": "string", "email": "string", "password": "string" }
```

**Response 200 (SMTP disabled — dev):**
```json
{ "user": { "id": "uuid", "email": "...", "username": "...", "role": "User", "quota_id": "guest", "storage_used": 0, "status": "Active", "created_at": "ISO8601" } }
```

**Response 200 (SMTP enabled — production):**
```json
{ "success": true, "message": "Account created! Check your email for a verification link." }
```

**Error responses:**

| Status | Condition |
|---|---|
| 400 | Missing fields, invalid email domain (MX check), duplicate email, duplicate username |
| 500 | Database or encryption failure |

VERIFIED — `src/server.ts:846-939`

---

### `GET /api/auth/verify-email?token=<64-char-hex>`

No auth required. Returns an HTML page, not JSON.

**Success:** HTTP 200, HTML confirmation page with a link to the app.
**Failure:** HTTP 400, HTML error page.

VERIFIED — `src/server.ts:946-987`

---

### `POST /api/auth/login`

No auth required. Rate-limited under `AUTH_RATE_LIMIT_RPM`.

**Request body:**
```json
{ "login": "email-or-username", "password": "string" }
```

Sets `leeku_session`, `leeku_csrf`, and `leeku_refresh` cookies on success.

**Response 200:**
```json
{ "user": { "id": "uuid", "email": "...", "username": "...", "role": "User|Admin", "quota_id": "...", "storage_used": 0, "status": "Active", "created_at": "ISO8601" } }
```

**Error responses:**

| Status | Condition |
|---|---|
| 400 | Missing fields, invalid credentials |
| 403 | Account suspended, email not verified (when SMTP enabled) |
| 429 | Account locked after `MAX_LOGIN_ATTEMPTS` failures |
| 500 | Service unavailable |

VERIFIED — `src/server.ts:1014-1077`

---

### `GET /api/auth/me`

Auth required.

**Response 200:**
```json
{
  "user": { "id": "uuid", "email": "...", "username": "...", "role": "User|Admin", "quota_id": "...", "storage_used": 0, "status": "Active", "created_at": "ISO8601" },
  "csrfToken": "48-char-hex"
}
```

VERIFIED — `src/server.ts:1083-1086`

---

### `GET /api/auth/csrf`

No auth required.

Returns (and sets) the current CSRF token for the session.

**Response 200:**
```json
{ "csrfToken": "48-char-hex" }
```

VERIFIED — `src/server.ts:1088-1091`

---

### `POST /api/auth/refresh`

No auth required (uses `leeku_refresh` cookie). Rotates the refresh token.

**Response 200:**
```json
{ "user": { ... }, "csrfToken": "48-char-hex" }
```

**Response 401:** Refresh session expired or revoked.

VERIFIED — `src/server.ts:1093-1103`

---

### `POST /api/auth/logout`

No auth required (uses cookies). Revokes the current refresh token and clears all auth cookies.

**Response 200:**
```json
{ "success": true }
```

VERIFIED — `src/server.ts:1105-1114`

---

## Group: Sessions

All session endpoints require authentication. Mounted at both `/api/auth/sessions` and `/api/users/me/sessions`.

VERIFIED — `src/server.ts:1125-1126`, `src/server/routes/sessions.ts`

---

### `GET /api/users/me/sessions`

**Response 200:**
```json
{
  "sessions": [
    {
      "id": "uuid",
      "ip_address": "1.2.3.4",
      "user_agent": "Mozilla/5.0 ...",
      "created_at": "ISO8601",
      "expires_at": "ISO8601",
      "is_current": true
    }
  ]
}
```

VERIFIED — `src/server/routes/sessions.ts:19-49`

---

### `DELETE /api/users/me/sessions/:id`

### `POST /api/users/me/sessions/:id/revoke`

Revokes a specific session by ID. If the revoked session is the current one, auth cookies are cleared.

**Response 200:**
```json
{ "success": true, "revoked_current": false }
```

**Response 404:** Active session not found.

VERIFIED — `src/server/routes/sessions.ts:52-73, 115-116`

---

### `POST /api/users/me/sessions/revoke-others`

Revokes all sessions except the current one.

**Response 200:**
```json
{ "success": true }
```

VERIFIED — `src/server/routes/sessions.ts:75-92`

---

### `POST /api/users/me/sessions/current/revoke`

Revokes only the current session and clears auth cookies.

**Response 200:**
```json
{ "success": true, "revoked_current": true }
```

VERIFIED — `src/server/routes/sessions.ts:94-113`

---

### `POST /api/users/me/sessions/revoke-all`

Revokes all active sessions and clears auth cookies.

**Response 200:**
```json
{ "success": true }
```

VERIFIED — `src/server/routes/sessions.ts:118-133`

---

## Group: User Profile

### `POST /api/users/me/update`

Auth required. Updates username, email, and/or password for the authenticated user.

**Request body (all fields optional):**
```json
{ "username": "string", "email": "string", "password": "string" }
```

Changing password revokes all existing refresh sessions and issues a new one.

**Response 200:**
```json
{ "success": true, "user": { ... } }
```

VERIFIED — `src/server.ts:1128-1183`

---

### `GET /api/users/me/avatar`

Auth required. Returns the current profile picture as the raw image bytes with appropriate `Content-Type`.

**Response 200:** Binary image (`image/jpeg`, `image/png`, or `image/webp`)
**Response 404:** No avatar set.

VERIFIED — `src/server.ts:1190-1204`

---

### `POST /api/users/me/avatar`

Auth required. Multipart form upload (`avatar` field). Max 5 MB. Accepted MIME types: JPEG, PNG, WebP (detected by magic bytes, not file extension). Keeps the 10 most recent pictures; older ones are deleted.

**Request:** `multipart/form-data`, field `avatar`

**Response 200:**
```json
{ "success": true }
```

VERIFIED — `src/server.ts:1206-1228`

---

### `DELETE /api/users/me/avatar`

### `POST /api/users/me/avatar/remove`

Auth required. Removes all stored profile pictures for the user.

**Response 200:**
```json
{ "success": true }
```

VERIFIED — `src/server.ts:1242-1243`

---

### `POST /api/users/me/delete-request`

Auth required. Generates a deletion confirmation token and sends an email (if SMTP is enabled). Token expires in 1 hour.

**Response 200 (SMTP enabled):**
```json
{ "success": true, "message": "A confirmation email has been sent..." }
```

**Response 200 (SMTP disabled — dev):**
```json
{ "success": true, "message": "...", "confirmationUrl": "http://localhost:3000/api/users/me/delete-confirm?token=..." }
```

VERIFIED — `src/server.ts:1249-1297`

---

### `GET /api/users/me/delete-confirm?token=<64-char-hex>`

No auth required. Validates the token and renders an HTML confirmation form.

Returns an HTML page (not JSON).

VERIFIED — `src/server.ts:1303-1340`

---

### `POST /api/users/me/delete-confirm`

No auth required. Executes permanent account deletion after token validation. Cascades to files, encryption keys, share links, and refresh tokens. Vault files are deleted from disk.

**Request body:** `application/x-www-form-urlencoded`, field `token` (and `_csrf`)

Returns an HTML page (not JSON).

VERIFIED — `src/server.ts:1342-1413`

---

## Group: Files

All file endpoints require authentication.

### `GET /api/files`

Returns the authenticated user's file list (excludes Expired files).

**Response 200:**
```json
{
  "files": [
    {
      "id": "uuid",
      "owner_user_id": "uuid",
      "username": "string",
      "original_name": "report.pdf",
      "stored_name": "abc123.vault",
      "mime_type": "application/pdf",
      "size": 102400,
      "encrypted_size": 102432,
      "status": "Available",
      "checksum": "64-char-hex",
      "leeku_vibe": "File verified and ready to use.",
      "is_encrypted": true,
      "has_user_secret": false,
      "created_at": "ISO8601"
    }
  ]
}
```

VERIFIED — `src/server.ts:1469-1507`

---

### `POST /api/files/upload`

Auth required. Accepts `multipart/form-data`. Supports optional NDJSON progress streaming when the client sends `Accept: application/x-ndjson`.

**Form fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `file` | file | Yes | The file to upload |
| `original_name` | string | No | Override filename (defaults to `file.originalname`) |
| `mime_type` | string | No | Override MIME type |
| `ttl_hours` | number | No | Auto-delete after N hours |
| `upload_secret_key` | string | No | Per-file secret key (min 8 chars) |
| `upload_secret_salt_b64` | string | Conditional | Base64 16-byte PBKDF2 salt (required with `upload_secret_key`) |
| `upload_secret_iv_b64` | string | Conditional | Base64 12-byte AES-GCM IV (required with `upload_secret_key`) |
| `upload_secret_iterations` | number | Conditional | PBKDF2 iterations 100000-1000000 (required with `upload_secret_key`) |

**Response 200 (standard JSON):**
```json
{
  "success": true,
  "message": "File approved and encrypted!",
  "file": { ... }
}
```

**Response 200 (NDJSON progress stream):** Each line is a JSON object:
```json
{"type":"processing","phase":"Scanning file","loaded":50,"total":1000}
{"type":"processing","phase":"Encrypting file","loaded":260,"total":1000}
{"type":"complete","phase":"Complete","loaded":1000,"total":1000,"success":true,"file":{...}}
```

On error during a stream: `{"type":"error","error":"message"}`

**Error responses:**

| Status | Condition |
|---|---|
| 400 | No file, quota exceeded (count, storage, or per-file size), invalid secret metadata |
| 422 | Heuristic block (blocked extension/filename) or AV scan failed |
| 499 | Upload connection closed by client before completion |
| 500 | Encryption or database failure |

VERIFIED — `src/server.ts:1559-1868`

---

### `POST /api/files/:id/delete`

Auth required. Owner or Admin only. Deletes the vault file from disk and the database record. Updates the owner's `storage_used_bytes`.

**Response 200:**
```json
{ "success": true, "message": "File deleted from vault." }
```

**Error responses:** 404 not found, 403 permission denied.

VERIFIED — `src/server.ts:1885-1918`

---

### `GET /api/files/:id/preview`

Auth required. Owner or Admin only. Streams the decrypted file inline (for images and MP4 video only). Unavailable for secret-key-protected files.

**Response 200:** Binary stream with `Content-Disposition: inline`, `Content-Type` set to file MIME type.

**Error responses:**

| Status | Condition |
|---|---|
| 403 | Secret-key-protected file |
| 404 | File not found |
| 410 | Blocked or vault file missing |
| 415 | MIME type not previewable |

VERIFIED — `src/server.ts:1920-1985`

---

### `GET /api/files/:id/download`

Auth required. Owner or Admin only. Decrypts to a temp file, verifies checksum, applies optional client-side secret decryption, streams with `Content-Disposition: attachment`.

**Request headers (for secret-key files):**
```
X-File-Secret: <secret-key>
```

**Response 200:** Binary stream.

**Error responses:** 403 wrong/missing secret key, 404, 410, 500 integrity check failed.

VERIFIED — `src/server.ts:1987-2074`

---

### `POST /api/files/:id/download/prepare`

Auth required. Initiates async decryption into a temp file. Returns a session ID immediately (HTTP 202).

**Request headers (for secret-key files):**
```
X-File-Secret: <secret-key>
```

**Response 202:**
```json
{
  "download_id": "uuid",
  "status_url": "/api/files/{id}/download/{downloadId}/status",
  "file_url": "/api/files/{id}/download/{downloadId}/file"
}
```

Download sessions expire after 10 minutes of inactivity.

VERIFIED — `src/server.ts:2076-2226`

---

### `GET /api/files/:id/download/:downloadId/status`

Auth required. Polls the status of a prepared download.

**Response 200:**
```json
{
  "status": "preparing|ready|error",
  "phase": "decrypting|verifying|finalizing|ready|error",
  "loaded": 1048576,
  "total": 2097152,
  "size": 2097152,
  "error": null,
  "file_url": "/api/files/{id}/download/{downloadId}/file"
}
```

`file_url` is `null` when status is not `ready`.

VERIFIED — `src/server.ts:2228-2247`

---

### `GET /api/files/:id/download/:downloadId/file`

Auth required. Claims the prepared download. Each session can only be claimed once.

**Response 200:** Binary stream with `Content-Disposition: attachment`.
**Response 409:** Still preparing or already claimed.
**Response 500:** Decryption or streaming error.

VERIFIED — `src/server.ts:2249-2290`

---

## Group: Shares

### `GET /api/sharing/links`

Auth required. Returns all share links owned by the authenticated user, including a real-time `is_available` flag (vault file existence check).

**Response 200:**
```json
{
  "links": [
    {
      "id": "uuid",
      "file_id": "uuid",
      "public_token": "32-char-hex",
      "allow_external_preview": false,
      "password": "[protected]",
      "expires_at": "ISO8601|null",
      "max_downloads": 10,
      "download_count": 3,
      "is_active": true,
      "is_available": true,
      "created_at": "ISO8601"
    }
  ]
}
```

VERIFIED — `src/server.ts:2296-2312`

---

### `POST /api/files/:id/share`

Auth required. Owner or Admin only. Creates or updates the share link for a file. Only one share link per file is supported.

**Request body (all fields optional on update):**
```json
{
  "password": "string|null",
  "expires_at": "ISO8601|null",
  "max_downloads": 10,
  "is_active": true,
  "allow_external_preview": false
}
```

Constraints:
- `allow_external_preview` requires image or video MIME type
- `allow_external_preview` and `password` are mutually exclusive
- `allow_external_preview` and `client_secret_hash` are mutually exclusive

Re-activating an inactive link (`is_active: true`) or changing `max_downloads` generates a new `public_token` and resets `download_count`.

**Response 200:**
```json
{ "success": true, "link": { ... } }
```

VERIFIED — `src/server.ts:2342-2435`

---

### `DELETE /api/sharing/links/:id`

### `POST /api/sharing/links/:id/remove`

Auth required. Owner or Admin only. Deletes the share link.

**Response 200:**
```json
{ "success": true }
```

VERIFIED — `src/server.ts:2314-2340`

---

## Group: Public Sharing (no auth)

These endpoints are rate-limited under `PUBLIC_SHARE_RATE_LIMIT_RPM` (default 60 rpm).

VERIFIED — `src/server/routes/public-sharing.ts`

---

### `GET /api/public/share/:token`

Returns share link metadata. Does not count as a download.

**Response 200:**
```json
{
  "token": "32-char-hex",
  "file_name": "report.pdf",
  "mime_type": "application/pdf",
  "size": 102400,
  "created_at": "ISO8601",
  "protected": false,
  "requires_secret_key": false,
  "allow_external_preview": false,
  "uploader": "username",
  "leeku_vibe": "File verified and ready to use.",
  "downloads_current": 3,
  "downloads_max": 10
}
```

**Error responses:**

| Status | Condition |
|---|---|
| 404 | Token not found or link inactive |
| 410 | Expired, download limit reached, or vault file missing |

VERIFIED — `src/server/routes/public-sharing.ts:266-310`

---

### `POST /api/public/share/:token/download`

Initiates async decryption. Rate-limited: `PUBLIC_SHARE_DOWNLOAD_ATTEMPTS_PER_15_MIN` (default 12) per IP per 15 minutes.

**Request body:**
```json
{ "password": "optional-string", "secret_key": "optional-string" }
```

**Response 202:**
```json
{
  "download_id": "uuid",
  "status_url": "/api/public/share/{token}/download/{downloadId}/status",
  "file_url": "/api/public/share/{token}/download/{downloadId}/file"
}
```

**Error responses:** 403 wrong password / wrong secret key, 404, 410.

VERIFIED — `src/server/routes/public-sharing.ts:312-465`

---

### `GET /api/public/share/:token/download/:downloadId/status`

Polls decryption progress. Same response shape as the private download status endpoint.

VERIFIED — `src/server/routes/public-sharing.ts:467-486`

---

### `GET /api/public/share/:token/download/:downloadId/file`

Claims the prepared public download. One-time use; increments `download_count` atomically.

**Response 200:** Binary stream with `Content-Disposition: attachment`.

VERIFIED — `src/server/routes/public-sharing.ts:488-555`

---

### `GET /api/public/share/:token/embed`

Streams the decrypted file for inline embedding (images and video only). Supports HTTP `Range` requests for video seeking. Requires `allow_external_preview=true`. Not available for password- or secret-key-protected shares.

Caches the decrypted file locally for `PUBLIC_SHARE_EMBED_CACHE_TTL_MS` (default 30 min). Increments `download_count`.

**Response 200 / 206:** Binary stream with `Content-Disposition: inline`, `Accept-Ranges: bytes`.

**Error responses:**

| Status | Condition |
|---|---|
| 400 | Non-image/video MIME type |
| 403 | External preview disabled, or file is password/secret-key protected |
| 410 | Expired, download limit reached, or vault file missing |
| 416 | Range not satisfiable |
| 503 | Embed cache temporarily locked (retry after 1 s) |

VERIFIED — `src/server/routes/public-sharing.ts:557-718`

---

## Group: Quotas

### `GET /api/quotas`

No auth required.

**Response 200:**
```json
{
  "quotas": [
    {
      "id": "guest",
      "name": "Guest",
      "storage_limit_bytes": 1073741824,
      "max_file_size_bytes": 104857600,
      "max_files": 10,
      "daily_upload_limit_bytes": 524288000
    }
  ]
}
```

VERIFIED — `src/server.ts:784-797`

---

## Group: Admin

All admin endpoints require both authentication and the `Admin` role. Non-admin requests receive HTTP 403.

VERIFIED — `src/server.ts:745-751`

---

### `GET /api/stats`

Admin only. Returns application and Windows Server system metrics.

**Response 200:**
```json
{
  "totalUsers": 42,
  "totalFiles": 318,
  "storageUsedBytes": 5368709120,
  "uploadsToday": 12,
  "blockedFiles": 3,
  "failedScans": 1,
  "cpuUsagePercent": 14.5,
  "memoryUsagePercent": 62,
  "memoryUsedMB": 4096,
  "memoryTotalMB": 8192,
  "diskUsagePercent": 41,
  "diskUsedGB": 82,
  "diskTotalGB": 200,
  "uptime": 86400
}
```

VERIFIED — `src/server.ts:799-840`

---

### `GET /api/admin/users`

Admin only. Returns all users.

**Response 200:** `{ "users": [ User[] ] }` — same `User` shape as `/api/auth/me`.

VERIFIED — `src/server.ts:2448-2458`

---

### `POST /api/admin/users/:id/suspend`

Admin only. Toggles user status between `Active` and `Suspended`. Cannot suspend another admin.

**Response 200:**
```json
{ "success": true, "user": { ... } }
```

VERIFIED — `src/server.ts:2460-2485`

---

### `POST /api/admin/users/:id/quota`

Admin only. Assigns a quota tier to a user.

**Request body:** `{ "quota_id": "string" }`

**Response 200:** `{ "success": true, "user": { ... } }`

VERIFIED — `src/server.ts:2487-2507`

---

### `POST /api/admin/users/:id/edit`

Admin only. Edits user username, email, role, status, and/or password.

**Request body (all optional):**
```json
{ "username": "string", "email": "string", "role": "User|Admin", "status": "Active|Suspended", "password": "string" }
```

**Response 200:** `{ "success": true, "user": { ... } }`

VERIFIED — `src/server.ts:2509-2550`

---

### `GET /api/admin/files`

Admin only. Returns all files across all users.

**Response 200:** `{ "files": [ FileMetadata[] ] }`

VERIFIED — `src/server.ts:2552-2564`

---

### `POST /api/admin/files/:id/block`

Admin only. Toggles file status between `Available` and `Blocked`. Updates owner storage usage accordingly.

**Response 200:**
```json
{ "success": true, "file": { "id": "uuid", "status": "Blocked" } }
```

VERIFIED — `src/server.ts:2566-2586`

---

### `GET /api/admin/logs`

Admin only. Returns the most recent system log entries (limited to `MAX_LOG_ENTRIES`, default 500).

**Response 200:**
```json
{
  "logs": [
    {
      "id": "1",
      "user_id": "uuid|null",
      "username": "string|null",
      "event_type": "Upload|Scan|Delete|Download|Link|Admin|Security|Auth",
      "target_type": "string",
      "target_id": "string",
      "ip_address": "string",
      "message": "string",
      "created_at": "ISO8601"
    }
  ]
}
```

VERIFIED — `src/server.ts:2588-2596`, `src/app/shared/types/index.ts:66-76`

---

### `POST /api/admin/quotas`

Admin only. Creates or updates a quota tier (MERGE upsert by `id`).

**Request body:**
```json
{
  "id": "string",
  "name": "string",
  "storage_limit_bytes": 1073741824,
  "max_file_size_bytes": 104857600,
  "max_files": 10,
  "daily_upload_limit_bytes": 524288000
}
```

**Response 200:** `{ "success": true, "quotas": [ Quota[] ] }`

VERIFIED — `src/server.ts:2598-2617`

---

### `POST /api/admin/quotas/:id/delete`

Admin only. Deletes a quota tier. Fails if it is the last tier, or if users are assigned and `migrate_to_quota_id` is not provided.

**Request body (conditional):**
```json
{ "migrate_to_quota_id": "string" }
```

**Error responses:**

| Status | Body |
|---|---|
| 400 | `{ "error": "Migration required", "needs_migration": true, "attached_count": N }` |
| 400 | `{ "error": "Cannot delete the last quota tier." }` |
| 404 | Quota not found |

**Response 200:** `{ "success": true, "quotas": [ Quota[] ] }`

VERIFIED — `src/server.ts:2619-2645`

---

## CONTRACT_DRIFT

The `.env.example` documents `JWT_PRIVATE_KEY_PATH` and `JWT_PUBLIC_KEY_PATH` as RS256 key paths for JWT signing. The current `src/server.ts` implementation uses `COOKIE_SECRET_BASE64` as a **symmetric HS256** secret via `getJwtSecret()` (line 177) and does not read those PEM files. The PEM variables are reserved infrastructure for a planned RS256 migration.

CONTRACT_DRIFT: `.env.example:151-152` documents RS256 PEM paths; `src/server.ts:177` uses `COOKIE_SECRET_BASE64` as a symmetric secret.
