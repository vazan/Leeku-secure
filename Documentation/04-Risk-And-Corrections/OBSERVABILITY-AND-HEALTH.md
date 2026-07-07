# OBSERVABILITY AND HEALTH (MSSQL + POSTGRESQL)

Date: 2026-07-07
Scope: Leeku-MSSQL and Leeku-POSTGRESQL
Sources:
- Documentation/01-Technical/DISCOVERY-REPORT.md
- Documentation/04-Risk-And-Corrections/GAP-MANIFEST.md

## 1. Current Health Evidence

Confirmed by discovery inputs:
- Health endpoints and IIS-style logging are present in both branches.
- PostgreSQL branch includes container health-related assets.

## 2. Branch-Specific Health Runbook

### 2.1 Leeku-MSSQL

1. Validate liveness and readiness after startup and after maintenance windows.
2. Track maintenance transitions and dependency issues (DB, vault, scanner).
3. Record readiness failures as incident candidates.

### 2.2 Leeku-POSTGRESQL

1. Validate readiness in selected mode (host/Docker).
2. In Docker mode, verify DB service health before app readiness evaluation.
3. Track translation-layer and DB readiness related degradations.

## 3. Monitoring Maturity Assessment

- Gap reference: GAP-OBS-001 (P3).
- Observability architecture is weakly evidenced beyond endpoint/log presence.

NOT CONFIGURED:
- Centralized metrics stack
- Distributed tracing
- Alert-routing/on-call integration
- SLO ownership and error-budget policy

## 4. Minimum Interim Monitoring Controls

1. Poll live and ready endpoints continuously.
2. Trigger alerts on repeated readiness failures.
3. Trigger alerts on scanner timeout/unavailable patterns.
4. Trigger alerts when maintenance mode auto-enables unexpectedly.

UNVERIFIED STEP:
- Formal threshold values and retention policies are not evidenced by supplied inputs.

## 5. Priority Corrections

- P2: Define branch-aware alert catalog and ownership.
- P3: Define baseline SLO set for auth/upload/download/readiness.
- P3: Introduce metrics/tracing architecture decision record.
