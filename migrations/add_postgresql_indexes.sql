-- ============================================================
-- PostgreSQL Migration: Add Missing Indexes for MSSQL Compatibility
-- Date: 2026-10-17
-- Purpose:
--   - Add thumbnail support columns to files table
--   - Create ix_files_thumbnail index for optimal query performance
--   - Ensure MSSQL/PostgreSQL schema parity
-- ============================================================

-- Step 1: Add missing thumbnail columns to files table
-- ============================================================

ALTER TABLE files
  ADD COLUMN IF NOT EXISTS thumbnail_generated BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE files
  ADD COLUMN IF NOT EXISTS thumbnail_preview TEXT NULL;

-- Step 2: Create the ix_files_thumbnail index
-- ============================================================
-- This index supports queries filtering by mime_type, status, owner_user_id
-- for files that have thumbnails generated, similar to MSSQL's IX_files_thumbnail.
--
-- The WHERE clause creates a partial index, which is more efficient than
-- including all files since only files with thumbnails are relevant.
--
-- MSSQL equivalent:
--   CREATE INDEX IX_files_thumbnail ON dbo.files(mime_type, status, owner_user_id, thumbnail_generated) INCLUDE (...)
--
-- PostgreSQL equivalent (using partial index instead of INCLUDE for NULL values):
--   CREATE INDEX IF NOT EXISTS ix_files_thumbnail
--   ON files (mime_type, status, owner_user_id, thumbnail_generated)
--   WHERE thumbnail_preview IS NOT NULL;
-- ============================================================

CREATE INDEX IF NOT EXISTS ix_files_thumbnail
  ON files (mime_type, status, owner_user_id, thumbnail_generated)
  WHERE thumbnail_preview IS NOT NULL;

-- Step 3: Create additional performance indexes
-- ============================================================

-- Index for thumbnail generation queries
CREATE INDEX IF NOT EXISTS ix_files_thumbnail_pending
  ON files (owner_user_id, created_at)
  WHERE thumbnail_generated = FALSE AND mime_type LIKE 'image%';

-- Index for file lookup by status and mime type (common query pattern)
CREATE INDEX IF NOT EXISTS ix_files_status_mime
  ON files (status, mime_type, created_at DESC);

-- Index for owner's files by status (common dashboard query)
CREATE INDEX IF NOT EXISTS ix_files_owner_status
  ON files (owner_user_id, status, created_at DESC)
  INCLUDE (id, original_name_encrypted, size_bytes, expires_at);

-- Step 4: Verify indexes were created
-- ============================================================

-- Run this query to verify the indexes:
-- SELECT indexname, tablename, indexdef
-- FROM pg_indexes
-- WHERE tablename = 'files'
-- ORDER BY indexname;

-- Expected indexes after migration:
-- - ix_files_owner_status_created_at (existing)
-- - ix_files_folder_id (existing)
-- - ix_files_expires_at_available (existing)
-- - ix_files_thumbnail (NEW)
-- - ix_files_thumbnail_pending (NEW)
-- - ix_files_status_mime (NEW)
-- - ix_files_owner_status (NEW)
