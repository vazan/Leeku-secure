# Leeku Secure - Release Checklist

Date: 2026-06-08
Scope: Workspace snapshot after security and technical-debt remediation pass.

## 1. Pre-Release Validation

- [ ] Run type check:
  - `npm run lint`
- [ ] Confirm no local auth token persistence in frontend:
  - Verify `src/App.tsx` has no `localStorage` auth reads/writes.
- [ ] Confirm cookie-session auth path is active:
  - `server.ts` sets and clears session cookie (`setAuthCookie`, `clearAuthCookie`).
- [ ] Confirm CSRF protection is active for cookie-authenticated write requests:
  - `server.ts` middleware `requireCsrfForCookieSession` is mounted on `/api`.
- [ ] Confirm `/api/stats` is protected by auth + admin middleware.
- [ ] Confirm upload fail-closed policy for scanner non-clean outcomes.

## 2. Security Regression Checks

- [ ] Login flow:
  - Login succeeds.
  - `Set-Cookie` for session is returned.
- [ ] Session restore:
  - Reload page and verify `/api/auth/me` restores user session from cookie.
- [ ] Logout:
  - `POST /api/auth/logout` clears session and CSRF cookies.
- [ ] CSRF enforcement:
  - Cookie-session `POST` without valid CSRF token is rejected (`403`).
  - Cookie-session `POST` with valid CSRF token succeeds.
- [ ] Account deletion flow:
  - GET confirm endpoint only renders confirmation page.
  - Deletion occurs only on POST confirm.
- [ ] HTML escaping:
  - Server-rendered verification/deletion pages do not render raw injected HTML.

## 3. Operational Checks

- [ ] Verify environment configuration for production:
  - `NODE_ENV=production`
  - Strong `COOKIE_SECRET_BASE64`
  - Strong `MASTER_KEY_BASE64`
  - Correct `ALLOWED_ORIGINS`
  - Correct SQL connection settings
- [ ] Confirm IIS logging path is writable.
- [ ] Confirm AV scanner path and timeout settings are valid.
- [ ] Confirm SMTP settings if verification/deletion emails are required.

## 4. Documentation Checks

- [ ] Confirm README reflects current architecture and run instructions.
- [ ] Confirm Bitdefender guide reflects fail-closed policy.
- [ ] Confirm security/debt tracker is up to date.

## 5. Release Build

- [ ] Build artifacts:
  - `npm run build`
- [ ] Start production server locally (smoke test):
  - `npm run start`
- [ ] Perform smoke checks:
  - Landing page
  - Auth login/register
  - Dashboard access
  - File upload/download
  - Share flow

## 6. Git Hygiene

- [ ] Review changes:
  - `git status --short`
  - `git diff`
- [ ] Stage intended files only.
- [ ] Commit with clear message.
- [ ] Tag release if applicable.

## 7. Post-Deploy Verification

- [ ] Re-run critical API smoke tests in deployed environment.
- [ ] Verify `/api/stats` admin-only access in deployed environment.
- [ ] Verify CSRF rejection behavior in deployed environment.
- [ ] Verify AV fail-closed behavior in deployed environment.
- [ ] Verify logs show expected request/audit events.

## Notes

- `Documentations/SQL` scripts and `leeks_db.json` are intentionally deleted in this workspace snapshot.
- If SQL scripts are later restored, run a separate SQL migration/grants consistency review before release.