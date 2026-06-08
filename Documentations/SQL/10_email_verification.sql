-- ============================================================
-- 10_email_verification.sql
-- Adds email verification columns to the users table.
--
-- Run this migration on existing LeekuSecure databases:
--   sqlcmd -S localhost -d LeekuSecure -U leeku_app -P "<PASSWORD>" -i 10_email_verification.sql
-- ============================================================

USE LeekuSecure;
GO

-- Drop the index if it somehow exists already (clean slate)
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_users_email_verification_token' AND object_id = OBJECT_ID('dbo.users'))
BEGIN
    DROP INDEX IX_users_email_verification_token ON dbo.users;
    PRINT 'Dropped existing index: IX_users_email_verification_token';
END
GO

-- Add columns one at a time with TRY/CATCH so each is independently safe to re-run
BEGIN TRY
    ALTER TABLE dbo.users ADD email_verified BIT NOT NULL DEFAULT 0;
    PRINT 'Added column: email_verified';
END TRY
BEGIN CATCH
    IF ERROR_NUMBER() = 2705 -- column already exists
        PRINT 'Column email_verified already exists (skipped).';
    ELSE
        THROW;
END CATCH
GO

BEGIN TRY
    ALTER TABLE dbo.users ADD email_verification_token CHAR(64) NULL;
    PRINT 'Added column: email_verification_token';
END TRY
BEGIN CATCH
    IF ERROR_NUMBER() = 2705
        PRINT 'Column email_verification_token already exists (skipped).';
    ELSE
        THROW;
END CATCH
GO

BEGIN TRY
    ALTER TABLE dbo.users ADD email_verification_expires DATETIMEOFFSET NULL;
    PRINT 'Added column: email_verification_expires';
END TRY
BEGIN CATCH
    IF ERROR_NUMBER() = 2705
        PRINT 'Column email_verification_expires already exists (skipped).';
    ELSE
        THROW;
END CATCH
GO

-- Index for fast lookup by verification token
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_users_email_verification_token' AND object_id = OBJECT_ID('dbo.users'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_users_email_verification_token
        ON dbo.users (email_verification_token)
        WHERE email_verification_token IS NOT NULL;
    PRINT 'Created index: IX_users_email_verification_token';
END
ELSE
    PRINT 'Index IX_users_email_verification_token already exists.';

GO

PRINT '10_email_verification.sql completed.';
GO
