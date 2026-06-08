-- ============================================================
-- 04_file_encryption_keys.sql
-- Stores per-file AES-256-GCM encryption keys in wrapped form.
--
-- Key hierarchy:
--   MASTER_KEY_BASE64 (env var)
--       └─ HKDF-SHA256("leeku-file-key-wrapping-v1") → wrapping sub-key
--              └─ AES-256-GCM wraps the per-file key
--
-- Columns:
--   encrypted_key  — the 32-byte file key, encrypted with the wrapping sub-key
--   key_iv         — random IV used for the key-wrapping AES-GCM operation
--   key_auth_tag   — GCM auth tag for the key-wrapping operation
--   file_iv        — random IV used when the file content was encrypted
--   file_auth_tag  — GCM auth tag for the file content encryption
--
-- This table is kept separate from `files` to allow future key rotation:
-- re-wrap encrypted_key with a new master key without touching vault files.
-- ============================================================

USE LeekuSecure;
GO

CREATE TABLE file_encryption_keys (
    file_id       UNIQUEIDENTIFIER NOT NULL,

    -- Per-file AES-256 key, wrapped (encrypted) with the wrapping sub-key
    encrypted_key VARBINARY(64)    NOT NULL,
    key_iv        VARBINARY(16)    NOT NULL,   -- IV used for the key-wrapping operation
    key_auth_tag  VARBINARY(16)    NOT NULL,   -- GCM auth tag for key wrapping

    -- IV and auth tag used when the vault file itself was encrypted
    file_iv       VARBINARY(16)    NOT NULL,
    file_auth_tag VARBINARY(16)    NOT NULL,

    algorithm     NVARCHAR(20)     NOT NULL DEFAULT 'AES-256-GCM',
    created_at    DATETIMEOFFSET   NOT NULL DEFAULT SYSDATETIMEOFFSET(),

    CONSTRAINT PK_file_keys       PRIMARY KEY (file_id),
    CONSTRAINT FK_file_keys_files FOREIGN KEY (file_id)
                                  REFERENCES files(id) ON DELETE CASCADE
);
GO

PRINT '04_file_encryption_keys.sql completed.';
GO
