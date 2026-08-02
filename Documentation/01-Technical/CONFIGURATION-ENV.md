# Configuration and Environment

Date: 2026-07-07  
Scope: Shared environment catalog with branch-specific deltas

## 1. Source Evidence

- Leeku-MSSQL/.env.example
- Leeku-POSTGRESQL/.env.example
- Leeku-MSSQL/src/server.ts
- Leeku-POSTGRESQL/src/server.ts
- Leeku-MSSQL/src/server/db.ts
- Leeku-POSTGRESQL/src/server/db.ts
- Leeku-MSSQL/src/server/utils/production.ts
- Leeku-MSSQL/src/server/utils/scanner.ts
- Leeku-MSSQL/src/server/utils/email.ts
- Leeku-MSSQL/src/server/middleware/iis-logger.ts

## 2. Shared Variable Groups

### 2.1 Core runtime
- NODE_ENV
- PORT
- APP_URL
- ALLOWED_ORIGINS
- PROXY_TRUST_HOPS

### 2.2 HTTP and server timeouts
- HTTP_REQUEST_TIMEOUT_MS
- HTTP_HEADERS_TIMEOUT_MS
- HTTP_KEEP_ALIVE_TIMEOUT_MS
- HTTP_SOCKET_TIMEOUT_MS

### 2.3 Security and identity
- MASTER_KEY_BASE64
- COOKIE_SECRET_BASE64
- JWT_ACCESS_EXPIRY_SECONDS
- JWT_REFRESH_EXPIRY_SECONDS
- JWT_ISSUER
- JWT_AUDIENCE
- SESSION_COOKIE_NAME
- REFRESH_COOKIE_NAME
- CSRF_COOKIE_NAME
- COOKIE_SECURE

### 2.4 Storage and paths
- FILE_STORAGE_UNC_PATH
- PROFILE_PICTURE_PATH
- FILE_SCAN_TEMP_PATH
- UPLOAD_TEMP_PATH
- UNC_SHARE_HEALTHCHECK_INTERVAL_MS
- Optional net use variables for UNC mounting path and credentials

### 2.5 Scanner and upload controls
- BITDEFENDER_SCAN_CLI_PATH
- BITDEFENDER_TIMEOUT_MS
- BITDEFENDER_EXTRA_ARGS
- ALLOW_UNSCANNED_UPLOADS_IN_DEVELOPMENT
- PUBLIC_SHARE_DOWNLOAD_ATTEMPTS_PER_15_MIN
- PUBLIC_SHARE_PREVIEW_ATTEMPTS_PER_15_MIN
- PUBLIC_SHARE_EMBED_CACHE_TTL_MS

### 2.6 Mail and notifications
- SMTP_HOST
- SMTP_PORT
- SMTP_SECURE
- SMTP_USER
- SMTP_PASSWORD
- SMTP_TLS_REJECT_UNAUTHORIZED

### 2.7 Logging and operations
- MAX_LOG_ENTRIES
- IIS_LOGS_ENABLED
- IIS_SITE_ID
- IIS_LOGS_PATH
- IIS_LOG_FIELDS
- IIS_LOGS_DAILY_ROLLOVER

## 3. Production Guardrails (Code-Evidenced)

In production mode, startup validation requires non-placeholder values for:
- APP_URL
- ALLOWED_ORIGINS
- MASTER_KEY_BASE64
- COOKIE_SECRET_BASE64
- DB_SERVER
- DB_USER
- DB_PASSWORD
- FILE_STORAGE_UNC_PATH
- UPLOAD_TEMP_PATH

Additional production guardrails:
- scanner must be available
- COOKIE_SECURE cannot be false
- vault path must be readable and writable

Evidence:
- Leeku-MSSQL/src/server/utils/production.ts

## 4. DB Delta Matrix

| Variable | MSSQL branch | PostgreSQL branch | Evidence |
|---|---|---|---|
| DB_PORT default | 1433 | 5432 | Leeku-MSSQL/src/server/db.ts, Leeku-POSTGRESQL/src/server/db.ts |
| DB_ENCRYPT | primary SQL Server TLS toggle | compatibility alias accepted | Leeku-MSSQL/src/server/db.ts, Leeku-POSTGRESQL/src/server/db.ts |
| DB_SSL | not primary in adapter | primary SSL toggle | Leeku-POSTGRESQL/src/server/db.ts |
| DB_TRUST_SERVER_CERTIFICATE | used by driver options | affects SSL reject behavior | Leeku-MSSQL/src/server/db.ts, Leeku-POSTGRESQL/src/server/db.ts |

## 5. Secret Handling Rules

- Never publish real secret values in documentation.
- Use [REDACTED] when examples require placeholders.
- Treat DB passwords, SMTP credentials, key material, and private key files as secrets.

Evidence:
- Leeku-MSSQL/.env.example
- Leeku-POSTGRESQL/.env.example

## 6. Explicit Unknowns

- Unknown: one authoritative env catalog generated from all process.env usage across both branches.
- Unknown: complete required vs optional classification for every variable in one canonical artifact.
- Unknown: branch policy for conflicting docs trees (Documentation and Documentations) as single source of truth.
