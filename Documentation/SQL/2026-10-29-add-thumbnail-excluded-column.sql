-- Migration: Add thumbnail_excluded column to files table
-- Date: 2026-10-29
-- Purpose: Mark files whose thumbnail generation permanently fails (e.g.
--          corrupt/decryptable data) so the thumbnail scan stops retrying
--          them every cycle. A value of 1 means the file is skipped forever;
--          it can be reset to 0 manually if the underlying data is repaired.

IF COL_LENGTH('dbo.files', 'thumbnail_excluded') IS NULL
BEGIN
    ALTER TABLE dbo.files ADD thumbnail_excluded BIT NOT NULL DEFAULT 0;
    PRINT 'Added thumbnail_excluded column to files table';
END
GO

-- Verify column was added
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'files' AND TABLE_SCHEMA = 'dbo'
AND COLUMN_NAME = 'thumbnail_excluded';
