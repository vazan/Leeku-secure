-- ============================================================
-- 03_files.sql
-- Creates the files table and its indexes.
--
-- Security notes:
--   • original_name is AES-256-GCM encrypted — only the application
--     can recover the real filename; the DB engine stores opaque bytes.
--   • stored_path contains only the opaque vault filename on the UNC
--     share (e.g. \\srv\vault\<uuid>.vault), never a user-supplied name.
--   • checksum_sha256 is verified on every download to detect corruption
--     or tampering of the vault file on disk.
--   • scan_result stores the Bitdefender verdict; Blocked files cannot
--     be downloaded or shared.
--   • ttl_hours / expires_at drive the automatic file expiry system.
--     Valid TTL values: 1, 4, 24, 48, 120, 168 (hours).
--     NULL = permanent (no expiry).
-- ============================================================

USE LeekuSecure;
GO

CREATE TABLE files (
    id                      UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID(),
    owner_user_id           UNIQUEIDENTIFIER NOT NULL,

    -- AES-256-GCM encrypted original filename (application layer)
    original_name_encrypted VARBINARY(2048)  NOT NULL,
    original_name_iv        VARBINARY(16)    NOT NULL,
    original_name_auth_tag  VARBINARY(16)    NOT NULL,

    -- Opaque vault path on the UNC share
    stored_path             NVARCHAR(1000)   NOT NULL,

    mime_type               NVARCHAR(255)    NOT NULL,
    size_bytes              BIGINT           NOT NULL,
    encrypted_size_bytes    BIGINT           NOT NULL,

    status                  NVARCHAR(20)     NOT NULL DEFAULT 'Available',

    -- SHA-256 of the original plaintext file, verified on download
    checksum_sha256         CHAR(64)         NOT NULL,

    -- Bitdefender scan results
    scan_result             NVARCHAR(20)     NULL,
    scan_message            NVARCHAR(MAX)    NULL,
    scanned_at              DATETIMEOFFSET   NULL,

    is_encrypted            BIT              NOT NULL DEFAULT 1,
    leeku_vibe              NVARCHAR(500)    NULL,

    -- TTL auto-expiry:
    --   ttl_hours  = NULL → permanent file
    --   ttl_hours  ∈ {1, 4, 24, 48, 120, 168}
    --   expires_at is pre-computed at upload time (created_at + ttl_hours)
    ttl_hours               INT              NULL,
    expires_at              DATETIMEOFFSET   NULL,

    created_at              DATETIMEOFFSET   NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    deleted_at              DATETIMEOFFSET   NULL,   -- Populated when the file is expired/deleted

    CONSTRAINT PK_files         PRIMARY KEY CLUSTERED (id),
    CONSTRAINT FK_files_users   FOREIGN KEY (owner_user_id)
                                REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT CK_files_status  CHECK (status IN ('Available', 'Blocked', 'Expired')),
    CONSTRAINT CK_files_ttl     CHECK (ttl_hours IS NULL
                                    OR ttl_hours IN (1, 4, 24, 48, 120, 168)),
    CONSTRAINT CK_files_scan    CHECK (scan_result IS NULL
                                    OR scan_result IN ('Clean', 'Infected', 'Suspicious', 'Error', 'Timeout')),
    CONSTRAINT CK_files_size    CHECK (size_bytes > 0)
);
GO

-- General lookup by owner
CREATE NONCLUSTERED INDEX IX_files_owner_id
    ON files (owner_user_id)
    INCLUDE (status, created_at);

-- Partial index used exclusively by the expiry cleanup job
-- Only covers files that can actually expire and are still Available
CREATE NONCLUSTERED INDEX IX_files_expires_at
    ON files (expires_at)
    WHERE expires_at IS NOT NULL AND status = 'Available';

-- Status lookup used by admin and stats endpoints
CREATE NONCLUSTERED INDEX IX_files_status
    ON files (status)
    INCLUDE (owner_user_id);
GO

PRINT '03_files.sql completed.';
GO
