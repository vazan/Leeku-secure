-- ============================================================
-- 00_create_database.sql
-- Creates the LeekuSecure database and sets isolation level.
-- Run once as a sysadmin login before executing any other script.
-- ============================================================

USE master;
GO

IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'LeekuSecure')
BEGIN
    CREATE DATABASE LeekuSecure
        COLLATE Latin1_General_100_CI_AS_SC_UTF8;
    PRINT 'Database LeekuSecure created.';
END
ELSE
BEGIN
    PRINT 'Database LeekuSecure already exists — skipping CREATE.';
END
GO

USE LeekuSecure;
GO

-- Enable snapshot isolation to reduce read/write blocking
ALTER DATABASE LeekuSecure SET READ_COMMITTED_SNAPSHOT ON;
GO

PRINT '00_create_database.sql completed.';
GO
