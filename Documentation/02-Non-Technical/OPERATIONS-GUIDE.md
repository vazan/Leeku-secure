# OPERATIONS GUIDE (MSSQL + POSTGRESQL)

Date: 2026-07-07
Scope: Leeku-MSSQL and Leeku-POSTGRESQL
Sources:
- Documentation/01-Technical/DISCOVERY-REPORT.md
- Documentation/04-Risk-And-Corrections/GAP-MANIFEST.md

## 1. Purpose

This guide defines branch-safe operations for deployment mode selection, health checks, incident containment, and backup/restore readiness.

## 2. Operating Principles

1. Operate with explicit branch context before any change or recovery action.
2. Prefer evidence-backed procedures only; mark non-validated steps as UNVERIFIED STEP.
3. Treat missing monitoring/alerting integrations as NOT CONFIGURED until proven.
4. Escalate all P1 gaps from GAP-MANIFEST immediately.

## 3. Deployment Mode Decision Matrix

| Branch | Evidenced Runtime Modes | Recommended Primary Mode | Preconditions | Validation Gate |
|---|---|---|---|---|
| Leeku-MSSQL | Windows/IIS style app operation language in discovery | IIS/Windows-hosted Node process | Vault access, DB reachability, scanner availability in production | Health liveness and readiness pass |
| Leeku-POSTGRESQL | Docker assets present (Dockerfile, docker-compose, entrypoint wait) and Windows/IIS language also present | Docker-first in environments with container support | DB container healthy, app container can resolve DB host, vault mounted/accessible | Health liveness and readiness pass |

Operational warning:
- GAP-DEPLOY-001 remains open until one canonical per-environment decision policy is approved.

## 4. Branch-Specific Runbook Sections

### 4.1 Leeku-MSSQL Runbook

Startup:
1. Confirm production-required environment variables are set.
2. Confirm scanner dependency and vault path access.
3. Start app process and verify health endpoints.

Steady-state checks:
1. Poll live and ready health endpoints.
2. Track maintenance mode status during file-impacting operations.
3. Verify backup artifact freshness and checksum records.

Shutdown:
1. Use graceful app stop.
2. Confirm background jobs are stopped.
3. Confirm DB and vault connections are closed cleanly.

### 4.2 Leeku-POSTGRESQL Runbook

Startup:
1. Confirm whether runtime is Docker mode or host mode.
2. In Docker mode, verify DB service readiness before app readiness validation.
3. Validate health endpoints after startup.

Steady-state checks:
1. Poll live and ready health endpoints.
2. Monitor translation-layer dependent paths for SQL portability regressions.
3. Validate backup strategy is PostgreSQL-native before declaring recovery-ready.

Shutdown:
1. Gracefully stop app service.
2. In Docker mode, verify compose service stop order and persisted data safety.

UNVERIFIED STEP:
- A validated PostgreSQL-native restore drill is not evidenced in provided sources.

## 5. Backup and Recovery Guardrails

P1 risk statement:
- GAP-OPS-001 identifies that Leeku-POSTGRESQL/scripts/backup.ps1 uses SQL Server command patterns (BACKUP DATABASE, RESTORE VERIFYONLY, sqlcmd), creating high recovery failure risk for the PostgreSQL branch.

Operator rules:
1. Do not certify PostgreSQL DR readiness using the current PostgreSQL backup script.
2. Require PostgreSQL-native backup/restore runbook and restore drill evidence before production readiness sign-off.
3. Keep MSSQL and PostgreSQL backup procedures documented as separate branch appendices.

## 6. Incident Operations Baseline

1. Detect: health degradation, user reports, or operational errors.
2. Triage: identify branch, subsystem, blast radius.
3. Contain: enable maintenance controls when data integrity is at risk.
4. Recover: apply branch-appropriate recovery workflow.
5. Validate: health endpoints plus key user flow checks.
6. Record: timeline, root cause, owner, corrective action.

## 7. Monitoring and Alerting Status

NOT CONFIGURED:
- Centralized metrics/tracing/alert-routing evidence is missing from scoped discovery inputs.

Minimum interim controls:
1. Endpoint polling on live and ready checks.
2. Alert on repeated readiness failures.
3. Alert on scanner unavailability/timeouts.
4. Alert on maintenance auto-enable events.

## 8. Priority Actions

- P1: Close GAP-OPS-001 with PostgreSQL-native backup/restore runbook and validated drill evidence.
- P1: Close GAP-DEPLOY-001 with deployment mode governance by environment and branch.
- P2: Close GAP-ENV-001 with env-variable canon generated from runtime usage.
- P2: Close GAP-SEC-001 with control-to-evidence traceability matrix.

## 9. Evidence Notes

All claims in this guide are constrained to the two supplied source documents.
