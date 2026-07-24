# SYSTEM COMPONENTS - SHARED FIRST, DB DELTAS

Date: 2026-07-07  
Scope: Leeku-MSSQL, Leeku-POSTGRESQL  
Evidence sources:
- Documentation/01-Technical/DISCOVERY-REPORT.md
- Documentation/04-Risk-And-Corrections/GAP-MANIFEST.md

## 1) Shared Component Catalog

### 1.1 Client tier

Component: Web client (React/Vite/TypeScript)
- Responsibility: user-facing interface and API consumption.
- Inputs: browser interactions.
- Outputs: HTTP requests to backend API.
- Trust boundary: Browser/user environment to server boundary.
- Confidence: High

### 1.2 API tier

Component: Express server runtime
- Responsibility: route dispatch, session/public/share/health/maintenance APIs.
- Inputs: HTTP requests from clients and operators.
- Outputs: HTTP responses, DB calls, scanner/vault interactions.
- Control points: route mount points, maintenance mode gate, health checks.
- Confidence: High

### 1.3 Route modules (shared families)

- Sessions router.
- Public sharing router.
- Health router.
- Maintenance mode router.

Notes:
- Discovery evidence indicates parity of route families and mount patterns across both branches.
- Canonical request/response matrix is not evidenced in a schema artifact.

Confidence: High (module presence), Medium (contract completeness)

### 1.4 Security/guardrail utilities

Component set:
- Encryption utility module.
- Scanner integration module.
- Production validation module.

Responsibilities:
- Protect sensitive operations and enforce production readiness conditions.

Control points:
- Startup validation path.
- Health readiness dependency checks.

Confidence: High

### 1.5 Persistence abstraction

Component: DB adapter facade (`getPool`, `getRequest` pattern)
- Responsibility: present stable DB interaction shape to higher-level server code.
- Trust boundary: transition from app-level query intent to DB-driver execution.
- Confidence: High

### 1.6 Vault storage

Component: Vault-backed user storage path (workspace `vault/users` present in both branches)
- Responsibility: support persisted user/session-related data path as referenced by discovery health checks.
- Trust boundary: filesystem persistence boundary.
- Confidence: Medium-High

## 2) DB-Delta Component Differences

### 2.1 MSSQL-specific components

- `mssql` driver integration in DB layer.
- Native SQL Server execution semantics.

Confidence: High

### 2.2 PostgreSQL-specific components

- `pg` driver integration in DB layer.
- SQL compatibility translation seam (`translateQuery`) to adapt SQL Server-like tokens.
- Additional container deployment assets (`Dockerfile`, `docker-compose.yml`, `docker-entrypoint.sh`).

Confidence: High

## 3) Data-flow and Control Points by Component

### 3.1 Normal request path

1. Client -> API route entrypoint.
2. Route module applies request-specific logic.
3. DB adapter invoked for persistence/query operations.
4. Optional scanner/vault interactions based on endpoint behavior.
5. Response emitted.

Confidence: High

### 3.2 Operational control path

1. Operator/system probes health endpoint.
2. Health path checks DB/vault/scanner readiness dependencies.
3. Maintenance route can alter availability behavior.

Confidence: High

## 4) Component Risks

- GAP-API-001 (P1): missing canonical API contract despite route parity.
- GAP-ARCH-001 (P1): no formalized DB portability seam contract.
- GAP-DB-001 (P2): translation limits/incompatibilities not fully documented.
- GAP-OPS-001 (P1): PostgreSQL backup script pattern misaligned with native PostgreSQL expectations.

Risk confidence: Medium-High

## 5) Explicit Unknowns

- Unknown: source-of-truth API schema location.
- Unknown: CI/CD pipeline artifact presence in repository scope.
- Unknown: documented ownership and freshness SLA for component docs.

Unknowns confidence: High

## 6) Confidence Snapshot

- Component inventory confidence: High
- Shared-vs-delta separation confidence: High
- Trust boundary mapping confidence: High
- Runtime behavior completeness confidence: Medium
