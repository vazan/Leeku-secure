# ROLE GUIDE - QA ENGINEER

Date: 2026-07-07
Scope: Leeku-MSSQL and Leeku-POSTGRESQL
Inputs:
- Documentation/01-Technical/DISCOVERY-REPORT.md
- Documentation/04-Risk-And-Corrections/GAP-MANIFEST.md

## Mandate

Own evidence-based verification strategy for branch-safe releases and operational regressions.

## Responsibilities

1. Define minimum verification matrix while automation is limited.
2. Ensure branch-specific regression checks cover API, health, and recovery-critical paths.
3. Validate incident fixes with reproducible acceptance checks.
4. Track test debt and release risk exposure in collaboration with PM/Tech Lead.

## Branch-Specific Focus

### Leeku-MSSQL

- Verify core auth, file, maintenance, and health behaviors per release.
- Validate MSSQL backup/restore smoke drill checkpoints where available.

### Leeku-POSTGRESQL

- Add targeted regression tests for translation-dependent queries.
- Block release readiness sign-off when PostgreSQL DR evidence is incomplete.

## Priority Work Queue

- P2: GAP-TEST-001 minimum verification strategy and release criteria.
- P2 support: GAP-DB-001 translation incompatibility regression coverage.
- P1 support: GAP-OPS-001 restore validation evidence criteria.

## Handoffs

- To Backend Engineer: reproducible defects and failing scenarios.
- To Ops Engineer: runbook validation outcomes and recoverability findings.
- To Security Engineer: security-related behavioral regressions.
- To Project Manager: release confidence and outstanding risk statement.

## Acceptance Criteria

1. Every release has an explicit verification evidence pack.
2. Branch-specific test differences are documented, not implied.
3. P1 gaps are represented in go/no-go checklist.
4. Failed checks include owner, ETA, and retest requirements.
