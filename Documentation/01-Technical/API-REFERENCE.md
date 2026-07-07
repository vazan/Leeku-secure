# API Reference (Implementation-Evidenced)

Date: 2026-07-07  
Scope: Shared API surface for Leeku-MSSQL and Leeku-POSTGRESQL

## 1. Evidence Policy

This document lists only method/path/auth evidence directly observable in implementation.

Not claimed here:
- full request schema per endpoint
- full response schema per endpoint
- complete status/error matrix per endpoint

Reason:
- Canonical OpenAPI/Swagger artifact is unknown in workspace scope.

Evidence:
- Leeku-MSSQL/src/server.ts
- Leeku-POSTGRESQL/src/server.ts
- Leeku-MSSQL/src/server/routes/health.ts
- Leeku-MSSQL/src/server/routes/sessions.ts
- Leeku-MSSQL/src/server/routes/public-sharing.ts
- Leeku-MSSQL/src/server/routes/maintenance-mode.ts
- Documentation/01-Technical/DISCOVERY-REPORT.md
- Documentation/04-Risk-And-Corrections/GAP-MANIFEST.md

## 2. Shared Route Parity Statement

Observed route groups and mount points are parity-aligned across MSSQL and PostgreSQL server entrypoints.

Evidence:
- Leeku-MSSQL/src/server.ts
- Leeku-POSTGRESQL/src/server.ts

## 3. Route Inventory

### 3.1 Health

| Method | Path | Auth | Known Behavior | Evidence |
|---|---|---|---|---|
| GET | /api/health/live | None | Returns liveness payload | Leeku-MSSQL/src/server/routes/health.ts |
| GET | /api/health/ready | None | Returns readiness based on DB, vault, scanner | Leeku-MSSQL/src/server/routes/health.ts |

### 3.2 Auth and Session

| Method | Path | Auth | Known Behavior | Evidence |
|---|---|---|---|---|
| POST | /api/auth/register | None | Handler exists; schema unknown | Leeku-MSSQL/src/server.ts |
| GET | /api/auth/verify-email | None | Handler exists; token contract unknown | Leeku-MSSQL/src/server.ts |
| POST | /api/auth/login | None | Handler exists; schema unknown | Leeku-MSSQL/src/server.ts |
| GET | /api/auth/me | User | Authenticated identity route | Leeku-MSSQL/src/server.ts |
| GET | /api/auth/csrf | None | CSRF token route | Leeku-MSSQL/src/server.ts |
| POST | /api/auth/refresh | None | Refresh handler exists | Leeku-MSSQL/src/server.ts |
| POST | /api/auth/logout | None | Logout handler exists | Leeku-MSSQL/src/server.ts |
| GET | /api/auth/sessions | User | Active sessions listing | Leeku-MSSQL/src/server/routes/sessions.ts |
| GET | /api/users/me/sessions | User | Alias mount to same router | Leeku-MSSQL/src/server.ts |
| POST | /api/auth/sessions/revoke-others | User | Revokes other sessions | Leeku-MSSQL/src/server/routes/sessions.ts |
| POST | /api/auth/sessions/current/revoke | User | Revokes current session | Leeku-MSSQL/src/server/routes/sessions.ts |
| DELETE | /api/auth/sessions/:id | User | Revokes session by id | Leeku-MSSQL/src/server/routes/sessions.ts |
| POST | /api/auth/sessions/:id/revoke | User | Revoke alias by id | Leeku-MSSQL/src/server/routes/sessions.ts |
| POST | /api/auth/sessions/revoke-all | User | Revokes all sessions | Leeku-MSSQL/src/server/routes/sessions.ts |

### 3.3 User and Profile

| Method | Path | Auth | Known Behavior | Evidence |
|---|---|---|---|---|
| POST | /api/users/me/update | User | Profile update handler exists | Leeku-MSSQL/src/server.ts |
| POST | /api/users/me/quota-change-request | User | Quota request handler exists | Leeku-MSSQL/src/server.ts |
| GET | /api/users/me/avatar | User | Avatar fetch handler exists | Leeku-MSSQL/src/server.ts |
| POST | /api/users/me/avatar | User | Avatar upload handler exists | Leeku-MSSQL/src/server.ts |
| DELETE | /api/users/me/avatar | User | Avatar removal handler exists | Leeku-MSSQL/src/server.ts |
| POST | /api/users/me/avatar/remove | User | Alias removal handler exists | Leeku-MSSQL/src/server.ts |
| POST | /api/users/me/delete-request | User | Delete request handler exists | Leeku-MSSQL/src/server.ts |
| GET | /api/users/me/delete-confirm | None | Delete confirmation lookup exists | Leeku-MSSQL/src/server.ts |
| POST | /api/users/me/delete-confirm | None | Delete confirmation submit exists | Leeku-MSSQL/src/server.ts |

### 3.4 Files and Sharing

| Method | Path | Auth | Known Behavior | Evidence |
|---|---|---|---|---|
| GET | /api/files | User | File listing handler exists | Leeku-MSSQL/src/server.ts |
| GET | /api/files/upload | User | Upload state/check handler exists | Leeku-MSSQL/src/server.ts |
| POST | /api/files/upload | User | File upload handler exists | Leeku-MSSQL/src/server.ts |
| POST | /api/files/:id/delete | User | File delete handler exists | Leeku-MSSQL/src/server.ts |
| GET | /api/files/:id/preview | User | File preview handler exists | Leeku-MSSQL/src/server.ts |
| GET | /api/files/:id/download | User | Direct/private download handler exists | Leeku-MSSQL/src/server.ts |
| POST | /api/files/:id/download/prepare | User | Prepared download initiation exists | Leeku-MSSQL/src/server.ts |
| GET | /api/files/:id/download/:downloadId/status | User | Prepared download status exists | Leeku-MSSQL/src/server.ts |
| GET | /api/files/:id/download/:downloadId/file | User | Prepared download fetch exists | Leeku-MSSQL/src/server.ts |
| GET | /api/sharing/links | User | Sharing links listing exists | Leeku-MSSQL/src/server.ts |
| DELETE | /api/sharing/links/:id | User | Sharing link delete exists | Leeku-MSSQL/src/server.ts |
| POST | /api/sharing/links/:id/remove | User | Sharing link delete alias exists | Leeku-MSSQL/src/server.ts |
| POST | /api/files/:id/share | User | Create share link exists | Leeku-MSSQL/src/server.ts |

### 3.5 Public Share Router

Mounted at /api/public/share.

| Method | Path | Auth | Known Behavior | Evidence |
|---|---|---|---|---|
| GET | /api/public/share/:token | None | Returns share metadata | Leeku-MSSQL/src/server/routes/public-sharing.ts |
| GET | /api/public/share/:token/og | None | OG metadata page route | Leeku-MSSQL/src/server/routes/public-sharing.ts |
| GET | /api/public/share/s/:token | None | Short token route variant | Leeku-MSSQL/src/server/routes/public-sharing.ts |
| POST | /api/public/share/:token/download | None | Public download initiation | Leeku-MSSQL/src/server/routes/public-sharing.ts |
| GET | /api/public/share/:token/download/:downloadId/status | None | Public prepared download status | Leeku-MSSQL/src/server/routes/public-sharing.ts |
| GET | /api/public/share/:token/download/:downloadId/file | None | Public prepared download fetch | Leeku-MSSQL/src/server/routes/public-sharing.ts |
| GET | /api/public/share/:token/embed | None | Embed/public preview endpoint | Leeku-MSSQL/src/server/routes/public-sharing.ts |

### 3.6 Admin and Maintenance

| Method | Path | Auth | Known Behavior | Evidence |
|---|---|---|---|---|
| GET | /api/stats | Admin | Stats handler exists | Leeku-MSSQL/src/server.ts |
| GET | /api/admin/users | Admin | Admin users listing exists | Leeku-MSSQL/src/server.ts |
| POST | /api/admin/users/create-dummy | Admin | Helper creation handler exists | Leeku-MSSQL/src/server.ts |
| POST | /api/admin/users/:id/reset-password | Admin | Reset password handler exists | Leeku-MSSQL/src/server.ts |
| POST | /api/admin/users/:id/suspend | Admin | Suspend handler exists | Leeku-MSSQL/src/server.ts |
| POST | /api/admin/users/:id/quota | Admin | Quota assignment handler exists | Leeku-MSSQL/src/server.ts |
| POST | /api/admin/users/:id/edit | Admin | Admin edit handler exists | Leeku-MSSQL/src/server.ts |
| GET | /api/admin/files | Admin | Admin files listing exists | Leeku-MSSQL/src/server.ts |
| POST | /api/admin/files/:id/block | Admin | File block handler exists | Leeku-MSSQL/src/server.ts |
| GET | /api/admin/logs | Admin | Logs listing exists | Leeku-MSSQL/src/server.ts |
| GET | /api/admin/logs/security | Admin | Security logs listing exists | Leeku-MSSQL/src/server.ts |
| POST | /api/admin/quotas | Admin | Quota create/update handler exists | Leeku-MSSQL/src/server.ts |
| POST | /api/admin/quotas/:id/delete | Admin | Quota delete handler exists | Leeku-MSSQL/src/server.ts |
| GET | /api/admin/maintenance/status | None | Current maintenance status | Leeku-MSSQL/src/server/routes/maintenance-mode.ts |
| POST | /api/admin/maintenance/toggle | Admin | Toggle maintenance mode | Leeku-MSSQL/src/server/routes/maintenance-mode.ts |

## 4. Explicit Unknowns

- Unknown: authoritative request and response schemas per endpoint.
- Unknown: canonical status-code matrix per endpoint family.
- Unknown: canonical error object taxonomy.
- Unknown: location of official OpenAPI or equivalent schema artifact.

## 5. Contract Drift Notes

- API route parity is strong, but schema contract source-of-truth is missing from discovered scope.
- This file intentionally avoids inventing schema fields or enum values not defined in a formal API artifact.
