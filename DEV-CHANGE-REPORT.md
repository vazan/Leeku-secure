Intent
Implemented GitHub issue #11 by adding an admin workflow to create user accounts with dummy emails and an explicit admin password reset action from the Users tab.

Change class
🟡 STANDARD

Files changed
- src/server.ts: Added admin endpoints for dummy account creation and password reset, including validation, duplicate checks, secure hashing, session revocation, and audit logging.
- src/app/features/files/components/admin-workspace.tsx: Added Users-tab UI for creating dummy users and a dedicated reset-password action button.

Public contracts impacted
- Added API endpoint: POST /api/admin/users/create-dummy
- Request body: { username: string, password: string, quota_id?: string }
- Response success: { success: true, user: User }
- Response errors: 400/500 with { error: string }
- Added API endpoint: POST /api/admin/users/:id/reset-password
- Request body: { password: string }
- Response success: { success: true, user: User }
- Response errors: 400/404/500 with { error: string }

Risks
- Security: Password reset currently uses prompt-based plaintext entry in the browser; functional but not ideal UX/privacy for shared screens.
- Regression: Dummy email derivation uses strict username-driven format; usernames with unsupported characters are rejected intentionally.
- Compatibility: Additive changes only; no existing endpoint contract changed.

Technical debt observed
- MAJOR: Repository lint baseline still reports unrelated JSX namespace issues in maintenance components.

Suggested follow-ups
- XS / MED: Replace prompt-based password reset with a secure modal input field and strength hints.
- S / HIGH: Add integration tests for admin dummy account create/reset flows and permission checks.
- XS / MED: Add server-side rate limiting specific to admin create/reset endpoints.

Test coverage status + handoff hint for test-engineer
- No automated tests were added.
- Handoff focus:
  - Verify admin can create dummy account and resulting email is username@dummy.local.
  - Verify duplicate username rejection and invalid password/username validation.
  - Verify reset-password endpoint revokes active refresh sessions and clears lockout counters.
  - Verify non-admin access is denied for both endpoints.

Validation status
- build: PASSED
  - npm run build completed successfully for frontend and server bundle.
- lint/type-check: UNVERIFIED in this task (known unrelated baseline failures exist in maintenance components).

Approval trail
- Not required (STANDARD change).