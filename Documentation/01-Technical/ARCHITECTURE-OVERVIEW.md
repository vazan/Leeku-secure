# ARCHITECTURE OVERVIEW - SHARED FIRST, DB DELTAS

Date: 2026-07-07  
Scope: Leeku-MSSQL, Leeku-POSTGRESQL  
Evidence sources:
- Documentation/01-Technical/DISCOVERY-REPORT.md
- Documentation/04-Risk-And-Corrections/GAP-MANIFEST.md

## 1) Shared Architecture Baseline

### 1.1 Runtime shape

- Both branches expose a web application stack with:
  - Frontend: React + Vite + TypeScript.
  - Backend: Node + Express + TypeScript.
- Server route families are aligned across branches (sessions, public sharing, health, maintenance).

Evidence confidence: High

### 1.2 High-level control plane

- Request handling is mediated by shared route mounting patterns in each branch server entrypoint.
- Health/readiness behavior includes dependency checks that involve database and vault readiness, and scanner checks in production mode.

Evidence confidence: High

### 1.3 Trust boundaries (shared)

Boundary TB-1: External client -> HTTP API server
- Trust shift: untrusted network input enters server-side validation/authz path.
- Control points: API route mounting, route-level middleware, maintenance mode routing.

Boundary TB-2: API server -> Database adapter
- Trust shift: application query intent transformed into DB-driver calls.
- Control points: `getPool` / `getRequest` abstraction and adapter-level query execution.

Boundary TB-3: API server -> Vault storage
- Trust shift: identity/session data persistence and retrieval.
- Control points: startup readiness checks and file-system-backed vault path usage (as referenced by discovery).

Boundary TB-4: API server -> Scanner subsystem (production path)
- Trust shift: file verdict is delegated to external scanning integration.
- Control points: scanner utility wiring and production validation checks.

Evidence confidence: High

## 2) Data-flow and Control-flow Points (Shared)

### 2.1 Core request flow

1. Client sends API request to Express endpoint.
2. Route family dispatches request to module router (sessions/public/health/maintenance).
3. Route logic invokes DB adapter abstraction when persistence is required.
4. Route returns status/body to caller.

Evidence confidence: High

### 2.2 Operational control points

- Maintenance mode path acts as an operational gate.
- Health endpoints expose readiness/liveness signals tied to dependencies.
- Production checks validate required runtime configuration before steady-state operation.

Evidence confidence: High

## 3) DB Delta-Specific Architecture

### 3.1 MSSQL branch delta

- Native SQL Server driver path (`mssql`) is used.
- SQL semantics are executed without translation layer.

Evidence confidence: High

### 3.2 PostgreSQL branch delta

- PostgreSQL branch uses `pg` plus a SQL compatibility adapter.
- Adapter includes SQL token translation (`translateQuery`) to preserve call-site style parity.

Evidence confidence: High

### 3.3 Architectural risk concentration

- The DB portability boundary is the primary divergence seam.
- Query translation in PostgreSQL branch introduces compatibility risk for unsupported SQL forms.

Evidence confidence: High
Risk confidence: Medium-High

## 4) Observed Deployment Shape

Shared evidence:
- Both branches include Windows/IIS-oriented operational language in README context (as reported by discovery).

PostgreSQL delta evidence:
- PostgreSQL branch contains container assets (Dockerfile, docker-compose, entrypoint).

Evidence confidence: High

## 5) Explicit Unknowns and Non-Claims

- Unknown: canonical API contract artifact (OpenAPI/Swagger/JSON schema) location.
- Unknown: CI/CD workflow definitions in workspace scope (`.github/workflows` not found in discovery).
- Unknown: status/location of README-referenced internal branch-local doc trees.
- Not claimed: runtime performance, throughput, or availability SLO compliance.

Unknowns confidence: High

## 6) Key Risks (Architecture Lens)

- P1: DB portability boundary lacks a formal, enforced compatibility contract for translation-safe SQL subset.
- P1: PostgreSQL backup/restore operational pattern appears SQL Server-derived, creating architecture/ops inconsistency.
- P1: API route parity is evidenced, but canonical interface contract source-of-truth is missing.

Risk confidence: Medium-High

## 7) Confidence Snapshot

- Shared topology confidence: High
- Trust boundary mapping confidence: High
- Data-flow mapping confidence: High
- Deployment-mode completeness confidence: Medium
- DB seam risk assessment confidence: Medium-High
