-- Fix thumbnail_generated column type if it was incorrectly created
-- This script should be run if thumbnail_generated is a boolean or wrong type instead of TIMESTAMPTZ

BEGIN;

-- Check if thumbnail_generated exists and fix type
DO $$
DECLARE
    col_exists boolean;
    col_type text;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'files' AND column_name = 'thumbnail_generated'
    ) INTO col_exists;
    
    IF col_exists THEN
        SELECT data_type INTO col_type FROM information_schema.columns 
        WHERE table_name = 'files' AND column_name = 'thumbnail_generated';
        
        IF col_type = 'boolean' THEN
            -- Remove default value and convert boolean to TIMESTAMPTZ
            ALTER TABLE files 
            ALTER COLUMN thumbnail_generated DROP DEFAULT;
            ALTER TABLE files 
            ALTER COLUMN thumbnail_generated TYPE TIMESTAMPTZ 
            USING NULL;
            RAISE NOTICE 'Converted thumbnail_generated from boolean to TIMESTAMPTZ';
        ELSIF col_type != 'timestamp with time zone' THEN
            -- Convert any other type to TIMESTAMPTZ
            ALTER TABLE files 
            ALTER COLUMN thumbnail_generated TYPE TIMESTAMPTZ 
            USING NULL;
            RAISE NOTICE 'Converted thumbnail_generated to TIMESTAMPTZ (was %)', col_type;
        ELSE
            RAISE NOTICE 'thumbnail_generated already TIMESTAMPTZ, no conversion needed';
        END IF;
    ELSE
        RAISE NOTICE 'thumbnail_generated column does not exist, creating it';
        ALTER TABLE files ADD COLUMN thumbnail_generated TIMESTAMPTZ;
    END IF;
END $$;

-- Ensure the column has the correct index
DROP INDEX IF EXISTS ix_files_thumbnail;
CREATE INDEX IF NOT EXISTS ix_files_thumbnail
    ON files (thumbnail_generated)
    WHERE mime_type LIKE 'image/%' AND status = 'Available'
        AND deleted_at IS NULL AND client_secret_hash IS NULL;

COMMIT;
