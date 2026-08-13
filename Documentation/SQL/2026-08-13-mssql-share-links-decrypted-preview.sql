/*
  Migration: 2026-08-13-mssql-share-links-decrypted-preview.sql
  Purpose:
    - Ensure dbo.share_links has allow_external_preview and
      allow_decrypted_external_preview flags required by external/decrypted embed flow.
  Safety:
    - Idempotent (safe to run multiple times).
    - Schema-qualified for environments where default schema is not dbo.
*/

SET NOCOUNT ON;

IF OBJECT_ID('dbo.share_links', 'U') IS NULL
BEGIN
  RAISERROR('Migration aborted: dbo.share_links does not exist in the current database.', 16, 1);
  RETURN;
END;

IF COL_LENGTH('dbo.share_links', 'allow_external_preview') IS NULL
BEGIN
  ALTER TABLE dbo.share_links
    ADD allow_external_preview BIT NOT NULL
      CONSTRAINT DF_share_links_allow_external_preview DEFAULT ((0)) WITH VALUES;
END;

IF COL_LENGTH('dbo.share_links', 'allow_decrypted_external_preview') IS NULL
BEGIN
  ALTER TABLE dbo.share_links
    ADD allow_decrypted_external_preview BIT NOT NULL
      CONSTRAINT DF_share_links_allow_decrypted_external_preview DEFAULT ((0)) WITH VALUES;
END;

-- Backfill + NOT NULL enforcement are executed through dynamic SQL so SQL Server
-- does not fail batch compilation when columns are created earlier in this script.
IF COL_LENGTH('dbo.share_links', 'allow_external_preview') IS NOT NULL
BEGIN
  EXEC sp_executesql N'
    UPDATE dbo.share_links
    SET allow_external_preview = 0
    WHERE allow_external_preview IS NULL;

    ALTER TABLE dbo.share_links
      ALTER COLUMN allow_external_preview BIT NOT NULL;
  ';
END;

IF COL_LENGTH('dbo.share_links', 'allow_decrypted_external_preview') IS NOT NULL
BEGIN
  EXEC sp_executesql N'
    UPDATE dbo.share_links
    SET allow_decrypted_external_preview = 0
    WHERE allow_decrypted_external_preview IS NULL;

    ALTER TABLE dbo.share_links
      ALTER COLUMN allow_decrypted_external_preview BIT NOT NULL;
  ';
END;

-- Ensure default constraints exist even if columns pre-existed without defaults.
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
    ADD CONSTRAINT DF_share_links_allow_external_preview
      DEFAULT ((0)) FOR allow_external_preview;
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.default_constraints dc
  INNER JOIN sys.columns c
    ON c.default_object_id = dc.object_id
  WHERE dc.parent_object_id = OBJECT_ID('dbo.share_links')
    AND c.name = 'allow_decrypted_external_preview'
)
BEGIN
  ALTER TABLE dbo.share_links
    ADD CONSTRAINT DF_share_links_allow_decrypted_external_preview
      DEFAULT ((0)) FOR allow_decrypted_external_preview;
END;

PRINT 'Migration complete: dbo.share_links external preview flags are ready.';
