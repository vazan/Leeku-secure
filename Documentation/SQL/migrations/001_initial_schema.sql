-- ============================================================
-- Migration: 001_initial_schema.sql
-- Leeku-Secure Initial Database Schema
-- SQL Server 2022 (or compatible)
-- ============================================================
-- Description:
--   Creates the initial database schema for Leeku-Secure.
--   This migration is idempotent and can be run multiple times safely.
--
-- Execution:
--   sqlcmd -S localhost -U sa -P <password> -d LeekuSecure -i 001_initial_schema.sql
--   or via Node.js:
--   const sql = require('mssql');
--   const fs = require('fs');
--   const schema = fs.readFileSync('./001_initial_schema.sql', 'utf-8');
--   const req = new sql.Request();
--   await req.batch(schema);
--
-- Rollback:
--   Execute: DROP TABLE IF EXISTS [system_logs];
--            DROP TABLE IF EXISTS [refresh_tokens];
--            DROP TABLE IF EXISTS [share_links];
--            DROP TABLE IF EXISTS [file_encryption_keys];
--            DROP TABLE IF EXISTS [files];
--            DROP TABLE IF EXISTS [users];
--            DELETE FROM [quotas];
-- ============================================================

-- ============================================================
-- Create Tables (in dependency order)
-- ============================================================

-- Step 1: Create quotas (no dependencies)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'quotas')
BEGIN
    CREATE TABLE quotas (
        id                              NVARCHAR(50)        NOT NULL PRIMARY KEY,
        name                            NVARCHAR(100)       NOT NULL,
        storage_limit_bytes             BIGINT              NOT NULL,
        max_file_size_bytes             BIGINT              NOT NULL,
        max_files                       INT                 NOT NULL,
        daily_upload_limit_bytes        BIGINT              NOT NULL
    );
    PRINT 'Created table: quotas';
END
ELSE
    PRINT 'Table quotas already exists.';

-- Step 2: Seed quotas with default tier (idempotent)
IF NOT EXISTS (SELECT 1 FROM quotas WHERE id = 'guest')
BEGIN
    INSERT INTO quotas (id, name, storage_limit_bytes, max_file_size_bytes, max_files, daily_upload_limit_bytes)
    VALUES ('guest', 'Guest', 1073741824, 104857600, 10, 524288000);  -- 1GB, 100MB, 10 files, 500MB/day
    PRINT 'Seeded quotas table with ''guest'' tier.';
END
ELSE
    PRINT 'Quotas already seeded.';

-- Step 3: Create users (depends on quotas)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'users')
BEGIN
    CREATE TABLE users (
        id                              UNIQUEIDENTIFIER    NOT NULL DEFAULT NEWID() PRIMARY KEY,
        email_encrypted                 VARBINARY(512)      NOT NULL,
        email_iv                        VARBINARY(16)       NOT NULL,
        email_auth_tag                  VARBINARY(16)       NOT NULL,
        email_hash                      CHAR(64)            NOT NULL UNIQUE,
        username_encrypted              VARBINARY(512)      NOT NULL,
        username_iv                     VARBINARY(16)       NOT NULL,
        username_auth_tag               VARBINARY(16)       NOT NULL,
        username_hash                   CHAR(64)            NOT NULL UNIQUE,
        password_hash                   NVARCHAR(512)       NOT NULL,
        role                            NVARCHAR(10)        NOT NULL DEFAULT 'User',
        quota_id                        NVARCHAR(50)        NOT NULL DEFAULT 'guest',
        storage_used_bytes              BIGINT              NOT NULL DEFAULT 0,
        status                          NVARCHAR(20)        NOT NULL DEFAULT 'Active',
        failed_login_count              INT                 NOT NULL DEFAULT 0,
        locked_until                    DATETIMEOFFSET      NULL,
        last_login_at                   DATETIMEOFFSET      NULL,
        email_verified                  BIT                 NOT NULL DEFAULT 0,
        email_verification_token        CHAR(64)            NULL,
        email_verification_expires      DATETIMEOFFSET      NULL,
        deletion_token                  CHAR(64)            NULL,
        deletion_token_expires          DATETIMEOFFSET      NULL,
        created_at                      DATETIMEOFFSET      NOT NULL DEFAULT SYSDATETIMEOFFSET(),
        FOREIGN KEY (quota_id)          REFERENCES quotas(id)
    );
    CREATE INDEX idx_email_hash            ON users(email_hash);
    CREATE INDEX idx_username_hash         ON users(username_hash);
    CREATE INDEX idx_quota_id              ON users(quota_id);
    CREATE INDEX idx_status_created        ON users(status, created_at);
    PRINT 'Created table: users (with indexes)';
END
ELSE
    PRINT 'Table users already exists.';

-- Step 4: Create files (depends on users)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'files')
BEGIN
    CREATE TABLE files (
        id                              UNIQUEIDENTIFIER    NOT NULL DEFAULT NEWID() PRIMARY KEY,
        owner_user_id                   UNIQUEIDENTIFIER    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        original_name_encrypted         VARBINARY(2048)     NOT NULL,
        original_name_iv                VARBINARY(16)       NOT NULL,
        original_name_auth_tag          VARBINARY(16)       NOT NULL,
        stored_path                     NVARCHAR(1000)      NOT NULL,
        mime_type                       NVARCHAR(255)       NOT NULL,
        size_bytes                      BIGINT              NOT NULL,
        encrypted_size_bytes            BIGINT              NOT NULL,
        status                          NVARCHAR(20)        NOT NULL DEFAULT 'Available',
        checksum_sha256                 CHAR(64)            NOT NULL,
        is_encrypted                    BIT                 NOT NULL DEFAULT 1,
        scan_result                     NVARCHAR(20)        NULL,
        scan_message                    NVARCHAR(MAX)       NULL,
        scanned_at                      DATETIMEOFFSET      NULL,
        leeku_vibe                      NVARCHAR(500)       NULL,
        ttl_hours                       INT                 NULL,
        expires_at                      DATETIMEOFFSET      NULL,
        deleted_at                      DATETIMEOFFSET      NULL,
        created_at                      DATETIMEOFFSET      NOT NULL DEFAULT SYSDATETIMEOFFSET()
    );
    CREATE INDEX idx_owner_user_id         ON files(owner_user_id);
    CREATE INDEX idx_status_created        ON files(status, created_at);
    CREATE INDEX idx_expires_at            ON files(expires_at);
    CREATE INDEX idx_deleted_at            ON files(deleted_at);
    CREATE INDEX idx_checksum_sha256       ON files(checksum_sha256);
    PRINT 'Created table: files (with indexes)';
END
ELSE
    PRINT 'Table files already exists.';

-- Step 5: Create file_encryption_keys (depends on files)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'file_encryption_keys')
BEGIN
    CREATE TABLE file_encryption_keys (
        file_id                         UNIQUEIDENTIFIER    NOT NULL REFERENCES files(id) ON DELETE CASCADE PRIMARY KEY,
        encrypted_key                   VARBINARY(64)       NOT NULL,
        key_iv                          VARBINARY(16)       NOT NULL,
        key_auth_tag                    VARBINARY(16)       NOT NULL,
        file_iv                         VARBINARY(16)       NOT NULL,
        file_auth_tag                   VARBINARY(16)       NOT NULL
    );
    PRINT 'Created table: file_encryption_keys';
END
ELSE
    PRINT 'Table file_encryption_keys already exists.';

-- Step 6: Create share_links (depends on files)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'share_links')
BEGIN
    CREATE TABLE share_links (
        id                              UNIQUEIDENTIFIER    NOT NULL DEFAULT NEWID() PRIMARY KEY,
        file_id                         UNIQUEIDENTIFIER    NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        public_token                    CHAR(32)            NOT NULL UNIQUE,
        password_hash                   NVARCHAR(256)       NULL,
        expires_at                      DATETIMEOFFSET      NULL,
        max_downloads                   INT                 NULL,
        download_count                  INT                 NOT NULL DEFAULT 0,
        is_active                       BIT                 NOT NULL DEFAULT 1,
        created_at                      DATETIMEOFFSET      NOT NULL DEFAULT SYSDATETIMEOFFSET()
    );
    CREATE INDEX idx_public_token          ON share_links(public_token);
    CREATE INDEX idx_file_id               ON share_links(file_id);
    CREATE INDEX idx_expires_at            ON share_links(expires_at);
    PRINT 'Created table: share_links (with indexes)';
END
ELSE
    PRINT 'Table share_links already exists.';

-- Step 7: Create refresh_tokens (depends on users)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'refresh_tokens')
BEGIN
    CREATE TABLE refresh_tokens (
        id                              UNIQUEIDENTIFIER    NOT NULL DEFAULT NEWID() PRIMARY KEY,
        user_id                         UNIQUEIDENTIFIER    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash                      CHAR(64)            NOT NULL UNIQUE,
        expires_at                      DATETIMEOFFSET      NOT NULL,
        created_at                      DATETIMEOFFSET      NOT NULL DEFAULT SYSDATETIMEOFFSET(),
        revoked_at                      DATETIMEOFFSET      NULL,
        ip_address                      NVARCHAR(45)        NULL,
        user_agent                      NVARCHAR(500)       NULL
    );
    CREATE INDEX idx_user_id               ON refresh_tokens(user_id);
    CREATE INDEX idx_token_hash            ON refresh_tokens(token_hash);
    CREATE INDEX idx_expires_at            ON refresh_tokens(expires_at);
    PRINT 'Created table: refresh_tokens (with indexes)';
END
ELSE
    PRINT 'Table refresh_tokens already exists.';

-- Step 8: Create system_logs (no hard dependencies)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'system_logs')
BEGIN
    CREATE TABLE system_logs (
        id                              BIGINT              NOT NULL IDENTITY(1,1) PRIMARY KEY,
        user_id                         UNIQUEIDENTIFIER    NULL,
        username_snapshot               NVARCHAR(200)       NULL,
        event_type                      NVARCHAR(20)        NOT NULL,
        target_type                     NVARCHAR(50)        NOT NULL,
        target_id                       NVARCHAR(100)       NOT NULL,
        ip_address                      NVARCHAR(45)        NOT NULL,
        message                         NVARCHAR(MAX)       NOT NULL,
        created_at                      DATETIMEOFFSET      NOT NULL DEFAULT SYSDATETIMEOFFSET()
    );
    CREATE INDEX idx_user_id               ON system_logs(user_id);
    CREATE INDEX idx_event_type            ON system_logs(event_type);
    CREATE INDEX idx_created_at            ON system_logs(created_at);
    CREATE INDEX idx_user_event_date       ON system_logs(user_id, event_type, created_at);
    PRINT 'Created table: system_logs (with indexes)';
END
ELSE
    PRINT 'Table system_logs already exists.';

-- ============================================================
-- Add Optional Columns (auto-migration simulation)
-- ============================================================

-- Add client_secret_hash to files if not present
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('files') AND name = 'client_secret_hash')
BEGIN
    ALTER TABLE files ADD client_secret_hash NVARCHAR(512) NULL;
    ALTER TABLE files ADD client_crypto_salt VARBINARY(32) NULL;
    ALTER TABLE files ADD client_crypto_iv VARBINARY(16) NULL;
    ALTER TABLE files ADD client_crypto_iterations INT NULL;
    PRINT 'Added optional client-secret columns to files table.';
END
ELSE
    PRINT 'Optional client-secret columns already exist in files table.';

-- Add allow_external_preview to share_links if not present
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('share_links') AND name = 'allow_external_preview')
BEGIN
    ALTER TABLE share_links ADD allow_external_preview BIT NOT NULL DEFAULT 0;
    PRINT 'Added allow_external_preview column to share_links table.';
END
ELSE
    PRINT 'Column allow_external_preview already exists in share_links table.';

-- ============================================================
-- Summary
-- ============================================================
PRINT '';
PRINT '========================================';
PRINT 'Schema Migration Complete';
PRINT '========================================';
PRINT 'All tables created and indexes built.';
PRINT 'Optional columns (client secrets, external preview) added.';
PRINT 'Ready for application use.';
PRINT '========================================';
