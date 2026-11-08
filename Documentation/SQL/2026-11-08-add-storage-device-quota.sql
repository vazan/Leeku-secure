-- Migration: Per-device storage quota (MSSQL)
-- Date: 2026-11-08
-- Purpose: Add an optional storage quota (in bytes) per storage device so
--          admins can restrict how much data is stored under DATA-00 / DATA-xx.
--          A NULL quota means "unlimited" (no behavioral change for devices
--          that predate this migration).
--
-- Additions:
--   - `storage_devices.quota_bytes` BIGINT NULL (soft limit in bytes).
--
-- Idempotent: guarded by COL_LENGTH so it is safe to rerun.

SET XACT_ABORT ON;
GO

IF OBJECT_ID('dbo.storage_devices', 'U') IS NULL
BEGIN
    PRINT 'dbo.storage_devices does not exist — nothing to migrate.';
END
ELSE IF COL_LENGTH('dbo.storage_devices', 'quota_bytes') IS NULL
BEGIN
    ALTER TABLE dbo.storage_devices
        ADD quota_bytes BIGINT NULL;
    PRINT 'Added quota_bytes column to storage_devices table';
END
ELSE
BEGIN
    PRINT 'quota_bytes column already exists on storage_devices';
END
GO

-- Optional constraint: quota must be a positive whole number of bytes when set.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_storage_devices_quota_bytes')
BEGIN
    ALTER TABLE dbo.storage_devices
        ADD CONSTRAINT [CK_storage_devices_quota_bytes]
        CHECK (quota_bytes IS NULL OR quota_bytes > 0);
    PRINT 'Added CK_storage_devices_quota_bytes check constraint';
END
ELSE
BEGIN
    PRINT 'CK_storage_devices_quota_bytes already exists';
END
GO

-- Verify
SELECT storage_id,
       quota_bytes,
       CASE WHEN quota_bytes IS NULL THEN 'unlimited' ELSE CAST(quota_bytes AS varchar(30)) END AS quota_label
FROM dbo.storage_devices;
GO
