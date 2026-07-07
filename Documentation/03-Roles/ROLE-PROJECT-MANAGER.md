# ROLE GUIDE - PROJECT MANAGER

Date: 2026-07-07
Scope: Leeku-MSSQL and Leeku-POSTGRESQL
Inputs:
- Documentation/01-Technical/DISCOVERY-REPORT.md
- Documentation/04-Risk-And-Corrections/GAP-MANIFEST.md

## Mandate

Own delivery governance for documentation debt, risk acceptance, and cross-role execution cadence.

## Responsibilities

1. Prioritize and sequence P1/P2/P3 documentation and operational debt.
2. Enforce ownership, due dates, and status transparency for each gap.
3. Gate releases on unresolved P1 risks unless formally accepted.
4. Resolve documentation tree governance and ownership model.
5. Ensure post-incident corrective actions are tracked to completion.

## Branch-Specific Focus

### Leeku-MSSQL

- Ensure MSSQL runbook and risk controls remain current and validated.

### Leeku-POSTGRESQL

- Escalate PostgreSQL backup mismatch as immediate delivery risk.
- Drive decision and execution for Docker/IIS deployment governance.

## Priority Work Queue

- P1 oversight: GAP-OPS-001, GAP-API-001, GAP-ARCH-001, GAP-DEPLOY-001.
- P2 oversight: GAP-ENV-001, GAP-SEC-001, GAP-TEST-001, GAP-DB-001, GAP-DOC-001.
- P3 oversight: GAP-OBS-001, GAP-OWN-001.

## Governance Cadence

1. Weekly risk board with role owners.
2. Biweekly documentation freshness review.
3. Monthly recovery-readiness and incident trend review.

## Handoffs

- To Ops/Security/Backend/QA: prioritized action list with deadlines.
- To stakeholders: accepted vs unaccepted residual risk and delivery impact.

## Acceptance Criteria

1. Each gap has owner, priority, target date, and current state.
2. No P1 item remains without explicit mitigation path.
3. Documentation governance drift (dual tree risk) has approved reconciliation plan.
4. Corrective actions are closed only with evidence.
