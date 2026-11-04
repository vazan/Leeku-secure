# AUDIT-PLAN — Leeku Secure MSSQL Security Audit

**Date:** 2026-11-04
**Auditor role:** QaEngineer (working solo; subagent dispatch waived — see Consolidation §Auto-validation)
**Repo:** Leeku-secure-mssql
**Branch audited:** `fix/files-shared-tab-names` (working tree clean)

## 1. Objectives

Produce a report of **HIGH and CRITICAL** security issues that are **triggerable by an
end-user** (unauthenticated public visitors or any authenticated account) and should be
remediated. Internal-network-only threats, admin-only functionality, and build/dev-time
dependency weaknesses are out of scope unless they can be driven by an end-user.

## 2. Scope

**In scope (end-user reachable):**
- Authentication & session management (register / login / JWT / refresh / logout / delete-account)
- CSRF protection
- File upload (direct + resumable), download, preview, thumbnail, versioning
- File/folder share links (public + folder sharing) and prepared-download sessions
- Profile picture upload + public avatar endpoint
- Account/email verification flows
- Rate limiting / lockout behaviour

**Out of scope (not end-user triggerable):**
- Admin-only routes (`/api/admin/*`) short of privilege escalation via an end-user path
- Internal-network-only surfaces (UNC mount, maintenance toggle, desktop-update artifacts)
- Build/dev-time tooling (`shadcn`, `glob`, `minimatch`, `deepmerge`) — low/moderate npm audit only

## 3. Methodology

1. Static code review of `src/server.ts` (6 887 lines) and all handlers in `src/server/`.
2. Verify authorization (ownership) checks, parameterization (SQL injection), input
   sanitisation (path traversal), and cryptographic usage in `src/server/utils/`.
3. `npm audit` for dependency advisories (documented as a runtime limitation — see report).
4. Classify findings CRITICAL / HIGH / MEDIUM / LOW; report only HIGH/CRITICAL.

## 4. Success Criteria

- Every reported finding has **direct code evidence** (file:line) and is **end-user triggerable**.
- Each finding includes an actionable remediation.
- Final quality score reported with the CONDITIONAL gate applied if score < 7.0.

## 5. Deliverables

- `QA-VALIDATION-REPORT.md` (project root)
- This audit plan under `memories/session/audit-plan.md`
