-- Migration: Add thumbnail columns to files table
-- Date: 2026-10-15
-- Purpose: Add thumbnail_preview and thumbnail_generated columns for image thumbnail support

-- Add thumbnail_preview column (stores encrypted thumbnail JPEG data)
IF COL_LENGTH('dbo.files', 'thumbnail_preview') IS NULL
BEGIN
    ALTER TABLE dbo.files ADD thumbnail_preview VARBINARY(MAX) NULL;
    PRINT 'Added thumbnail_preview column to files table';
END
GO

-- Add thumbnail_generated column (tracks when thumbnail was last generated)
IF COL_LENGTH('dbo.files', 'thumbnail_generated') IS NULL
BEGIN
    ALTER TABLE dbo.files ADD thumbnail_generated DATETIMEOFFSET(7) NULL;
    PRINT 'Added thumbnail_generated column to files table';
END
GO

-- Verify columns were added
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'files' AND TABLE_SCHEMA = 'dbo'
AND COLUMN_NAME IN ('thumbnail_preview', 'thumbnail_generated');
