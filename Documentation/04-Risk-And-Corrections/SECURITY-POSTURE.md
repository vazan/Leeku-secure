# SECURITY POSTURE (MSSQL + POSTGRESQL)

Date: 2026-07-07
Scope: Leeku-MSSQL and Leeku-POSTGRESQL
Sources:
- Documentation/01-Technical/DISCOVERY-REPORT.md
- Documentation/04-Risk-And-Corrections/GAP-MANIFEST.md

## 1. Security Baseline (Evidence-Constrained)

Confirmed by discovery inputs:
- Security utilities are present and wired: encryption, scanner integration, production validation.
- Health readiness includes DB + vault + scanner checks in production context.
- PostgreSQL branch uses translation layer for SQL Server-style patterns.

## 2. Branch-Specific Security Runbook

### 2.1 Leeku-MSSQL

1. Validate production startup guardrails (required envs, scanner availability, vault access).
2. Confirm readiness state before traffic enablement.
3. Confirm backup/restore control path remains SQL Server-aligned and auditable.

### 2.2 Leeku-POSTGRESQL

1. Validate production startup guardrails identically.
2. Confirm DB portability seam assumptions for affected modules before release.
3. Treat DR controls as non-compliant until PostgreSQL-native backup/restore evidence exists.

UNVERIFIED STEP:
- Full security validation protocol for PostgreSQL-native restore workflow is not evidenced.

## 3. Priority Security Risks

- P1 linked risk: GAP-OPS-001 creates availability and integrity exposure for PostgreSQL recovery.
- P1 linked risk: GAP-ARCH-001 lacks explicit portability boundary, increasing hidden regression/security behavior drift.
- P2 linked risk: GAP-SEC-001 missing control-to-evidence mapping reduces audit confidence.

## 4. Immediate Security Corrections

1. P1: Require PostgreSQL-native backup/restore control set with verification evidence.
2. P1: Document allowed SQL subset and unsupported patterns for portability seam.
3. P2: Publish security control traceability matrix (claim -> code path -> runtime gate -> owner).
4. P2: Define minimum alerting for scanner failures and readiness degradation.

## 5. Security Assurance Status

NOT CONFIGURED:
- Centralized SIEM, IDS/EDR documentation, and CI/CD security gates are not evidenced by the supplied inputs.
