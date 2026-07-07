# FAQ

Date: 2026-07-07  
Audience: End users, support, non-developer stakeholders

## 1. Is this one product or two products?

It is one product with two technical deployment branches:
- Leeku-MSSQL
- Leeku-POSTGRESQL

Both branches expose largely the same functional API route groups and user capabilities.

Evidence:
- Leeku-MSSQL/src/server.ts
- Leeku-POSTGRESQL/src/server.ts

## 2. What is different between the branches?

Main differences:
- Database driver and adapter behavior.
- PostgreSQL branch includes Docker deployment assets.

Evidence:
- Leeku-MSSQL/src/server/db.ts
- Leeku-POSTGRESQL/src/server/db.ts
- Leeku-POSTGRESQL/docker-compose.yml

## 3. Is the API contract fully documented?

Partially. Route paths and handlers are evidenced in code, but a canonical OpenAPI/Swagger source is currently unknown.

Evidence:
- Documentation/01-Technical/API-REFERENCE.md
- Documentation/04-Risk-And-Corrections/GAP-MANIFEST.md

## 4. Can operations teams rely on backup docs equally for both branches?

Not yet. PostgreSQL backup guidance is a known high-priority gap because current script pattern remains SQL Server-style.

Evidence:
- Leeku-POSTGRESQL/scripts/backup.ps1
- Documentation/04-Risk-And-Corrections/GAP-MANIFEST.md

## 5. How do we check if the system is healthy?

Use health endpoints:
- GET /api/health/live
- GET /api/health/ready

Readiness checks database, vault access, and scanner dependency in production.

Evidence:
- Leeku-MSSQL/src/server/routes/health.ts

## 6. Are security controls present?

Yes, evidence exists for encryption utilities, scanner integration, and production configuration validation.

Evidence:
- Leeku-MSSQL/src/server/utils/encryption.ts
- Leeku-MSSQL/src/server/utils/scanner.ts
- Leeku-MSSQL/src/server/utils/production.ts

## 7. Do these docs include secrets?

No. Secrets should always be masked as [REDACTED] in documentation and tickets.

Evidence:
- Documentation/04-Risk-And-Corrections/GAP-MANIFEST.md

## 8. What remains unknown?

- Unknown location of canonical API schema artifact.
- Unknown validated PostgreSQL-native restore drill evidence.
- Unknown final ownership policy for dual docs trees in workspace.
