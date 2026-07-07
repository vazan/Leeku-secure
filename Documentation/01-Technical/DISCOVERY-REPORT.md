# DISCOVERY REPORT - SHARED BASE (MSSQL + POSTGRESQL)

Date: 2026-07-07  
Scope: `Leeku-MSSQL`, `Leeku-POSTGRESQL`  
Mode: Read-only discovery, evidence-based (no runtime validation performed)

## 1) Scope and Method

- Repositories scanned:
  - `Leeku-MSSQL`
  - `Leeku-POSTGRESQL`
- Focus areas:
  - Stack and module topology
  - API and route parity
  - DB seam and portability boundary
  - Ops/deployment/backup evidence
  - Security controls evidence
  - Existing documentation presence
- Exclusions:
  - No runtime execution of app/services
  - No secret material collection
  - No inferred behavior without code or file evidence

Confidence: High

## 2) Stack Profile and Branch Delta

### Shared stack evidence

- Frontend/backend baseline appears aligned in both branches:
  - React/Vite/TypeScript and Express/Node toolchain in both package manifests.
  - Evidence:
    - `Leeku-MSSQL/package.json`
    - `Leeku-POSTGRESQL/package.json`
- Shared route modules exist in both branches:
  - `src/server/routes/sessions.ts`
  - `src/server/routes/public-sharing.ts`
  - `src/server/routes/health.ts`
  - `src/server/routes/maintenance-mode.ts`

### DB-specific delta evidence

- MSSQL branch depends on `mssql` driver:
  - `Leeku-MSSQL/package.json`
  - `Leeku-MSSQL/src/server/db.ts`
- PostgreSQL branch depends on `pg` driver and exposes an adapter translating SQL Server style tokens:
  - `Leeku-POSTGRESQL/package.json`
  - `Leeku-POSTGRESQL/src/server/db.ts`
  - Evidence of translation seam: `translateQuery(...)` and SQL token rewrites in `Leeku-POSTGRESQL/src/server/db.ts`.

Confidence: High

## 3) Shared vs DB-Specific Evidence Map

| Domain | Shared Evidence (Both Branches) | MSSQL-Specific Evidence | PostgreSQL-Specific Evidence |
|---|---|---|---|
| API Surface | API routers mounted in both server entrypoints (`/api/auth/sessions`, `/api/users/me/sessions`, `/api/public/share`, `/api/health`, `/api/admin/maintenance`) | n/a | n/a |
| DB Connectivity | `getPool`, `getRequest` abstraction used in both branches | Native SQL Server pool via `mssql` in `Leeku-MSSQL/src/server/db.ts` | `pg` pool + mssql-like request adapter in `Leeku-POSTGRESQL/src/server/db.ts` |
| DB Portability Layer | Common call-site style preserved via request/input pattern | Native SQL Server SQL semantics expected | Query translation layer (`ISNULL`, `GETDATE`, `TOP(...)`, parameter tokens) in `Leeku-POSTGRESQL/src/server/db.ts` |
| Health and Ops Middleware | Health router and maintenance middleware exist in both branches | SQL Server bootstrap/query syntax in maintenance middleware | PostgreSQL bootstrap uses PostgreSQL DDL, but still queries SQL Server style table/identifier syntax in middleware via adapter path |
| Security Utilities | Encryption/scanner/production validation modules present and wired in server startup path | n/a | n/a |
| Deployment Assets | Shared Windows/IIS operational language in README files | n/a | Docker assets exist: `Dockerfile`, `docker-compose.yml`, `docker-entrypoint.sh` |
| Backup Script | PowerShell backup script exists in both branches | SQL Server backup commands align with branch intent | Backup script still uses SQL Server `BACKUP DATABASE` + `sqlcmd` pattern |

Evidence references:
- `Leeku-MSSQL/src/server.ts`
- `Leeku-POSTGRESQL/src/server.ts`
- `Leeku-MSSQL/src/server/db.ts`
- `Leeku-POSTGRESQL/src/server/db.ts`
- `Leeku-MSSQL/scripts/backup.ps1`
- `Leeku-POSTGRESQL/scripts/backup.ps1`
- `Leeku-POSTGRESQL/docker-compose.yml`
- `Leeku-POSTGRESQL/Dockerfile`

Confidence: High

## 4) API and Route Parity Findings

- Route mounting patterns are near-identical between branches (same high-level route families and middleware attachment points).
- Explicit evidence in both `src/server.ts` files shows same router modules and route roots for sessions/public sharing/health/maintenance.
- Canonical API schema artifact (OpenAPI/Swagger) was not found in workspace scan.

Confidence: High (route parity), Medium (full contract completeness)

## 5) Security and Production Guardrails Findings

- Security-related utilities are present and integrated in startup/request paths:
  - Encryption module (`encryption.ts`)
  - Scanner integration (`scanner.ts`)
  - Production config validator (`production.ts`)
- Health readiness requires DB + vault, and scanner in production mode (`health.ts` in both branches).
- Production validation checks for required env vars and scanner availability (`production.ts`).

Confidence: High

## 6) Operations and Deployment Findings

- PostgreSQL branch contains container deployment assets and DB bootstrap mount:
  - `postgres:16-alpine`
  - schema mount: `./Documentation/SQL/postgresql_schema.sql`
  - app service env points `DB_SERVER: db`
- Both branches include backup scripts, but PostgreSQL branch script is still SQL Server style (`BACKUP DATABASE`, `RESTORE VERIFYONLY`, `sqlcmd`).

Confidence: High

## 7) Documentation Inventory Observations

- New target tree root exists: `Documentation/`.
- Prior generated docs also exist under `Documentations/` (legacy/sibling tree).
- Internal branch-local documentation trees referenced by READMEs (for example `Documentation/00-Index/DOC-HUB.md`) were not found under `Leeku-MSSQL/Documentation` or `Leeku-POSTGRESQL/Documentation` in this workspace snapshot.

Confidence: Medium

## 8) Explicit Unknowns and Missing Evidence

- Unknown: Canonical API schema source (OpenAPI/Swagger/JSON schema) in repository scope.
- Unknown: CI/CD pipeline definitions in workspace scope (`.github/workflows` not found).
- Unknown: Whether README-linked internal docs for each branch exist outside this workspace snapshot.
- Missing evidence: End-to-end backup restore drill evidence for PostgreSQL path.
- Missing evidence: Centralized observability stack wiring (metrics/tracing/alert routing) in scanned roots.

Confidence: Medium

## 9) Discovery Summary

- Strong branch parity on app structure and API route families.
- Primary architecture seam is DB adapter behavior (`mssql` native vs `pg` with SQL translation layer).
- Highest operational risk is PostgreSQL backup/restore mismatch due to SQL Server command pattern in PostgreSQL branch script.
- Documentation corpus is split between `Documentation/` and `Documentations/`, increasing governance/ownership drift risk.

Confidence: High
