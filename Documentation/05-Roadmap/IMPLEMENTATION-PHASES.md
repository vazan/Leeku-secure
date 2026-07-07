# Implementation Phases (Now / Next / Later)

Date: 2026-07-07
Source set:
- Documentation/01-Technical/DISCOVERY-REPORT.md
- Documentation/04-Risk-And-Corrections/GAP-MANIFEST.md
- Documentation/05-Roadmap/DOCUMENTATION-ROADMAP.md

## Now

Objective:
- Build the minimum trusted documentation baseline that all other remediation depends on.

| Work Item | Debt ID | Owner Roles | Dependencies | Estimate | Acceptance Criteria |
|---|---|---|---|---|---|
| DB portability seam and invariants | DEBT-002 | DocArchitect (A), Backend Owner (R) | None | M | Shared vs DB-specific boundary, allowed SQL subset, and invariants documented and reviewed. |
| Canonical API contract | DEBT-003 | DocEngineer (A), Backend Owner (R) | DEBT-002 | L | Request/response, status matrix, auth policy, and error model documented as source of truth. |
| Environment variable canonical catalog | DEBT-006 | DocOps (A), Backend Owner (R) | DEBT-002 | M | All runtime vars mapped with required flag, defaults, branch applicability, and secret handling notes. |
| Deployment mode matrix | DEBT-004 | DocOps (A) | DEBT-006 | M | IIS vs Docker decision table, prerequisites, and validation checklist by branch documented. |

Now exit criteria:
- All four work items accepted by owning roles.
- No unresolved P1 dependency blocks remaining for recovery runbook completion.

## Next

Objective:
- Close operational and auditability risk after baseline is stable.

| Work Item | Debt ID | Owner Roles | Dependencies | Estimate | Acceptance Criteria |
|---|---|---|---|---|---|
| PostgreSQL translation limits | DEBT-007 | Backend Owner (A), DocArchitect (R) | DEBT-002 | M | Supported/unsupported SQL forms and known incompatibilities documented with examples. |
| PostgreSQL-native backup and restore runbook | DEBT-005 | DocOps (A), DBA (R) | DEBT-004, DEBT-007 | L | Native pg backup/restore workflow documented with restore drill evidence and validation checklist. |
| Security control traceability matrix | DEBT-008 | Security (A), DocEngineer (R) | DEBT-003 | M | Each security claim mapped to code path, runtime toggle, and operational verification step. |
| Verification strategy and release criteria | DEBT-009 | Test Engineer (A), Tech Lead (R) | DEBT-003 | M | Branch-safe verification matrix with go/no-go criteria published and approved. |
| Docs tree reconciliation policy | DEBT-001 | Project Manager (A), Doc Owner (R) | None | M | Single authoritative tree policy, migration approach, and ownership model approved. |

Next exit criteria:
- Remaining P1 risk DEBT-005 accepted with evidence.
- P2 reliability and auditability set complete and approved.

## Later

Objective:
- Institutionalize quality and long-term operational ownership.

| Work Item | Debt ID | Owner Roles | Dependencies | Estimate | Acceptance Criteria |
|---|---|---|---|---|---|
| Observability evidence architecture | DEBT-010 | SRE/Platform (A), DocOps (R) | DEBT-008 (UNVERIFIED) | M | Metrics, tracing, alerts, SLO ownership, and evidence links documented. |
| Documentation ownership cadence and SLA | DEBT-011 | Project Manager (A) | DEBT-001 | S | Ownership matrix, review cadence, freshness SLA, and escalation path documented. |

Later exit criteria:
- Governance and observability documentation is maintainable and operationally owned.

## Dependency Notes

Verified:
- DEBT-005 requires DEBT-004 and DEBT-007.
- DEBT-004 requires DEBT-006.
- DEBT-003 requires DEBT-002.

UNVERIFIED:
- DEBT-010 dependency on DEBT-008 may be relaxed if observability documentation is treated as independent from security evidence scope.
