-- ============================================================
-- 09_security_grants.sql
-- Creates the least-privilege application login and user,
-- then grants only the permissions the app actually needs.
--
-- IMPORTANT: Replace <STRONG_RANDOM_PASSWORD> with a password
-- generated with a password manager or:
--   node -e "console.log(require('crypto').randomBytes(24).toString('base64'))"
--
-- Run this script as a sysadmin login AFTER all tables and
-- procedures have been created (i.e., after scripts 01–08).
-- ============================================================

USE master;
GO

-- Create the SQL Server login (server scope)
IF NOT EXISTS (SELECT name FROM sys.server_principals WHERE name = N'leeku_app')
BEGIN
    CREATE LOGIN leeku_app
        WITH PASSWORD        = '<STRONG_RANDOM_PASSWORD>',
             CHECK_POLICY    = ON,   -- enforce Windows password policy
             CHECK_EXPIRATION = ON;  -- enforce password expiration
    PRINT 'Login leeku_app created.';
END
ELSE
BEGIN
    PRINT 'Login leeku_app already exists — skipping CREATE LOGIN.';
END
GO

USE LeekuSecure;
GO

-- Create the database user mapped to the login
IF NOT EXISTS (SELECT name FROM sys.database_principals WHERE name = N'leeku_app')
BEGIN
    CREATE USER leeku_app FOR LOGIN leeku_app;
    PRINT 'User leeku_app created in LeekuSecure.';
END
ELSE
BEGIN
    PRINT 'User leeku_app already exists — skipping CREATE USER.';
END
GO

-- ──────────────────────────────────────────────────────────────
-- Table permissions
-- ──────────────────────────────────────────────────────────────

-- Reference data — app reads and updates quota tiers
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.quotas               TO leeku_app;

-- User accounts
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.users                TO leeku_app;

-- File metadata
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.files                TO leeku_app;

-- Encryption key store
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.file_encryption_keys TO leeku_app;

-- Share links
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.share_links          TO leeku_app;

-- JWT refresh token store
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.refresh_tokens       TO leeku_app;

-- Audit log — INSERT only (append-only; no UPDATE or DELETE)
GRANT SELECT, INSERT                  ON dbo.system_logs         TO leeku_app;
DENY  UPDATE, DELETE                  ON dbo.system_logs         TO leeku_app;
GO

-- ──────────────────────────────────────────────────────────────
-- Stored procedure permissions
-- ──────────────────────────────────────────────────────────────
GRANT EXECUTE ON dbo.sp_GetExpiredFiles        TO leeku_app;
GRANT EXECUTE ON dbo.sp_MarkFilesExpired       TO leeku_app;
GRANT EXECUTE ON dbo.sp_IncrementDownloadCount TO leeku_app;
GRANT EXECUTE ON dbo.sp_ResetLoginAttempts     TO leeku_app;
GRANT EXECUTE ON dbo.sp_RecordFailedLogin      TO leeku_app;
GO

-- ──────────────────────────────────────────────────────────────
-- User-defined type permission (required for sp_MarkFilesExpired)
-- ──────────────────────────────────────────────────────────────
GRANT EXECUTE ON TYPE::dbo.GuidList TO leeku_app;
GO

-- ──────────────────────────────────────────────────────────────
-- Deny DDL — the app cannot alter or drop any schema objects
-- ──────────────────────────────────────────────────────────────
DENY ALTER  ON SCHEMA::dbo TO leeku_app;
DENY CREATE TABLE           TO leeku_app;
DENY CREATE PROCEDURE       TO leeku_app;
DENY CREATE VIEW            TO leeku_app;
GO

PRINT '09_security_grants.sql completed.';
GO
