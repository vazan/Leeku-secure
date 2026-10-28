-- Fix thumbnail_generated column type if it was incorrectly created as boolean
-- This script should be run if thumbnail_generated is a boolean instead of TIMESTAMPTZ

BEGIN;

-- Check if thumbnail_generated exists and is boolean type
DO $$
DECLARE
    col_type text;
BEGIN
    SELECT data_type INTO col_type
    FROM information_schema.columns
    WHERE table_name = 'files' 
      AND column_name = 'thumbnail_generated';
    
    IF col_type = 'boolean' THEN
        -- Remove default value if it exists
        ALTER TABLE files 
        ALTER COLUMN thumbnail_generated DROP DEFAULT;
        
        -- Change column type from boolean to TIMESTAMPTZ using CASE expression
        ALTER TABLE files 
        ALTER COLUMN thumbnail_generated TYPE TIMESTAMPTZ 
        USING CASE WHEN thumbnail_generated THEN NULL ELSE NULL END;
        
        RAISE NOTICE 'Successfully converted thumbnail_generated from boolean to TIMESTAMPTZ';
    ELSE
        RAISE NOTICE 'thumbnail_generated is already type %, no conversion needed', col_type;
    END IF;
END $$;

-- Ensure the column has the correct index
DROP INDEX IF EXISTS ix_files_thumbnail;
CREATE INDEX ix_files_thumbnail
    ON files (thumbnail_generated)
    WHERE mime_type LIKE 'image/%' AND status = 'Available'
        AND deleted_at IS NULL AND client_secret_hash IS NULL;

COMMIT;
