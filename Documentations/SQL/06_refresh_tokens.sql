-- ============================================================
-- 06_refresh_tokens.sql
-- Server-side refresh token store for JWT RS256 authentication.
--
-- Security notes:
--   • The actual refresh token string is NEVER stored here.
--     Only token_hash (SHA-256 of the token) is persisted so that
--     even a full DB dump cannot be used to forge tokens.
--   • Tokens are revoked on logout, password change, or account
--     suspension by setting revoked_at = SYSDATETIMEOFFSET().
--   • The partial index covers only non-revoked tokens — the common
--     hot path during token refresh.
-- ============================================================

USE LeekuSecure;
GO

CREATE TABLE refresh_tokens (
    id          UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID(),
    user_id     UNIQUEIDENTIFIER NOT NULL,

    -- SHA-256 hex digest of the opaque refresh token value
    token_hash  CHAR(64)         NOT NULL,

    expires_at  DATETIMEOFFSET   NOT NULL,
    created_at  DATETIMEOFFSET   NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    revoked_at  DATETIMEOFFSET   NULL,

    -- Contextual audit data
    ip_address  NVARCHAR(45)     NOT NULL,   -- IPv4 or IPv6
    user_agent  NVARCHAR(500)    NULL,

    CONSTRAINT PK_refresh_tokens       PRIMARY KEY CLUSTERED (id),
    CONSTRAINT UQ_refresh_tokens_hash  UNIQUE (token_hash),
    CONSTRAINT FK_refresh_tokens_users FOREIGN KEY (user_id)
                                       REFERENCES users(id) ON DELETE CASCADE
);
GO

-- Partial index — only non-revoked tokens are validated at runtime
CREATE NONCLUSTERED INDEX IX_refresh_tokens_user_active
    ON refresh_tokens (user_id, expires_at)
    WHERE revoked_at IS NULL;
GO

PRINT '06_refresh_tokens.sql completed.';
GO
