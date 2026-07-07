# DB ADAPTER SEAMS - SHARED FIRST, DB DELTAS

Date: 2026-07-07  
Scope: Leeku-MSSQL, Leeku-POSTGRESQL  
Evidence sources:
- Documentation/01-Technical/DISCOVERY-REPORT.md
- Documentation/04-Risk-And-Corrections/GAP-MANIFEST.md

## 1) Seam Definition (Shared)

Seam name: Database portability boundary
- Purpose: keep upper-layer server/route code stable while DB implementation differs by branch.
- Shared interface shape: `getPool` and `getRequest` abstraction pattern.
- Architectural intent evidenced by parity-oriented DB call style across branches.

Confidence: High

## 2) Shared Invariants (Evidence-backed)

Invariant I-1: Route-level logic can invoke DB access through a common request abstraction pattern.
Invariant I-2: API route families remain aligned while DB backends differ.
Invariant I-3: Health and maintenance behavior depend on the DB path being available.

Confidence: High

## 3) MSSQL Delta Seam

Implementation evidence:
- MSSQL branch DB adapter uses native SQL Server driver (`mssql`).
- SQL execution follows SQL Server semantics directly.

Seam implications:
- Fewer translation layers in adapter path.
- Behavior depends on SQL Server-native syntax expectations.

Confidence: High

## 4) PostgreSQL Delta Seam

Implementation evidence:
- PostgreSQL branch uses `pg` and a translation layer (`translateQuery`) to adapt SQL Server-style query patterns.
- Discovery identifies token rewrites including SQL constructs such as `ISNULL`, `GETDATE`, and `TOP(...)`, plus parameter token adaptation.

Seam implications:
- Compatibility is partial by design unless all query forms are covered.
- Translation correctness becomes a critical control point for branch safety.

Confidence: High

## 5) Trust Boundaries and Control Points

Boundary DB-TB-1: Application query intent -> adapter translation/execution pipeline
- Control point CP-DB-1: query rewrite/translation routine in PostgreSQL adapter.
- Control point CP-DB-2: request-parameter binding semantics.

Boundary DB-TB-2: Adapter -> database engine protocol
- Control point CP-DB-3: driver-level execution path (`mssql` vs `pg`).

Boundary DB-TB-3: Operational probes -> DB readiness signal
- Control point CP-DB-4: health endpoint dependency checks tied to DB availability.

Confidence: High

## 6) Allowed/Unsupported SQL Contract Status

Current status:
- No complete, explicit compatibility contract (allowed SQL subset + unsupported patterns) is evidenced in current docs.

Documented gap references:
- GAP-ARCH-001 (P1): missing explicit architecture seam contract.
- GAP-DB-001 (P2): missing translation-limit and incompatibility catalogue.

Confidence: High

## 7) Data-flow Through the Seam

1. Route module constructs query intent and parameters.
2. Adapter request path receives query.
3. PostgreSQL branch may translate SQL tokens before execution.
4. Driver executes against DB backend.
5. Result shape returns to route layer.

Confidence: High

## 8) Risks and Failure Modes

- P1: Silent query semantic drift if translation produces syntactically valid but behaviorally different SQL.
- P1: Branch-sync regressions when new SQL patterns are introduced without translation coverage.
- P2: Incident triage complexity from seam opacity when compatibility assumptions are undocumented.

Risk confidence: Medium-High

## 9) Explicit Unknowns

- Unknown: exhaustive list of currently supported SQL patterns in PostgreSQL adapter.
- Unknown: evidence of automated compatibility tests for translation behavior.
- Unknown: branch governance policy enforcing seam-safe query authoring.

Unknowns confidence: High

## 10) Confidence Snapshot

- Seam existence confidence: High
- Seam control-point mapping confidence: High
- Compatibility boundary completeness confidence: Medium
- Risk estimation confidence: Medium-High
