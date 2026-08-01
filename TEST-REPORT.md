# Folder Sharing Test Report

Date: 2026-07-31

## Passed

- VS Code workspace diagnostics: no TypeScript errors across the workspace.
- Focused diagnostics: server routes, application router, public folder page, dashboard, and shared types report no errors.
- Static security review: recursive SQL scopes every file query to the shared root; password and expiry checks gate manifests and download preparation; file secret keys remain mandatory; final retrieval rechecks link activity/expiry and requires a random one-time session plus a separate 256-bit access token.
- Schema parity review: migration and canonical schema include `folder_share_links`, one-row-per-folder and token uniqueness constraints, cascade deletion, defaults, and active/expiry index.

## Not executed

- PostgreSQL-backed HTTP integration tests. This workspace does not expose a configured test database or an HTTP integration harness.
- Browser screenshot and responsive visual checks. No browser automation tool is available in this session.

Release requires running the integration and browser scenarios in `TEST-PLAN.md` against a migrated non-production environment.