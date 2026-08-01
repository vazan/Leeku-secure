/*
  Adds password- and expiry-protected public links for folder trees.
  Idempotent: safe to run more than once.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
    BEGIN TRAN;

    IF OBJECT_ID('dbo.folder_share_links', 'U') IS NULL
    BEGIN
        CREATE TABLE dbo.folder_share_links (
            id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_folder_share_links_id DEFAULT NEWSEQUENTIALID(),
            folder_id UNIQUEIDENTIFIER NOT NULL,
            public_token CHAR(32) NOT NULL,
            password_hash NVARCHAR(256) NULL,
            expires_at DATETIMEOFFSET(7) NULL,
            is_active BIT NOT NULL CONSTRAINT DF_folder_share_links_is_active DEFAULT ((1)),
            created_at DATETIMEOFFSET(7) NOT NULL CONSTRAINT DF_folder_share_links_created_at DEFAULT SYSDATETIMEOFFSET(),
            CONSTRAINT PK_folder_share_links PRIMARY KEY CLUSTERED (id ASC),
            CONSTRAINT UQ_folder_share_links_folder UNIQUE (folder_id),
            CONSTRAINT UQ_folder_share_links_token UNIQUE (public_token),
            CONSTRAINT FK_folder_share_links_folders FOREIGN KEY (folder_id)
                REFERENCES dbo.file_folders(id) ON DELETE CASCADE
        );

        CREATE NONCLUSTERED INDEX IX_folder_share_links_active_expiry
            ON dbo.folder_share_links (is_active, expires_at)
            INCLUDE (folder_id, public_token);
    END;

    COMMIT TRAN;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;
END CATCH;