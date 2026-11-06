-- Migration: Multi-storage device pool (MSSQL)
-- Date: 2026-11-06
-- Purpose: Replace single-path vault storage with a database-backed
--          multi-storage availability group. Each vault blob is now
--          located via (storage_device_id → storage_path) instead of a
--          single FILE_STORAGE_UNC_PATH constant.
--
-- Additions:
--   - `storage_devices` table (GUID PK, logical storage_id, storage_path,
--     encrypted SMB credentials, provisioning_enabled, is_primary).
--   - `files.storage_device_id` FK → storage_devices (nullable until backfill).
--   - `file_versions.storage_device_id` FK → storage_devices (nullable until backfill).
--
-- This migration is idempotent and forward-compatible: existing rows keep
-- working (nullable FK) until the backfill step (2026-11-06-multi-storage-backfill.sql)
-- assigns the seed device and the app flips to the DB-backed device pool.

SET XACT_ABORT ON;
GO

-- ──────────────────────────────────────────────────────────────
-- 1. storage_devices table
-- ──────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.storage_devices', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.storage_devices(
        [id]                     [uniqueidentifier]  NOT NULL,
        [storage_id]             [nvarchar](64)      NOT NULL,
        [storage_path]           [nvarchar](1000)    NOT NULL,
        [smb_username_encrypted] [varbinary](2048)   NULL,
        [smb_username_iv]        [varbinary](16)     NULL,
        [smb_username_auth_tag]  [varbinary](16)     NULL,
        [smb_password_encrypted] [varbinary](2048)   NULL,
        [smb_password_iv]        [varbinary](16)     NULL,
        [smb_password_auth_tag]  [varbinary](16)     NULL,
        [provisioning_enabled]   [bit]               NOT NULL CONSTRAINT DF_storage_devices_provisioning DEFAULT (0),
        [is_primary]             [bit]               NOT NULL CONSTRAINT DF_storage_devices_is_primary DEFAULT (0),
        [created_at]             [datetimeoffset](7) NOT NULL CONSTRAINT DF_storage_devices_created_at DEFAULT (SYSDATETIMEOFFSET()),
        CONSTRAINT [PK_storage_devices] PRIMARY KEY CLUSTERED ([id] ASC)
    ) ON [PRIMARY];
    PRINT 'Created dbo.storage_devices table';
END
ELSE
BEGIN
    PRINT 'dbo.storage_devices table already exists';
END
GO

-- ──────────────────────────────────────────────────────────────
-- 1b. Partial unique index: at most one is_primary=1 row.
-- ──────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_storage_devices_primary' AND object_id=OBJECT_ID('dbo.storage_devices'))
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX [UX_storage_devices_primary]
        ON dbo.storage_devices([is_primary]) WHERE [is_primary] = 1;
    PRINT 'Created UX_storage_devices_primary partial unique index';
END
ELSE
BEGIN
    PRINT 'UX_storage_devices_primary already exists';
END
GO

-- ──────────────────────────────────────────────────────────────
-- 2. files.storage_device_id (nullable until backfill)
-- ──────────────────────────────────────────────────────────────
IF COL_LENGTH('dbo.files', 'storage_device_id') IS NULL
BEGIN
    ALTER TABLE dbo.files ADD storage_device_id UNIQUEIDENTIFIER NULL;
    PRINT 'Added storage_device_id column to files table';
END
ELSE
BEGIN
    PRINT 'storage_device_id column already exists on files table';
END
GO

-- ──────────────────────────────────────────────────────────────
-- 3. file_versions.storage_device_id (nullable until backfill)
-- ──────────────────────────────────────────────────────────────
IF COL_LENGTH('dbo.file_versions', 'storage_device_id') IS NULL
BEGIN
    ALTER TABLE dbo.file_versions ADD storage_device_id UNIQUEIDENTIFIER NULL;
    PRINT 'Added storage_device_id column to file_versions table';
END
ELSE
BEGIN
    PRINT 'storage_device_id column already exists on file_versions table';
END
GO

-- ──────────────────────────────────────────────────────────────
-- 4. Foreign keys
-- ──────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_files_storage_devices')
BEGIN
    ALTER TABLE dbo.files WITH CHECK ADD CONSTRAINT [FK_files_storage_devices]
        FOREIGN KEY ([storage_device_id]) REFERENCES dbo.storage_devices([id]);
    PRINT 'Added FK_files_storage_devices';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_file_versions_storage_devices')
BEGIN
    ALTER TABLE dbo.file_versions WITH CHECK ADD CONSTRAINT [FK_file_versions_storage_devices]
        FOREIGN KEY ([storage_device_id]) REFERENCES dbo.storage_devices([id]);
    PRINT 'Added FK_file_versions_storage_devices';
END
GO

-- ──────────────────────────────────────────────────────────────
-- 5. Index for per-device inventory / cleanup queries
-- ──────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_files_storage_device' AND object_id=OBJECT_ID('dbo.files'))
BEGIN
    CREATE INDEX IX_files_storage_device ON dbo.files(storage_device_id)
        INCLUDE (stored_path, status);
    PRINT 'Created IX_files_storage_device index';
END
ELSE
BEGIN
    PRINT 'IX_files_storage_device already exists';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_file_versions_storage_device' AND object_id=OBJECT_ID('dbo.file_versions'))
BEGIN
    CREATE INDEX IX_file_versions_storage_device ON dbo.file_versions(storage_device_id)
        INCLUDE (stored_path);
    PRINT 'Created IX_file_versions_storage_device index';
END
ELSE
BEGIN
    PRINT 'IX_file_versions_storage_device already exists';
END
GO

-- ──────────────────────────────────────────────────────────────
-- Verify
-- ──────────────────────────────────────────────────────────────
SELECT 'storage_devices' AS tbl, COUNT(*) AS rows FROM dbo.storage_devices
UNION ALL SELECT 'files', COUNT(*) FROM dbo.files
UNION ALL SELECT 'file_versions', COUNT(*) FROM dbo.file_versions;
GO

SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME IN ('files','file_versions') AND TABLE_SCHEMA='dbo'
AND COLUMN_NAME = 'storage_device_id';
GO
