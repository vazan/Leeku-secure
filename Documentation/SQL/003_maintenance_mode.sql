-- ============================================================
-- LeekuSecure Maintenance Mode Migration
-- Adds system configuration table for maintenance mode
-- ============================================================

USE [LeekuSecure]
GO

-- Create system_config table
CREATE TABLE [dbo].[system_config](
    [key] [nvarchar](100) NOT NULL,
    [value] [nvarchar](max) NOT NULL,
    [updated_at] [datetimeoffset](7) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT [PK_system_config] PRIMARY KEY CLUSTERED ([key] ASC)
) ON [PRIMARY]
GO

-- Initialize maintenance_mode config (disabled by default)
INSERT INTO [dbo].[system_config] ([key], [value], [updated_at])
VALUES (N'maintenance_mode', N'false', SYSDATETIMEOFFSET())
GO

-- Create stored procedure to get maintenance status
CREATE OR ALTER PROCEDURE [dbo].[sp_GetMaintenanceStatus]
AS
BEGIN
    SET NOCOUNT ON;
    
    DECLARE @value NVARCHAR(MAX);
    
    SELECT @value = [value]
    FROM [dbo].[system_config]
    WHERE [key] = N'maintenance_mode';
    
    SELECT CAST(ISNULL(@value, N'false') AS BIT) AS is_maintenance_enabled;
END
GO

-- Create stored procedure to toggle maintenance mode
CREATE OR ALTER PROCEDURE [dbo].[sp_ToggleMaintenanceMode]
    @enabled BIT
AS
BEGIN
    SET NOCOUNT ON;
    
    UPDATE [dbo].[system_config]
    SET [value] = CAST(@enabled AS NVARCHAR(MAX)),
        [updated_at] = SYSDATETIMEOFFSET()
    WHERE [key] = N'maintenance_mode';
    
    -- If no rows updated, insert
    IF @@ROWCOUNT = 0
    BEGIN
        INSERT INTO [dbo].[system_config] ([key], [value], [updated_at])
        VALUES (N'maintenance_mode', CAST(@enabled AS NVARCHAR(MAX)), SYSDATETIMEOFFSET());
    END
    
    SELECT CAST(@enabled AS BIT) AS is_maintenance_enabled;
END
GO
