BEGIN;

-- Add thumbnail_preview if not exists (ensure it's BYTEA, not text type)
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
            -- Column exists but is wrong type, convert it
            ALTER TABLE files 
            ALTER COLUMN thumbnail_preview TYPE BYTEA 
            USING (thumbnail_preview::BYTEA);
            RAISE NOTICE 'Converted thumbnail_preview to BYTEA';
        ELSE
            RAISE NOTICE 'thumbnail_preview already BYTEA, skipping';
        END IF;
    ELSE
        -- Column doesn't exist, create it
        ALTER TABLE files ADD COLUMN thumbnail_preview BYTEA;
        RAISE NOTICE 'Created thumbnail_preview column';
    END IF;
END $$;

-- Add thumbnail_generated if not exists (ensure it's TIMESTAMPTZ, not boolean)
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
            -- Column exists but is boolean, convert it
            ALTER TABLE files 
            ALTER COLUMN thumbnail_generated DROP DEFAULT;
            ALTER TABLE files 
            ALTER COLUMN thumbnail_generated TYPE TIMESTAMPTZ 
            USING NULL;
            RAISE NOTICE 'Converted thumbnail_generated from boolean to TIMESTAMPTZ';
        ELSIF col_type != 'timestamp with time zone' THEN
            -- Column exists but is wrong type (not TIMESTAMPTZ)
            ALTER TABLE files 
            ALTER COLUMN thumbnail_generated TYPE TIMESTAMPTZ 
            USING NULL;
            RAISE NOTICE 'Converted thumbnail_generated to TIMESTAMPTZ';
        ELSE
            RAISE NOTICE 'thumbnail_generated already TIMESTAMPTZ, skipping';
        END IF;
    ELSE
        -- Column doesn't exist, create it
        ALTER TABLE files ADD COLUMN thumbnail_generated TIMESTAMPTZ;
        RAISE NOTICE 'Created thumbnail_generated column';
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_files_thumbnail
    ON files (thumbnail_generated)
    WHERE mime_type LIKE 'image/%' AND status = 'Available'
        AND deleted_at IS NULL AND client_secret_hash IS NULL;

COMMIT;