-- ============================================================
-- 08_stored_procedures.sql
-- All stored procedures and user-defined types.
--
-- Procedures:
--   sp_GetExpiredFiles        — returns files ready for auto-deletion
--   sp_MarkFilesExpired       — bulk-marks files as Expired after disk deletion
--   sp_IncrementDownloadCount — atomic download counter increment
--   sp_ResetLoginAttempts     — clears brute-force counter on successful login
--   sp_RecordFailedLogin      — increments counter + sets lockout when threshold hit
--
-- Types:
--   dbo.GuidList              — table-valued parameter for bulk ID passing
-- ============================================================

USE LeekuSecure;
GO

-- ──────────────────────────────────────────────────────────────
-- User-Defined Table Type: GuidList
-- Used by sp_MarkFilesExpired to pass a set of file IDs safely.
-- ──────────────────────────────────────────────────────────────
CREATE TYPE dbo.GuidList AS TABLE
(
    id UNIQUEIDENTIFIER NOT NULL
);
GO

-- ──────────────────────────────────────────────────────────────
-- sp_GetExpiredFiles
-- Returns all files whose TTL has elapsed and that are still
-- in 'Available' status. Called by the Node.js expiry cleanup job
-- to retrieve vault file paths before physical deletion.
-- ──────────────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE sp_GetExpiredFiles
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        f.id,
        f.stored_path,
        f.owner_user_id,
        f.expires_at,
        f.size_bytes
    FROM files f
    WHERE
        f.expires_at IS NOT NULL
        AND f.expires_at <= SYSDATETIMEOFFSET()
        AND f.status = 'Available';
END;
GO

-- ──────────────────────────────────────────────────────────────
-- sp_MarkFilesExpired
-- Called after the vault files have been physically deleted from
-- the UNC share. Marks the corresponding DB records as 'Expired'
-- and sets deleted_at to the current timestamp.
-- Uses a table-valued parameter to avoid SQL injection.
-- ──────────────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE sp_MarkFilesExpired
    @FileIds dbo.GuidList READONLY
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE f
    SET
        status     = 'Expired',
        deleted_at = SYSDATETIMEOFFSET()
    FROM files f
    INNER JOIN @FileIds ids ON f.id = ids.id
    WHERE f.status = 'Available';
END;
GO

-- ──────────────────────────────────────────────────────────────
-- sp_IncrementDownloadCount
-- Atomically increments the download_count for a share link.
-- Called immediately before serving a file download.
-- ──────────────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE sp_IncrementDownloadCount
    @PublicToken CHAR(32)
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE share_links
    SET download_count = download_count + 1
    WHERE public_token = @PublicToken;
END;
GO

-- ──────────────────────────────────────────────────────────────
-- sp_ResetLoginAttempts
-- Resets brute-force counters on a successful login.
-- Also updates last_login_at for the user.
-- ──────────────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE sp_ResetLoginAttempts
    @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE users
    SET
        failed_login_count = 0,
        locked_until       = NULL,
        last_login_at      = SYSDATETIMEOFFSET()
    WHERE id = @UserId;
END;
GO

-- ──────────────────────────────────────────────────────────────
-- sp_RecordFailedLogin
-- Increments the failed_login_count for the given email hash.
-- When the count reaches @MaxAttempts the account is locked
-- for @LockoutMinutes minutes.
-- ──────────────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE sp_RecordFailedLogin
    @EmailHash      CHAR(64),
    @MaxAttempts    INT,
    @LockoutMinutes INT
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE users
    SET
        failed_login_count = failed_login_count + 1,
        locked_until = CASE
            WHEN failed_login_count + 1 >= @MaxAttempts
            THEN DATEADD(MINUTE, @LockoutMinutes, SYSDATETIMEOFFSET())
            ELSE locked_until
        END
    WHERE email_hash = @EmailHash;
END;
GO

PRINT '08_stored_procedures.sql completed.';
GO
