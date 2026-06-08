-- ============================================================
-- 02_users.sql
-- Creates the users table and its indexes.
--
-- Security notes:
--   • email and username are NEVER stored in plaintext.
--     The application encrypts them with AES-256-GCM before INSERT
--     and stores the ciphertext + IV + auth-tag columns.
--   • email_hash / username_hash are HMAC-SHA256 of the normalised
--     plaintext — used for indexed lookup and uniqueness enforcement
--     without the DB engine ever seeing plaintext.
--   • password_hash is an Argon2id PHC string produced by the app.
--   • failed_login_count and locked_until implement brute-force
--     account lockout at the database layer.
-- ============================================================

USE LeekuSecure;
GO

CREATE TABLE users (
    id                   UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID(),

    -- AES-256-GCM encrypted email (application layer)
    email_encrypted      VARBINARY(512)   NOT NULL,
    email_iv             VARBINARY(16)    NOT NULL,   -- 12-byte GCM IV
    email_auth_tag       VARBINARY(16)    NOT NULL,   -- 16-byte GCM auth tag
    -- HMAC-SHA256 of normalised (lowercase + trimmed) email for login lookup
    email_hash           CHAR(64)         NOT NULL,

    -- AES-256-GCM encrypted username (application layer)
    username_encrypted   VARBINARY(512)   NOT NULL,
    username_iv          VARBINARY(16)    NOT NULL,
    username_auth_tag    VARBINARY(16)    NOT NULL,
    -- HMAC-SHA256 of normalised username for uniqueness check
    username_hash        CHAR(64)         NOT NULL,

    -- Argon2id PHC string — app never stores plaintext passwords
    password_hash        NVARCHAR(512)    NOT NULL,

    role                 NVARCHAR(10)     NOT NULL DEFAULT 'User',
    quota_id             NVARCHAR(50)     NOT NULL DEFAULT 'guest',
    storage_used_bytes   BIGINT           NOT NULL DEFAULT 0,
    status               NVARCHAR(20)     NOT NULL DEFAULT 'Active',

    created_at           DATETIMEOFFSET   NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    last_login_at        DATETIMEOFFSET   NULL,

    -- Brute-force lockout
    failed_login_count   INT              NOT NULL DEFAULT 0,
    locked_until         DATETIMEOFFSET   NULL,

    CONSTRAINT PK_users             PRIMARY KEY CLUSTERED (id),
    CONSTRAINT UQ_users_email_hash  UNIQUE (email_hash),
    CONSTRAINT UQ_users_uname_hash  UNIQUE (username_hash),
    CONSTRAINT CK_users_role        CHECK (role   IN ('User', 'Admin')),
    CONSTRAINT CK_users_status      CHECK (status IN ('Active', 'Suspended')),
    CONSTRAINT CK_users_storage     CHECK (storage_used_bytes >= 0),
    CONSTRAINT FK_users_quotas      FOREIGN KEY (quota_id) REFERENCES quotas(id)
);
GO

-- Indexes
CREATE NONCLUSTERED INDEX IX_users_email_hash
    ON users (email_hash);

CREATE NONCLUSTERED INDEX IX_users_username_hash
    ON users (username_hash);

-- Partial index — only Active users are queried frequently
CREATE NONCLUSTERED INDEX IX_users_status
    ON users (status)
    WHERE status = 'Active';
GO

PRINT '02_users.sql completed.';
GO
