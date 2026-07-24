# ROLE GUIDE - SECURITY ENGINEER

Date: 2026-07-07
Scope: Leeku-MSSQL and Leeku-POSTGRESQL
Inputs:
- Documentation/01-Technical/DISCOVERY-REPORT.md
- Documentation/04-Risk-And-Corrections/GAP-MANIFEST.md

## Mandate

Own security control traceability, production hardening assurance, and incident security posture.

## Responsibilities

1. Maintain control-to-evidence mapping for security claims.
2. Validate production guardrails (scanner requirement, secret hygiene, startup checks).
3. Assess branch-specific security risks introduced by DB portability seams.
4. Define incident severity/security triage triggers.
5. Track and report unresolved security debt in risk register cadence.

## Branch-Specific Focus

### Leeku-MSSQL

- Validate SQL Server deployment hardening assumptions.
- Verify backup and restore controls meet confidentiality/integrity requirements.

### Leeku-POSTGRESQL

- Treat non-native backup path as high security+availability risk until corrected.
- Review SQL translation dependency for injection/safety and behavior drift implications.

## Priority Work Queue

- P2: GAP-SEC-001 control-to-evidence matrix completion.
- P1 support: GAP-OPS-001 DR risk mitigation sign-off requirements.
- P2 support: GAP-DB-001 translation compatibility risk documentation.

## Handoffs

- To Ops Engineer: security-required operational controls and release gates.
- To Backend Engineer: control implementation gaps and remediation criteria.
- To QA Engineer: security regression test priorities.
- To Project Manager: risk acceptance decisions requiring business approval.

## Acceptance Criteria

1. No unreferenced security claim in official docs.
2. Security-critical controls have explicit owner and verification cadence.
3. P1 recovery/security blockers are escalated within governance SLA.
4. Incident postmortems include security impact and control effectiveness notes.
