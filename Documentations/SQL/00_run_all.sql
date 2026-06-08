-- ============================================================
-- 00_run_all.sql
-- Master script — executes all setup scripts in the correct order.
--
-- Usage (SQLCMD mode — recommended):
--   sqlcmd -S localhost -U sa -P "<SA_PASSWORD>" -i "00_run_all.sql"
--
-- Or in SSMS: enable SQLCMD mode (Query → SQLCMD Mode) then execute.
--
-- Prerequisites:
--   • SQL Server 2022 running and reachable
--   • The executing login must be a member of the sysadmin role
--     (required for CREATE DATABASE and CREATE LOGIN)
--   • Replace <STRONG_RANDOM_PASSWORD> in 09_security_grants.sql
--     before running this script
--
-- Execution order (dependency-safe):
--   00 → database + isolation level
--   01 → quotas          (no FK dependencies)
--   02 → users           (FK → quotas)
--   03 → files           (FK → users)
--   04 → file_encryption_keys  (FK → files)
--   05 → share_links     (FK → files)
--   06 → refresh_tokens  (FK → users)
--   07 → system_logs     (no FK — intentional)
--   08 → stored procedures + GuidList type
--   09 → security grants (must run last)
-- ============================================================

:r 00_create_database.sql
:r 01_quotas.sql
:r 02_users.sql
:r 03_files.sql
:r 04_file_encryption_keys.sql
:r 05_share_links.sql
:r 06_refresh_tokens.sql
:r 07_system_logs.sql
:r 08_stored_procedures.sql
:r 09_security_grants.sql

PRINT '============================================';
PRINT 'LeekuSecure database setup completed.';
PRINT '============================================';
GO
