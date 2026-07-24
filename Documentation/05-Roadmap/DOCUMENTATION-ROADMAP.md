# Documentation Remediation Roadmap (Dependency-Aware)

Date: 2026-07-07
Inputs:
- Documentation/01-Technical/DISCOVERY-REPORT.md
- Documentation/04-Risk-And-Corrections/GAP-MANIFEST.md

## Scope

This roadmap sequences documentation remediation for Leeku-MSSQL and Leeku-POSTGRESQL with a dependency-first approach.

Goals:
- Remove P1 blockers first.
- Reach and maintain P1/P2 coverage >= 80%.
- Preserve shared-core documentation with DB-specific appendices.

## Normalized Debt Register

| Debt ID | Source Gap ID | Priority | Topic | Suggested Owners | Estimate |
|---|---|---|---|---|---|
| DEBT-001 | GAP-DOC-001 | P2 | Docs tree reconciliation policy and migration map | Project Manager + Doc Owner | M |
| DEBT-002 | GAP-ARCH-001 | P1 | DB portability boundary and invariants | DocArchitect + Backend Owner | M |
| DEBT-003 | GAP-API-001 | P1 | Canonical API contract | DocEngineer + Backend Owner | L |
| DEBT-004 | GAP-DEPLOY-001 | P1 | Deployment mode matrix (IIS vs Docker) | DocOps | M |
| DEBT-005 | GAP-OPS-001 | P1 | PostgreSQL-native backup/restore runbook and drill evidence | DocOps + DBA | L |
| DEBT-006 | GAP-ENV-001 | P2 | Environment variable canonical catalog | DocOps + Backend Owner | M |
| DEBT-007 | GAP-DB-001 | P2 | PostgreSQL translation limits and incompatibilities | Backend Owner + DocArchitect | M |
| DEBT-008 | GAP-SEC-001 | P2 | Security control traceability matrix | Security + DocEngineer | M |
| DEBT-009 | GAP-TEST-001 | P2 | Verification strategy and release criteria | Test Engineer + Tech Lead | M |
| DEBT-010 | GAP-OBS-001 | P3 | Observability architecture evidence | SRE/Platform + DocOps | M |
| DEBT-011 | GAP-OWN-001 | P3 | Documentation ownership cadence and SLA | Project Manager | S |

## Dependency Graph

Verified dependencies:
- DEBT-002 -> DEBT-003
- DEBT-002 -> DEBT-007
- DEBT-003 -> DEBT-008
- DEBT-004 -> DEBT-005
- DEBT-006 -> DEBT-004
- DEBT-007 -> DEBT-005
- DEBT-003 -> DEBT-009
- DEBT-001 -> DEBT-011

UNVERIFIED dependencies (must validate during execution):
- DEBT-008 -> DEBT-010 (depends on whether observability controls are treated as security controls in audit scope)

Parallelizable work:
- DEBT-001 can run in parallel with DEBT-002.
- DEBT-006 can start once DEBT-002 baseline terms are agreed.
- DEBT-009 can run in parallel with DEBT-008 after DEBT-003.

## Phases

### Now

- DEBT-002 (P1)
- DEBT-003 (P1)
- DEBT-006 (P2 prerequisite for deploy matrix)
- DEBT-004 (P1)

Now acceptance gate:
- Shared architecture seam published.
- Canonical API contract published with auth/status/error policy.
- Env catalog published with required/optional/default/secret flags.
- IIS vs Docker decision matrix published with validation checklist.

### Next

- DEBT-007 (P2)
- DEBT-005 (P1)
- DEBT-008 (P2)
- DEBT-009 (P2)
- DEBT-001 (P2)

Next acceptance gate:
- PostgreSQL translation limits documented with examples.
- PostgreSQL-native backup/restore runbook includes restore drill evidence.
- Security control to evidence matrix completed.
- Verification matrix and branch-safe release criteria approved.
- Authoritative docs tree policy and migration plan approved.

### Later

- DEBT-010 (P3)
- DEBT-011 (P3)

Later acceptance gate:
- Observability model includes metrics/tracing/alerts and owners.
- Documentation ownership registry includes cadence and freshness SLA.

## Critical Path

Critical path:
1. DEBT-002 -> 2. DEBT-003 -> 3. DEBT-006 -> 4. DEBT-004 -> 5. DEBT-007 -> 6. DEBT-005

Why this is critical:
- It resolves architecture and contract foundations first.
- It unlocks safe deployment guidance and DB-specific recovery guidance.
- It closes the highest-impact production risk (PostgreSQL backup/restore mismatch).

## Coverage (P1/P2)

Coverage target: >= 80%

Current roadmap coverage:
- P1 covered: 4/4 (100%)
- P2 covered: 5/5 (100%)
- Combined P1/P2 covered: 9/9 (100%)

P1 exemptions:
- None
