# Feature Mapping (Shared Core and DB Deltas)

Date: 2026-07-07

## 1. Purpose

Map product features to implementation evidence while keeping shared logic centralized and branch deltas isolated.

Primary evidence:
- Leeku-MSSQL/src/server.ts
- Leeku-POSTGRESQL/src/server.ts
- Leeku-MSSQL/src/server/routes/sessions.ts
- Leeku-MSSQL/src/server/routes/public-sharing.ts
- Leeku-MSSQL/src/server/routes/health.ts
- Leeku-MSSQL/src/server/routes/maintenance-mode.ts
- Leeku-MSSQL/src/server/utils/production.ts
- Leeku-MSSQL/src/server/utils/scanner.ts
- Leeku-MSSQL/src/server/utils/encryption.ts
- Leeku-MSSQL/src/server/db.ts
- Leeku-POSTGRESQL/src/server/db.ts

## 2. Shared Feature Matrix

| Feature area | Shared behavior evidence | Notes |
|---|---|---|
| Auth lifecycle | register, verify-email, login, me, csrf, refresh, logout routes in server.ts | schema contracts unknown without API spec artifact |
| Session management | mounted session router plus revoke patterns | routes parity observed across both branches |
| User profile and avatar | update, quota request, avatar read/write/remove, delete request/confirm | auth policy implemented in route wiring |
| File handling | list, upload, preview, download, prepared-download flow | anti-malware and encryption utilities are present |
| Sharing | private sharing routes and public sharing router | tokenized public access plus staged download flow |
| Admin controls | users/files/logs/quotas and maintenance routes | admin middleware gates in route declarations |
| Health and readiness | live and ready routes | ready combines DB, vault and production scanner conditions |

Evidence:
- Leeku-MSSQL/src/server.ts
- Leeku-POSTGRESQL/src/server.ts
- Leeku-MSSQL/src/server/routes/sessions.ts
- Leeku-MSSQL/src/server/routes/public-sharing.ts
- Leeku-MSSQL/src/server/routes/health.ts
- Leeku-MSSQL/src/server/routes/maintenance-mode.ts

## 3. Security and Ops Feature Mapping

| Control area | Implementation evidence | Shared or branch-specific |
|---|---|---|
| Encryption-at-rest workflows | encryption utility module and route integration | shared |
| Malware scanning gate | scanner utility and production validator requirements | shared |
| Production config enforcement | validateProductionConfig and startup checks | shared |
| IIS-style request logging | iis logger middleware module | shared runtime model |
| DB access layer | db helper abstraction in both branches | shared interface, DB-specific implementation |

Evidence:
- Leeku-MSSQL/src/server/utils/encryption.ts
- Leeku-MSSQL/src/server/utils/scanner.ts
- Leeku-MSSQL/src/server/utils/production.ts
- Leeku-MSSQL/src/server/middleware/iis-logger.ts
- Leeku-MSSQL/src/server/db.ts
- Leeku-POSTGRESQL/src/server/db.ts

## 4. Branch Deltas

### MSSQL delta
- Native mssql driver path.
- SQL Server backup script style is branch-consistent.

Evidence:
- Leeku-MSSQL/src/server/db.ts
- Leeku-MSSQL/scripts/backup.ps1

### PostgreSQL delta
- pg adapter with SQL translation seam.
- Docker assets are present.
- Backup script still SQL Server-patterned and tracked as P1 ops/doc gap.

Evidence:
- Leeku-POSTGRESQL/src/server/db.ts
- Leeku-POSTGRESQL/docker-compose.yml
- Leeku-POSTGRESQL/scripts/backup.ps1
- Documentation/04-Risk-And-Corrections/GAP-MANIFEST.md

## 5. Contract Drift Register

- Missing canonical API schema source-of-truth.
- PostgreSQL SQL translation seam lacks formal allowed-subset contract.
- PostgreSQL backup flow lacks branch-native documented and validated restore procedure.

Evidence:
- Documentation/04-Risk-And-Corrections/GAP-MANIFEST.md
- Documentation/01-Technical/DISCOVERY-REPORT.md

## 6. Explicit Unknowns

- Unknown: endpoint-level schema and status matrix artifact location.
- Unknown: complete DB translation limitations inventory approved by backend owner.
- Unknown: observability stack ownership and alert-routing evidence in workspace scope.
