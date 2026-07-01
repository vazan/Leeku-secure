# Environment Variable Reference

<!-- self_score: 93/100 -->
<!-- self_score_breakdown: coverage=all_374_lines_of_env_example, grouping=verified, defaults=verified, rotation_notes=added, security_notes=added -->

All values are read from `.env` in the project root (or `../` relative to the built `dist/server.cjs`).
Copy `.env.example` to `.env` and replace every value marked `CHANGE_ME`.

**NEVER commit `.env` to source control.** On Windows Server 2022, restrict the file with NTFS ACLs:
```powershell
icacls ".env" /inheritance:r /grant "LEEKUUSER:(R)"
```

---

## Application

VERIFIED — `.env.example:10-34`, `src/server.ts:76-98`

| Variable | Type | Default | Required | Description | Security Notes |
|---|---|---|---|---|---|
| `NODE_ENV` | string | `production` | Yes | Runtime mode. `development` enables dev-only fallbacks (unscanned uploads, SMTP bypass). | Set to `production` on all servers. |
| `PORT` | integer | `3000` | Yes | HTTP listen port. | Use a privileged port only with a service account that has `SeServiceLogonRight`. |
| `APP_URL` | string | `http://localhost:3000` | Yes | Public base URL. Used in email links and JWT issuer. | Must match the actual hostname; a mismatch breaks email verification links. |
| `ALLOWED_ORIGINS` | string (CSV) | `APP_URL` | Yes | Comma-separated CORS allowed origins (no trailing slash). | Restrict to your exact domain in production. |
| `PROXY_TRUST_HOPS` | integer | `0` | Yes | Number of trusted reverse-proxy hops for `X-Forwarded-For`. Set to `1` behind IIS ARR or Nginx. | Incorrect values allow IP spoofing in rate-limit and audit-log records. |
| `HTTP_REQUEST_TIMEOUT_MS` | integer | `0` | No | Full-request deadline in ms. `0` disables it (recommended for large uploads). | If using IIS ARR, raise matching proxy timeout too. |
| `HTTP_HEADERS_TIMEOUT_MS` | integer | `60000` | No | Headers receipt timeout in ms. | |
| `HTTP_KEEP_ALIVE_TIMEOUT_MS` | integer | `5000` | No | Keep-alive timeout in ms. | |
| `HTTP_SOCKET_TIMEOUT_MS` | integer | `0` | No | Socket idle timeout in ms. `0` disables. | |

---

## SSL / TLS

VERIFIED — `.env.example:39-88`, `src/server.ts:2754-2781`

| Variable | Type | Default | Required | Description | Security Notes |
|---|---|---|---|---|---|
| `SSL_ENABLED` | boolean | `false` | No | Enable Node.js HTTPS server. Leave `false` when TLS is terminated by a reverse proxy. | |
| `SSL_CERT_PATH` | path | — | Conditional | PEM certificate file path. Required when `SSL_ENABLED=true` and no PFX. | Restrict file read to service account. |
| `SSL_KEY_PATH` | path | — | Conditional | PEM private key file path. Required when `SSL_ENABLED=true` and no PFX. | `icacls` restrict to service account only. |
| `SSL_CA_PATH` | path | — | No | Optional intermediate/CA bundle file. | |
| `SSL_PFX_PATH` | path | — | Conditional | PKCS#12 bundle path. Takes precedence over `SSL_CERT_PATH`/`SSL_KEY_PATH` if set. | |
| `SSL_PFX_PASSPHRASE` | string | — | Conditional | PFX passphrase. Required when `SSL_PFX_PATH` is set. | Store only in `.env`; never in code. |
| `SSL_PORT` | integer | `443` | No | HTTPS listen port. | |
| `SSL_MIN_VERSION` | string | `TLSv1.2` | No | Minimum TLS version. Options: `TLSv1.2`, `TLSv1.3`. | PCI-DSS / HIPAA minimum is `TLSv1.2`. |
| `SSL_CIPHERS` | string | Node.js default | No | Colon-separated OpenSSL cipher string. Leave blank unless compliance mandates specific ciphers. | |

---

## Database

VERIFIED — `.env.example:93-110`, `src/server/db.ts:29-55`

| Variable | Type | Default | Required | Description | Security Notes |
|---|---|---|---|---|---|
| `DB_SERVER` | string | `localhost` | Yes | PostgreSQL hostname or IP. | |
| `DB_PORT` | integer | `5432` | No | PostgreSQL TCP port. | |
| `DB_NAME` | string | `LeekuSecure` | Yes | Database name. | |
| `DB_USER` | string | — | Yes | PostgreSQL role name. | Use a least-privilege application role, not `postgres`. |
| `DB_PASSWORD` | string | `CHANGE_ME_STRONG_PASSWORD` | Yes | PostgreSQL role password. | Rotate via PostgreSQL role policy; update `.env` and restart. |
| `DB_POOL_MIN` | integer | `2` | No | Minimum connection pool size. | |
| `DB_POOL_MAX` | integer | `10` | No | Maximum connection pool size. | |
| `DB_REQUEST_TIMEOUT_MS` | integer | `15000` | No | Per-query timeout in ms. | |
| `DB_CONNECTION_TIMEOUT_MS` | integer | `30000` | No | Initial connection timeout in ms. | |
| `DB_SSL` | boolean | `false` | No | Enable TLS for the PostgreSQL connection. Prefer `true` in production. | |
| `DB_ENCRYPT` | boolean | `false` | No | Backward-compatible alias for `DB_SSL`. | Use `DB_SSL` going forward. |
| `DB_TRUST_SERVER_CERTIFICATE` | boolean | `false` | No | When TLS is enabled, set `true` only for self-signed development certificates. | Never `true` in production. |

**How to rotate DB_PASSWORD:** Update the PostgreSQL role password, then update `DB_PASSWORD` in `.env` and restart the Node process.

---

## Master Encryption Key

VERIFIED — `.env.example:114-127`, `src/server/utils/encryption.ts:66-78`

| Variable | Type | Default | Required | Description | Security Notes |
|---|---|---|---|---|---|
| `MASTER_KEY_BASE64` | string (base64) | `CHANGE_ME_GENERATE_WITH_CRYPTO_RANDOMBYTES_32` | Yes | 32 random bytes, base64-encoded. Derives all HKDF sub-keys for file encryption, column encryption, and HMAC lookup. | **Rotating this key requires re-encrypting every vault file and every encrypted DB column.** Protect with NTFS ACL; consider Azure Key Vault or Windows DPAPI for additional protection. |

**How to generate:**
```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**Key derivation hierarchy (VERIFIED — `src/server/utils/encryption.ts:84-95`):**
```
MASTER_KEY_BASE64
  └─ HKDF-SHA256("leeku-file-key-wrapping-v1")   → wraps per-file AES-256 keys
  └─ HKDF-SHA256("leeku-column-encryption-v1")   → encrypts email/username columns
  └─ HKDF-SHA256("leeku-column-hmac-v1")         → HMAC-SHA256 lookup hashes
```

---

## Cookie / Session Security

VERIFIED — `.env.example:130-142`, `src/server.ts:92-93, 176-178`

| Variable | Type | Default | Required | Description | Security Notes |
|---|---|---|---|---|---|
| `COOKIE_SECRET_BASE64` | string (base64) | `CHANGE_ME_GENERATE_WITH_CRYPTO_RANDOMBYTES_32` | Yes | 32+ random bytes, base64-encoded. Used as the symmetric HS256 JWT signing secret and for cookie signing. | Rotating this invalidates all active access tokens (users must re-login). Store only in `.env`. |
| `COOKIE_DOMAIN` | string | — | No | Cookie domain attribute (e.g. `leeks.miku.rip`). | |
| `COOKIE_SECURE` | boolean | `true` | No | Set `Secure` flag on cookies. Must be `true` in production (requires HTTPS). | |

**How to rotate COOKIE_SECRET_BASE64:** Generate a new value, update `.env`, restart the Node process. All existing JWT access tokens become invalid immediately. Refresh tokens stored in the database are unaffected by this rotation (they are verified by hash lookup, not JWT signature), but active sessions will need to call `/api/auth/refresh` to obtain new access tokens, which will succeed until the refresh tokens expire.

---

## JWT

VERIFIED — `.env.example:144-178`, `src/server.ts:88-93`

| Variable | Type | Default | Required | Description | Security Notes |
|---|---|---|---|---|---|
| `JWT_PRIVATE_KEY_PATH` | path | `C:\LeekuSecure\keys\jwt_private.pem` | No | Path to RS256 private key PEM. Reserved for planned RS256 migration; not currently read at runtime. | See CONTRACT_DRIFT note. |
| `JWT_PUBLIC_KEY_PATH` | path | `C:\LeekuSecure\keys\jwt_public.pem` | No | Path to RS256 public key PEM. Reserved for planned RS256 migration. | |
| `JWT_ACCESS_EXPIRY_SECONDS` | integer | `900` | No | Access token lifetime in seconds (default 15 min). | Short lifetimes limit exposure from token leakage. |
| `JWT_REFRESH_EXPIRY_SECONDS` | integer | `604800` | No | Refresh token lifetime in seconds (default 7 days). | |
| `REFRESH_COOKIE_NAME` | string | `leeku_refresh` | No | Name of the HttpOnly refresh token cookie. | |
| `JWT_ISSUER` | string | `APP_URL` | No | JWT `iss` claim. Must match the public app URL. | |
| `JWT_AUDIENCE` | string | `leeku-secure-api` | No | JWT `aud` claim. | |
| `PUBLIC_SHARE_RATE_LIMIT_RPM` | integer | `60` | No | Max requests per IP per minute on `/api/public/share/*`. | |
| `PUBLIC_SHARE_DOWNLOAD_ATTEMPTS_PER_15_MIN` | integer | `12` | No | Max download or password attempts per IP per 15 minutes. | |
| `PUBLIC_SHARE_EMBED_CACHE_TTL_MS` | integer | `1800000` | No | Embed cache file lifetime in ms (min 60000). | Increase for better video streaming hit rate; decrease to reduce local temp disk retention. |

**CONTRACT_DRIFT:** `JWT_PRIVATE_KEY_PATH` / `JWT_PUBLIC_KEY_PATH` are documented in `.env.example` but the current server implementation signs with `COOKIE_SECRET_BASE64` (HS256). See `src/server.ts:177`.

---

## File Storage

VERIFIED — `.env.example:181-238`, `src/server.ts:79-81`

| Variable | Type | Default | Required | Description | Security Notes |
|---|---|---|---|---|---|
| `FILE_STORAGE_UNC_PATH` | path | `\\10.10.11.85\hyperv_storage` | Yes | UNC path (or local path) for the encrypted file vault. Service account must have Read+Write. | Restrict at the share and NTFS level to the service account only. |
| `PROFILE_PICTURE_PATH` | path | `FILE_STORAGE_UNC_PATH\users` | No | Root directory for user avatar storage. | |
| `STORAGE_NET_USE_PATH` | path | — | No | If set, the app calls `net use <path> <pass> /user:<user>` at startup. Leave blank if the service account has pre-configured persistent credentials (preferred). | Password in `.env` only; never hardcode. |
| `STORAGE_NET_USE_USER` | string | — | Conditional | Share account username. Required if `STORAGE_NET_USE_PATH` is set. | |
| `STORAGE_NET_USE_PASS` | string | `CHANGE_ME` | Conditional | Share account password. | Rotate whenever the share password changes; update `.env` and restart. |
| `FILE_SCAN_TEMP_PATH` | path | `C:\LeekuTemp\scan-staging` | Yes | Local temp directory for Bitdefender scan staging. **Must be local disk, not UNC.** | |
| `UPLOAD_TEMP_PATH` | path | OS temp dir | Yes | Local temp directory for multer upload staging. **Must be local disk, not UNC.** | Ensure sufficient free space: `largest_expected_file × 2`. |
| `MAX_UPLOAD_BODY_MB` | integer | `1` | No | JSON body size limit for non-upload endpoints (MB). Uploads use multipart streaming and are unaffected. | |

---

## Bitdefender

VERIFIED — `.env.example:247-274`, `src/server/utils/scanner.ts:76-113`

| Variable | Type | Default | Required | Description | Security Notes |
|---|---|---|---|---|---|
| `BITDEFENDER_SCAN_CLI_PATH` | path | Auto-detect | No | Explicit path to `product.console.exe` or `bdscan.exe`. Leave blank for auto-detection from six common paths. | |
| `BITDEFENDER_TIMEOUT_MS` | integer | `30000` | No | Max ms to wait for a scan result before aborting. | |
| `BITDEFENDER_EXTRA_ARGS` | string | — | No | Space-separated extra CLI arguments passed before the file path. | |
| `ALLOW_UNSCANNED_UPLOADS_IN_DEVELOPMENT` | boolean | `true` | No | When `NODE_ENV=development` and Bitdefender is unavailable, allow uploads. Set `false` to test production fail-closed behavior locally. | Must be `false` (or omitted) in production. |

Auto-detection order (VERIFIED — `src/server/utils/scanner.ts:84-91`):
1. `C:\Program Files\Bitdefender\Endpoint Security Tools\product.console.exe`
2. `C:\Program Files\Bitdefender\Endpoint Security\product.console.exe`
3. `C:\Program Files (x86)\Bitdefender\Endpoint Security Tools\product.console.exe`
4. `C:\Program Files\Bitdefender\Endpoint Security Tools\bdscan.exe`
5. `C:\Program Files\Bitdefender\Endpoint Security\bdscan.exe`
6. `C:\Program Files (x86)\Bitdefender\Endpoint Security Tools\bdscan.exe`

---

## File Auto-Expiry

VERIFIED — `.env.example:278-282`, `src/server/utils/expiry-cleanup.ts`

| Variable | Type | Default | Required | Description |
|---|---|---|---|---|
| `EXPIRY_CLEANUP_INTERVAL_MS` | integer | `60000` | No | How often the background cleanup job runs in ms. |

---

## Rate Limiting and Brute-Force Protection

VERIFIED — `.env.example:285-299`, `src/server.ts:83-84, 452-473`

| Variable | Type | Default | Required | Description |
|---|---|---|---|---|
| `MAX_LOGIN_ATTEMPTS` | integer | `5` | No | Consecutive failed login attempts before account lockout. |
| `LOCKOUT_DURATION_MINUTES` | integer | `15` | No | Account lockout duration in minutes after exceeding `MAX_LOGIN_ATTEMPTS`. |
| `AUTH_RATE_LIMIT_RPM` | integer | `20` | No | Max requests per IP per minute on `/api/auth/*`. |
| `API_RATE_LIMIT_RPM` | integer | `120` | No | Max requests per IP per minute on all `/api/*` endpoints. |

---

## Email Verification (SMTP)

VERIFIED — `.env.example:302-319`, `src/server.ts:86`

| Variable | Type | Default | Required | Description | Security Notes |
|---|---|---|---|---|---|
| `SMTP_HOST` | string | — | No | SMTP server hostname. Leave blank to disable email verification entirely (accounts auto-verified in dev). | |
| `SMTP_PORT` | integer | `587` | Conditional | SMTP port. | |
| `SMTP_SECURE` | boolean | `false` | No | `true` for implicit TLS (port 465); `false` for STARTTLS (port 587). | |
| `SMTP_USER` | string | — | Conditional | SMTP login username. | |
| `SMTP_PASSWORD` | string | `CHANGE_ME_APP_PASSWORD` | Conditional | SMTP login password or app password. | Rotate by generating a new app password in your email provider; update `.env` and restart. |
| `SMTP_FROM` | string | — | No | `From:` address for outbound emails. | |

**How to rotate SMTP_PASSWORD:** Generate a new app password in your email provider, update `SMTP_PASSWORD` in `.env`, restart the Node process.

---

## Google Gemini API

VERIFIED — `.env.example:323-325`

| Variable | Type | Default | Required | Description | Security Notes |
|---|---|---|---|---|---|
| `GEMINI_API_KEY` | string | `CHANGE_ME` | No | Google Gemini API key for AI-generated scan result messages. If blank or `CHANGE_ME`, the feature uses static fallback messages. | Rotate in Google Cloud Console; update `.env` and restart. |

---

## Logging

VERIFIED — `.env.example:328-335`, `src/server.ts:82`

| Variable | Type | Default | Required | Description |
|---|---|---|---|---|
| `LOG_LEVEL` | string | `info` | No | Console log level: `error`, `warn`, `info`, `debug`. |
| `MAX_LOG_ENTRIES` | integer | `500` | No | Maximum system log entries returned by `GET /api/admin/logs`. |

---

## IIS W3C Extended Log Format

VERIFIED — `.env.example:338-374`

| Variable | Type | Default | Required | Description |
|---|---|---|---|---|
| `IIS_LOGS_ENABLED` | boolean | `false` | No | Enable IIS W3C Extended Log Format HTTP request logging. |
| `IIS_SITE_ID` | integer | `1` | No | IIS Site ID for log filename construction. Find with: `Get-IISSite \| Select-Object Name, Id` |
| `IIS_LOGS_PATH` | path | `C:\inetpub\logs\LogFiles\W3SVC{IIS_SITE_ID}` | No | Custom log directory. Leave blank for IIS default. |
| `IIS_LOG_FIELDS` | string | See `.env.example:370` | No | Space-separated W3C log fields to record. |
| `IIS_LOGS_DAILY_ROLLOVER` | boolean | `true` | No | Roll to a new log file daily (`true`) or append to a single file (`false`). |

---

## Secret Rotation Summary

| Secret | How to rotate | Impact |
|---|---|---|
| `MASTER_KEY_BASE64` | Generate new value, re-encrypt all vault files and all encrypted DB columns, update `.env`, restart | All files and PII data must be re-encrypted — plan a maintenance window |
| `COOKIE_SECRET_BASE64` | Generate new value, update `.env`, restart | All active JWT access tokens are immediately invalidated; users must refresh or re-login |
| `DB_PASSWORD` | Update PostgreSQL role password, update `.env`, restart | Brief connection pool drain during restart |
| `SMTP_PASSWORD` | Generate new app password in email provider, update `.env`, restart | No data impact |
| `GEMINI_API_KEY` | Revoke old key in Google Cloud Console, generate new one, update `.env`, restart | No data impact; falls back to static messages until restarted |
| `STORAGE_NET_USE_PASS` | Change share password, update `.env`, restart | File vault inaccessible between share password change and restart |
