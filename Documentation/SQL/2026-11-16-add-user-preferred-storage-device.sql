-- Migration: Per-user preferred storage device (MSSQL)
-- Date: 2026-11-16
-- Purpose: Add an optional per-user default storage device so a user's NEW
--          uploads provision to a specific device instead of the server-wide
--          default (`selectProvisionDevice`). When NULL, the user falls back to
--          the global primary / auto-balancing provisioning.
--
-- Additions:
--   - `users.preferred_storage_device_id` UNIQUEIDENTIFIER NULL
--     (NULL = use server default provisioning).
--   - FK `FK_users_preferred_storage` → storage_devices(id) ON DELETE SET NULL
--     (deleting a device clears the preference instead of failing).
--   - Index `IX_users_preferred_storage` on users(preferred_storage_device_id)
--     for the admin panel join and provisioning lookup.
--
-- Idempotent: guarded by OBJECT_ID / COL_LENGTH / sys.foreign_keys /
-- sys.indexes so it is safe to rerun.
--
-- ADMIN ONLY: this is a server-admin managed preference; users have no
-- mutation surface. On assignment the user's existing blobs are auto-migrated
-- by the application (see Phase D), not by this DDL.

SET XACT_ABORT ON;
GO

-- ──────────────────────────────────────────────────────────────
-- 1. Column
-- ──────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.users', 'U') IS NULL
BEGIN
    PRINT 'dbo.users does not exist — nothing to migrate.';
END
ELSE IF COL_LENGTH('dbo.users', 'preferred_storage_device_id') IS NULL
BEGIN
    ALTER TABLE dbo.users
        ADD preferred_storage_device_id UNIQUEIDENTIFIER NULL;
    PRINT 'Added preferred_storage_device_id column to users table';
END
ELSE
BEGIN
    PRINT 'preferred_storage_device_id column already exists on users';
END
GO

-- ──────────────────────────────────────────────────────────────
-- 2. Foreign key (ON DELETE SET NULL — deleting a device clears prefs)
-- ──────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.storage_devices', 'U') IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_users_preferred_storage')
BEGIN
    ALTER TABLE dbo.users WITH CHECK ADD CONSTRAINT [FK_users_preferred_storage]
        FOREIGN KEY ([preferred_storage_device_id])
        REFERENCES dbo.storage_devices([id])
        ON DELETE SET NULL;
    PRINT 'Added FK_users_preferred_storage foreign key';
END
ELSE
BEGIN
    PRINT 'FK_users_preferred_storage already exists (or storage_devices is missing)';
END
GO

-- ──────────────────────────────────────────────────────────────
-- 3. Index for provisioning lookup + admin panel join
-- ──────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.users', 'U') IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_users_preferred_storage' AND object_id=OBJECT_ID('dbo.users'))
BEGIN
    CREATE INDEX IX_users_preferred_storage ON dbo.users(preferred_storage_device_id);
    PRINT 'Created IX_users_preferred_storage index';
END
ELSE
BEGIN
    PRINT 'IX_users_preferred_storage already exists';
END
GO

-- ──────────────────────────────────────────────────────────────
-- Verify
-- ──────────────────────────────────────────────────────────────
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'users' AND TABLE_SCHEMA = 'dbo'
AND COLUMN_NAME = 'preferred_storage_device_id';
GO
