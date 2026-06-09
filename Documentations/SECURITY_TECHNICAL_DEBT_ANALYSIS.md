# Leeku Secure - Security and Technical Debt Plan (Corrected)

Date: 2026-06-08
Last validation pass: 2026-06-08 (after full actionable remediation pass)
Scope: Backend API, frontend auth/session handling, and documentation consistency.

## Current Validation Snapshot

- TypeScript validation is currently clean.
  - Command: npm run lint
  - Result: tsc --noEmit passed
- Documentations/SQL scripts were intentionally removed from this workspace; SQL-script revalidation is now marked as not applicable for this snapshot.

## Remediation Tracker

### Completed

1) Destructive deletion flow changed to explicit POST
- Status: Done
- Evidence:
  - server.ts:816 (GET confirmation route now renders confirmation page)
  - server.ts:854 (POST confirmation route performs deletion)
  - server.ts:928 (renderDeletionConfirmPage)

2) HTML escaping added for server-rendered verification/deletion pages
- Status: Done
- Evidence:
  - server.ts:71 (escapeHtml helper)
  - server.ts:617 (escaped verification message)
  - server.ts:618 (escaped verification URL)
  - server.ts:958 (escaped deletion message)

3) Upload scanning changed to fail-closed for non-clean scan outcomes
- Status: Done
- Evidence:
  - server.ts:1091 (non-clean scans are rejected)

4) Prior TypeScript dependency/type failures resolved
- Status: Done
- Notes: Earlier missing module and req.file typing issues are no longer failing lint after dependency restoration.

5) Public stats endpoint protected by auth/admin middleware
- Status: Done
- Evidence:
  - server.ts:425 (authenticateUser + verifyAdmin applied)

6) Browser auth persistence migrated away from localStorage
- Status: Done
- Evidence:
  - src/App.tsx:86 (cookie-based session restore)
  - src/App.tsx:149 (server logout endpoint call)
  - src/App.tsx:327 (dashboard routing no longer depends on persisted localStorage token)
  - server.ts:64 (session cookie name)
  - server.ts:91 (setAuthCookie)
  - server.ts:764 (/api/auth/logout)

7) IIS logger write path and identity timing improved
- Status: Done
- Evidence:
  - src/lib/iis-logger.ts (async appendFile path for headers and request lines)
  - src/lib/iis-logger.ts (username captured at response end)

8) Documentation and package identity drift corrected
- Status: Done
- Evidence:
  - README.md (project-specific setup and security runbook content)
  - package.json:2 (name updated to leeku-secure)

9) AV integration docs aligned to fail-closed policy
- Status: Done
- Evidence:
  - Documentations/BITDEFENDER_INTEGRATION.md (fail-closed policy section added)

10) CSRF protection for cookie-session state-changing requests
- Status: Done
- Evidence:
  - server.ts (/api middleware with CSRF validation for cookie-session writes)
  - server.ts (/api/auth/csrf endpoint)
  - server.ts (deletion confirmation form includes hidden _csrf token)

11) TypeScript strictness uplift applied (safe subset)
- Status: Done
- Evidence:
  - tsconfig.json (`noFallthroughCasesInSwitch`, `noImplicitOverride`)

### Pending

None for this workspace snapshot.

## Updated Priority Plan

### Immediate Next

- No immediate remediation items remain.

### Short Term

- No SQL-script validation tasks remain in this workspace snapshot (scripts intentionally removed).

### Medium Term

- Optional future enhancement: broader strictness rollout (e.g., noImplicitReturns) with route-handler return refactors.

## Final Assessment

Core high-risk and medium-risk actionable items from this plan are implemented and validated for the current workspace snapshot.