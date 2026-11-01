-- ============================================================
-- Migration: File version history + soft-deletion retention (PostgreSQL)
-- Date: 2026-10-31
-- Branch: postgresql
-- Purpose:
--   Port of the MSSQL file-versioning feature (`mssql` branch,
--   commits d364703f..e82dba6c) to the PostgreSQL dialect.
--
--   1. files.file_name_hash       - HMAC-SHA256 (64 hex) of the normalized
--                                   filename: enables indexed same-name /
--                                   same-folder detection without storing
--                                   plaintext names.
--   2. files.version_count        - total versions (current + archived).
--                                   The current version lives in `files`
--                                   (Model B); archived versions live in
--                                   `file_versions`.
--   3. files.current_version_id   - reserved for future restore-promote flow.
--   4. share_links.version_id     - optional pin to a specific archived
--                                   version (NULL = latest at access time).
--   5. file_versions              - archived older versions.
--   6. file_version_keys          - wrapped key per archived version (1:1).
--   7. Indexes + FK for pin /
--      version-trash support.
--
--   `files.deleted_at` already exists (soft-deletion); no DDL needed for it.
--   `file_name_hash` backfill is done by the app (scripts/backfill-file-hashes.ts),
--   because encrypted names cannot be derived by the database.
--
-- Idempotent. Run as schema owner:
--   psql -U leeku_app -d LeekuSecure -f Documentation/SQL/2026-10-31-postgresql-file-versioning.sql
-- ============================================================

BEGIN;

-- ──────────────────────────────────────────────────────────────
-- 1. files.file_name_hash — indexed HMAC for same-name detection
-- ──────────────────────────────────────────────────────────────
ALTER TABLE files ADD COLUMN IF NOT EXISTS file_name_hash CHAR(64) NULL;

-- ──────────────────────────────────────────────────────────────
-- 2. files.version_count — total versions (current + archived)
-- ──────────────────────────────────────────────────────────────
ALTER TABLE files
    ADD COLUMN IF NOT EXISTS version_count INTEGER NOT NULL DEFAULT 1;

-- ──────────────────────────────────────────────────────────────
-- 3. files.current_version_id — reserved (nullable)
-- ──────────────────────────────────────────────────────────────
ALTER TABLE files ADD COLUMN IF NOT EXISTS current_version_id UUID NULL;

-- ──────────────────────────────────────────────────────────────
-- 4. share_links.version_id — optional per-version pinning (NULL = current)
-- ──────────────────────────────────────────────────────────────
ALTER TABLE share_links ADD COLUMN IF NOT EXISTS version_id UUID NULL;

-- ──────────────────────────────────────────────────────────────
-- 5. file_versions — archived older versions
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS file_versions (
    id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id                    UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    version_no                 INTEGER NOT NULL,
    original_name_encrypted    BYTEA NOT NULL,
    original_name_iv           BYTEA NOT NULL,
    original_name_auth_tag     BYTEA NOT NULL,
    stored_path                TEXT NOT NULL,
    mime_type                  VARCHAR(255) NOT NULL,
    size_bytes                 BIGINT NOT NULL,
    encrypted_size_bytes       BIGINT NOT NULL,
    status                     VARCHAR(20) NOT NULL DEFAULT 'Available',
    checksum_sha256            CHAR(64) NOT NULL,
    scan_result                VARCHAR(20) NULL,
    scan_message               TEXT NULL,
    is_encrypted               BOOLEAN NOT NULL DEFAULT TRUE,
    client_secret_hash         TEXT NULL,
    client_crypto_salt         BYTEA NULL,
    client_crypto_iv           BYTEA NULL,
    client_crypto_iterations   INTEGER NULL,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at                 TIMESTAMPTZ NULL,
    deleted_by                 UUID NULL,
    CONSTRAINT uq_file_versions_file_version UNIQUE (file_id, version_no)
);

-- ──────────────────────────────────────────────────────────────
-- 6. file_version_keys — wrapped key per archived version (1:1)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS file_version_keys (
    version_id      UUID PRIMARY KEY REFERENCES file_versions(id) ON DELETE CASCADE,
    encrypted_key   BYTEA NOT NULL,
    key_iv          BYTEA NOT NULL,
    key_auth_tag    BYTEA NOT NULL,
    file_iv         BYTEA NOT NULL,
    file_auth_tag   BYTEA NOT NULL,
    algorithm       VARCHAR(20) NOT NULL DEFAULT 'AES-256-GCM',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ──────────────────────────────────────────────────────────────
-- 7. FK share_links.version_id -> file_versions(id) NO ACTION (pin)
--     A version can only be purged once the pin is cleared by the app.
-- ──────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        INNER JOIN pg_class t ON t.oid = c.conrelid
        INNER JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE t.relname = 'share_links'
            AND n.nspname = current_schema()
            AND c.conname = 'fk_share_links_version'
    ) THEN
        ALTER TABLE share_links
            ADD CONSTRAINT fk_share_links_version
            FOREIGN KEY (version_id) REFERENCES file_versions(id);
    END IF;
END $$;

-- ──────────────────────────────────────────────────────────────
-- 8. Index: same-name same-folder detection
-- ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS ix_files_owner_name_hash
    ON files (owner_user_id, folder_id, file_name_hash)
    WHERE file_name_hash IS NOT NULL;

-- ──────────────────────────────────────────────────────────────
-- 9. Index: Trash purge scan (soft-deleted rows by age)
-- ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS ix_files_deleted_at
    ON files (deleted_at)
    WHERE deleted_at IS NOT NULL;

-- ──────────────────────────────────────────────────────────────
-- 10. Index: file_versions lookup by parent file + version no
-- ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS ix_file_versions_file_id
    ON file_versions (file_id, version_no);

COMMIT;
