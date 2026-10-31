-- Migration: Add thumbnail_excluded column to files table (PostgreSQL)
-- Date: 2026-10-29
-- Purpose: Mark files whose thumbnail generation permanently fails (e.g.
--          corrupt/undecryptable data) so the thumbnail scan stops retrying
--          them every cycle. A value of TRUE means the file is skipped forever;
--          it can be reset to FALSE manually if the underlying data is repaired.

BEGIN;

-- Add thumbnail_excluded if it does not already exist
ALTER TABLE files ADD COLUMN IF NOT EXISTS thumbnail_excluded BOOLEAN NOT NULL DEFAULT FALSE;

-- Extend the existing partial index to also cover the exclusion flag so the
-- thumbnail scan can skip excluded files efficiently.
DROP INDEX IF EXISTS ix_files_thumbnail;
CREATE INDEX IF NOT EXISTS ix_files_thumbnail
    ON files (thumbnail_generated)
    WHERE mime_type LIKE 'image/%' AND status = 'Available'
        AND deleted_at IS NULL AND client_secret_hash IS NULL
        AND thumbnail_excluded = FALSE;

COMMIT;

-- Verify column was added
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'files' AND COLUMN_NAME = 'thumbnail_excluded';
