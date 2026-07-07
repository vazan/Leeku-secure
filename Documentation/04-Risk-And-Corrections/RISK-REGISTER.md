# RISK REGISTER (MSSQL + POSTGRESQL)

Date: 2026-07-07
Scope: Documentation risks derived from discovery + gap manifest
Sources:
- Documentation/01-Technical/DISCOVERY-REPORT.md
- Documentation/04-Risk-And-Corrections/GAP-MANIFEST.md

## 1. Active Risks

| Risk ID | Gap Link | Risk Statement | Branch | Probability | Impact | Priority | Owner | Mitigation Summary |
|---|---|---|---|---|---|---|---|---|
| R-001 | GAP-OPS-001 | PostgreSQL backup script uses SQL Server semantics; restore may fail in incident | Leeku-POSTGRESQL | High | High | P1 | DocOps + DBA | Replace with PostgreSQL-native runbook and validate restore drill |
| R-002 | GAP-API-001 | Missing canonical API contract can cause integration drift | Both | Medium | High | P1 | DocEngineer + Backend Owner | Publish source-of-truth contract and status/error matrix |
| R-003 | GAP-ARCH-001 | Portability seam undocumented; hidden cross-branch regressions likely | Both | Medium | High | P1 | DocArchitect + Backend Owner | Define allowed SQL subset and invariants |
| R-004 | GAP-DEPLOY-001 | Ambiguous IIS vs Docker guidance causes deployment errors | Both | Medium | High | P1 | DocOps | Publish environment decision matrix and validation checklist |
| R-005 | GAP-ENV-001 | Incomplete env canon risks production misconfiguration | Both | Medium | Medium | P2 | DocOps + Backend Owner | Generate env catalog from runtime usage and guardrails |
| R-006 | GAP-SEC-001 | Security claims lack full traceability and ownership mapping | Both | Medium | Medium | P2 | Security + DocEngineer | Build control-to-evidence matrix with cadence |
| R-007 | GAP-TEST-001 | No mature verification strategy increases regression risk | Both | High | Medium | P2 | QA + Tech Lead | Define minimum release verification matrix |
| R-008 | GAP-DB-001 | PostgreSQL translation limits undocumented; runtime incompatibilities hidden | Leeku-POSTGRESQL | Medium | Medium | P2 | Backend Owner + DocArchitect | Publish incompatibility catalog and guardrails |
| R-009 | GAP-DOC-001 | Dual doc trees can diverge and mislead operators | Both | Medium | Medium | P2 | PM + Doc Owner | Define authoritative tree and migration governance |
| R-010 | GAP-OBS-001 | Limited observability evidence delays incident detection | Both | Medium | Medium | P3 | SRE/Platform + DocOps | Establish baseline monitoring and alert ownership |
| R-011 | GAP-OWN-001 | Missing owner cadence enables documentation decay | Both | Medium | Low | P3 | Project Manager | Define owner registry and freshness SLA |

## 2. Top Risk Summary

1. R-001 (PostgreSQL DR mismatch) is the primary operational blocker.
2. R-002 and R-003 drive cross-branch reliability and integration instability.
3. R-004 compounds incident risk through deployment ambiguity.

## 3. Escalation Rules

- Any unresolved P1 risk blocks production-readiness sign-off unless explicitly risk-accepted by governance owner.
- P2 risks require planned closure window and owner commitment.
- P3 risks are tracked with periodic governance review cadence.
