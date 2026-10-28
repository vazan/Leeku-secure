BEGIN;

-- Fix thumbnail_preview column type if it was incorrectly created as text type
-- This script should be run if thumbnail_preview shows "invalid byte sequence for encoding UTF8" errors

DO $$
DECLARE
    col_exists boolean;
    col_type text;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'files' AND column_name = 'thumbnail_preview'
    ) INTO col_exists;
    
    IF col_exists THEN
        SELECT data_type INTO col_type FROM information_schema.columns 
        WHERE table_name = 'files' AND column_name = 'thumbnail_preview';
        
        IF col_type != 'bytea' THEN
            -- Column exists but is not BYTEA, convert it
            ALTER TABLE files 
            ALTER COLUMN thumbnail_preview TYPE BYTEA 
            USING (thumbnail_preview::BYTEA);
            RAISE NOTICE 'Converted thumbnail_preview to BYTEA (was %)', col_type;
        ELSE
            RAISE NOTICE 'thumbnail_preview already BYTEA, no conversion needed';
        END IF;
    ELSE
        RAISE NOTICE 'thumbnail_preview column does not exist, creating it';
        ALTER TABLE files ADD COLUMN thumbnail_preview BYTEA;
    END IF;
END $$;

COMMIT;
