BEGIN;

ALTER TABLE files ADD COLUMN IF NOT EXISTS thumbnail_preview BYTEA;
ALTER TABLE files ADD COLUMN IF NOT EXISTS thumbnail_generated TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS ix_files_thumbnail
    ON files (thumbnail_generated)
    WHERE mime_type LIKE 'image/%' AND status = 'Available'
        AND deleted_at IS NULL AND client_secret_hash IS NULL;

COMMIT;