# CORRECTIONS PLAN (MSSQL + POSTGRESQL)

Date: 2026-07-07
Scope: Priority remediation plan from GAP-MANIFEST
Sources:
- Documentation/01-Technical/DISCOVERY-REPORT.md
- Documentation/04-Risk-And-Corrections/GAP-MANIFEST.md

## 1. Objective

Reduce documentation debt and operational risk by closing prioritized gaps with owner-bound, evidence-based deliverables.

## 2. Priority Execution Board

| Action ID | Gap Link | Priority | Action | Owner | Due Window | Exit Evidence |
|---|---|---|---|---|---|---|
| C-001 | GAP-OPS-001 | P1 | Produce PostgreSQL-native backup/restore runbook and complete restore drill evidence | DocOps + DBA | 0-14 days | Approved runbook + drill record + validation checklist |
| C-002 | GAP-API-001 | P1 | Publish canonical API contract with status/auth/error matrix | DocEngineer + Backend Owner | 0-14 days | Signed contract doc in authoritative tree |
| C-003 | GAP-ARCH-001 | P1 | Publish DB portability seam policy (allowed SQL subset, unsupported patterns, invariants) | DocArchitect + Backend Owner | 0-14 days | Reviewed seam policy and known-limit appendix |
| C-004 | GAP-DEPLOY-001 | P1 | Publish IIS vs Docker decision matrix by environment and branch | DocOps | 0-14 days | Deployment matrix + preflight checklist |
| C-005 | GAP-ENV-001 | P2 | Generate env variable canon from runtime usage with required/default/secret flags | DocOps + Backend Owner | 15-30 days | Env catalog with verification notes |
| C-006 | GAP-SEC-001 | P2 | Build control-to-evidence matrix for security claims | Security + DocEngineer | 15-30 days | Control matrix mapped to code/runtime owners |
| C-007 | GAP-TEST-001 | P2 | Define minimum verification strategy and branch-safe release criteria | QA + Tech Lead | 15-30 days | Verification matrix and go/no-go checklist |
| C-008 | GAP-DB-001 | P2 | Publish PostgreSQL translation incompatibility catalog | Backend Owner + DocArchitect | 15-30 days | Limits register with regression hooks |
| C-009 | GAP-DOC-001 | P2 | Approve authoritative documentation tree policy and migration plan | PM + Doc Owner | 15-30 days | Signed governance note and migration tracker |
| C-010 | GAP-OBS-001 | P3 | Define observability architecture baseline with ownership | SRE/Platform + DocOps | 31-60 days | Monitoring standard and alert ownership map |
| C-011 | GAP-OWN-001 | P3 | Establish documentation ownership cadence and freshness SLA | Project Manager | 31-60 days | Owner registry + review calendar |

## 3. Branch-Specific Correction Tracks

### 3.1 Leeku-MSSQL

- Preserve and validate current SQL Server-oriented DR and operations docs.
- Align deployment and env canon with branch runtime assumptions.

### 3.2 Leeku-POSTGRESQL

- Prioritize DR correction (C-001) before release-readiness claims.
- Publish portability-limit constraints and deployment mode governance.

## 4. Governance and Reporting

1. Weekly corrections review by PM with all role owners.
2. P1 actions require progress update every 3 business days.
3. Close actions only with explicit evidence artifact links.

## 5. Dependency and Risk Notes

- C-001 is a blocker dependency for production recovery confidence on PostgreSQL branch.
- C-002 and C-003 are blockers for stable cross-branch engineering and integration reliability.
- C-009 is required to avoid contradictory guidance while corrections are in flight.

## 6. Debt Handling Rule

Current gap count from manifest is 11 items; handoff to roadmap specialization is not required by the >15 threshold.
