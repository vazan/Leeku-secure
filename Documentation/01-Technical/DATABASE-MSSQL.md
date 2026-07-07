# Database MSSQL

Date: 2026-07-07

## 1. Scope

This document describes MSSQL-specific database behavior and operational notes, with shared concerns linked but not duplicated.

Primary evidence:
- Leeku-MSSQL/src/server/db.ts
- Leeku-MSSQL/.env.example
- Leeku-MSSQL/scripts/backup.ps1
- Documentation/04-Risk-And-Corrections/GAP-MANIFEST.md

## 2. Adapter Model

MSSQL branch uses mssql driver directly with singleton pool lifecycle.

Exposed helpers:
- getPool
- closePool
- getRequest
- query
- execProc

Evidence:
- Leeku-MSSQL/src/server/db.ts

## 3. Configuration Defaults

Code-evidenced defaults:
- host: DB_SERVER or localhost
- port: DB_PORT or 1433
- database: DB_NAME or LeekuSecure
- pool min/max: DB_POOL_MIN/DB_POOL_MAX with defaults 2/10
- request timeout default 15000
- connection timeout default 30000

TLS-related options:
- DB_ENCRYPT
- DB_TRUST_SERVER_CERTIFICATE

Evidence:
- Leeku-MSSQL/src/server/db.ts

## 4. Query/Procedure Capability

- Parameterized query flow is native to mssql request input semantics.
- Stored procedures are supported through execProc helper.

Evidence:
- Leeku-MSSQL/src/server/db.ts

## 5. Table-Level Evidence from Routes

Observed table references in route handlers:
- refresh_tokens
- share_links
- files
- users

Evidence:
- Leeku-MSSQL/src/server/routes/sessions.ts
- Leeku-MSSQL/src/server/routes/public-sharing.ts

## 6. Backup and Restore Surface (MSSQL)

Branch script contains SQL Server-native pattern:
- sqlcmd invocation
- BACKUP DATABASE
- RESTORE VERIFYONLY

This aligns with MSSQL branch intent.

Evidence:
- Leeku-MSSQL/scripts/backup.ps1

## 7. Shared Risk Linkage

Cross-branch operational parity is currently at risk because PostgreSQL backup path is still SQL Server-patterned. This is tracked in gap manifest and should remain visible.

Evidence:
- Documentation/04-Risk-And-Corrections/GAP-MANIFEST.md

## 8. Explicit Unknowns

- Unknown: authoritative SQL schema artifact location for full table/column contract in current workspace scope.
- Unknown: validated restore drill evidence artifact for MSSQL branch in shared docs tree.
