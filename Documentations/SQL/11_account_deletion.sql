-- ============================================================
-- 11_account_deletion.sql
-- Adds account deletion token columns to the users table.
--
-- The account deletion flow:
--   1. User requests deletion from Settings → server stores a
--      cryptographically random token + expiry (1 hour).
--   2. Server emails the user a confirmation link containing
--      the token.
--   3. User clicks the link (or enters the token) → server
--      verifies the token, then cascades-deletes the user
--      and all their files, share links, and encryption keys.
--
-- Run this migration on existing LeekuSecure databases:
--   sqlcmd -S localhost -d LeekuSecure -U leeku_app -P "<PASSWORD>" -i 11_account_deletion.sql
-- ============================================================

USE LeekuSecure;
GO

-- Drop the index if it somehow exists already (clean slate)
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_users_deletion_token' AND object_id = OBJECT_ID('dbo.users'))
BEGIN
    DROP INDEX IX_users_deletion_token ON dbo.users;
    PRINT 'Dropped existing index: IX_users_deletion_token';
END
GO

-- Add columns one at a time with TRY/CATCH so each is independently safe to re-run
BEGIN TRY
    ALTER TABLE dbo.users ADD deletion_token CHAR(64) NULL;
    PRINT 'Added column: deletion_token';
END TRY
BEGIN CATCH
    IF ERROR_NUMBER() = 2705 -- column already exists
        PRINT 'Column deletion_token already exists (skipped).';
    ELSE
        THROW;
END CATCH
GO

BEGIN TRY
    ALTER TABLE dbo.users ADD deletion_token_expires DATETIMEOFFSET NULL;
    PRINT 'Added column: deletion_token_expires';
END TRY
BEGIN CATCH
    IF ERROR_NUMBER() = 2705
        PRINT 'Column deletion_token_expires already exists (skipped).';
    ELSE
        THROW;
END CATCH
GO

-- Index for fast lookup by deletion token
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_users_deletion_token' AND object_id = OBJECT_ID('dbo.users'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_users_deletion_token
        ON dbo.users (deletion_token)
        WHERE deletion_token IS NOT NULL;
    PRINT 'Created index: IX_users_deletion_token';
END
ELSE
    PRINT 'Index IX_users_deletion_token already exists.';

GO

PRINT '11_account_deletion.sql completed.';
GO
