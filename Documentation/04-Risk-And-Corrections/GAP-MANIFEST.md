# GAP MANIFEST - SHARED DOC BASE (MSSQL + POSTGRESQL)

Date: 2026-07-07  
Scope: `Leeku-MSSQL`, `Leeku-POSTGRESQL`

## Priority Model

- P1: Blocking for reliable production documentation and branch-safe operations.
- P2: Important for operational robustness and auditability.
- P3: Quality and maintainability improvements.

## Prioritized Gap Table

| Gap ID | Area | Current Evidence | Missing / Weakly-Evidenced Content | Impact | Priority | Suggested Owner |
|---|---|---|---|---|---|---|
| GAP-OPS-001 | Backup/Restore Parity | `Leeku-POSTGRESQL/scripts/backup.ps1` still uses `BACKUP DATABASE`, `RESTORE VERIFYONLY`, `sqlcmd` pattern; MSSQL script uses same commands | PostgreSQL-native backup and restore runbook + validated restore drill evidence | High incident recovery failure risk on PostgreSQL branch | P1 | DocOps + DBA |
| GAP-API-001 | Canonical API Contract | Route mounts and modular routers are evident in both `src/server.ts` and `src/server/routes/*` | Source-of-truth request/response contract (status matrix, auth policy, errors) in shared docs tree | Integration drift and onboarding friction | P1 | DocEngineer + Backend Owner |
| GAP-ARCH-001 | DB Portability Boundary | PostgreSQL adapter explicitly translates SQL Server-style SQL in `Leeku-POSTGRESQL/src/server/db.ts` (`translateQuery`) | Explicit architecture seam doc: allowed SQL subset, unsupported patterns, and invariants for cross-branch safety | Hidden regressions during branch sync and DB migration work | P1 | DocArchitect + Backend Owner |
| GAP-DEPLOY-001 | Deployment Mode Matrix | PostgreSQL has Docker assets; README language also indicates Windows/IIS intent | Unified decision matrix for IIS vs Docker paths, prerequisites, and validation checklist by branch | Environment-specific outages and operator confusion | P1 | DocOps |
| GAP-ENV-001 | Environment Variable Canon | `.env.example` exists in both branches; production validation logic checks critical vars in `production.ts` | Generated env var catalog from actual `process.env` usage including defaults, required flags, and secret handling guidance | Misconfiguration risk in production and staging | P2 | DocOps + Backend Owner |
| GAP-SEC-001 | Security Control Traceability | Scanner/encryption/production guard modules are present and wired | Control-to-evidence matrix mapping each security claim to code path and runtime toggle | Audit/compliance friction and claim ambiguity | P2 | Security + DocEngineer |
| GAP-TEST-001 | Verification Strategy | `Leeku-MSSQL/CONTRIBUTING.md` states no automated tests/no test runner/no CI test step | Minimum verification matrix and branch-safe release criteria until test suite exists | High regression probability | P2 | Test Engineer + Tech Lead |
| GAP-DB-001 | PostgreSQL Translation Limits | PostgreSQL branch relies on SQL token translation compatibility layer | Documented limits and known incompatibilities (query forms, stored-procedure assumptions, edge SQL syntax) | Runtime defects hidden behind partial compatibility | P2 | Backend Owner + DocArchitect |
| GAP-DOC-001 | Docs Tree Reconciliation | Workspace contains both `Documentation/` and `Documentations/`; README links branch-local docs not found in scanned branch folders | Single authoritative doc tree policy + ownership and migration plan | Staleness and contradictory guidance | P2 | Project Manager + Doc Owner |
| GAP-OBS-001 | Observability Evidence | Health endpoints and IIS-style logging are evident | Evidence-backed observability architecture (metrics/tracing/alerts/SLO ownership) | Slower incident detection and triage | P3 | SRE/Platform + DocOps |
| GAP-OWN-001 | Documentation Ownership Cadence | No explicit owner registry found for document families | Ownership matrix, review cadence, and freshness SLA | Documentation decay over time | P3 | Project Manager |

## Shared vs DB-Specific Gap Focus

Shared-core docs required once:
- API surface, auth/session model, security model, and operational workflows.
- Baseline env var catalog and production validation rules.

DB-specific appendices required:
- MSSQL adapter and SQL Server operations.
- PostgreSQL adapter translation caveats, native backup/restore, and Docker-first deployment path.

## Explicit Unknowns to Resolve

- Unknown: Canonical API schema artifact location (OpenAPI/Swagger/JSON schema).
- Unknown: CI/CD definitions in workspace scope (`.github/workflows` not found).
- Unknown: Definitive status/location of README-referenced internal documentation trees.

## Documentation Debt Score

Debt score: 76/100.

Rationale:
- Increased by P1 operational mismatch (PostgreSQL backup script pattern) and missing canonical API contract.
- Increased by DB portability seam without a formal boundary contract.
- Slightly reduced by strong code-level parity and existing security/health modules with clear evidence.

## Confidence by Major Section

- Gap prioritization confidence: High
- Impact estimation confidence: Medium-High
- Unknowns register confidence: High
- Debt score confidence: Medium
