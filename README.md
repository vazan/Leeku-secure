# Leeku Secure

Leeku Secure is a secure file-sharing platform with:

- User/admin authentication with short-lived JWT access tokens
- httpOnly session cookie support for browser session restore
- Encrypted file storage (AES-256-GCM)
- Per-file key wrapping and integrity checksum verification
- Malware scanning pipeline with fail-closed upload policy
- Sharing links with optional password protection and limits
- IIS W3C logging integration and SQL-backed audit logs

## Requirements

- Node.js 20+
- SQL Server (configured through environment variables)
- Optional: Bitdefender Endpoint Security Tools CLI for AV scanning
- Optional: SMTP server for verification/deletion emails

## Install

```bash
npm install
```

## Environment

Create a `.env` file in the project root and configure at minimum:

```env
# App
NODE_ENV=development
PORT=3000
APP_URL=http://localhost:3000
ALLOWED_ORIGINS=http://localhost:3000

# Crypto / auth
MASTER_KEY_BASE64=<base64-32-bytes-or-more>
COOKIE_SECRET_BASE64=<strong-jwt-secret>
JWT_ACCESS_EXPIRY_SECONDS=900

# SQL Server
DB_SERVER=localhost
DB_PORT=1433
DB_NAME=LeekuSecure
DB_USER=<db_user>
DB_PASSWORD=<db_password>
DB_ENCRYPT=false
DB_TRUST_SERVER_CERTIFICATE=true

# Storage
FILE_STORAGE_UNC_PATH=<vault-path-or-local-folder>
UPLOAD_TEMP_PATH=<local-temp-folder>

# Optional AV
BITDEFENDER_SCAN_CLI_PATH=<path-to-bdscan-or-product-console>
BITDEFENDER_TIMEOUT_MS=30000
FILE_SCAN_TEMP_PATH=C:\\LeekuTemp\\scan-staging
# Development only: set false to force fail-closed scanner behavior locally.
ALLOW_UNSCANNED_UPLOADS_IN_DEVELOPMENT=true

# Optional SMTP
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_SECURE=false
```

## Run

Development:

```bash
npm run dev
```

Production build and start:

```bash
npm run build
npm run start
```

Type check:

```bash
npm run lint
```

## Security Notes

- Upload scanning is fail-closed in production: any non-clean AV result blocks upload.
- In `NODE_ENV=development`, uploads continue when the Bitdefender CLI is unavailable unless `ALLOW_UNSCANNED_UPLOADS_IN_DEVELOPMENT=false`.
- Session cookie is httpOnly with SameSite=Lax and secure in production.
- Browser localStorage persistence for auth tokens is removed from App flow.
- Account deletion requires explicit POST confirmation step.

## Operations

- Main server entry: `src/server.ts`
- Frontend entry: `src/client.tsx`
- Frontend features: `src/app/features`
- Shared frontend modules: `src/app/shared`
- Security/debt tracker: `Documentations/SECURITY_TECHNICAL_DEBT_ANALYSIS.md`
- AV integration guide: `Documentations/BITDEFENDER_INTEGRATION.md`

## Current Known Gaps

- SQL documentation scripts are currently absent from `Documentations/SQL` in this workspace snapshot.
- Session model is cookie-enabled but still supports bearer header compatibility during migration.
