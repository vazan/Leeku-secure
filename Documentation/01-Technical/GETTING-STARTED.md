# Getting Started (Shared Baseline)

Date: 2026-07-07  
Scope: Leeku-MSSQL and Leeku-POSTGRESQL

## 1. Purpose

This guide is the common developer onboarding path for both branches. It centralizes shared setup and isolates DB-specific deltas.

Primary evidence:
- Leeku-MSSQL/package.json
- Leeku-POSTGRESQL/package.json
- Leeku-MSSQL/src/server.ts
- Leeku-POSTGRESQL/src/server.ts
- Documentation/01-Technical/DISCOVERY-REPORT.md
- Documentation/04-Risk-And-Corrections/GAP-MANIFEST.md

## 2. Shared Prerequisites

- Node.js 22.x runtime.
- PNPM available.
- A local .env file created from branch .env.example.

Evidence:
- Leeku-MSSQL/package.json
- Leeku-POSTGRESQL/package.json
- Leeku-MSSQL/.env.example
- Leeku-POSTGRESQL/.env.example

## 3. Shared Setup Steps

1. Choose one branch folder as working app root:
   - Leeku-MSSQL
   - Leeku-POSTGRESQL
2. Install dependencies:
   - pnpm install --frozen-lockfile
3. Create environment file:
   - copy .env.example to .env
4. Fill placeholders before run (secrets must remain masked in docs and tickets as [REDACTED]).
5. Start development:
   - pnpm run dev

Evidence:
- Leeku-MSSQL/package.json
- Leeku-POSTGRESQL/package.json
- Leeku-POSTGRESQL/Dockerfile

## 4. Shared Run Commands

- pnpm run dev
- pnpm run build
- pnpm run start
- pnpm run preview
- pnpm run clean
- pnpm run lint

Evidence:
- Leeku-MSSQL/package.json
- Leeku-POSTGRESQL/package.json

## 5. First Health Verification

After startup, verify:
- GET /api/health/live
- GET /api/health/ready

Expected readiness behavior is code-evidenced:
- checks database connectivity
- checks vault path accessibility
- in production, scanner availability is part of readiness

Evidence:
- Leeku-MSSQL/src/server/routes/health.ts
- Leeku-POSTGRESQL/src/server/routes/health.ts

## 6. Branch Delta: MSSQL

- Uses mssql driver.
- DB defaults align to SQL Server flow.

Evidence:
- Leeku-MSSQL/src/server/db.ts
- Leeku-MSSQL/package.json

## 7. Branch Delta: PostgreSQL

- Uses pg driver with compatibility adapter preserving request/input style.
- Includes Docker assets for app+db path.

Evidence:
- Leeku-POSTGRESQL/src/server/db.ts
- Leeku-POSTGRESQL/package.json
- Leeku-POSTGRESQL/Dockerfile
- Leeku-POSTGRESQL/docker-compose.yml
- Leeku-POSTGRESQL/docker-entrypoint.sh

## 8. Contract Drift (Visible)

- PostgreSQL backup script still uses SQL Server backup command pattern.
- Canonical API schema artifact is not found in current scope.

Evidence:
- Leeku-POSTGRESQL/scripts/backup.ps1
- Documentation/04-Risk-And-Corrections/GAP-MANIFEST.md
- Documentation/01-Technical/DISCOVERY-REPORT.md

## 9. Explicit Unknowns

- Unknown: authoritative OpenAPI/Swagger/JSON schema location.
- Unknown: CI/CD workflow definitions in workspace scope.
- Unknown: final authoritative policy between Documentation and Documentations trees.
