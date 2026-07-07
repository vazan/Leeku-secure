# ROLE GUIDE - BACKEND ENGINEER

Date: 2026-07-07
Scope: Leeku-MSSQL and Leeku-POSTGRESQL
Inputs:
- Documentation/01-Technical/DISCOVERY-REPORT.md
- Documentation/04-Risk-And-Corrections/GAP-MANIFEST.md

## Mandate

Own API correctness, DB portability safety, and branch-specific backend reliability constraints.

## Responsibilities

1. Maintain route parity and behavioral parity across branches.
2. Document API contract gaps and provide canonical request/response definitions.
3. Define DB portability boundary and SQL compatibility invariants.
4. Partner with Ops/Security on startup guardrail and readiness requirements.
5. Support incident root-cause analysis for backend failures.

## Branch-Specific Focus

### Leeku-MSSQL

- Preserve native SQL Server behavior and adapter assumptions.
- Validate operational SQL and schema assumptions remain aligned.

### Leeku-POSTGRESQL

- Own translation-layer limits documentation and risk controls.
- Flag unsupported SQL patterns and branch-sync hazards early.

## Priority Work Queue

- P1: GAP-API-001 canonical API contract.
- P1: GAP-ARCH-001 portability seam boundary documentation.
- P2: GAP-DB-001 translation limits and incompatibility list.
- P2: GAP-ENV-001 env-variable behavior and defaults documentation support.

## Handoffs

- To Ops Engineer: branch deployment prerequisites and rollback constraints.
- To Security Engineer: backend controls that impact confidentiality/integrity.
- To QA Engineer: high-risk regression scenarios and acceptance tests.
- To Project Manager: effort/risk estimates for P1 and P2 engineering debt.

## Acceptance Criteria

1. Every cross-branch DB behavior change includes portability impact notes.
2. API contract updates are reflected in shared documentation promptly.
3. Known translation limits are explicit and testable.
4. P1 backend documentation gaps have clear owner and delivery date.

## Evidence Anchors

- Discovery and parity baseline: Documentation/01-Technical/DISCOVERY-REPORT.md
- DB seam and delta requirements: Documentation/01-Technical/DB-ADAPTER-SEAMS.md
- Corrective backlog ownership: Documentation/04-Risk-And-Corrections/GAP-MANIFEST.md
