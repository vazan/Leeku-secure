# Database PostgreSQL

Date: 2026-07-07

## 1. Scope

This document isolates PostgreSQL-specific database behavior and compatibility seam risks.

Primary evidence:
- Leeku-POSTGRESQL/src/server/db.ts
- Leeku-POSTGRESQL/src/server/middleware/maintenance-mode.ts
- Leeku-POSTGRESQL/.env.example
- Leeku-POSTGRESQL/docker-compose.yml
- Leeku-POSTGRESQL/docker-entrypoint.sh
- Leeku-POSTGRESQL/scripts/backup.ps1
- Documentation/04-Risk-And-Corrections/GAP-MANIFEST.md

## 2. Adapter Model

PostgreSQL branch uses pg with a compatibility request adapter preserving mssql-like call sites.

Exposed helpers:
- getPool
- closePool
- getRequest
- query
- execProc

Important difference:
- execProc is not supported for PostgreSQL branch adapter and throws.

Evidence:
- Leeku-POSTGRESQL/src/server/db.ts

## 3. Translation Seam (Contract Drift)

translateQuery applies SQL Server to PostgreSQL rewrites, including examples such as:
- bracketed identifiers to quoted identifiers
- ISNULL to COALESCE
- GETDATE and SYSDATETIMEOFFSET variants to CURRENT_TIMESTAMP forms
- TOP(n) conversion to LIMIT
- @param to positional parameters

This seam is explicit and high-risk for unsupported SQL forms.

Evidence:
- Leeku-POSTGRESQL/src/server/db.ts
- Documentation/04-Risk-And-Corrections/GAP-MANIFEST.md

## 4. Configuration Defaults

Code-evidenced defaults:
- host: DB_SERVER or localhost
- port: DB_PORT or 5432
- database: DB_NAME or LeekuSecure
- pool min/max: DB_POOL_MIN/DB_POOL_MAX with defaults 2/10
- SSL behavior controlled by DB_SSL or compatibility alias DB_ENCRYPT
- DB_TRUST_SERVER_CERTIFICATE influences rejectUnauthorized when SSL is on

Evidence:
- Leeku-POSTGRESQL/src/server/db.ts
- Leeku-POSTGRESQL/.env.example

## 5. Table-Level Evidence from Routes

Observed table references in route handlers remain parity-shaped with MSSQL branch usage:
- refresh_tokens
- share_links
- files
- users

Evidence:
- Leeku-POSTGRESQL/src/server/routes/sessions.ts
- Leeku-POSTGRESQL/src/server/routes/public-sharing.ts

## 6. Deployment Delta

PostgreSQL branch has container assets and DB readiness gating:
- Docker compose defines db and app services
- app startup waits for DB readiness with pg_isready path

Evidence:
- Leeku-POSTGRESQL/docker-compose.yml
- Leeku-POSTGRESQL/docker-entrypoint.sh
- Leeku-POSTGRESQL/Dockerfile

## 7. Backup and Restore Drift (Visible)

Current branch backup script still follows SQL Server command style. This is a P1 documentation/operations gap and must remain explicit until PostgreSQL-native runbook and validation evidence exist.

Evidence:
- Leeku-POSTGRESQL/scripts/backup.ps1
- Documentation/04-Risk-And-Corrections/GAP-MANIFEST.md

## 8. Explicit Unknowns

- Unknown: exact allowed SQL subset contract for branch-safe portability.
- Unknown: validated PostgreSQL-native restore drill evidence.
- Unknown: canonical PostgreSQL schema artifact location in current workspace scope.
