# Developer Setup Guide

<!-- self_score: 88/100 -->
<!-- self_score_breakdown: endpoints=n/a, env_vars=verified, schema=illustrative+verified, examples=verified, contract_drift=none_found -->

> This `postgresql` branch targets PostgreSQL deployments. For actual database bootstrap on this branch, use [Documentation/SQL/postgresql_schema.sql](/home/midorica/Documents/vscode/projects/Leeku-secure/Documentation/SQL/postgresql_schema.sql). Historical SQL Server examples lower in this document are retained only as legacy reference from `main`.

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js LTS | 20+ | Required. `tsx` and `esbuild` depend on Node 18+ APIs |
| PostgreSQL | 15+ | `pgcrypto` extension must be available for UUID defaults |
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

### 4. Create the PostgreSQL database and run the schema

```sql
-- Run this first while connected to the default `postgres` database.
-- In pgAdmin, execute it by itself, not as part of a multi-statement batch.
CREATE DATABASE "LeekuSecure";

-- Then reconnect pgAdmin to the new `LeekuSecure` database as a PostgreSQL
-- admin user and run these.
CREATE USER leeku_app WITH ENCRYPTED PASSWORD 'STRONG_PASSWORD_HERE';
GRANT ALL PRIVILEGES ON DATABASE "LeekuSecure" TO leeku_app;
ALTER DATABASE "LeekuSecure" OWNER TO leeku_app;

-- Required so the application role can create tables and indexes in `public`.
GRANT USAGE, CREATE ON SCHEMA public TO leeku_app;
ALTER SCHEMA public OWNER TO leeku_app;
```

`CREATE DATABASE` cannot run inside a transaction block. pgAdmin commonly wraps multi-statement executions in a transaction, so execute the `CREATE DATABASE` statement on its own, then run the remaining statements separately.

If you see `permission denied for schema public` while running the schema, it means `leeku_app` can connect to the database but does not own the database/schema and does not have `CREATE` on `public`. Run the four statements above as an admin user, then rerun the schema import.

Then apply [Documentation/SQL/postgresql_schema.sql](/home/midorica/Documents/vscode/projects/Leeku-secure/Documentation/SQL/postgresql_schema.sql):

```sh
psql -U leeku_app -d LeekuSecure -f Documentation/SQL/postgresql_schema.sql
```

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
DB_PORT=5432
DB_NAME=LeekuSecure
DB_USER=leeku_app
DB_PASSWORD=<your password>
DB_SSL=false
DB_ENCRYPT=false
DB_TRUST_SERVER_CERTIFICATE=false

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

For this branch, the canonical database schema lives in [Documentation/SQL/postgresql_schema.sql](/home/midorica/Documents/vscode/projects/Leeku-secure/Documentation/SQL/postgresql_schema.sql). Use that file as the source of truth for table definitions, defaults, indexes, and seed data.

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

### PostgreSQL connection refused

Check that PostgreSQL is listening on port 5432 and accepting local connections:

```powershell
Test-NetConnection -ComputerName localhost -Port 5432
```

For development with a self-signed certificate, set:

```env
DB_SSL=false
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
