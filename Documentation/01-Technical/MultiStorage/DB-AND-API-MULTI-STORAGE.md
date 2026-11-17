---
agent: DocEngineer | date: 2026-11-06 | model: doc-hub (engineering lens) | self-score: 8.0/10
---

# ENG SPEC — MULTI-STORAGE: DATA MODEL, API, CODE TAP POINTS

> Companion to ADR-0001 + DESIGN-SPEC-MULTI-STORAGE. MSSQL branch.

## 1. New Table: `storage_devices`

```sql
CREATE TABLE [dbo].[storage_devices](
    [id]                     [uniqueidentifier] NOT NULL,          -- GUID PK
    [storage_id]             [nvarchar](64)    NOT NULL,          -- logical id e.g. 'DATA-00'
    [storage_path]           [nvarchar](1000)  NOT NULL,          -- P:\DATA-00\ or \\SERVER\DATA-00\
    [smb_username_encrypted] [varbinary](2048) NULL,              -- encryptColumn()
    [smb_username_iv]        [varbinary](16)   NULL,
    [smb_username_auth_tag]  [varbinary](16)   NULL,
    [smb_password_encrypted] [varbinary](2048) NULL,
    [smb_password_iv]        [varbinary](16)   NULL,
    [smb_password_auth_tag]  [varbinary](16)   NULL,
    [provisioning_enabled]   [bit]     NOT NULL DEFAULT 0,
    [is_primary]             [bit]     NOT NULL DEFAULT 0,
    [created_at]             [datetimeoffset](7) NOT NULL DEFAULT sysdatetimeoffset(),
    CONSTRAINT [PK_storage_devices] PRIMARY KEY CLUSTERED ([id] ASC)
)
GO

-- Ensure at most one primary among enabled devices (partial-index guard)
CREATE UNIQUE NONCLUSTERED INDEX [UX_storage_devices_primary]
    ON [dbo].[storage_devices]([is_primary]) WHERE [is_primary] = 1
GO
```

> Credentials stored via the existing `encryptColumn()` (AES-256-GCM, per-column
> IV + auth tag, MASTER_KEY_BASE64-wrapped sub-key). NULL when a device needs no
> SMB auth (local disk / pre-mapped share). [REDACTED] values never re-issued.

## 2. `files` Table Change

```sql
ALTER TABLE [dbo].[files] ADD [storage_device_id] [uniqueidentifier] NULL
GO
ALTER TABLE [dbo].[files] WITH CHECK ADD CONSTRAINT [FK_files_storage_devices]
    FOREIGN KEY ([storage_device_id]) REFERENCES [dbo].[storage_devices]([id])
GO
```

- `NULL` allowed only for **legacy rows pending backfill**; after migration
  the column is `NOT NULL` (post-backfill `ALTER`).
- Index: `IX_files_storage_device` on `[storage_device_id]` for per-device
  inventory/cleanup queries.
- Composite index `IX_files_owner_device` on `[owner_user_id, storage_device_id]`
  `INCLUDE (size_bytes)` — backs the admin "Users by device" panel and per-user
  migration (`GROUP BY owner_user_id, storage_device_id`).

## 3. `file_versions` Table Change

```sql
ALTER TABLE [dbo].[file_versions] ADD [storage_device_id] [uniqueidentifier] NULL
GO
ALTER TABLE [dbo].[file_versions] WITH CHECK ADD CONSTRAINT [FK_file_versions_storage_devices]
    FOREIGN KEY ([storage_device_id]) REFERENCES [dbo].[storage_devices]([id])
GO
```

Version blobs are archived under the same device as the parent row by default.
Re-homing is supported at the **admin per-user migration** level: the
`POST /api/admin/storage/users/:userId/migrate` route moves a user's current
files + archived `file_versions` across devices simultaneously (versions are
scoped through `files.owner_user_id`).
- Composite index `IX_file_versions_file_device` on `[file_id, storage_device_id]`
  `INCLUDE (size_bytes)` — scopes a user's versions through `files` for the
  panel and migration.

## 3b. `users` Table Change (per-user preferred default device)

```sql
ALTER TABLE [dbo].[users] ADD [preferred_storage_device_id] [uniqueidentifier] NULL
GO
ALTER TABLE [dbo].[users] WITH CHECK ADD CONSTRAINT [FK_users_preferred_storage]
    FOREIGN KEY ([preferred_storage_device_id]) REFERENCES [dbo].[storage_devices]([id])
    ON DELETE SET NULL
GO
CREATE INDEX [IX_users_preferred_storage] ON [dbo].[users]([preferred_storage_device_id])
GO
```

- `NULL` (the default) means the user falls back to the server-wide default
  provisioning (`selectProvisionDevice`) — the pre-existing global primary /
  auto-balancing behavior is fully preserved.
- When set, the user's **new uploads** provision exclusively to that device
  (fail-closed via `selectProvisionDeviceForUser`), and on assignment the
  user's existing blobs **auto-migrate** to it in the background.
- `ON DELETE SET NULL`: deleting a device clears the preference instead of
  failing the delete.

## 4. Admin Storage API (new)

| Method | Endpoint | Handler duty |
|---|---|---|
| GET | `/api/admin/storage` | list devices (no plaintext creds) |
| POST | `/api/admin/storage` | add device (path + encrypted creds) |
| PATCH | `/api/admin/storage/:id` | update path / creds / provisioning_enabled |
| PUT | `/api/admin/storage/:id/primary` | set primary (un-set others) |
| DELETE | `/api/admin/storage/:id` | remove device (must not own files) |
| GET | `/api/admin/storage/users` | per-user per-device storage breakdown — admin "Users by device" panel (id, username, totalBytes, quotaBytes, preferredDeviceId, devices[{device_id, storage_id, files, versions, bytes}]) |
| POST | `/api/admin/storage/users/:userId/migrate` | move one user's whole data (current files + archived versions) source→destination device; `dry_run=true` → synchronous preview (no mutation), `dry_run=false` → `{ job_id }` background run pollable via `GET /api/admin/storage/migrate/:jobId` |
| PUT | `/api/admin/storage/users/:userId/device` | set/clear a user's **preferred default device** for new-upload provisioning. Body `{ device_id }` (a storage device id) or `{ device_id: null }` to clear. On SET: updates `users.preferred_storage_device_id`, auto-migrates the user's existing blobs to it in the background (`{ job_id }`), fail-closed on the preference. On CLEAR: column set NULL, no data movement. |

Both `/users` and `/users/:userId/migrate` routes are **admin-only**
(`authenticateUser` + `verifyAdmin`) and are declared **before**
`POST /api/admin/storage/:id` so the literal `users` segment is never captured
by the `:id` placeholder (same ordering rule as the device-level `/migrate`
routes).

Constraints enforced server-side:
- one primary at a time (transaction + partial unique index);
- refuse delete while `files`/`file_versions` reference the device;
- never echo plaintext SMB creds in GET responses.

## 5. Code Tap Points (MSSQL branch)

| File | Change |
|---|---|
| `src/server.ts` | replace `FILE_VAULT` constant reads with `StorageDeviceService.resolveDevice(deviceId)`; upload balancer at `#L3287`; delete paths `#L2081,2526,2533,3947` |
| `src/server/utils/production.ts` | drop `FILE_STORAGE_UNC_PATH` from required list; add check: ≥1 enabled + reachable device |
| `src/server.ts#L570` | move `net use` into device-provisioning path; drop `STORAGE_NET_USE_*` |
| `src/server.ts#L290` | per-device health monitor replacing global UNC monitor |
| `src/app/features/files/components/admin-workspace.tsx` | add `"storage"` to `AdminTab` union (`#L7`) + render Storage tab |
| `src/server/utils/storage-devices.ts` | `moveUserFiles()` (per-user re-homing, reusing shared `moveBlobToDevice()` atomic mover) + job registry |
| `src/server.ts` | `GET /api/admin/storage/users` + `POST /api/admin/storage/users/:userId/migrate` (admin-only, dry-run preview) |
| `scripts/cleanup-vault-orphans.ts` | derive device roots from DB, not `FILE_STORAGE_UNC_PATH` |

## 6. Encryption Contract (reuse)
- `encryptColumn(value)` → `{ciphertext, iv, authTag}` stored in the three
  `_encrypted` / `_iv` / `_auth_tag` columns (same shape as `files.original_name_*`).
- `decryptColumn` reads them back with the MASTER_KEY sub-key. Never persisted
  in plaintext; never returned by Admin API.

## 7. Explicit Unknowns (engineer side)
- Exact free-space watermark constant for the balancer.
- Rollback path if migration order (schema → backfill → code) is interrupted.

> Resolved: whether `file_versions` may re-home across devices — **yes**, via the
> admin per-user migration (`POST /api/admin/storage/users/:userId/migrate`),
> which relocates current files + archived versions together.
