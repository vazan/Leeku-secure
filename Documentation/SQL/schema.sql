-- ============================================================
-- Leeku-Secure Database Schema
-- SQL Server 2022 (or compatible)
-- ============================================================
-- This schema defines all tables required for the Leeku-Secure
-- file sharing and management platform with end-to-end encryption.
--
-- Key Features:
-- - Encrypted PII (email, username) with AES-256-GCM
-- - HMAC-SHA256 hash columns for secure index lookups
-- - File encryption with per-file keys
-- - Share link management with optional password protection
-- - Audit logging for compliance
-- - Soft delete support (expires_at, deleted_at)
--
-- NOTE: Columns marked (ILLUSTRATIVE) are inferred from TypeScript
-- interfaces; consult src/server.ts for authoritative column names.
-- ============================================================

-- Create database if it doesn't exist
-- Uncomment if needed: CREATE DATABASE LeekuSecure;
-- USE LeekuSecure;

-- ============================================================
-- Table: users
-- ============================================================
-- Core user identity and authentication storage.
-- Email and username are encrypted with AES-256-GCM for confidentiality.
-- HMAC-SHA256 hashes enable unique indexes on sensitive fields.
-- ============================================================
CREATE TABLE users (
    id                              UNIQUEIDENTIFIER    NOT NULL DEFAULT NEWID() PRIMARY KEY,
    -- Encrypted PII (AES-256-GCM)
    email_encrypted                 VARBINARY(512)      NOT NULL,        -- AES-256-GCM ciphertext
    email_iv                        VARBINARY(16)       NOT NULL,        -- 12-byte IV (stored as 16)
    email_auth_tag                  VARBINARY(16)       NOT NULL,        -- GCM auth tag
    email_hash                      CHAR(64)            NOT NULL UNIQUE, -- HMAC-SHA256 for index lookup
    -- Encrypted username
    username_encrypted              VARBINARY(512)      NOT NULL,
    username_iv                     VARBINARY(16)       NOT NULL,
    username_auth_tag               VARBINARY(16)       NOT NULL,
    username_hash                   CHAR(64)            NOT NULL UNIQUE,
    -- Authentication
    password_hash                   NVARCHAR(512)       NOT NULL,        -- Argon2id PHC string
    -- Authorization & Quotas
    role                            NVARCHAR(10)        NOT NULL DEFAULT 'User', -- 'User' | 'Admin'
    quota_id                        NVARCHAR(50)        NOT NULL DEFAULT 'guest',
    storage_used_bytes              BIGINT              NOT NULL DEFAULT 0,
    -- Account Status
    status                          NVARCHAR(20)        NOT NULL DEFAULT 'Active', -- 'Active' | 'Suspended'
    failed_login_count              INT                 NOT NULL DEFAULT 0,
    locked_until                    DATETIMEOFFSET      NULL,            -- Account lockout (brute force)
    last_login_at                   DATETIMEOFFSET      NULL,
    -- Email Verification
    email_verified                  BIT                 NOT NULL DEFAULT 0,
    email_verification_token        CHAR(64)            NULL,            -- SHA-256 hex
    email_verification_expires      DATETIMEOFFSET      NULL,
    -- Account Deletion
    deletion_token                  CHAR(64)            NULL,            -- SHA-256 hex
    deletion_token_expires          DATETIMEOFFSET      NULL,
    -- Audit
    created_at                      DATETIMEOFFSET      NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    -- Indexes
    INDEX idx_email_hash            ON email_hash,
    INDEX idx_username_hash         ON username_hash,
    INDEX idx_quota_id              ON quota_id,
    INDEX idx_status_created        ON status, created_at,
    FOREIGN KEY (quota_id)          REFERENCES quotas(id)
);

-- ============================================================
-- Table: quotas
-- ============================================================
-- Defines storage and upload limits for different user tiers.
-- Seed data includes 'guest' tier (required for registration).
-- ============================================================
CREATE TABLE quotas (
    id                              NVARCHAR(50)        NOT NULL PRIMARY KEY,  -- e.g. 'guest', 'basic', 'pro'
    name                            NVARCHAR(100)       NOT NULL,              -- e.g. 'Guest User', 'Basic Tier'
    storage_limit_bytes             BIGINT              NOT NULL,              -- Maximum total storage per user
    max_file_size_bytes             BIGINT              NOT NULL,              -- Maximum single file size
    max_files                       INT                 NOT NULL,              -- Maximum number of files
    daily_upload_limit_bytes        BIGINT              NOT NULL               -- Daily upload limit
);

-- Seed minimum quota tier required for registration
INSERT INTO quotas (id, name, storage_limit_bytes, max_file_size_bytes, max_files, daily_upload_limit_bytes)
VALUES ('guest', 'Guest', 1073741824, 104857600, 10, 524288000);  -- 1GB, 100MB, 10 files, 500MB/day

-- ============================================================
-- Table: files
-- ============================================================
-- User-uploaded files with encryption metadata and malware scan results.
-- Filename is encrypted; SHA256 checksum is plaintext (for dedup).
-- Per-file encryption key is stored separately in file_encryption_keys.
-- ============================================================
CREATE TABLE files (
    id                              UNIQUEIDENTIFIER    NOT NULL DEFAULT NEWID() PRIMARY KEY,
    -- Ownership
    owner_user_id                   UNIQUEIDENTIFIER    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Encrypted filename (AES-256-GCM)
    original_name_encrypted         VARBINARY(2048)     NOT NULL,
    original_name_iv                VARBINARY(16)       NOT NULL,
    original_name_auth_tag          VARBINARY(16)       NOT NULL,
    -- Storage & Metadata
    stored_path                     NVARCHAR(1000)      NOT NULL,        -- vault-relative filename, e.g. 'abc123.vault'
    mime_type                       NVARCHAR(255)       NOT NULL,
    size_bytes                      BIGINT              NOT NULL,
    encrypted_size_bytes            BIGINT              NOT NULL,
    -- Status & Availability
    status                          NVARCHAR(20)        NOT NULL DEFAULT 'Available', -- 'Available' | 'Blocked' | 'Expired'
    -- Integrity & Security
    checksum_sha256                 CHAR(64)            NOT NULL,        -- SHA-256 of plaintext
    is_encrypted                    BIT                 NOT NULL DEFAULT 1,
    -- Malware Scan Results
    scan_result                     NVARCHAR(20)        NULL,            -- 'Clean' | 'Infected' | 'Suspicious' | ...
    scan_message                    NVARCHAR(MAX)       NULL,
    scanned_at                      DATETIMEOFFSET      NULL,
    leeku_vibe                      NVARCHAR(500)       NULL,            -- AI-generated scan message
    -- Expiration (TTL)
    ttl_hours                       INT                 NULL,
    expires_at                      DATETIMEOFFSET      NULL,
    deleted_at                      DATETIMEOFFSET      NULL,
    -- Optional client-side secret key columns (added by auto-migration on startup)
    client_secret_hash              NVARCHAR(512)       NULL,            -- Argon2i hash
    client_crypto_salt              VARBINARY(32)       NULL,
    client_crypto_iv                VARBINARY(16)       NULL,
    client_crypto_iterations        INT                 NULL,
    -- Audit
    created_at                      DATETIMEOFFSET      NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    -- Indexes
    INDEX idx_owner_user_id         ON owner_user_id,
    INDEX idx_status_created        ON status, created_at,
    INDEX idx_expires_at            ON expires_at,
    INDEX idx_deleted_at            ON deleted_at,
    INDEX idx_checksum_sha256       ON checksum_sha256
);

-- ============================================================
-- Table: file_encryption_keys
-- ============================================================
-- Per-file encryption keys wrapped with the master key.
-- One row per file; deleted when file is deleted (CASCADE).
-- ============================================================
CREATE TABLE file_encryption_keys (
    file_id                         UNIQUEIDENTIFIER    NOT NULL REFERENCES files(id) ON DELETE CASCADE PRIMARY KEY,
    -- Wrapped per-file key (AES-256-GCM, wrapped with master key)
    encrypted_key                   VARBINARY(64)       NOT NULL,
    key_iv                          VARBINARY(16)       NOT NULL,
    key_auth_tag                    VARBINARY(16)       NOT NULL,
    -- IV & auth tag for the actual file ciphertext
    file_iv                         VARBINARY(16)       NOT NULL,
    file_auth_tag                   VARBINARY(16)       NOT NULL
);

-- ============================================================
-- Table: share_links
-- ============================================================
-- Public share links for files with optional password protection.
-- public_token is a 32-char hex string (16 random bytes).
-- Optional columns (allow_external_preview) added by auto-migration.
-- ============================================================
CREATE TABLE share_links (
    id                              UNIQUEIDENTIFIER    NOT NULL DEFAULT NEWID() PRIMARY KEY,
    -- File Reference
    file_id                         UNIQUEIDENTIFIER    NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    -- Public Access
    public_token                    CHAR(32)            NOT NULL UNIQUE, -- 16 random bytes as hex
    password_hash                   NVARCHAR(256)       NULL,            -- bcrypt hash (cost 12)
    -- Expiration & Download Limits
    expires_at                      DATETIMEOFFSET      NULL,
    max_downloads                   INT                 NULL,
    download_count                  INT                 NOT NULL DEFAULT 0,
    -- Control Flags
    is_active                       BIT                 NOT NULL DEFAULT 1,
    -- Optional column (added by auto-migration on startup)
    allow_external_preview          BIT                 NOT NULL DEFAULT 0,
    -- Audit
    created_at                      DATETIMEOFFSET      NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    -- Indexes
    INDEX idx_public_token          ON public_token,
    INDEX idx_file_id               ON file_id,
    INDEX idx_expires_at            ON expires_at
);

-- ============================================================
-- Table: refresh_tokens
-- ============================================================
-- OAuth2 refresh tokens for session management.
-- Tokens are hashed (SHA-256) before storage; original token
-- is never stored and cannot be recovered.
-- ============================================================
CREATE TABLE refresh_tokens (
    id                              UNIQUEIDENTIFIER    NOT NULL DEFAULT NEWID() PRIMARY KEY,
    -- User Reference
    user_id                         UNIQUEIDENTIFIER    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Token & Expiration
    token_hash                      CHAR(64)            NOT NULL UNIQUE, -- SHA-256 of the opaque token
    expires_at                      DATETIMEOFFSET      NOT NULL,
    -- Audit & Security
    created_at                      DATETIMEOFFSET      NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    revoked_at                      DATETIMEOFFSET      NULL,
    ip_address                      NVARCHAR(45)        NULL,            -- IPv4 or IPv6
    user_agent                      NVARCHAR(500)       NULL,
    -- Indexes
    INDEX idx_user_id               ON user_id,
    INDEX idx_token_hash            ON token_hash,
    INDEX idx_expires_at            ON expires_at
);

-- ============================================================
-- Table: system_logs
-- ============================================================
-- Comprehensive audit log for all user and system events.
-- Used for security forensics, compliance (GDPR SAR), and monitoring.
-- Logs are immutable and never deleted (soft-deleted via TTL).
-- ============================================================
CREATE TABLE system_logs (
    id                              BIGINT              NOT NULL IDENTITY(1,1) PRIMARY KEY,
    -- User Context (NULL for system events)
    user_id                         UNIQUEIDENTIFIER    NULL,
    username_snapshot               NVARCHAR(200)       NULL,            -- Username at time of event (immutable snapshot)
    -- Event Classification
    event_type                      NVARCHAR(20)        NOT NULL,        -- 'Upload'|'Scan'|'Delete'|'Download'|'Link'|'Admin'|'Security'|'Auth'
    target_type                     NVARCHAR(50)        NOT NULL,        -- 'File'|'User'|'Share'|'Token'
    target_id                       NVARCHAR(100)       NOT NULL,        -- ID of the affected resource
    -- Context
    ip_address                      NVARCHAR(45)        NOT NULL,        -- IPv4 or IPv6 address
    message                         NVARCHAR(MAX)       NOT NULL,        -- Free-form event description
    -- Audit
    created_at                      DATETIMEOFFSET      NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    -- Indexes (optimize common queries)
    INDEX idx_user_id               ON user_id,
    INDEX idx_event_type            ON event_type,
    INDEX idx_created_at            ON created_at,
    INDEX idx_user_event_date       ON user_id, event_type, created_at
);

-- ============================================================
-- Metadata & Constraints
-- ============================================================
-- AUTO-MIGRATIONS (on server startup):
-- The application runs two lightweight migrations that add optional columns
-- if they don't exist:
--   1. ensureOptionalFileSecretColumns: Adds client_secret_hash, client_crypto_salt,
--      client_crypto_iv, client_crypto_iterations to files table
--   2. ensureOptionalShareLinkColumns: Adds allow_external_preview to share_links table
--
-- These migrations are idempotent and safe to run on existing databases.
-- ============================================================
