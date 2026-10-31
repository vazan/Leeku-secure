-- Migration: File version history (MSSQL)
-- Date: 2026-10-31
-- Purpose: Support file versioning. Uploading a file with the same name into the
--          same folder creates a NEW VERSION instead of a standalone duplicate.
--          Users can list/download/restore/delete older versions.
--
-- Model (minimal blast radius):
--   - `files` stays the logical file AND holds the CURRENT version's physical blob
--     and keys. Existing queries joining files + file_encryption_keys keep working.
--   - `file_versions` / `file_version_keys` hold ARCHIVED (older) versions that were
--     displaced by a newer upload of the same logical file.
--   - `files.file_name_hash` (HMAC-SHA256, from hashColumnForLookup) enables indexed
--     same-name-in-same-folder detection without storing plaintext filenames.
--   - `share_links.version_id` (nullable) : NULL = link resolves to the current
--     version at access time; set = link is pinned to a specific file_versions.id.

SET XACT_ABORT ON;
GO

-- ──────────────────────────────────────────────────────────────
-- 1. files.file_name_hash — indexed HMAC for same-name detection
-- ──────────────────────────────────────────────────────────────
IF COL_LENGTH('dbo.files', 'file_name_hash') IS NULL
BEGIN
    ALTER TABLE dbo.files ADD file_name_hash CHAR(64) NULL;
    PRINT 'Added file_name_hash column to files table';
END
ELSE
BEGIN
    PRINT 'file_name_hash column already exists on files table';
END
GO

-- ──────────────────────────────────────────────────────────────
-- 2. files.version_count — total number of versions (current + archived).
--    The current version lives in `files` (Model B); archived versions are
--    in file_versions. version_no assigned on archive = version_count, then
--    version_count is incremented.
-- ──────────────────────────────────────────────────────────────
IF COL_LENGTH('dbo.files', 'version_count') IS NULL
BEGIN
    ALTER TABLE dbo.files ADD version_count INT NOT NULL CONSTRAINT DF_files_version_count DEFAULT (1);
    PRINT 'Added version_count column to files table';
END
ELSE
BEGIN
    PRINT 'version_count column already exists on files table';
END
GO

-- ──────────────────────────────────────────────────────────────
-- 2b. files.current_version_id — reserved for future "restore promotes an
--     archived version into files" flow. Kept nullable.
-- ──────────────────────────────────────────────────────────────
IF COL_LENGTH('dbo.files', 'current_version_id') IS NULL
BEGIN
    ALTER TABLE dbo.files ADD current_version_id UNIQUEIDENTIFIER NULL;
    PRINT 'Added current_version_id column to files table';
END
ELSE
BEGIN
    PRINT 'current_version_id column already exists on files table';
END
GO

-- ──────────────────────────────────────────────────────────────
-- 3. share_links.version_id — optional per-version pinning (NULL = current)
-- ──────────────────────────────────────────────────────────────
IF COL_LENGTH('dbo.share_links', 'version_id') IS NULL
BEGIN
    ALTER TABLE dbo.share_links ADD version_id UNIQUEIDENTIFIER NULL;
    PRINT 'Added version_id column to share_links table';
END
ELSE
BEGIN
    PRINT 'version_id column already exists on share_links table';
END
GO

-- ──────────────────────────────────────────────────────────────
-- 4. file_versions — archived older versions
-- ──────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.file_versions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.file_versions(
        [id]               UNIQUEIDENTIFIER NOT NULL,
        [file_id]          UNIQUEIDENTIFIER NOT NULL,
        [version_no]       INT              NOT NULL,
        [original_name_encrypted] VARBINARY(2048) NOT NULL,
        [original_name_iv] VARBINARY(16)    NOT NULL,
        [original_name_auth_tag] VARBINARY(16) NOT NULL,
        [stored_path]      NVARCHAR(1000)   NOT NULL,
        [mime_type]        NVARCHAR(255)    NOT NULL,
        [size_bytes]       BIGINT           NOT NULL,
        [encrypted_size_bytes] BIGINT       NOT NULL,
        [status]           NVARCHAR(20)     NOT NULL,
        [checksum_sha256]  CHAR(64)         NOT NULL,
        [scan_result]      NVARCHAR(20)     NULL,
        [scan_message]     NVARCHAR(MAX)    NULL,
        [is_encrypted]     BIT              NOT NULL,
        [client_secret_hash] NVARCHAR(512)  NULL,
        [client_crypto_salt] VARBINARY(32)  NULL,
        [client_crypto_iv] VARBINARY(16)    NULL,
        [client_crypto_iterations] INT      NULL,
        [created_at]       DATETIMEOFFSET(7) NOT NULL,
        CONSTRAINT [PK_file_versions] PRIMARY KEY CLUSTERED ([id] ASC),
        CONSTRAINT [UQ_file_versions_file_version] UNIQUE NONCLUSTERED ([file_id] ASC, [version_no] ASC)
    ) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY];
    PRINT 'Created dbo.file_versions table';
END
ELSE
BEGIN
    PRINT 'dbo.file_versions table already exists';
END
GO

-- ──────────────────────────────────────────────────────────────
-- 5. file_version_keys — wrapped key per archived version (1:1)
-- ──────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.file_version_keys', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.file_version_keys(
        [version_id]       UNIQUEIDENTIFIER NOT NULL,
        [encrypted_key]    VARBINARY(64)    NOT NULL,
        [key_iv]           VARBINARY(16)    NOT NULL,
        [key_auth_tag]     VARBINARY(16)    NOT NULL,
        [file_iv]          VARBINARY(16)    NOT NULL,
        [file_auth_tag]    VARBINARY(16)    NOT NULL,
        [algorithm]        NVARCHAR(20)     NOT NULL CONSTRAINT DF_file_version_keys_algorithm DEFAULT ('AES-256-GCM'),
        [created_at]       DATETIMEOFFSET(7) NOT NULL CONSTRAINT DF_file_version_keys_created_at DEFAULT (SYSDATETIMEOFFSET()),
        CONSTRAINT [PK_file_version_keys] PRIMARY KEY CLUSTERED ([version_id] ASC)
    ) ON [PRIMARY];
    PRINT 'Created dbo.file_version_keys table';
END
ELSE
BEGIN
    PRINT 'dbo.file_version_keys table already exists';
END
GO

-- ──────────────────────────────────────────────────────────────
-- 6. Foreign keys
-- ──────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_file_versions_files')
BEGIN
    ALTER TABLE dbo.file_versions WITH CHECK ADD CONSTRAINT [FK_file_versions_files]
        FOREIGN KEY ([file_id]) REFERENCES dbo.files([id]) ON DELETE CASCADE;
    PRINT 'Added FK_file_versions_files';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_file_version_keys_versions')
BEGIN
    ALTER TABLE dbo.file_version_keys WITH CHECK ADD CONSTRAINT [FK_file_version_keys_versions]
        FOREIGN KEY ([version_id]) REFERENCES dbo.file_versions([id]) ON DELETE CASCADE;
    PRINT 'Added FK_file_version_keys_versions';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_share_links_version')
BEGIN
    ALTER TABLE dbo.share_links WITH CHECK ADD CONSTRAINT [FK_share_links_version]
        FOREIGN KEY ([version_id]) REFERENCES dbo.file_versions([id]);
    PRINT 'Added FK_share_links_version';
END
GO

-- ──────────────────────────────────────────────────────────────
-- 6b. file_versions.deleted_at / deleted_by — soft-delete support.
--      When an archived version is deleted (moved to the version trash), its blob
--      and wrapped key are KEPT on disk/DB and only `deleted_at` is stamped. The
--      version can be restored (clears deleted_at) or permanently purged later.
-- ──────────────────────────────────────────────────────────────
IF COL_LENGTH('dbo.file_versions', 'deleted_at') IS NULL
BEGIN
    ALTER TABLE dbo.file_versions ADD deleted_at DATETIMEOFFSET(7) NULL;
    PRINT 'Added file_versions.deleted_at column';
END
ELSE
BEGIN
    PRINT 'file_versions.deleted_at column already exists';
END
GO

IF COL_LENGTH('dbo.file_versions', 'deleted_by') IS NULL
BEGIN
    ALTER TABLE dbo.file_versions ADD deleted_by UNIQUEIDENTIFIER NULL;
    PRINT 'Added file_versions.deleted_by column';
END
ELSE
BEGIN
    PRINT 'file_versions.deleted_by column already exists';
END
GO

-- ──────────────────────────────────────────────────────────────
-- 7. Index for same-name same-folder detection
-- ──────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_files_owner_name_hash' AND object_id=OBJECT_ID('dbo.files'))
BEGIN
    CREATE INDEX IX_files_owner_name_hash ON dbo.files(owner_user_id, folder_id, file_name_hash)
        INCLUDE (status);
    PRINT 'Created IX_files_owner_name_hash index';
END
GO

-- ──────────────────────────────────────────────────────────────
-- 8. Backfill: existing active files become version 1. Because the current
--    version lives in `files` itself (Model B), no data movement is required —
--    we only record version lineage metadata. `file_name_hash` is computed by
--    the app on first write; here we leave it NULL and let the server backfill
--    on read/write. (Names are encrypted; the DB cannot derive the HMAC.)
-- ──────────────────────────────────────────────────────────────
PRINT 'Backfill note: existing files remain the current version; file_name_hash is populated by the application.';
GO

-- ──────────────────────────────────────────────────────────────
-- Verify
-- ──────────────────────────────────────────────────────────────
SELECT 'files' AS tbl, COUNT(*) AS rows FROM dbo.files
UNION ALL SELECT 'file_versions', COUNT(*) FROM dbo.file_versions
UNION ALL SELECT 'file_version_keys', COUNT(*) FROM dbo.file_version_keys;
GO

SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME IN ('files','share_links') AND TABLE_SCHEMA='dbo'
AND COLUMN_NAME IN ('file_name_hash','current_version_id','version_id','version_count');
GO
