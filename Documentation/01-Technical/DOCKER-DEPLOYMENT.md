# Docker Deployment Guide

This guide explains how to run Leeku Secure with the Docker setup in two modes:

- Development deployment (fast local start)
- Production deployment (strict security checks and hardened values)

It also lists which fields you should edit and the exact commands to run.

---

## Files Used By This Setup

- `Dockerfile` — production-style multi-stage build for the Node.js app
- `docker-compose.yml` — app + PostgreSQL services
- `docker-entrypoint.sh` — app startup script that waits for PostgreSQL readiness
- `Documentation/SQL/postgresql_schema.sql` — auto-imported on first PostgreSQL volume initialization
- `.env.docker.dev.example` — development env template
- `.env.docker.prod.example` — production env template

---

## 1) Development Deployment

Use this mode for local testing and developer onboarding.

### Step 1: Create a development env file

Copy the example file:

```sh
cp .env.docker.dev.example .env.docker.dev
```

Then edit `.env.docker.dev` in the repository root:

```env
# Database credentials for PostgreSQL container
POSTGRES_DB=LeekuSecure
POSTGRES_USER=leeku_app
POSTGRES_PASSWORD=change_me_dev_only

# App exposure
APP_PORT=3000

# App runtime mode
NODE_ENV=development
APP_URL=http://localhost:3000
ALLOWED_ORIGINS=http://localhost:3000

# Required application secrets (32 random bytes, base64)
MASTER_KEY_BASE64=REPLACE_WITH_BASE64_32_BYTES
COOKIE_SECRET_BASE64=REPLACE_WITH_BASE64_32_BYTES

# Local Docker volume paths inside container
FILE_STORAGE_UNC_PATH=/app/vault
UPLOAD_TEMP_PATH=/app/uploads
FILE_SCAN_TEMP_PATH=/app/scan-temp

# Startup DB wait timeout (seconds)
DB_WAIT_TIMEOUT=90
```

Generate secure base64 values:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Run this command twice and use one value for `MASTER_KEY_BASE64`, one for `COOKIE_SECRET_BASE64`.

### Step 2: Start the stack

```sh
docker compose --env-file .env.docker.dev up --build
```

### Step 3: Access the app

- App: `http://localhost:3000`
- PostgreSQL: `localhost:5432`

### Step 4: Stop the stack

```sh
docker compose --env-file .env.docker.dev down
```

If you want a clean database reset:

```sh
docker compose --env-file .env.docker.dev down -v
```

---

## 2) Production Deployment

Use this mode for real deployments where application-level production checks are enforced.

Important behavior in this project:

- `NODE_ENV=production` enables strict startup validation.
- The app requires valid values for security and storage settings.
- The app checks scanner availability (Bitdefender CLI) in production.

### Step 1: Create a production env file

Copy the example file:

```sh
cp .env.docker.prod.example .env.docker.prod
```

Then edit `.env.docker.prod` and replace all placeholder values:

```env
# PostgreSQL credentials
POSTGRES_DB=LeekuSecure
POSTGRES_USER=leeku_app
POSTGRES_PASSWORD=REPLACE_WITH_STRONG_DB_PASSWORD

# App port mapping
APP_PORT=3000

# Production mode
NODE_ENV=production
APP_URL=https://your-domain.example
ALLOWED_ORIGINS=https://your-domain.example

# Required security secrets (32 random bytes, base64)
MASTER_KEY_BASE64=REPLACE_WITH_BASE64_32_BYTES
COOKIE_SECRET_BASE64=REPLACE_WITH_BASE64_32_BYTES

# Cookie security and proxy setup
COOKIE_SECURE=true
PROXY_TRUST_HOPS=1

# Storage paths inside container
FILE_STORAGE_UNC_PATH=/app/vault
UPLOAD_TEMP_PATH=/app/uploads
FILE_SCAN_TEMP_PATH=/app/scan-temp

# DB connection behavior
DB_SSL=false
DB_ENCRYPT=false
DB_TRUST_SERVER_CERTIFICATE=false

# Optional key paths if your deployment uses them
JWT_PRIVATE_KEY_PATH=/app/keys/jwt_private.pem
JWT_PUBLIC_KEY_PATH=/app/keys/jwt_public.pem

# Scanner requirement in production
# Set this to a valid scanner executable inside the container image.
BITDEFENDER_SCAN_CLI_PATH=/opt/bitdefender/product.console.exe

# Startup DB wait timeout (seconds)
DB_WAIT_TIMEOUT=120
```

### Step 2: Start in detached mode

```sh
docker compose --env-file .env.docker.prod up --build -d
```

### Step 3: Validate health

```sh
docker compose --env-file .env.docker.prod ps
docker compose --env-file .env.docker.prod logs --tail=200 app
```

### Step 4: Stop production stack

```sh
docker compose --env-file .env.docker.prod down
```

---

## Editable Fields Checklist

At minimum, edit these before running:

- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `APP_PORT`
- `NODE_ENV`
- `APP_URL`
- `ALLOWED_ORIGINS`
- `MASTER_KEY_BASE64`
- `COOKIE_SECRET_BASE64`
- `FILE_STORAGE_UNC_PATH`
- `UPLOAD_TEMP_PATH`

Recommended for production:

- `COOKIE_SECURE`
- `PROXY_TRUST_HOPS`
- `DB_SSL` / `DB_ENCRYPT` / `DB_TRUST_SERVER_CERTIFICATE`
- `BITDEFENDER_SCAN_CLI_PATH`
- `JWT_PRIVATE_KEY_PATH`
- `JWT_PUBLIC_KEY_PATH`

---

## First-Run Database Initialization

`docker-compose.yml` mounts `Documentation/SQL/postgresql_schema.sql` into PostgreSQL's `/docker-entrypoint-initdb.d/` directory.

This means:

- On first run with an empty `postgres_data` volume, schema is auto-created.
- On subsequent runs with existing data, init scripts are not re-run.

To re-run initialization from scratch:

```sh
docker compose --env-file .env.docker.dev down -v
docker compose --env-file .env.docker.dev up --build
```

---

## Common Commands

```sh
# Build images only
docker compose --env-file .env.docker.dev build

# Start services in background
docker compose --env-file .env.docker.dev up -d

# Follow app logs
docker compose --env-file .env.docker.dev logs -f app

# Show container status
docker compose --env-file .env.docker.dev ps
```
