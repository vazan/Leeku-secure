/*
  Migration MSSQL - alignement schema pour les changements de:
  - src/server.ts
  - src/app/features/files/pages/user-dashboard.tsx

  Objectif:
  - Garantir la contrainte de doublon dossier par scope parent.
  - Garantir les colonnes/contraintes/index requis par les routes files/folders/sharing.

  Script idempotent: peut etre relance sans effet de bord.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
    BEGIN TRAN;

    /* ---------------------------------------------------------
       1) file_folders: table + colonnes + FK + contrainte unique
       --------------------------------------------------------- */
    IF OBJECT_ID('dbo.file_folders', 'U') IS NULL
    BEGIN
        CREATE TABLE dbo.file_folders (
            id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_file_folders_id DEFAULT NEWSEQUENTIALID(),
            owner_user_id UNIQUEIDENTIFIER NOT NULL,
            parent_folder_id UNIQUEIDENTIFIER NULL,
            name NVARCHAR(120) NOT NULL,
            created_at DATETIMEOFFSET(7) NOT NULL CONSTRAINT DF_file_folders_created_at DEFAULT SYSDATETIMEOFFSET(),
            updated_at DATETIMEOFFSET(7) NOT NULL CONSTRAINT DF_file_folders_updated_at DEFAULT SYSDATETIMEOFFSET(),
            CONSTRAINT PK_file_folders PRIMARY KEY CLUSTERED (id ASC)
        );
    END;

    IF COL_LENGTH('dbo.file_folders', 'parent_folder_id') IS NULL
        ALTER TABLE dbo.file_folders ADD parent_folder_id UNIQUEIDENTIFIER NULL;

    IF NOT EXISTS (
        SELECT 1
        FROM sys.foreign_keys
        WHERE name = 'FK_file_folders_users'
          AND parent_object_id = OBJECT_ID('dbo.file_folders')
    )
    BEGIN
        ALTER TABLE dbo.file_folders WITH CHECK
        ADD CONSTRAINT FK_file_folders_users
            FOREIGN KEY (owner_user_id) REFERENCES dbo.users(id) ON DELETE CASCADE;
        ALTER TABLE dbo.file_folders CHECK CONSTRAINT FK_file_folders_users;
    END;

    IF NOT EXISTS (
        SELECT 1
        FROM sys.foreign_keys
        WHERE name = 'FK_file_folders_parent'
          AND parent_object_id = OBJECT_ID('dbo.file_folders')
    )
    BEGIN
        ALTER TABLE dbo.file_folders WITH CHECK
        ADD CONSTRAINT FK_file_folders_parent
            FOREIGN KEY (parent_folder_id) REFERENCES dbo.file_folders(id) ON DELETE NO ACTION;
        ALTER TABLE dbo.file_folders CHECK CONSTRAINT FK_file_folders_parent;
    END;

    /* Retire l'ancienne contrainte de scope global owner+name si presente */
    IF EXISTS (
        SELECT 1
        FROM sys.key_constraints
        WHERE [type] = 'UQ'
          AND name = 'UQ_file_folders_owner_name'
          AND parent_object_id = OBJECT_ID('dbo.file_folders')
    )
    BEGIN
        ALTER TABLE dbo.file_folders DROP CONSTRAINT UQ_file_folders_owner_name;
    END;

    /* Ajoute la nouvelle contrainte owner+parent+name si absente */
    IF NOT EXISTS (
        SELECT 1
        FROM sys.key_constraints
        WHERE [type] = 'UQ'
          AND name = 'UQ_file_folders_owner_parent_name'
          AND parent_object_id = OBJECT_ID('dbo.file_folders')
    )
    BEGIN
        /* Precheck: detecter d'eventuels doublons bloquants */
        IF EXISTS (
            SELECT 1
            FROM dbo.file_folders
            GROUP BY owner_user_id, parent_folder_id, name
            HAVING COUNT(*) > 1
        )
        BEGIN
            THROW 51000, 'Migration bloquee: doublons detectes dans file_folders(owner_user_id,parent_folder_id,name).', 1;
        END;

        ALTER TABLE dbo.file_folders
        ADD CONSTRAINT UQ_file_folders_owner_parent_name
            UNIQUE (owner_user_id, parent_folder_id, name);
    END;

    /* Index de recherche des dossiers */
    IF EXISTS (
        SELECT 1
        FROM sys.indexes
        WHERE name = 'IX_file_folders_owner'
          AND object_id = OBJECT_ID('dbo.file_folders')
    )
    BEGIN
        DROP INDEX IX_file_folders_owner ON dbo.file_folders;
    END;

    IF NOT EXISTS (
        SELECT 1
        FROM sys.indexes
        WHERE name = 'IX_file_folders_owner_parent'
          AND object_id = OBJECT_ID('dbo.file_folders')
    )
    BEGIN
        CREATE NONCLUSTERED INDEX IX_file_folders_owner_parent
        ON dbo.file_folders (owner_user_id ASC, parent_folder_id ASC, name ASC);
    END;

    /* ---------------------------------------------------------
       2) files: colonnes optionnelles + folder_id + FK + index
       --------------------------------------------------------- */
    IF COL_LENGTH('dbo.files', 'client_secret_hash') IS NULL
        ALTER TABLE dbo.files ADD client_secret_hash NVARCHAR(512) NULL;

    IF COL_LENGTH('dbo.files', 'client_crypto_salt') IS NULL
        ALTER TABLE dbo.files ADD client_crypto_salt VARBINARY(32) NULL;

    IF COL_LENGTH('dbo.files', 'client_crypto_iv') IS NULL
        ALTER TABLE dbo.files ADD client_crypto_iv VARBINARY(16) NULL;

    IF COL_LENGTH('dbo.files', 'client_crypto_iterations') IS NULL
        ALTER TABLE dbo.files ADD client_crypto_iterations INT NULL;

    IF COL_LENGTH('dbo.files', 'folder_id') IS NULL
        ALTER TABLE dbo.files ADD folder_id UNIQUEIDENTIFIER NULL;

    IF NOT EXISTS (
        SELECT 1
        FROM sys.foreign_keys
        WHERE name = 'FK_files_file_folders'
          AND parent_object_id = OBJECT_ID('dbo.files')
    )
    BEGIN
        ALTER TABLE dbo.files WITH CHECK
        ADD CONSTRAINT FK_files_file_folders
            FOREIGN KEY (folder_id) REFERENCES dbo.file_folders(id) ON DELETE NO ACTION;
        ALTER TABLE dbo.files CHECK CONSTRAINT FK_files_file_folders;
    END;

    IF NOT EXISTS (
        SELECT 1
        FROM sys.indexes
        WHERE name = 'IX_files_folder_id'
          AND object_id = OBJECT_ID('dbo.files')
    )
    BEGIN
        CREATE NONCLUSTERED INDEX IX_files_folder_id
        ON dbo.files (folder_id ASC, owner_user_id ASC)
        INCLUDE (status, created_at);
    END;

    /* ---------------------------------------------------------
       3) share_links: allow_external_preview
       --------------------------------------------------------- */
    IF COL_LENGTH('dbo.share_links', 'allow_external_preview') IS NULL
    BEGIN
        ALTER TABLE dbo.share_links
            ADD allow_external_preview BIT NOT NULL
                CONSTRAINT DF_share_links_allow_external_preview DEFAULT ((0)) WITH VALUES;
    END
    ELSE
    BEGIN
        IF EXISTS (
            SELECT 1
            FROM sys.columns
            WHERE object_id = OBJECT_ID('dbo.share_links')
              AND name = 'allow_external_preview'
              AND is_nullable = 1
        )
        BEGIN
            UPDATE dbo.share_links
            SET allow_external_preview = 0
            WHERE allow_external_preview IS NULL;

            ALTER TABLE dbo.share_links
            ALTER COLUMN allow_external_preview BIT NOT NULL;
        END;

        IF NOT EXISTS (
            SELECT 1
            FROM sys.default_constraints dc
            INNER JOIN sys.columns c
                ON c.default_object_id = dc.object_id
            WHERE dc.parent_object_id = OBJECT_ID('dbo.share_links')
              AND c.name = 'allow_external_preview'
        )
        BEGIN
            ALTER TABLE dbo.share_links
            ADD CONSTRAINT DF_share_links_allow_external_preview DEFAULT ((0)) FOR allow_external_preview;
        END;
    END;

    COMMIT TRAN;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0
        ROLLBACK TRAN;

    DECLARE @ErrMsg NVARCHAR(4000) = ERROR_MESSAGE();
    DECLARE @ErrNum INT = ERROR_NUMBER();
    DECLARE @ErrState INT = ERROR_STATE();

    RAISERROR('[MIGRATION FAILED] %s', 16, 1, @ErrMsg);
END CATCH;
