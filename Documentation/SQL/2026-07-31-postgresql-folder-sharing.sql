-- Adds password- and expiry-protected public links for folder trees.
-- Idempotent: safe to run more than once.

BEGIN;

CREATE TABLE IF NOT EXISTS folder_share_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    folder_id UUID NOT NULL UNIQUE REFERENCES file_folders(id) ON DELETE CASCADE,
    public_token CHAR(32) NOT NULL UNIQUE,
    password_hash VARCHAR(256) NULL,
    expires_at TIMESTAMPTZ NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_folder_share_links_active_expiry
    ON folder_share_links (is_active, expires_at)
    INCLUDE (folder_id, public_token);

COMMIT;