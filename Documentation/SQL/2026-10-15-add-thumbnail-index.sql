-- Migration: Add index for thumbnail scanning optimization
-- Date: 2026-10-15
-- Purpose: Improve performance of thumbnail scan queries

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_files_thumbnail' AND object_id=OBJECT_ID('dbo.files'))
BEGIN
    CREATE INDEX IX_files_thumbnail ON dbo.files(mime_type, status, owner_user_id, thumbnail_generated)
    INCLUDE (stored_path, original_name_encrypted, original_name_iv, original_name_auth_tag);
    PRINT 'Created IX_files_thumbnail index';
END
ELSE
BEGIN
    PRINT 'IX_files_thumbnail index already exists';
END
GO
