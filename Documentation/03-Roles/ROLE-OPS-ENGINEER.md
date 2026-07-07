# ROLE GUIDE - OPS ENGINEER

Date: 2026-07-07
Scope: Leeku-MSSQL and Leeku-POSTGRESQL
Inputs:
- Documentation/01-Technical/DISCOVERY-REPORT.md
- Documentation/04-Risk-And-Corrections/GAP-MANIFEST.md

## Mandate

Own runtime reliability, branch-safe deployment operations, backup/restore readiness, and incident containment workflows.

## Responsibilities

1. Maintain branch-specific runbooks for MSSQL and PostgreSQL.
2. Operate deployment mode decisions (IIS vs Docker where applicable).
3. Validate operational health baseline (live/ready checks and maintenance controls).
4. Coordinate backup and restore drill cadence with DBA/security.
5. Keep operational risk status synchronized with risk register.

## Branch-Specific Focus

### Leeku-MSSQL

- Operate SQL Server aligned backup and restore process.
- Validate production startup and health readiness before release acceptance.

### Leeku-POSTGRESQL

- Treat current backup script mismatch as P1 blocker (GAP-OPS-001).
- Require PostgreSQL-native DR workflow evidence before production sign-off.
- Apply Docker-first operational checks where container mode is selected.

## Priority Work Queue

- P1: GAP-OPS-001 backup/restore parity.
- P1: GAP-DEPLOY-001 deployment mode matrix finalization.
- P2: GAP-ENV-001 env canon operational verification.
- P3: GAP-OBS-001 observability baseline maturation.

## Handoffs

- To Backend Engineer: deployment/adapter behavior anomalies and startup blockers.
- To Security Engineer: scanner/production guard regressions and hardening deviations.
- To QA Engineer: release verification matrix inputs and incident regression scenarios.
- To Project Manager: unresolved P1/P2 risks and schedule impact.

## Acceptance Criteria

1. Branch context is explicit in every operational change ticket.
2. No production release proceeds with unresolved P1 operational risk.
3. Recovery readiness is evidenced by branch-appropriate drill artifacts.
4. Incident timeline and corrective owner are recorded within SLA.
