-- ============================================================
-- 07_system_logs.sql
-- Append-only immutable audit trail.
--
-- Security notes:
--   • The application DB login (leeku_app) is granted only
--     SELECT + INSERT — no UPDATE or DELETE.
--     This is enforced in 09_security_grants.sql.
--   • There is intentionally NO foreign key to the users table
--     so that log entries survive user account deletion.
--   • username_snapshot captures the username at event time;
--     if the user later renames themselves, history is preserved.
-- ============================================================

USE LeekuSecure;
GO

CREATE TABLE system_logs (
    id                BIGINT           NOT NULL IDENTITY(1,1),
    user_id           UNIQUEIDENTIFIER NULL,        -- NULL for anonymous / system events
    username_snapshot NVARCHAR(200)    NULL,         -- Username at the time of the event

    event_type        NVARCHAR(20)     NOT NULL,
    target_type       NVARCHAR(50)     NOT NULL,
    target_id         NVARCHAR(100)    NOT NULL,
    ip_address        NVARCHAR(45)     NOT NULL,    -- IPv4 or IPv6
    message           NVARCHAR(MAX)    NOT NULL,
    created_at        DATETIMEOFFSET   NOT NULL DEFAULT SYSDATETIMEOFFSET(),

    CONSTRAINT PK_system_logs     PRIMARY KEY CLUSTERED (id),
    CONSTRAINT CK_logs_event_type CHECK (event_type IN
        ('Upload', 'Scan', 'Delete', 'Download', 'Link', 'Admin', 'Security', 'Auth'))
    -- No FK to users — logs must outlive user accounts
);
GO

CREATE NONCLUSTERED INDEX IX_system_logs_user_id
    ON system_logs (user_id)
    WHERE user_id IS NOT NULL;

CREATE NONCLUSTERED INDEX IX_system_logs_created_at
    ON system_logs (created_at DESC);

CREATE NONCLUSTERED INDEX IX_system_logs_event_type
    ON system_logs (event_type, created_at DESC);
GO

PRINT '07_system_logs.sql completed.';
GO
