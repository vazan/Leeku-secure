# Executive Summary

Date: 2026-07-07  
Audience: Product, leadership, operations, security stakeholders

## 1. What this platform does

Leeku Secure provides authenticated file storage, sharing, and administration with health checks, maintenance controls, encryption utilities, and malware scanning integration.

Evidence:
- Leeku-MSSQL/src/server.ts
- Leeku-MSSQL/src/server/routes/public-sharing.ts
- Leeku-MSSQL/src/server/routes/health.ts

## 2. Branch strategy at a glance

Two branches share the same product surface:
- Leeku-MSSQL
- Leeku-POSTGRESQL

Main difference:
- database adapter and operations path
- PostgreSQL branch also includes Docker deployment assets

Evidence:
- Leeku-MSSQL/src/server.ts
- Leeku-POSTGRESQL/src/server.ts
- Leeku-MSSQL/src/server/db.ts
- Leeku-POSTGRESQL/src/server/db.ts
- Leeku-POSTGRESQL/docker-compose.yml

## 3. Current documentation direction

Shared content is centralized in the new Documentation tree, and DB-specific differences are isolated into dedicated MSSQL and PostgreSQL technical docs.

Evidence:
- Documentation/01-Technical
- Documentation/02-Non-Technical

## 4. Top risks to track now

1. PostgreSQL backup and restore guidance is not yet branch-native.
2. Canonical API contract source (OpenAPI/Swagger/schema) is not discovered.
3. DB portability boundary for translated SQL needs formal contract.

Evidence:
- Documentation/04-Risk-And-Corrections/GAP-MANIFEST.md
- Documentation/01-Technical/DISCOVERY-REPORT.md

## 5. What is known vs unknown

Known:
- Route parity and core feature parity are strong across branches.
- Security and production guard modules exist and are wired.

Unknown:
- definitive API schema artifact location
- validated PostgreSQL restore drill evidence
- final policy for dual docs trees (Documentation and Documentations)

Evidence:
- Documentation/01-Technical/DISCOVERY-REPORT.md
- Documentation/04-Risk-And-Corrections/GAP-MANIFEST.md

## 6. Recommended immediate focus

- Publish canonical API contract artifact or formal implementation-derived contract process.
- Deliver PostgreSQL-native backup and restore runbook with drill evidence.
- Lock single authoritative documentation tree policy.
