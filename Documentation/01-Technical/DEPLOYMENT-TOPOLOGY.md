# DEPLOYMENT TOPOLOGY - SHARED FIRST, DB DELTAS

Date: 2026-07-07  
Scope: Leeku-MSSQL, Leeku-POSTGRESQL  
Evidence sources:
- Documentation/01-Technical/DISCOVERY-REPORT.md
- Documentation/04-Risk-And-Corrections/GAP-MANIFEST.md

## 1) Shared Deployment Topology (Evidence-backed)

### 1.1 Common shape

- A web client is served for user interaction.
- An Express/Node API service handles business and operational endpoints.
- Persistent data dependencies include database and vault paths.
- Health/readiness checks are part of runtime operational surface.

Confidence: High

### 1.2 Shared trust boundaries

Boundary DTB-1: User/browser network -> API service
- Control points: API routing, maintenance-mode gating, auth/session routes.

Boundary DTB-2: API service -> persistence dependencies
- Control points: DB adapter path and vault dependency checks.

Boundary DTB-3: API service -> security scanner integration
- Control points: scanner readiness (production path) and health gate dependencies.

Confidence: High

## 2) DB-Delta Deployment Shapes

### 2.1 MSSQL branch deployment profile

- Evidence indicates SQL Server-oriented operational model.
- Backup script pattern aligns with SQL Server backup command style.

Confidence: High

### 2.2 PostgreSQL branch deployment profile

- Branch contains explicit container deployment assets:
  - Dockerfile
  - docker-compose.yml
  - docker-entrypoint.sh
- Compose evidence includes PostgreSQL service and app service wiring, with app DB host pointing to `db` service.

Confidence: High

## 3) Topology Decision Matrix (Evidence-constrained)

| Dimension | Shared Baseline | MSSQL Delta | PostgreSQL Delta | Confidence |
|---|---|---|---|---|
| Application runtime | Node/Express API + web client | Same | Same | High |
| Database backend | DB required for readiness | SQL Server driver path | PostgreSQL driver path + SQL translation seam | High |
| Containerization assets | Not evidenced as shared baseline | Not evidenced | Evidenced (Docker assets present) | High |
| Backup script alignment | Script exists in both | SQL Server style and branch-consistent | SQL Server style pattern appears branch-inconsistent | High |

## 4) Data-flow and Control-flow in Deployment Context

### 4.1 Runtime data-flow

1. Browser clients call API endpoints.
2. API routes invoke DB adapter and vault dependencies.
3. Response and health states are emitted.

Confidence: High

### 4.2 Operational control-flow

1. Startup/production validation enforces required runtime conditions.
2. Health endpoint reflects dependency readiness.
3. Maintenance mode route can alter serving behavior.

Confidence: High

## 5) Key Deployment Risks

- GAP-DEPLOY-001 (P1): no unified deployment mode matrix for IIS-style versus Docker-style operations across branches.
- GAP-OPS-001 (P1): PostgreSQL backup/restore path not evidenced as PostgreSQL-native.
- GAP-OBS-001 (P3): observability topology (metrics/tracing/alerts ownership) not evidenced.

Risk confidence: Medium-High

## 6) Explicit Unknowns

- Unknown: definitive branch policy for IIS-first vs Docker-first deployment standard.
- Unknown: CI/CD topology and promotion workflow artifacts in workspace scope.
- Unknown: validated restore drill evidence for PostgreSQL deployment path.

Unknowns confidence: High

## 7) Confidence Snapshot

- Shared topology confidence: High
- PostgreSQL container-topology confidence: High
- Deployment decision completeness confidence: Medium
- Operational resilience confidence: Medium
