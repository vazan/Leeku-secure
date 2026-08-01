-- ============================================================
-- LeekuSecure Database Creation & Configuration Script
-- SQL Server 2022 (Compatibility Level 160)
-- ============================================================
-- This is the production-ready schema from SSMS export.
-- Includes optimized indexes, stored procedures, and constraints.
--
-- IMPORTANT: Adjust file paths (P:\DATA, L:\LOGS) for your environment.
-- 
-- Execution:
--   sqlcmd -S <server> -U sa -P <password> -i production_schema.sql
--   or in SSMS: File > Open > Execute
--
-- Existing environments:
--   Run 2026-07-25-mssql-folder-and-share-migration.sql after this script (or standalone)
--   to enforce latest folder/share schema alignment idempotently.
--
-- ============================================================

USE [master]
GO

-- ============================================================
-- Create Database
-- ============================================================
-- NOTE: Adjust file paths per your storage environment:
--   P:\DATA  = Primary data file location
--   L:\LOGS  = Transaction log location
-- ============================================================

CREATE DATABASE [LeekuSecure]
 CONTAINMENT = NONE
 ON  PRIMARY 
( NAME = N'LeekuSecure', FILENAME = N'P:\DATA\LeekuSecure.mdf' , SIZE = 73728KB , MAXSIZE = UNLIMITED, FILEGROWTH = 65536KB )
 LOG ON 
( NAME = N'LeekuSecure_log', FILENAME = N'L:\LOGS\LeekuSecure_log.ldf' , SIZE = 73728KB , MAXSIZE = 2048GB , FILEGROWTH = 65536KB )
 WITH CATALOG_COLLATION = DATABASE_DEFAULT, LEDGER = OFF
GO

-- ============================================================
-- Database Configuration
-- ============================================================

ALTER DATABASE [LeekuSecure] SET COMPATIBILITY_LEVEL = 160
GO

-- Enable full-text search capability
IF (1 = FULLTEXTSERVICEPROPERTY('IsFullTextInstalled'))
begin
    EXEC [LeekuSecure].[dbo].[sp_fulltext_database] @action = 'enable'
end
GO

-- ANSI Compliance
ALTER DATABASE [LeekuSecure] SET ANSI_NULL_DEFAULT OFF 
GO
ALTER DATABASE [LeekuSecure] SET ANSI_NULLS OFF 
GO
ALTER DATABASE [LeekuSecure] SET ANSI_PADDING OFF 
GO
ALTER DATABASE [LeekuSecure] SET ANSI_WARNINGS OFF 
GO
ALTER DATABASE [LeekuSecure] SET ARITHABORT OFF 
GO

-- Maintenance & Cleanup
ALTER DATABASE [LeekuSecure] SET AUTO_CLOSE OFF 
GO
ALTER DATABASE [LeekuSecure] SET AUTO_SHRINK OFF 
GO
ALTER DATABASE [LeekuSecure] SET AUTO_UPDATE_STATISTICS ON 
GO
ALTER DATABASE [LeekuSecure] SET AUTO_UPDATE_STATISTICS_ASYNC OFF 
GO

-- Concurrency & Transactions
ALTER DATABASE [LeekuSecure] SET CURSOR_CLOSE_ON_COMMIT OFF 
GO
ALTER DATABASE [LeekuSecure] SET CURSOR_DEFAULT  GLOBAL 
GO
ALTER DATABASE [LeekuSecure] SET CONCAT_NULL_YIELDS_NULL OFF 
GO
ALTER DATABASE [LeekuSecure] SET NUMERIC_ROUNDABORT OFF 
GO
ALTER DATABASE [LeekuSecure] SET QUOTED_IDENTIFIER OFF 
GO
ALTER DATABASE [LeekuSecure] SET RECURSIVE_TRIGGERS OFF 
GO

-- Service Broker (for async messaging)
ALTER DATABASE [LeekuSecure] SET  ENABLE_BROKER 
GO

-- Isolation Level & Snapshots
ALTER DATABASE [LeekuSecure] SET DATE_CORRELATION_OPTIMIZATION OFF 
GO
ALTER DATABASE [LeekuSecure] SET TRUSTWORTHY OFF 
GO
ALTER DATABASE [LeekuSecure] SET ALLOW_SNAPSHOT_ISOLATION OFF 
GO
ALTER DATABASE [LeekuSecure] SET PARAMETERIZATION SIMPLE 
GO
ALTER DATABASE [LeekuSecure] SET READ_COMMITTED_SNAPSHOT ON 
GO
ALTER DATABASE [LeekuSecure] SET HONOR_BROKER_PRIORITY OFF 
GO

-- Recovery & Backup Strategy
ALTER DATABASE [LeekuSecure] SET RECOVERY FULL 
GO
ALTER DATABASE [LeekuSecure] SET  MULTI_USER 
GO
ALTER DATABASE [LeekuSecure] SET PAGE_VERIFY CHECKSUM  
GO
ALTER DATABASE [LeekuSecure] SET DB_CHAINING OFF 
GO

-- Advanced Options
ALTER DATABASE [LeekuSecure] SET FILESTREAM( NON_TRANSACTED_ACCESS = OFF ) 
GO
ALTER DATABASE [LeekuSecure] SET TARGET_RECOVERY_TIME = 60 SECONDS 
GO
ALTER DATABASE [LeekuSecure] SET DELAYED_DURABILITY = DISABLED 
GO
ALTER DATABASE [LeekuSecure] SET ACCELERATED_DATABASE_RECOVERY = OFF  
GO

-- Query Store (for query performance insights)
ALTER DATABASE [LeekuSecure] SET QUERY_STORE = ON
GO
ALTER DATABASE [LeekuSecure] SET QUERY_STORE (
    OPERATION_MODE = READ_WRITE, 
    CLEANUP_POLICY = (STALE_QUERY_THRESHOLD_DAYS = 30), 
    DATA_FLUSH_INTERVAL_SECONDS = 900, 
    INTERVAL_LENGTH_MINUTES = 60, 
    MAX_STORAGE_SIZE_MB = 1000, 
    QUERY_CAPTURE_MODE = AUTO, 
    SIZE_BASED_CLEANUP_MODE = AUTO, 
    MAX_PLANS_PER_QUERY = 200, 
    WAIT_STATS_CAPTURE_MODE = ON
)
GO

-- ============================================================
-- Switch to Database & Create Security Context
-- ============================================================

USE [LeekuSecure]
GO

-- Create application user (assumes login already exists)
-- If login doesn't exist, create it first in master:
-- CREATE LOGIN [leeku_app] WITH PASSWORD = N'<secure_password>'
CREATE USER [leeku_app] FOR LOGIN [leeku_app] WITH DEFAULT_SCHEMA=[dbo]
GO

-- Grant minimal necessary permissions
ALTER ROLE [db_datareader] ADD MEMBER [leeku_app]
GO
ALTER ROLE [db_datawriter] ADD MEMBER [leeku_app]
GO

-- ============================================================
-- Custom Types
-- ============================================================

-- Table-Valued Parameter type for batch operations (used in sp_MarkFilesExpired)
CREATE TYPE [dbo].[GuidList] AS TABLE(
    [id] [uniqueidentifier] NOT NULL
)
GO

-- ============================================================
-- Create Tables (in dependency order)
-- ============================================================

-- Step 1: quotas (no dependencies)
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[quotas](
    [id] [nvarchar](50) NOT NULL,
    [name] [nvarchar](100) NOT NULL,
    [storage_limit_bytes] [bigint] NOT NULL,
    [max_file_size_bytes] [bigint] NOT NULL,
    [max_files] [int] NOT NULL,
    [daily_upload_limit_bytes] [bigint] NOT NULL,
    [created_at] [datetimeoffset](7) NOT NULL,
    CONSTRAINT [PK_quotas] PRIMARY KEY CLUSTERED ([id] ASC)
) ON [PRIMARY]
GO

-- Step 2: users (depends on quotas)
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[users](
    [id] [uniqueidentifier] NOT NULL,
    [email_encrypted] [varbinary](512) NOT NULL,
    [email_iv] [varbinary](16) NOT NULL,
    [email_auth_tag] [varbinary](16) NOT NULL,
    [email_hash] [char](64) NOT NULL,
    [username_encrypted] [varbinary](512) NOT NULL,
    [username_iv] [varbinary](16) NOT NULL,
    [username_auth_tag] [varbinary](16) NOT NULL,
    [username_hash] [char](64) NOT NULL,
    [password_hash] [nvarchar](512) NOT NULL,
    [role] [nvarchar](10) NOT NULL,
    [quota_id] [nvarchar](50) NOT NULL,
    [storage_used_bytes] [bigint] NOT NULL,
    [status] [nvarchar](20) NOT NULL,
    [created_at] [datetimeoffset](7) NOT NULL,
    [last_login_at] [datetimeoffset](7) NULL,
    [failed_login_count] [int] NOT NULL,
    [locked_until] [datetimeoffset](7) NULL,
    [email_verified] [bit] NOT NULL,
    [email_verification_token] [char](64) NULL,
    [email_verification_expires] [datetimeoffset](7) NULL,
    [deletion_token] [char](64) NULL,
    [deletion_token_expires] [datetimeoffset](7) NULL,
    CONSTRAINT [PK_users] PRIMARY KEY CLUSTERED ([id] ASC),
    CONSTRAINT [UQ_users_email_hash] UNIQUE NONCLUSTERED ([email_hash] ASC),
    CONSTRAINT [UQ_users_uname_hash] UNIQUE NONCLUSTERED ([username_hash] ASC)
) ON [PRIMARY]
GO

-- Step 3: file_folders (depends on users)
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[file_folders](
    [id] [uniqueidentifier] NOT NULL,
    [owner_user_id] [uniqueidentifier] NOT NULL,
    [parent_folder_id] [uniqueidentifier] NULL,
    [name] [nvarchar](120) NOT NULL,
    [created_at] [datetimeoffset](7) NOT NULL,
    [updated_at] [datetimeoffset](7) NOT NULL,
    CONSTRAINT [PK_file_folders] PRIMARY KEY CLUSTERED ([id] ASC),
    CONSTRAINT [UQ_file_folders_owner_parent_name] UNIQUE NONCLUSTERED ([owner_user_id] ASC, [parent_folder_id] ASC, [name] ASC)
) ON [PRIMARY]
GO

-- Step 4: files (depends on users and file_folders)
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[files](
    [id] [uniqueidentifier] NOT NULL,
    [owner_user_id] [uniqueidentifier] NOT NULL,
    [folder_id] [uniqueidentifier] NULL,
    [original_name_encrypted] [varbinary](2048) NOT NULL,
    [original_name_iv] [varbinary](16) NOT NULL,
    [original_name_auth_tag] [varbinary](16) NOT NULL,
    [stored_path] [nvarchar](1000) NOT NULL,
    [mime_type] [nvarchar](255) NOT NULL,
    [size_bytes] [bigint] NOT NULL,
    [encrypted_size_bytes] [bigint] NOT NULL,
    [status] [nvarchar](20) NOT NULL,
    [checksum_sha256] [char](64) NOT NULL,
    [scan_result] [nvarchar](20) NULL,
    [scan_message] [nvarchar](max) NULL,
    [scanned_at] [datetimeoffset](7) NULL,
    [is_encrypted] [bit] NOT NULL,
    [leeku_vibe] [nvarchar](500) NULL,
    [ttl_hours] [int] NULL,
    [expires_at] [datetimeoffset](7) NULL,
    [created_at] [datetimeoffset](7) NOT NULL,
    [deleted_at] [datetimeoffset](7) NULL,
    [client_secret_hash] [nvarchar](512) NULL,
    [client_crypto_salt] [varbinary](32) NULL,
    [client_crypto_iv] [varbinary](16) NULL,
    [client_crypto_iterations] [int] NULL,
    CONSTRAINT [PK_files] PRIMARY KEY CLUSTERED ([id] ASC)
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO

-- Step 5: file_encryption_keys (depends on files)
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[file_encryption_keys](
    [file_id] [uniqueidentifier] NOT NULL,
    [encrypted_key] [varbinary](64) NOT NULL,
    [key_iv] [varbinary](16) NOT NULL,
    [key_auth_tag] [varbinary](16) NOT NULL,
    [file_iv] [varbinary](16) NOT NULL,
    [file_auth_tag] [varbinary](16) NOT NULL,
    [algorithm] [nvarchar](20) NOT NULL,
    [created_at] [datetimeoffset](7) NOT NULL,
    CONSTRAINT [PK_file_keys] PRIMARY KEY CLUSTERED ([file_id] ASC)
) ON [PRIMARY]
GO

-- Step 6: share_links (depends on files)
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[share_links](
    [id] [uniqueidentifier] NOT NULL,
    [file_id] [uniqueidentifier] NOT NULL,
    [public_token] [char](32) NOT NULL,
    [password_hash] [nvarchar](256) NULL,
    [expires_at] [datetimeoffset](7) NULL,
    [max_downloads] [int] NULL,
    [download_count] [int] NOT NULL,
    [is_active] [bit] NOT NULL,
    [created_at] [datetimeoffset](7) NOT NULL,
    [allow_external_preview] [bit] NOT NULL,
    CONSTRAINT [PK_share_links] PRIMARY KEY CLUSTERED ([id] ASC),
    CONSTRAINT [UQ_share_links_token] UNIQUE NONCLUSTERED ([public_token] ASC)
) ON [PRIMARY]
GO

-- Step 6b: folder_share_links (depends on file_folders)
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[folder_share_links](
    [id] [uniqueidentifier] NOT NULL,
    [folder_id] [uniqueidentifier] NOT NULL,
    [public_token] [char](32) NOT NULL,
    [password_hash] [nvarchar](256) NULL,
    [expires_at] [datetimeoffset](7) NULL,
    [is_active] [bit] NOT NULL,
    [created_at] [datetimeoffset](7) NOT NULL,
    CONSTRAINT [PK_folder_share_links] PRIMARY KEY CLUSTERED ([id] ASC),
    CONSTRAINT [UQ_folder_share_links_folder] UNIQUE NONCLUSTERED ([folder_id] ASC),
    CONSTRAINT [UQ_folder_share_links_token] UNIQUE NONCLUSTERED ([public_token] ASC)
) ON [PRIMARY]
GO
CREATE NONCLUSTERED INDEX [IX_folder_share_links_active_expiry]
ON [dbo].[folder_share_links] ([is_active] ASC, [expires_at] ASC)
INCLUDE ([folder_id], [public_token])
GO

-- Step 7: refresh_tokens (depends on users)
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[refresh_tokens](
    [id] [uniqueidentifier] NOT NULL,
    [user_id] [uniqueidentifier] NOT NULL,
    [token_hash] [char](64) NOT NULL,
    [expires_at] [datetimeoffset](7) NOT NULL,
    [created_at] [datetimeoffset](7) NOT NULL,
    [revoked_at] [datetimeoffset](7) NULL,
    [ip_address] [nvarchar](45) NOT NULL,
    [user_agent] [nvarchar](500) NULL,
    CONSTRAINT [PK_refresh_tokens] PRIMARY KEY CLUSTERED ([id] ASC),
    CONSTRAINT [UQ_refresh_tokens_hash] UNIQUE NONCLUSTERED ([token_hash] ASC)
) ON [PRIMARY]
GO

-- Step 8: system_logs (no hard dependencies)
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[system_logs](
    [id] [bigint] IDENTITY(1,1) NOT NULL,
    [user_id] [uniqueidentifier] NULL,
    [username_snapshot] [nvarchar](200) NULL,
    [event_type] [nvarchar](20) NOT NULL,
    [target_type] [nvarchar](50) NOT NULL,
    [target_id] [nvarchar](100) NOT NULL,
    [ip_address] [nvarchar](45) NOT NULL,
    [message] [nvarchar](max) NOT NULL,
    [created_at] [datetimeoffset](7) NOT NULL,
    CONSTRAINT [PK_system_logs] PRIMARY KEY CLUSTERED ([id] ASC)
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO

-- Step 9: system_config (no hard dependencies - for maintenance mode & system settings)
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[system_config](
    [key] [nvarchar](100) NOT NULL,
    [value] [nvarchar](max) NOT NULL,
    [updated_at] [datetimeoffset](7) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT [PK_system_config] PRIMARY KEY CLUSTERED ([key] ASC)
) ON [PRIMARY]
GO

-- ============================================================
-- Create Indexes (optimized for common query patterns)
-- ============================================================

-- Files indexes
CREATE NONCLUSTERED INDEX [IX_file_folders_owner_parent] ON [dbo].[file_folders]
([owner_user_id] ASC, [parent_folder_id] ASC, [name] ASC)
WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, 
    DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, 
    OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO

CREATE NONCLUSTERED INDEX [IX_files_owner_id] ON [dbo].[files]
([owner_user_id] ASC)
INCLUDE([status],[created_at])
WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, 
      DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, 
      OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO

CREATE NONCLUSTERED INDEX [IX_files_status] ON [dbo].[files]
([status] ASC)
INCLUDE([owner_user_id])
WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, 
      DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, 
      OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO

CREATE NONCLUSTERED INDEX [IX_files_expires_at] ON [dbo].[files]
([expires_at] ASC)
WHERE ([expires_at] IS NOT NULL AND [status]='Available')
WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, 
      DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, 
      OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO

CREATE NONCLUSTERED INDEX [IX_files_folder_id] ON [dbo].[files]
([folder_id] ASC, [owner_user_id] ASC)
INCLUDE([status],[created_at])
WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, 
    DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, 
    OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO

-- Users indexes
SET ANSI_PADDING ON
GO
CREATE NONCLUSTERED INDEX [IX_users_email_hash] ON [dbo].[users]
([email_hash] ASC)
WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, 
      DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, 
      OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO

CREATE NONCLUSTERED INDEX [IX_users_username_hash] ON [dbo].[users]
([username_hash] ASC)
WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, 
      DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, 
      OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO

CREATE NONCLUSTERED INDEX [IX_users_status] ON [dbo].[users]
([status] ASC)
WHERE ([status]='Active')
WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, 
      DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, 
      OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO

CREATE NONCLUSTERED INDEX [IX_users_email_verification_token] ON [dbo].[users]
([email_verification_token] ASC)
WHERE ([email_verification_token] IS NOT NULL)
WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, 
      DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, 
      OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO

CREATE NONCLUSTERED INDEX [IX_users_deletion_token] ON [dbo].[users]
([deletion_token] ASC)
WHERE ([deletion_token] IS NOT NULL)
WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, 
      DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, 
      OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO

-- Refresh tokens indexes
CREATE NONCLUSTERED INDEX [IX_refresh_tokens_user_active] ON [dbo].[refresh_tokens]
([user_id] ASC, [expires_at] ASC)
WHERE ([revoked_at] IS NULL)
WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, 
      DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, 
      OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO

-- Share links indexes
CREATE NONCLUSTERED INDEX [IX_share_links_file_id] ON [dbo].[share_links]
([file_id] ASC)
INCLUDE([is_active],[public_token])
WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, 
      DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, 
      OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO

-- System logs indexes
CREATE NONCLUSTERED INDEX [IX_system_logs_created_at] ON [dbo].[system_logs]
([created_at] DESC)
WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, 
      DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, 
      OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO

SET ANSI_PADDING ON
GO
CREATE NONCLUSTERED INDEX [IX_system_logs_event_type] ON [dbo].[system_logs]
([event_type] ASC, [created_at] DESC)
WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, 
      DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, 
      OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO

CREATE NONCLUSTERED INDEX [IX_system_logs_user_id] ON [dbo].[system_logs]
([user_id] ASC)
WHERE ([user_id] IS NOT NULL)
WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, 
      DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, 
      OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO

-- ============================================================
-- Set Default Values for Columns
-- ============================================================

-- Users defaults
ALTER TABLE [dbo].[users] ADD DEFAULT (newsequentialid()) FOR [id]
GO
ALTER TABLE [dbo].[users] ADD DEFAULT ('User') FOR [role]
GO
ALTER TABLE [dbo].[users] ADD DEFAULT ('guest') FOR [quota_id]
GO
ALTER TABLE [dbo].[users] ADD DEFAULT ((0)) FOR [storage_used_bytes]
GO
ALTER TABLE [dbo].[users] ADD DEFAULT ('Active') FOR [status]
GO
ALTER TABLE [dbo].[users] ADD DEFAULT (sysdatetimeoffset()) FOR [created_at]
GO
ALTER TABLE [dbo].[users] ADD DEFAULT ((0)) FOR [failed_login_count]
GO
ALTER TABLE [dbo].[users] ADD DEFAULT ((0)) FOR [email_verified]
GO

-- Files defaults
ALTER TABLE [dbo].[files] ADD DEFAULT (newsequentialid()) FOR [id]
GO

-- File folders defaults
ALTER TABLE [dbo].[file_folders] ADD DEFAULT (newsequentialid()) FOR [id]
GO
ALTER TABLE [dbo].[file_folders] ADD DEFAULT (sysdatetimeoffset()) FOR [created_at]
GO
ALTER TABLE [dbo].[file_folders] ADD DEFAULT (sysdatetimeoffset()) FOR [updated_at]
GO

ALTER TABLE [dbo].[files] ADD DEFAULT ('Available') FOR [status]
GO
ALTER TABLE [dbo].[files] ADD DEFAULT ((1)) FOR [is_encrypted]
GO
ALTER TABLE [dbo].[files] ADD DEFAULT (sysdatetimeoffset()) FOR [created_at]
GO

-- File encryption keys defaults
ALTER TABLE [dbo].[file_encryption_keys] ADD DEFAULT ('AES-256-GCM') FOR [algorithm]
GO
ALTER TABLE [dbo].[file_encryption_keys] ADD DEFAULT (sysdatetimeoffset()) FOR [created_at]
GO

-- Share links defaults
ALTER TABLE [dbo].[share_links] ADD DEFAULT (newsequentialid()) FOR [id]
GO
ALTER TABLE [dbo].[share_links] ADD DEFAULT ((0)) FOR [download_count]
GO
ALTER TABLE [dbo].[share_links] ADD DEFAULT ((1)) FOR [is_active]
GO
ALTER TABLE [dbo].[share_links] ADD DEFAULT (sysdatetimeoffset()) FOR [created_at]
GO
ALTER TABLE [dbo].[share_links] ADD CONSTRAINT [DF_share_links_allow_external_preview] DEFAULT ((0)) FOR [allow_external_preview]
GO

-- Folder share links defaults
ALTER TABLE [dbo].[folder_share_links] ADD CONSTRAINT [DF_folder_share_links_id] DEFAULT (newsequentialid()) FOR [id]
GO
ALTER TABLE [dbo].[folder_share_links] ADD CONSTRAINT [DF_folder_share_links_is_active] DEFAULT ((1)) FOR [is_active]
GO
ALTER TABLE [dbo].[folder_share_links] ADD CONSTRAINT [DF_folder_share_links_created_at] DEFAULT (sysdatetimeoffset()) FOR [created_at]
GO

-- Refresh tokens defaults
ALTER TABLE [dbo].[refresh_tokens] ADD DEFAULT (newsequentialid()) FOR [id]
GO
ALTER TABLE [dbo].[refresh_tokens] ADD DEFAULT (sysdatetimeoffset()) FOR [created_at]
GO

-- System logs defaults
ALTER TABLE [dbo].[system_logs] ADD DEFAULT (sysdatetimeoffset()) FOR [created_at]
GO

-- Quotas defaults
ALTER TABLE [dbo].[quotas] ADD DEFAULT (sysdatetimeoffset()) FOR [created_at]
GO

-- System config defaults
ALTER TABLE [dbo].[system_config] ADD DEFAULT (sysdatetimeoffset()) FOR [updated_at]
GO

-- ============================================================
-- Create Foreign Key Constraints
-- ============================================================

ALTER TABLE [dbo].[file_encryption_keys] WITH CHECK ADD CONSTRAINT [FK_file_keys_files] 
FOREIGN KEY([file_id])
REFERENCES [dbo].[files] ([id])
ON DELETE CASCADE
GO
ALTER TABLE [dbo].[file_encryption_keys] CHECK CONSTRAINT [FK_file_keys_files]
GO

ALTER TABLE [dbo].[file_folders] WITH CHECK ADD CONSTRAINT [FK_file_folders_users]
FOREIGN KEY([owner_user_id])
REFERENCES [dbo].[users] ([id])
ON DELETE CASCADE
GO
ALTER TABLE [dbo].[file_folders] CHECK CONSTRAINT [FK_file_folders_users]
GO

ALTER TABLE [dbo].[file_folders] WITH CHECK ADD CONSTRAINT [FK_file_folders_parent]
FOREIGN KEY([parent_folder_id])
REFERENCES [dbo].[file_folders] ([id])
ON DELETE NO ACTION
GO
ALTER TABLE [dbo].[file_folders] CHECK CONSTRAINT [FK_file_folders_parent]
GO

ALTER TABLE [dbo].[files] WITH CHECK ADD CONSTRAINT [FK_files_users] 
FOREIGN KEY([owner_user_id])
REFERENCES [dbo].[users] ([id])
ON DELETE CASCADE
GO
ALTER TABLE [dbo].[files] CHECK CONSTRAINT [FK_files_users]
GO

ALTER TABLE [dbo].[files] WITH CHECK ADD CONSTRAINT [FK_files_file_folders]
FOREIGN KEY([folder_id])
REFERENCES [dbo].[file_folders] ([id])
ON DELETE NO ACTION
GO
ALTER TABLE [dbo].[files] CHECK CONSTRAINT [FK_files_file_folders]
GO

ALTER TABLE [dbo].[refresh_tokens] WITH CHECK ADD CONSTRAINT [FK_refresh_tokens_users] 
FOREIGN KEY([user_id])
REFERENCES [dbo].[users] ([id])
ON DELETE CASCADE
GO
ALTER TABLE [dbo].[refresh_tokens] CHECK CONSTRAINT [FK_refresh_tokens_users]
GO

ALTER TABLE [dbo].[share_links] WITH CHECK ADD CONSTRAINT [FK_share_links_files] 
FOREIGN KEY([file_id])
REFERENCES [dbo].[files] ([id])
ON DELETE CASCADE
GO
ALTER TABLE [dbo].[share_links] CHECK CONSTRAINT [FK_share_links_files]
GO

ALTER TABLE [dbo].[folder_share_links] WITH CHECK ADD CONSTRAINT [FK_folder_share_links_folders]
FOREIGN KEY([folder_id])
REFERENCES [dbo].[file_folders] ([id])
ON DELETE CASCADE
GO
ALTER TABLE [dbo].[folder_share_links] CHECK CONSTRAINT [FK_folder_share_links_folders]
GO

ALTER TABLE [dbo].[users] WITH CHECK ADD CONSTRAINT [FK_users_quotas] 
FOREIGN KEY([quota_id])
REFERENCES [dbo].[quotas] ([id])
GO
ALTER TABLE [dbo].[users] CHECK CONSTRAINT [FK_users_quotas]
GO

-- ============================================================
-- Create Check Constraints (Data Validation)
-- ============================================================

-- User constraints
ALTER TABLE [dbo].[users] WITH CHECK ADD CONSTRAINT [CK_users_role] 
CHECK ([role]='Admin' OR [role]='User')
GO
ALTER TABLE [dbo].[users] CHECK CONSTRAINT [CK_users_role]
GO

ALTER TABLE [dbo].[users] WITH CHECK ADD CONSTRAINT [CK_users_status] 
CHECK ([status]='Suspended' OR [status]='Active')
GO
ALTER TABLE [dbo].[users] CHECK CONSTRAINT [CK_users_status]
GO

ALTER TABLE [dbo].[users] WITH CHECK ADD CONSTRAINT [CK_users_storage] 
CHECK ([storage_used_bytes] >= (0))
GO
ALTER TABLE [dbo].[users] CHECK CONSTRAINT [CK_users_storage]
GO

-- File constraints
ALTER TABLE [dbo].[files] WITH CHECK ADD CONSTRAINT [CK_files_status] 
CHECK ([status]='Expired' OR [status]='Blocked' OR [status]='Available')
GO
ALTER TABLE [dbo].[files] CHECK CONSTRAINT [CK_files_status]
GO

ALTER TABLE [dbo].[files] WITH CHECK ADD CONSTRAINT [CK_files_size] 
CHECK ([size_bytes] > (0))
GO
ALTER TABLE [dbo].[files] CHECK CONSTRAINT [CK_files_size]
GO

ALTER TABLE [dbo].[files] WITH CHECK ADD CONSTRAINT [CK_files_scan] 
CHECK (
    [scan_result] IS NULL OR 
    [scan_result]='Timeout' OR 
    [scan_result]='Error' OR 
    [scan_result]='Suspicious' OR 
    [scan_result]='Infected' OR 
    [scan_result]='Clean'
)
GO
ALTER TABLE [dbo].[files] CHECK CONSTRAINT [CK_files_scan]
GO

ALTER TABLE [dbo].[files] WITH CHECK ADD CONSTRAINT [CK_files_ttl] 
CHECK (
    [ttl_hours] IS NULL OR 
    [ttl_hours] = 168 OR 
    [ttl_hours] = 120 OR 
    [ttl_hours] = 48 OR 
    [ttl_hours] = 24 OR 
    [ttl_hours] = 4 OR 
    [ttl_hours] = 1
)
GO
ALTER TABLE [dbo].[files] CHECK CONSTRAINT [CK_files_ttl]
GO

-- Quota constraints
ALTER TABLE [dbo].[quotas] WITH CHECK ADD CONSTRAINT [CK_quotas_storage] 
CHECK ([storage_limit_bytes] > (0))
GO
ALTER TABLE [dbo].[quotas] CHECK CONSTRAINT [CK_quotas_storage]
GO

ALTER TABLE [dbo].[quotas] WITH CHECK ADD CONSTRAINT [CK_quotas_filesize] 
CHECK ([max_file_size_bytes] > (0))
GO
ALTER TABLE [dbo].[quotas] CHECK CONSTRAINT [CK_quotas_filesize]
GO

ALTER TABLE [dbo].[quotas] WITH CHECK ADD CONSTRAINT [CK_quotas_maxfiles] 
CHECK ([max_files] > (0))
GO
ALTER TABLE [dbo].[quotas] CHECK CONSTRAINT [CK_quotas_maxfiles]
GO

-- Share link constraints
ALTER TABLE [dbo].[share_links] WITH CHECK ADD CONSTRAINT [CK_share_links_dl] 
CHECK ([max_downloads] IS NULL OR [max_downloads] > (0))
GO
ALTER TABLE [dbo].[share_links] CHECK CONSTRAINT [CK_share_links_dl]
GO

-- System logs constraints
ALTER TABLE [dbo].[system_logs] WITH CHECK ADD CONSTRAINT [CK_logs_event_type] 
CHECK (
    [event_type]='Auth' OR 
    [event_type]='Security' OR 
    [event_type]='Admin' OR 
    [event_type]='Link' OR 
    [event_type]='Download' OR 
    [event_type]='Delete' OR 
    [event_type]='Scan' OR 
    [event_type]='Upload'
)
GO
ALTER TABLE [dbo].[system_logs] CHECK CONSTRAINT [CK_logs_event_type]
GO

-- ============================================================
-- Create Stored Procedures (for optimized operations)
-- ============================================================

SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- Procedure: sp_GetExpiredFiles
-- Returns all files whose TTL has elapsed and are still available.
-- Called by Node.js expiry cleanup job to retrieve vault file paths.
CREATE PROCEDURE [dbo].[sp_GetExpiredFiles]
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

-- Procedure: sp_IncrementDownloadCount
-- Atomically increments the download_count for a share link.
-- Called immediately before serving a file download.
CREATE PROCEDURE [dbo].[sp_IncrementDownloadCount]
    @PublicToken CHAR(32)
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE share_links
    SET download_count = download_count + 1
    WHERE public_token = @PublicToken;
END;
GO

-- Procedure: sp_MarkFilesExpired
-- Marks vault files as 'Expired' after physical deletion.
-- Uses table-valued parameter to avoid SQL injection.
CREATE PROCEDURE [dbo].[sp_MarkFilesExpired]
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

-- Procedure: sp_RecordFailedLogin
-- Increments failed_login_count and locks account if threshold reached.
CREATE PROCEDURE [dbo].[sp_RecordFailedLogin]
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

-- Procedure: sp_ResetLoginAttempts
-- Resets brute-force counters on successful login.
-- Also updates last_login_at for audit.
CREATE PROCEDURE [dbo].[sp_ResetLoginAttempts]
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

-- Procedure: sp_GetMaintenanceStatus
-- Retrieves the current maintenance mode status.
-- Returns 1 (true) if maintenance is enabled, 0 (false) otherwise.
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

-- Procedure: sp_ToggleMaintenanceMode
-- Updates the maintenance mode status.
-- Called by admin endpoints to enable/disable maintenance mode.
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

-- ============================================================
-- Seed Initial Data
-- ============================================================

-- Insert default quota tier (required for registration)
IF NOT EXISTS (SELECT 1 FROM quotas WHERE id = 'guest')
BEGIN
    INSERT INTO quotas (id, name, storage_limit_bytes, max_file_size_bytes, max_files, daily_upload_limit_bytes, created_at)
    VALUES ('guest', 'Guest', 1073741824, 104857600, 10, 524288000, SYSDATETIMEOFFSET());
    PRINT 'Seeded default ''guest'' quota tier.';
END
GO

-- Initialize maintenance_mode config (disabled by default)
IF NOT EXISTS (SELECT 1 FROM system_config WHERE [key] = N'maintenance_mode')
BEGIN
    INSERT INTO [dbo].[system_config] ([key], [value], [updated_at])
    VALUES (N'maintenance_mode', N'false', SYSDATETIMEOFFSET());
    PRINT 'Seeded default maintenance_mode configuration (disabled).';
END
GO

-- ============================================================
-- Final Database Configuration
-- ============================================================

USE [master]
GO
ALTER DATABASE [LeekuSecure] SET  READ_WRITE 
GO

PRINT '====================================================='
PRINT 'LeekuSecure Database Creation Complete'
PRINT '====================================================='
PRINT 'Tables created: users, files, file_encryption_keys,'
PRINT '                share_links, refresh_tokens, system_logs,'
PRINT '                system_config, quotas'
PRINT 'Indexes created: 12 optimized indexes'
PRINT 'Stored Procedures: 7'
PRINT '  - sp_GetExpiredFiles'
PRINT '  - sp_IncrementDownloadCount'
PRINT '  - sp_MarkFilesExpired'
PRINT '  - sp_RecordFailedLogin'
PRINT '  - sp_ResetLoginAttempts'
PRINT '  - sp_GetMaintenanceStatus'
PRINT '  - sp_ToggleMaintenanceMode'
PRINT 'User: leeku_app (db_datareader, db_datawriter)'
PRINT 'Data Seeded: 1 quota tier (guest), maintenance_mode config'
PRINT '====================================================='
