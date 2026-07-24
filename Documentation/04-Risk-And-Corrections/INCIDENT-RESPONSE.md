# INCIDENT RESPONSE (MSSQL + POSTGRESQL)

Date: 2026-07-07
Scope: Leeku-MSSQL and Leeku-POSTGRESQL
Sources:
- Documentation/01-Technical/DISCOVERY-REPORT.md
- Documentation/04-Risk-And-Corrections/GAP-MANIFEST.md

## 1. Severity Model

- SEV-1: service outage, data integrity threat, or unresolved recovery blocker.
- SEV-2: major functional degradation with partial workaround.
- SEV-3: localized degradation with low blast radius.

## 2. Core Response Flow

1. Detect: identify symptom source and affected branch.
2. Triage: classify severity and business impact.
3. Contain: activate maintenance controls when integrity risk exists.
4. Recover: execute branch-specific runbook.
5. Validate: health checks and business-critical smoke tests.
6. Record: timeline, root cause, action owner, due date.

## 3. Branch-Specific Incident Runbooks

### 3.1 Leeku-MSSQL

Primary scenarios:
1. Database availability degradation.
2. Scanner outage affecting production startup/operations.
3. Vault/UNC path access instability.

Actions:
1. Stabilize dependencies (DB/scanner/vault).
2. Use maintenance controls during high-risk operations.
3. Re-validate readiness and key flows before normal traffic.

### 3.2 Leeku-POSTGRESQL

Primary scenarios:
1. DB/container readiness mismatch in Docker mode.
2. SQL translation compatibility regression.
3. Recovery operation failure due to non-native backup script path.

Actions:
1. Validate runtime mode and DB readiness first.
2. Contain translation-sensitive operations where failures occur.
3. Escalate to P1 when DR path depends on SQL Server backup semantics.

UNVERIFIED STEP:
- End-to-end PostgreSQL restore drill sequence is not evidenced.

## 4. Incident Communication Requirements

1. First status update within incident SLA.
2. Explicit branch impacted in every update.
3. P1 escalation path includes PM + Ops + Security + Backend owner.
4. Closure requires documented corrective actions and verification evidence.

## 5. Priority Incident Improvements

- P1: Add tested PostgreSQL restore incident runbook.
- P2: Add branch-specific incident checklists for portability seam regressions.
- P3: Add alerting-driven incident trigger standards once observability stack is defined.
