# BACKUP AND RESTORE (MSSQL + POSTGRESQL)

Date: 2026-07-07
Scope: Leeku-MSSQL and Leeku-POSTGRESQL
Sources:
- Documentation/01-Technical/DISCOVERY-REPORT.md
- Documentation/04-Risk-And-Corrections/GAP-MANIFEST.md

## 1. Executive Statement

P1 risk confirmed:
- GAP-OPS-001 documents that Leeku-POSTGRESQL/scripts/backup.ps1 follows SQL Server backup semantics (BACKUP DATABASE, RESTORE VERIFYONLY, sqlcmd), which is incompatible as canonical PostgreSQL recovery procedure.

Impact:
- High probability of recovery failure during PostgreSQL incident restoration.

## 2. Branch-Specific Backup Runbook

### 2.1 Leeku-MSSQL

Operational stance:
- Existing script pattern is aligned to SQL Server semantics.

Operator checklist:
1. Execute backup according to MSSQL script conventions.
2. Verify generated artifacts and integrity manifest.
3. Store artifact metadata and retention context.
4. Schedule periodic restore rehearsal in non-production.

### 2.2 Leeku-POSTGRESQL

Operational stance:
- Current backup script cannot be accepted as PostgreSQL-native runbook evidence.

Operator checklist:
1. Do not sign off DR readiness using current PostgreSQL backup script alone.
2. Use DBA-approved PostgreSQL-native backup process until corrected script/runbook is published.
3. Record each backup with method, artifact location, and validation outcome.
4. Require restore drill evidence prior to production readiness declaration.

UNVERIFIED STEP:
- PostgreSQL-native command sequence and restore drill artifact are not evidenced in supplied sources.

## 3. Branch-Specific Restore Runbook

### 3.1 Leeku-MSSQL

1. Enter controlled maintenance window.
2. Validate backup artifact integrity.
3. Restore DB and vault data using approved SQL Server process.
4. Validate health and critical user flows before reopening traffic.

### 3.2 Leeku-POSTGRESQL

1. Enter controlled maintenance window.
2. Execute PostgreSQL-native restore process (DBA-approved).
3. Validate readiness and critical user flows.
4. Record RTO/RPO and residual deviations.

UNVERIFIED STEP:
- Repository-scoped PostgreSQL restore command playbook is missing from provided evidence.

## 4. Required Corrective Actions

1. P1: Replace PostgreSQL backup script with PostgreSQL-native backup+verify procedure.
2. P1: Publish and validate PostgreSQL restore drill runbook.
3. P2: Add backup/restore acceptance criteria with evidence retention template.
4. P2: Add periodic restore drill cadence and owner.
