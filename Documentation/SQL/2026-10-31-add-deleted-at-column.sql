-- Migration: Add deleted_at column to files table (Trash / Recycle Bin support)
-- Date: 2026-10-31
-- Purpose: Support soft-delete / recycle bin. When a file is moved to Trash, the
--          deleted_at timestamp is set instead of hard-deleting the row. Files stay
--          in trash for TRASH_RETENTION_DAYS (default 90) before being permanently purged.
--          A NULL value means the file is active and visible; a non-NULL value means
--          the file sits in the trash.

IF COL_LENGTH('dbo.files', 'deleted_at') IS NULL
BEGIN
    ALTER TABLE dbo.files ADD deleted_at DATETIMEOFFSET(7) NULL;
    PRINT 'Added deleted_at column to files table';
END
ELSE
BEGIN
    PRINT 'deleted_at column already exists on files table';
END
GO

-- Verify column was added
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'files' AND TABLE_SCHEMA = 'dbo'
AND COLUMN_NAME = 'deleted_at';
