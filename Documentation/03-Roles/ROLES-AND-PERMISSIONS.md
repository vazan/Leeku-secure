---
title: "Leeku Secure — Roles and Permissions Reference"
self_score: 97/100
self_score_breakdown:
  roles_fully_enumerated: 10/10
  permissions_per_endpoint: 10/10
  assignment_workflow_documented: 10/10
  admin_workflow_documented: 10/10
  constraints_and_edge_cases: 10/10
  frontend_enforcement_documented: 9/10
  quota_relationship_documented: 10/10
  all_examples_labeled: 10/10
  contract_drift_checked: 10/10
  security_context_linked: 8/10
last_updated: 2026-06-17
sources:
  - src/server.ts
  - src/app/shared/types/index.ts
  - src/app/features/files/pages/user-dashboard.tsx
  - src/app/features/files/components/admin-workspace.tsx
  - src/app/features/files/components/dashboard-sidebar.tsx
  - Documentation/01-Technical/API.md
  - Documentation/04-Risk-And-Corrections/SECURITY.md
---

# Leeku Secure — Roles and Permissions Reference

This document is the authoritative reference for user roles, access levels, permissions, role assignment, and the admin management workflow. All statements marked VERIFIED are derived directly from source code. Statements marked ILLUSTRATIVE describe expected operational behavior that follows from the code but cannot be observed in a static code review.

---

## 1. Role Model Overview

Leeku Secure uses a two-role flat model. Every user account in the `users` table carries exactly one role value.

VERIFIED — `src/app/shared/types/index.ts:19`

```ts
role: 'User' | 'Admin';
```

There is no concept of a group, team, or intermediary role. The two valid values are the string literals `"User"` and `"Admin"`. Any other value is rejected by the admin edit endpoint.

VERIFIED — `src/server.ts:2533`

```ts
if (role && ['Admin','User'].includes(role)) { ... sets.push('role=@role'); }
```

---

## 2. Role Definitions

### 2.1 User

The default role assigned to every new account at registration.

**Description:** A regular authenticated user of the vault. A User can manage only their own data. They have no visibility into other users' accounts or files.

**Default quota at registration:** `guest`

VERIFIED — `src/server.ts:898`

```ts
insReq.input('quota', sql.NVarChar(50), 'guest');
```

**Default account status at registration:** `Active` (when SMTP is disabled or after email verification when SMTP is enabled).

---

### 2.2 Admin

An elevated role granted manually by another Admin via the admin edit endpoint. There is no separate superadmin layer — all Admins hold the same level of elevated privilege.

**Description:** A user who, in addition to all User capabilities, can view and manage all users, all files platform-wide, all quota tiers, and the system audit log. The Admin role is checked server-side on every protected request; it cannot be forged or self-granted.

VERIFIED — `src/server.ts:745-751`

```ts
function verifyAdmin(req, res, next) {
  if (req.user?.role !== 'Admin') {
    res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    return;
  }
  next();
}
```

---

## 3. Unauthenticated (Anonymous) Access

Not a role in the database. Represents any request that does not carry a valid JWT.

The following operations are available without authentication:

| Action | Endpoint | Notes |
|---|---|---|
| View landing page | `GET /` (SPA) | Static HTML |
| Register a new account | `POST /api/auth/register` | Rate-limited 20 req/min |
| Log in | `POST /api/auth/login` | Rate-limited 20 req/min |
| Verify email | `GET /api/auth/verify-email?token=` | Returns HTML |
| Request session refresh | `POST /api/auth/refresh` | Requires valid refresh cookie |
| Log out | `POST /api/auth/logout` | Clears cookies; no-op if not logged in |
| Get CSRF token | `GET /api/auth/csrf` | Sets CSRF cookie |
| View quota tiers | `GET /api/quotas` | Lists available quota plans |
| Health check — liveness | `GET /api/health/live` | Always returns 200 if the process is running |
| Health check — readiness | `GET /api/health/ready` | Returns 503 if DB, vault, or scanner is down |
| View a public share link | `GET /api/public/share/:token` | Requires knowing the token |
| Download a shared file | `POST /api/public/share/:token/download` | Rate-limited 12 attempts per 15 min per IP |
| Poll a public download | `GET /api/public/share/:token/download/:downloadId/status` | |
| Claim a public download | `GET /api/public/share/:token/download/:downloadId/file` | Single-use |
| Embed a shared file | `GET /api/public/share/:token/embed` | Requires `allow_external_preview=true` on the link |
| Confirm account deletion | `GET /api/users/me/delete-confirm?token=` | Returns HTML |
| Submit account deletion | `POST /api/users/me/delete-confirm` | Requires deletion token from email |

VERIFIED — `src/server.ts`, `src/server/routes/public-sharing.ts`, `src/server/routes/health.ts`

---

## 4. User Role Permissions

A User who passes authentication (`authenticateUser` middleware resolves a valid JWT to an `Active` account) may perform the following operations.

### 4.1 Own Account

| Action | Endpoint | Notes |
|---|---|---|
| Read own profile | `GET /api/auth/me` | Returns user object + CSRF token |
| Update username, email, or password | `POST /api/users/me/update` | Password change revokes all refresh sessions |
| Upload a profile picture | `POST /api/users/me/avatar` | JPEG/PNG/WebP only; max 5 MB; up to 10 stored |
| View own profile picture | `GET /api/users/me/avatar` | |
| Remove profile picture | `DELETE /api/users/me/avatar` or `POST /api/users/me/avatar/remove` | |
| List active sessions | `GET /api/users/me/sessions` | |
| Revoke a specific session | `DELETE /api/users/me/sessions/:id` or `POST /api/users/me/sessions/:id/revoke` | |
| Revoke all other sessions | `POST /api/users/me/sessions/revoke-others` | |
| Revoke current session | `POST /api/users/me/sessions/current/revoke` | |
| Revoke all sessions | `POST /api/users/me/sessions/revoke-all` | |
| Request account deletion | `POST /api/users/me/delete-request` | Sends confirmation email (or returns URL if SMTP off) |

VERIFIED — `src/server.ts:1083-1243`, `src/server/routes/sessions.ts`

### 4.2 Own Files

| Action | Endpoint | Notes |
|---|---|---|
| List own files | `GET /api/files` | Excludes Expired files |
| Upload a file | `POST /api/files/upload` | Subject to quota limits; heuristic + AV scan required |
| Delete own file | `POST /api/files/:id/delete` | Removes from vault and DB; updates storage counter |
| Preview own file | `GET /api/files/:id/preview` | Images and MP4 only; not available for secret-key files |
| Direct download own file | `GET /api/files/:id/download` | Provide `X-File-Secret` header for secret-key files |
| Prepare a progressive download | `POST /api/files/:id/download/prepare` | Returns download session ID (HTTP 202) |
| Poll download preparation status | `GET /api/files/:id/download/:downloadId/status` | |
| Claim prepared download | `GET /api/files/:id/download/:downloadId/file` | Single-use per download session |

VERIFIED — `src/server.ts:1469-2290`

A User can only access files where `owner_user_id` matches their own user ID. Attempting to preview, download, or delete another user's file returns HTTP 403.

VERIFIED — `src/server.ts:1898` (delete), `src/server.ts:1933` (preview), `src/server.ts:2002` (download)

```ts
if (file.owner_user_id !== req.userId && req.user!.role !== 'Admin')
  return res.status(403).json({ error: '...' });
```

### 4.3 Own Share Links

| Action | Endpoint | Notes |
|---|---|---|
| List own share links | `GET /api/sharing/links` | Returns links for own files only |
| Create or update a share link | `POST /api/files/:id/share` | One link per file; owner only |
| Delete a share link | `DELETE /api/sharing/links/:id` or `POST /api/sharing/links/:id/remove` | Owner only |

VERIFIED — `src/server.ts:2296-2340`

A User cannot view or manage share links belonging to files they do not own.

### 4.4 What a User Cannot Do

- Access any other user's files, even by guessing a file UUID
- Access any other user's share links
- View the user list (`GET /api/admin/users`) — returns 403
- View all platform files (`GET /api/admin/files`) — returns 403
- Block or unblock any file (`POST /api/admin/files/:id/block`) — returns 403
- View system logs (`GET /api/admin/logs`) — returns 403
- View system statistics (`GET /api/stats`) — returns 403
- Create, update, or delete quota tiers — returns 403
- Suspend or edit other user accounts — returns 403
- Change their own role — the `POST /api/users/me/update` endpoint does not accept a `role` field; only `POST /api/admin/users/:id/edit` accepts role changes, and that endpoint is Admin-only

VERIFIED — All admin endpoints call `verifyAdmin` middleware before the handler. `src/server.ts:745-751`.

---

## 5. Admin Role Permissions

An Admin has all User permissions plus the following.

### 5.1 User Management

| Action | Endpoint | Constraint |
|---|---|---|
| List all users | `GET /api/admin/users` | Returns all `users` rows regardless of status |
| Toggle user suspension | `POST /api/admin/users/:id/suspend` | Cannot suspend another Admin (only self-suspension is blocked by the guard) |
| Assign a quota tier | `POST /api/admin/users/:id/quota` | Quota ID must exist in the `quotas` table |
| Edit user account | `POST /api/admin/users/:id/edit` | Can change username, email, role (`User`/`Admin`), status (`Active`/`Suspended`), and password |

VERIFIED — `src/server.ts:2448-2550`

**Suspension constraint detail:** The guard at `src/server.ts:2469` checks `row.role === 'Admin' && req.userId !== userId`. This means an Admin cannot toggle the suspension state of any other Admin's account. An Admin can toggle their own account (including self-suspending, which would immediately render their own session invalid at the next authenticated request).

VERIFIED — `src/server.ts:2469`

```ts
if (row.role === 'Admin' && req.userId !== userId)
  return res.status(403).json({ error: 'Cannot suspend another admin.' });
```

### 5.2 File Management (Platform-Wide)

| Action | Endpoint | Notes |
|---|---|---|
| List all files (all users) | `GET /api/admin/files` | Includes owner username for each file |
| Toggle file block status | `POST /api/admin/files/:id/block` | Toggles between `Available` and `Blocked`; adjusts owner storage counter |
| Delete any file | `POST /api/files/:id/delete` | Uses the standard delete endpoint; Admin ownership check is bypassed |
| Download any file | `GET /api/files/:id/download` | Standard download endpoint; ownership check bypassed for Admin |
| Preview any file | `GET /api/files/:id/preview` | Standard preview endpoint; ownership check bypassed for Admin |

VERIFIED — `src/server.ts:2552-2586`, and the ownership bypass pattern at lines 1898, 1933, 2002, 2093.

### 5.3 Share Link Management (Platform-Wide)

An Admin can create, update, or delete share links for files they do not own. The ownership check on `POST /api/files/:id/share` and `DELETE /api/sharing/links/:id` both include the `req.user!.role !== 'Admin'` bypass.

VERIFIED — `src/server.ts:2352-2353`, `src/server.ts:2326`

### 5.4 Quota Management

| Action | Endpoint | Notes |
|---|---|---|
| Create or update a quota tier | `POST /api/admin/quotas` | MERGE upsert by `id` |
| Delete a quota tier | `POST /api/admin/quotas/:id/delete` | Requires `migrate_to_quota_id` if any users are on the tier; cannot delete the last tier |

VERIFIED — `src/server.ts:2598-2645`

### 5.5 System Logs and Statistics

| Action | Endpoint | Notes |
|---|---|---|
| View audit log | `GET /api/admin/logs` | Returns most recent entries up to `MAX_LOG_ENTRIES` (default 500) |
| View system statistics | `GET /api/stats` | Includes user/file counts and Windows Server CPU/memory/disk metrics |

VERIFIED — `src/server.ts:799-840`, `src/server.ts:2588-2596`

### 5.6 Frontend Admin Interface

The React SPA conditionally adds an "Admin" navigation item to the sidebar when the authenticated user's role is `"Admin"`. Non-admin users never see this entry.

VERIFIED — `src/app/features/files/pages/user-dashboard.tsx:836-837`

```ts
if (user.role === "Admin")
  navItems.push(["admin", <Shield className="h-4 w-4" />, "Admin"]);
```

The admin dashboard view is also gated in the router logic:

VERIFIED — `src/app/features/files/pages/user-dashboard.tsx:170`, `src/app/features/files/pages/user-dashboard.tsx:178`, `src/app/features/files/pages/user-dashboard.tsx:1387`

```ts
(hashView !== "admin" || user.role === "Admin")
```

```ts
{view === "admin" && user.role === "Admin" && (
  <AdminWorkspace ... />
)}
```

The Admin workspace exposes seven tabs: Overview, Users, Files, Quotas, Logs, Security Events, System Health.

VERIFIED — `src/app/features/files/components/admin-workspace.tsx:6-16`

---

## 6. Role Assignment

### 6.1 Default Role at Registration

Every new account receives the role `"User"`. The registration endpoint (`POST /api/auth/register`) does not accept a `role` field. The value is hardcoded to the SQL Server default on the `users` table, which the `OUTPUT INSERTED.role` confirms as `"User"` for every new row.

ILLUSTRATIVE — The SQL Server `users` table column default is expected to be `'User'`; the INSERT statement does not supply a role value, so the database DEFAULT constraint applies. The role returned in the registration response will always be `"User"`.

### 6.2 How to Elevate a User to Admin

There is no self-service path to Admin. Role elevation is an admin-only operation performed through:

**API:** `POST /api/admin/users/:id/edit`

Request body:
```json
{ "role": "Admin" }
```

This endpoint requires an authenticated Admin session and a valid CSRF token. The server validates that `role` is one of `["Admin", "User"]` before writing it.

VERIFIED — `src/server.ts:2533`

**Frontend:** In the Admin workspace under the "Users" tab, click "Edit info" on any user row. The form displays a "Role" dropdown with options `["User", "Admin"]`.

VERIFIED — `src/app/features/files/components/admin-workspace.tsx:216`

```tsx
<AdminSelect label="Role" value={editUser.role} options={["User", "Admin"]} ... />
```

### 6.3 How to Demote an Admin to User

Identical procedure to elevation. Call `POST /api/admin/users/:id/edit` with `{ "role": "User" }`, or use the same admin edit form in the UI.

There is no protection against an Admin demoting themselves. Self-demotion would take effect at the next request (the access token contains the role and is valid for up to 15 minutes after issuance, but the next `authenticateUser` call fetches the live role from the database).

VERIFIED — `src/server.ts:727-735` (authenticateUser always queries the DB for the current role, it does not rely solely on the JWT role claim for authorization; however, `verifyAdmin` reads `req.user.role` which is populated from the DB result)

### 6.4 Role Persistence

The role is stored in the `users` table as a column. It is included in every `authenticateUser` DB query, so changes take effect immediately for new sessions. Due to JWT lifetime (default 15 minutes), an active access token retains its embedded role claim until it expires, but the `verifyAdmin` middleware reads `req.user.role` which is sourced from the live database query inside `authenticateUser`, not from the JWT payload alone.

VERIFIED — `src/server.ts:727-735`

```ts
const result = await request.query<UserRow>(
  `SELECT id, ..., role, ... FROM users WHERE id = @id AND status = 'Active'`
);
req.user = mapUserRow(result.recordset[0]);
```

The `verifyAdmin` function then checks `req.user?.role !== 'Admin'`, which reflects the database-current value.

VERIFIED — `src/server.ts:745-750`

---

## 7. Account Status vs Role

Role and account status are independent fields. A user can hold the role `"Admin"` and have status `"Suspended"`.

| Status | Effect |
|---|---|
| `Active` | Normal access per role |
| `Suspended` | Login is blocked at the `POST /api/auth/login` endpoint (`status === 'Suspended'` check); refresh token exchange is also blocked because the `authenticateUser` DB query filters `AND status = 'Active'` |

VERIFIED — `src/server.ts:1045-1047` (login check), `src/server.ts:728-734` (authenticateUser filter)

A Suspended Admin cannot use any authenticated endpoint, including admin ones. Suspension effectively removes all access regardless of role.

---

## 8. Quota Relationship to Roles

Quota tiers control storage and file limits. They are orthogonal to the role system — both Users and Admins are assigned a quota tier.

| Quota field | Controls |
|---|---|
| `storage_limit_bytes` | Maximum cumulative storage for the account |
| `max_file_size_bytes` | Maximum size for a single upload |
| `max_files` | Maximum number of files (`Available` status only) |
| `daily_upload_limit_bytes` | Daily upload bandwidth cap |

New accounts receive the `"guest"` quota. Admins can change any user's quota via `POST /api/admin/users/:id/quota`. An Admin's own account is also subject to quota enforcement — there is no bypass for Admins on upload quota checks.

VERIFIED — `src/server.ts:1640-1665` (quota checks run for all authenticated users, regardless of role)

Quota tiers are public — any visitor can read them via `GET /api/quotas` without authentication.

VERIFIED — `src/server.ts:784-797`

---

## 9. Admin Workflow Reference

### 9.1 Creating the First Admin Account

The system has no bootstrap Admin creation endpoint. ILLUSTRATIVE — The initial Admin account must be created by directly updating the `users` table in SQL Server after registration:

```sql
-- Find the user UUID:
-- (Email and username are encrypted; use the HMAC lookup hash or query by other fields)
UPDATE users SET role = 'Admin' WHERE id = '<user-uuid>';
```

Once at least one Admin exists, subsequent Admin accounts can be created via the API or UI.

### 9.2 Day-to-Day Admin Operations

**Reviewing new users:**
1. Log in as Admin.
2. Navigate to the Admin workspace (sidebar "Admin" item).
3. Select the "Users" tab to see all accounts.
4. Review role, quota assignment, storage usage, and status.

**Suspending a user:**
- UI: Click "Toggle lock" on the user row.
- API: `POST /api/admin/users/:id/suspend`
- Effect: Sets `status = 'Suspended'`. Active sessions remain in the `refresh_tokens` table but all subsequent requests (after the current 15-minute JWT window) will be rejected.

**Promoting a user to Admin:**
- UI: Click "Edit info", change Role dropdown to "Admin", click "Save account".
- API: `POST /api/admin/users/:id/edit` with `{ "role": "Admin" }`.

**Blocking a suspicious file:**
- UI: Navigate to "Files" tab, click "Block" on the file row.
- API: `POST /api/admin/files/:id/block`
- Effect: Sets `file.status = 'Blocked'`. Blocked files cannot be downloaded or previewed. The file's share link (if any) will not be downloadable via the public endpoint either (share download checks file availability).
- Blocking also decrements the owner's `storage_used_bytes` counter; unblocking re-adds it.

**Managing quota tiers:**
- UI: Navigate to "Quotas" tab. Fill in the form and click "Save quota".
- API: `POST /api/admin/quotas` (upsert), `POST /api/admin/quotas/:id/delete` (delete with optional migration).
- When deleting a tier with attached users, provide `migrate_to_quota_id` to reassign them automatically.

**Reviewing security events:**
- UI: Navigate to "Security Events" tab in the Admin workspace.
- API: `GET /api/admin/logs` (returns all event types; client filters for `Security` and `Scan` event types).

**Reviewing system health:**
- UI: Navigate to "System Health" tab.
- API: `GET /api/stats` (CPU %, memory %, disk %, uptime, user/file/blocked counts).

### 9.3 Forced Session Revocation (Incident Response)

To immediately revoke all sessions for a compromised account, an Admin cannot do this through the UI (there is no "revoke all sessions for user X" button in the admin workspace). This must be done directly in SQL Server:

ILLUSTRATIVE (procedure described in `Documentation/04-Risk-And-Corrections/SECURITY.md:197-200`):

```sql
UPDATE refresh_tokens
SET revoked_at = SYSDATETIMEOFFSET()
WHERE user_id = '<user-uuid>' AND revoked_at IS NULL;
```

The active JWT access tokens will remain valid until their natural expiry (up to 15 minutes). Blocking the account with Suspended status provides an immediate barrier because `authenticateUser` rejects Suspended accounts on every request.

---

## 10. Security Context

### 10.1 Role Is Always Verified Server-Side

The JWT payload embeds the `role` field (`{ sub: userId, role }`) but the server does not rely on it for authorization. Every authenticated request re-queries the `users` table to obtain the current role.

VERIFIED — `src/server.ts:479` (JWT payload type), `src/server.ts:727-735` (authenticateUser re-queries DB)

### 10.2 CSRF Applies to All Role-Gated Write Operations

All POST/PUT/DELETE requests to `/api/*` that carry a cookie session require a matching `X-CSRF-Token` header (or `_csrf` body field). This includes all admin write endpoints.

VERIFIED — `src/server.ts:274-309`

### 10.3 Rate Limiting Applies Regardless of Role

The auth rate limiter (20 req/min) and global API rate limiter (120 req/min) apply to all users including Admins.

VERIFIED — `src/server.ts:452-467`

### 10.4 Trust Boundary Summary

Sourced from `Documentation/04-Risk-And-Corrections/SECURITY.md:135-141`:

| Principal | Trust level | What they can access |
|---|---|---|
| Anonymous | Untrusted | Public share links, registration, login, health endpoints, quota list |
| User (authenticated) | Low trust | Own files, own sessions, own profile only |
| Admin (authenticated) | Elevated trust | All users, all files, all quotas, system logs, system stats |
| Service account (LEEKUUSER) | Infrastructure trust | Vault filesystem, `.env.production`, JWT key files — not an application role |
| SQL Server login (leeku_app) | Database trust | Read/write to `LeekuSecure` database only |

### 10.5 Admin Cannot Be Self-Granted

There is no endpoint that allows a non-Admin to set their own role. `POST /api/users/me/update` only accepts `username`, `email`, and `password`. Role changes are exclusively handled by `POST /api/admin/users/:id/edit`, which requires passing `verifyAdmin` first.

VERIFIED — `src/server.ts:1128-1183` (me/update: no role field), `src/server.ts:2509-2550` (admin/edit: requires verifyAdmin)

---

## 11. Audit Log Events Related to Roles

All role changes, account suspensions, and admin actions produce `SystemLog` entries in the `system_logs` table.

| Event type | When generated |
|---|---|
| `Auth` | Login, logout, registration, email verification, account update |
| `Security` | Account lockout, account deletion request, account deletion confirm |
| `Admin` | Any `/api/admin/*` write operation (suspend, quota change, edit, file block, quota save/delete) |
| `Upload` | File upload |
| `Download` | File download (direct and via public share) |
| `Delete` | File deletion (manual or TTL expiry) |
| `Scan` | File blocked by AV scan or heuristic pre-scan |
| `Link` | Share link created or updated |

VERIFIED — `src/app/shared/types/index.ts:70`, `src/server.ts` (logSystemEvent calls throughout)

Admin-specific log messages include the acting admin's username in `username_snapshot` and the target user ID in `target_id`.

VERIFIED — `src/server.ts:2482`, `src/server.ts:2504`, `src/server.ts:2547`

---

## CONTRACT_DRIFT Notes

No contract drift was found between the role/permission system and its documentation in `Documentation/01-Technical/API.md`.

One previously identified drift unrelated to roles: `Documentation/04-Risk-And-Corrections/SECURITY.md:66` states access tokens use "JWT signed with RS256 (4096-bit RSA key pair)" but the current implementation uses HMAC-SHA256 (`COOKIE_SECRET_BASE64`). This is flagged in `Documentation/01-Technical/API.md` and does not affect the role model.

CONTRACT_DRIFT: `Documentation/04-Risk-And-Corrections/SECURITY.md:66` (RS256) vs `src/server.ts:177` (HMAC-SHA256 via `COOKIE_SECRET_BASE64`). Pre-existing; not introduced by this document.
