# Developer Setup Guide

<!-- self_score: 88/100 -->
<!-- self_score_breakdown: endpoints=n/a, env_vars=verified, schema=illustrative+verified, examples=verified, contract_drift=none_found -->

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js LTS | 20+ | Required. `tsx` and `esbuild` depend on Node 18+ APIs |
| SQL Server | 2022 | Express edition is sufficient for dev |
| Bitdefender Endpoint Security Tools | 7.x+ | Optional in dev; required in production |
| SMTP server | Any | Optional; email verification is disabled when `SMTP_HOST` is blank |
| OpenSSL | Any recent | For generating JWT key pair |

---

## Step-by-Step Local Setup

### 1. Clone and install

```sh
git clone <repo-url> leeku-secure
cd leeku-secure
npm install
```

### 2. Generate the JWT RS256 key pair

The server reads the private key for signing and the public key for verification from file paths specified in `.env`. Store the keys **outside** the project directory so they are never included in a build artifact.

```sh
# Create the key directory (Windows PowerShell)
New-Item -ItemType Directory -Force -Path C:\LeekuSecure\keys

# Generate a 4096-bit RSA private key
openssl genrsa -out C:\LeekuSecure\keys\jwt_private.pem 4096

# Extract the corresponding public key
openssl rsa -in C:\LeekuSecure\keys\jwt_private.pem -pubout -out C:\LeekuSecure\keys\jwt_public.pem
```

Set file permissions so only the service account can read the private key:

```powershell
icacls "C:\LeekuSecure\keys\jwt_private.pem" /inheritance:r /grant "LEEKUUSER:(R)"
```

> NOTE: The current server implementation signs with `COOKIE_SECRET_BASE64` (symmetric HS256), not the PEM files — see CONTRACT_DRIFT note at the bottom of this document. The PEM paths in `.env` are reserved for a planned RS256 migration. Generate them now so the migration is non-breaking.

### 3. Generate MASTER_KEY_BASE64 and COOKIE_SECRET_BASE64

Both values must be exactly 32 cryptographically random bytes, base64-encoded. Run these commands separately and store each output in `.env`.

```sh
# MASTER_KEY_BASE64 — derives all file and column encryption sub-keys
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# COOKIE_SECRET_BASE64 — signs JWT access tokens and session cookies
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**Never reuse these values between environments.** Rotating `MASTER_KEY_BASE64` requires re-encrypting every file and every PII column in the database.

### 4. Create the SQL Server database and run the schema

```sql
-- Run as sysadmin
CREATE DATABASE LeekuSecure;
GO

CREATE LOGIN leeku_app WITH PASSWORD = 'STRONG_PASSWORD_HERE';
GO

USE LeekuSecure;
GO

CREATE USER leeku_app FOR LOGIN leeku_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::dbo TO leeku_app;
GO
```

Then execute the schema below (see [Database Schema](#database-schema)).

### 5. Configure .env from .env.example

```sh
cp .env.example .env
```

Edit `.env` and replace every value marked `CHANGE_ME`. The minimum required values for a working local instance are:

```env
NODE_ENV=development
PORT=3000
APP_URL=http://localhost:3000
ALLOWED_ORIGINS=http://localhost:3000

MASTER_KEY_BASE64=<output from step 3>
COOKIE_SECRET_BASE64=<output from step 3>

DB_SERVER=localhost
DB_PORT=1433
DB_NAME=LeekuSecure
DB_USER=leeku_app
DB_PASSWORD=<your password>
DB_ENCRYPT=false
DB_TRUST_SERVER_CERTIFICATE=true

FILE_STORAGE_UNC_PATH=C:\LeekuTemp\vault
UPLOAD_TEMP_PATH=C:\LeekuTemp\uploads
FILE_SCAN_TEMP_PATH=C:\LeekuTemp\scan-staging

ALLOW_UNSCANNED_UPLOADS_IN_DEVELOPMENT=true
```

Leave `SMTP_HOST` blank to disable email verification in development (accounts are auto-verified on registration).

### 6. Start the development server

```sh
npm run dev
```

This runs `concurrently` with two processes:
- **client** — Vite dev server on port 5173 (default), proxying `/api/*` to port 3000
- **server** — `tsx watch src/server.ts` with hot-reload on port 3000

Open `http://localhost:5173` in your browser.

---

## Database Schema

> VERIFIED columns are confirmed by SQL queries and TypeScript interfaces in `src/server.ts` and `src/server/routes/`.
> Columns marked (ILLUSTRATIVE) are inferred from INSERT/UPDATE parameter names and TypeScript row interfaces; exact SQL Server types may differ slightly from what your DBA chose.

```sql
-- ============================================================
-- users
-- ============================================================
CREATE TABLE users (
    id                              UNIQUEIDENTIFIER    NOT NULL DEFAULT NEWID() PRIMARY KEY,
    email_encrypted                 VARBINARY(512)      NOT NULL,        -- AES-256-GCM ciphertext
    email_iv                        VARBINARY(16)       NOT NULL,        -- 12-byte IV (stored as 16)
    email_auth_tag                  VARBINARY(16)       NOT NULL,        -- GCM auth tag
    email_hash                      CHAR(64)            NOT NULL UNIQUE, -- HMAC-SHA256 for index lookup
    username_encrypted              VARBINARY(512)      NOT NULL,
    username_iv                     VARBINARY(16)       NOT NULL,
    username_auth_tag               VARBINARY(16)       NOT NULL,
    username_hash                   CHAR(64)            NOT NULL UNIQUE,
    password_hash                   NVARCHAR(512)       NOT NULL,        -- Argon2id PHC string
    role                            NVARCHAR(10)        NOT NULL DEFAULT 'User', -- 'User' | 'Admin'
    quota_id                        NVARCHAR(50)        NOT NULL DEFAULT 'guest',
    storage_used_bytes              BIGINT              NOT NULL DEFAULT 0,
    status                          NVARCHAR(20)        NOT NULL DEFAULT 'Active', -- 'Active' | 'Suspended'
    failed_login_count              INT                 NOT NULL DEFAULT 0,
    locked_until                    DATETIMEOFFSET      NULL,
    last_login_at                   DATETIMEOFFSET      NULL,
    email_verified                  BIT                 NOT NULL DEFAULT 0,
    email_verification_token        CHAR(64)            NULL,
    email_verification_expires      DATETIMEOFFSET      NULL,
    deletion_token                  CHAR(64)            NULL,
    deletion_token_expires          DATETIMEOFFSET      NULL,
    created_at                      DATETIMEOFFSET      NOT NULL DEFAULT SYSDATETIMEOFFSET()
);

-- ============================================================
-- quotas
-- ============================================================
CREATE TABLE quotas (
    id                              NVARCHAR(50)        NOT NULL PRIMARY KEY,  -- e.g. 'guest', 'basic', 'pro'
    name                            NVARCHAR(100)       NOT NULL,
    storage_limit_bytes             BIGINT              NOT NULL,
    max_file_size_bytes             BIGINT              NOT NULL,
    max_files                       INT                 NOT NULL,
    daily_upload_limit_bytes        BIGINT              NOT NULL
);

-- Seed minimum quota tier required for registration
INSERT INTO quotas (id, name, storage_limit_bytes, max_file_size_bytes, max_files, daily_upload_limit_bytes)
VALUES ('guest', 'Guest', 1073741824, 104857600, 10, 524288000);

-- ============================================================
-- files
-- ============================================================
CREATE TABLE files (
    id                              UNIQUEIDENTIFIER    NOT NULL DEFAULT NEWID() PRIMARY KEY,
    owner_user_id                   UNIQUEIDENTIFIER    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    original_name_encrypted         VARBINARY(2048)     NOT NULL,
    original_name_iv                VARBINARY(16)       NOT NULL,
    original_name_auth_tag          VARBINARY(16)       NOT NULL,
    stored_path                     NVARCHAR(1000)      NOT NULL,        -- vault-relative filename, e.g. 'abc123.vault'
    mime_type                       NVARCHAR(255)       NOT NULL,
    size_bytes                      BIGINT              NOT NULL,
    encrypted_size_bytes            BIGINT              NOT NULL,
    status                          NVARCHAR(20)        NOT NULL DEFAULT 'Available', -- 'Available' | 'Blocked' | 'Expired'
    checksum_sha256                 CHAR(64)            NOT NULL,        -- SHA-256 of plaintext
    scan_result                     NVARCHAR(20)        NULL,            -- 'Clean' | 'Infected' | 'Suspicious' | ...
    scan_message                    NVARCHAR(MAX)       NULL,
    scanned_at                      DATETIMEOFFSET      NULL,
    is_encrypted                    BIT                 NOT NULL DEFAULT 1,
    leeku_vibe                      NVARCHAR(500)       NULL,            -- AI-generated scan message
    ttl_hours                       INT                 NULL,
    expires_at                      DATETIMEOFFSET      NULL,
    deleted_at                      DATETIMEOFFSET      NULL,
    -- Optional client-side secret key columns (added by auto-migration on startup)
    client_secret_hash              NVARCHAR(512)       NULL,            -- Argon2i hash
    client_crypto_salt              VARBINARY(32)       NULL,
    client_crypto_iv                VARBINARY(16)       NULL,
    client_crypto_iterations        INT                 NULL,
    created_at                      DATETIMEOFFSET      NOT NULL DEFAULT SYSDATETIMEOFFSET()
);

-- ============================================================
-- file_encryption_keys
-- ============================================================
CREATE TABLE file_encryption_keys (
    file_id                         UNIQUEIDENTIFIER    NOT NULL REFERENCES files(id) ON DELETE CASCADE PRIMARY KEY,
    encrypted_key                   VARBINARY(64)       NOT NULL,        -- AES-256-GCM wrapped per-file key
    key_iv                          VARBINARY(16)       NOT NULL,
    key_auth_tag                    VARBINARY(16)       NOT NULL,
    file_iv                         VARBINARY(16)       NOT NULL,        -- IV used to encrypt the vault file
    file_auth_tag                   VARBINARY(16)       NOT NULL
);

-- ============================================================
-- share_links
-- ============================================================
CREATE TABLE share_links (
    id                              UNIQUEIDENTIFIER    NOT NULL DEFAULT NEWID() PRIMARY KEY,
    file_id                         UNIQUEIDENTIFIER    NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    public_token                    CHAR(32)            NOT NULL UNIQUE, -- 16 random bytes as hex
    password_hash                   NVARCHAR(256)       NULL,            -- bcrypt hash (cost 12)
    expires_at                      DATETIMEOFFSET      NULL,
    max_downloads                   INT                 NULL,
    download_count                  INT                 NOT NULL DEFAULT 0,
    is_active                       BIT                 NOT NULL DEFAULT 1,
    -- Optional column (added by auto-migration on startup)
    allow_external_preview          BIT                 NOT NULL DEFAULT 0,
    created_at                      DATETIMEOFFSET      NOT NULL DEFAULT SYSDATETIMEOFFSET()
);

-- ============================================================
-- refresh_tokens
-- ============================================================
CREATE TABLE refresh_tokens (
    id                              UNIQUEIDENTIFIER    NOT NULL DEFAULT NEWID() PRIMARY KEY,
    user_id                         UNIQUEIDENTIFIER    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash                      CHAR(64)            NOT NULL UNIQUE, -- SHA-256 of the opaque token
    expires_at                      DATETIMEOFFSET      NOT NULL,
    created_at                      DATETIMEOFFSET      NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    revoked_at                      DATETIMEOFFSET      NULL,
    ip_address                      NVARCHAR(45)        NULL,
    user_agent                      NVARCHAR(500)       NULL
);

-- ============================================================
-- system_logs
-- ============================================================
CREATE TABLE system_logs (
    id                              BIGINT              NOT NULL IDENTITY(1,1) PRIMARY KEY,
    user_id                         UNIQUEIDENTIFIER    NULL,            -- NULL for anonymous/system events
    username_snapshot               NVARCHAR(200)       NULL,
    event_type                      NVARCHAR(20)        NOT NULL,        -- 'Upload'|'Scan'|'Delete'|'Download'|'Link'|'Admin'|'Security'|'Auth'
    target_type                     NVARCHAR(50)        NOT NULL,
    target_id                       NVARCHAR(100)       NOT NULL,
    ip_address                      NVARCHAR(45)        NOT NULL,
    message                         NVARCHAR(MAX)       NOT NULL,
    created_at                      DATETIMEOFFSET      NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
```

> WARNING: The server runs two lightweight auto-migrations at startup (`ensureOptionalFileSecretColumns` and `ensureOptionalShareLinkColumns`) that add the `client_secret_hash`, `client_crypto_salt`, `client_crypto_iv`, `client_crypto_iterations`, and `allow_external_preview` columns if they are missing. These are safe to run on an existing database. VERIFIED — `src/server.ts` lines 2693-2713.

---

## Common Troubleshooting

### Bitdefender CLI not found

```
[scanner] Bitdefender CLI not found in common paths or BITDEFENDER_SCAN_CLI_PATH.
```

The scanner auto-detects from six common paths. If yours differs, set `BITDEFENDER_SCAN_CLI_PATH` explicitly:

```powershell
# Find the executable
Get-ChildItem "C:\Program Files\Bitdefender" -Recurse -Filter "product.console.exe" -ErrorAction SilentlyContinue
Get-ChildItem "C:\Program Files\Bitdefender" -Recurse -Filter "bdscan.exe" -ErrorAction SilentlyContinue
```

In development, set `ALLOW_UNSCANNED_UPLOADS_IN_DEVELOPMENT=true` to accept uploads without a scanner.

### SQL Server connection refused

Check that TCP/IP is enabled in SQL Server Configuration Manager and that port 1433 is open:

```powershell
Test-NetConnection -ComputerName localhost -Port 1433
```

If using a named instance (e.g. `.\SQLEXPRESS`), set `DB_SERVER=localhost\SQLEXPRESS` and ensure the SQL Server Browser service is running.

For development with a self-signed certificate, set:

```env
DB_ENCRYPT=false
DB_TRUST_SERVER_CERTIFICATE=true
```

### UNC path access denied

The Windows service account running Node.js must have Read+Write on the share. Test manually:

```powershell
# Test with the service account credentials
net use \\10.10.11.85\hyperv_storage /user:DOMAIN\leekuuser
```

If the account cannot be pre-configured with persistent credentials, use the `STORAGE_NET_USE_*` variables in `.env` to have the application call `net use` at startup.

### UPLOAD_TEMP_PATH must be on local disk

Bitdefender scans over SMB are orders of magnitude slower than local-disk scans. Both `UPLOAD_TEMP_PATH` and `FILE_SCAN_TEMP_PATH` must point to a local NTFS directory, not the UNC vault share.

### Port 3000 already in use

```powershell
netstat -ano | findstr :3000
taskkill /PID <pid> /F
```

---

## CONTRACT_DRIFT Note

The `.env.example` and this guide document `JWT_PRIVATE_KEY_PATH` / `JWT_PUBLIC_KEY_PATH`. However, the current `src/server.ts` implementation uses `COOKIE_SECRET_BASE64` as a symmetric HS256 JWT secret via `getJwtSecret()` (line 177) and does not read the PEM files at runtime. The PEM variables are present for a planned RS256 migration. This is flagged as CONTRACT_DRIFT [`env.example:151-152` vs `src/server.ts:177`] — do not rely on the PEM key paths for token signing until the migration is complete.
