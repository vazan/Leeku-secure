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

## 3. `file_versions` Table Change

```sql
ALTER TABLE [dbo].[file_versions] ADD [storage_device_id] [uniqueidentifier] NULL
GO
ALTER TABLE [dbo].[file_versions] WITH CHECK ADD CONSTRAINT [FK_file_versions_storage_devices]
    FOREIGN KEY ([storage_device_id]) REFERENCES [dbo].[storage_devices]([id])
GO
```

Version blobs are archived under the same device as the parent row by default
(open decision: allow re-homing on archive).

## 4. Admin Storage API (new)

| Method | Endpoint | Handler duty |
|---|---|---|
| GET | `/api/admin/storage` | list devices (no plaintext creds) |
| POST | `/api/admin/storage` | add device (path + encrypted creds) |
| PATCH | `/api/admin/storage/:id` | update path / creds / provisioning_enabled |
| PUT | `/api/admin/storage/:id/primary` | set primary (un-set others) |
| DELETE | `/api/admin/storage/:id` | remove device (must not own files) |

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
| `scripts/cleanup-vault-orphans.ts` | derive device roots from DB, not `FILE_STORAGE_UNC_PATH` |

## 6. Encryption Contract (reuse)
- `encryptColumn(value)` → `{ciphertext, iv, authTag}` stored in the three
  `_encrypted` / `_iv` / `_auth_tag` columns (same shape as `files.original_name_*`).
- `decryptColumn` reads them back with the MASTER_KEY sub-key. Never persisted
  in plaintext; never returned by Admin API.

## 7. Explicit Unknowns (engineer side)
- Exact free-space watermark constant for the balancer.
- Whether `file_versions` may re-home across devices on archive.
- Rollback path if migration order (schema → backfill → code) is interrupted.
