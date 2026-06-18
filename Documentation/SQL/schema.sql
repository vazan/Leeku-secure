-- ============================================================
-- Leeku-Secure Database Schema Documentation
-- Reference guide with detailed column descriptions
-- ============================================================

-- For the actual deployment script, see: production_schema.sql
-- This file is for reference and understanding only.

-- ============================================================
-- users
-- ============================================================
-- Core user identity and authentication storage.
-- Email and username are encrypted with AES-256-GCM for confidentiality.
-- HMAC-SHA256 hashes enable unique indexes on sensitive fields.
-- ============================================================

-- Table Structure
-- PRIMARY KEY: id (UNIQUEIDENTIFIER, generated with NEWID())
-- UNIQUE INDEX: email_hash (CHAR(64), HMAC-SHA256)
-- UNIQUE INDEX: username_hash (CHAR(64), HMAC-SHA256)
-- FOREIGN KEY: quota_id → quotas(id)

COLUMN DEFINITIONS:
  id                              UNIQUEIDENTIFIER    -- Primary key (unique user ID)
  email_encrypted                 VARBINARY(512)      -- AES-256-GCM ciphertext of email
  email_iv                        VARBINARY(16)       -- 12-byte IV (stored as 16)
  email_auth_tag                  VARBINARY(16)       -- GCM authentication tag
  email_hash                      CHAR(64)            -- HMAC-SHA256 for index lookup (UNIQUE)
  username_encrypted              VARBINARY(512)      -- AES-256-GCM ciphertext of username
  username_iv                     VARBINARY(16)       -- 12-byte IV (stored as 16)
  username_auth_tag               VARBINARY(16)       -- GCM authentication tag
  username_hash                   CHAR(64)            -- HMAC-SHA256 for index lookup (UNIQUE)
  password_hash                   NVARCHAR(512)       -- Argon2id PHC string (never plaintext)
  role                            NVARCHAR(10)        -- 'User' (default) | 'Admin'
  quota_id                        NVARCHAR(50)        -- References quotas(id), default 'guest'
  storage_used_bytes              BIGINT              -- Running total of user's file sizes
  status                          NVARCHAR(20)        -- 'Active' (default) | 'Suspended'
  created_at                      DATETIMEOFFSET      -- Account creation timestamp
  last_login_at                   DATETIMEOFFSET      -- Last successful login timestamp
  failed_login_count              INT                 -- Brute-force counter, reset on success
  locked_until                    DATETIMEOFFSET      -- Account locked until this time (if > NOW)
  email_verified                  BIT                 -- 1 = verified, 0 = pending verification
  email_verification_token        CHAR(64)            -- SHA-256 hex of verification link (NULL when verified)
  email_verification_expires      DATETIMEOFFSET      -- Expiration time of verification link
  deletion_token                  CHAR(64)            -- SHA-256 hex of deletion confirmation link (NULL = no deletion requested)
  deletion_token_expires          DATETIMEOFFSET      -- Expiration time of deletion link

-- ============================================================
-- quotas
-- ============================================================
-- Defines storage and upload limits for different user tiers.
-- Seed data includes 'guest' tier (required for registration).
-- ============================================================

COLUMN DEFINITIONS:
  id                              NVARCHAR(50)        -- Primary key, e.g. 'guest', 'basic', 'pro'
  name                            NVARCHAR(100)       -- Human-readable name, e.g. 'Guest User'
  storage_limit_bytes             BIGINT              -- Maximum total storage per user
  max_file_size_bytes             BIGINT              -- Maximum single file size
  max_files                       INT                 -- Maximum number of files per user
  daily_upload_limit_bytes        BIGINT              -- Daily upload limit (resets at UTC midnight)
  created_at                      DATETIMEOFFSET      -- When this quota tier was created

-- Default Seed Data:
-- INSERT INTO quotas (id, name, storage_limit_bytes, max_file_size_bytes, max_files, daily_upload_limit_bytes)
-- VALUES ('guest', 'Guest', 1073741824, 104857600, 10, 524288000);
-- -- 1GB storage, 100MB per file, 10 files, 500MB/day

-- ============================================================
-- files
-- ============================================================
-- User-uploaded files with encryption metadata and malware scan results.
-- Filename is encrypted; SHA256 checksum is plaintext (for dedup).
-- Per-file encryption key is stored separately in file_encryption_keys.
-- ============================================================

COLUMN DEFINITIONS:
  id                              UNIQUEIDENTIFIER    -- Primary key (file ID)
  owner_user_id                   UNIQUEIDENTIFIER    -- Foreign key → users(id), CASCADE on delete
  original_name_encrypted         VARBINARY(2048)     -- AES-256-GCM ciphertext of original filename
  original_name_iv                VARBINARY(16)       -- IV for filename encryption
  original_name_auth_tag          VARBINARY(16)       -- GCM auth tag for filename
  stored_path                     NVARCHAR(1000)      -- Vault-relative filepath, e.g. '/vault/abc123.vault'
  mime_type                       NVARCHAR(255)       -- Content type, e.g. 'application/pdf'
  size_bytes                      BIGINT              -- Plaintext file size (before encryption)
  encrypted_size_bytes            BIGINT              -- Ciphertext file size (after encryption)
  status                          NVARCHAR(20)        -- 'Available' | 'Blocked' | 'Expired'
  checksum_sha256                 CHAR(64)            -- SHA-256 of plaintext (for integrity & dedup)
  is_encrypted                    BIT                 -- 1 = encrypted on vault, 0 = plaintext (rare)
  scan_result                     NVARCHAR(20)        -- 'Clean' | 'Suspicious' | 'Infected' | 'Error' | 'Timeout' | NULL
  scan_message                    NVARCHAR(MAX)       -- Detailed malware scan result message
  scanned_at                      DATETIMEOFFSET      -- When the file was last scanned
  leeku_vibe                      NVARCHAR(500)       -- AI-generated scan summary (optional)
  ttl_hours                       INT                 -- Allowed values: 1, 4, 24, 48, 120, 168, or NULL for permanent
  expires_at                      DATETIMEOFFSET      -- Expiration timestamp (calculated from ttl_hours + created_at)
  deleted_at                      DATETIMEOFFSET      -- Soft delete timestamp (NULL = not deleted)
  created_at                      DATETIMEOFFSET      -- File upload timestamp
  -- Optional columns (added by auto-migration if missing):
  client_secret_hash              NVARCHAR(512)       -- Argon2i hash of client-side secret (for password-protected downloads)
  client_crypto_salt              VARBINARY(32)       -- Salt for client-side key derivation
  client_crypto_iv                VARBINARY(16)       -- IV for client-side encryption
  client_crypto_iterations        INT                 -- PBKDF2 iterations for client-side key derivation

-- ============================================================
-- file_encryption_keys
-- ============================================================
-- Per-file encryption keys wrapped with the master key.
-- One row per file; deleted when file is deleted (CASCADE).
-- ============================================================

COLUMN DEFINITIONS:
  file_id                         UNIQUEIDENTIFIER    -- Primary key & foreign key → files(id), CASCADE on delete
  encrypted_key                   VARBINARY(64)       -- Per-file key (256-bit), wrapped with master key using AES-256-GCM
  key_iv                          VARBINARY(16)       -- IV for key wrapping
  key_auth_tag                    VARBINARY(16)       -- GCM auth tag for key wrapping
  file_iv                         VARBINARY(16)       -- IV used to encrypt the actual vault file
  file_auth_tag                   VARBINARY(16)       -- GCM auth tag for the vault file
  algorithm                       NVARCHAR(20)        -- Encryption algorithm, e.g. 'AES-256-GCM' (default)
  created_at                      DATETIMEOFFSET      -- When this key was created

-- ============================================================
-- share_links
-- ============================================================
-- Public share links for files with optional password protection.
-- public_token is a 32-char hex string (16 random bytes).
-- Optional columns (allow_external_preview) added by auto-migration.
-- ============================================================

COLUMN DEFINITIONS:
  id                              UNIQUEIDENTIFIER    -- Primary key (share link ID)
  file_id                         UNIQUEIDENTIFIER    -- Foreign key → files(id), CASCADE on delete
  public_token                    CHAR(32)            -- 32-char hex string (16 random bytes), UNIQUE
  password_hash                   NVARCHAR(256)       -- bcrypt hash (cost 12) of optional password (NULL = no password)
  expires_at                      DATETIMEOFFSET      -- Link expiration timestamp (NULL = no expiration)
  max_downloads                   INT                 -- Download limit (NULL = unlimited)
  download_count                  INT                 -- Current download count (incremented atomically)
  is_active                       BIT                 -- 1 = active, 0 = disabled/revoked
  allow_external_preview          BIT                 -- 1 = allow preview (not just download), 0 = download only
  created_at                      DATETIMEOFFSET      -- When this share link was created

-- ============================================================
-- refresh_tokens
-- ============================================================
-- OAuth2 refresh tokens for session management.
-- Tokens are hashed (SHA-256) before storage; original token
-- is never stored and cannot be recovered.
-- ============================================================

COLUMN DEFINITIONS:
  id                              UNIQUEIDENTIFIER    -- Primary key (token record ID)
  user_id                         UNIQUEIDENTIFIER    -- Foreign key → users(id), CASCADE on delete
  token_hash                      CHAR(64)            -- SHA-256 of the opaque token (UNIQUE)
  expires_at                      DATETIMEOFFSET      -- Token expiration timestamp
  created_at                      DATETIMEOFFSET      -- When token was issued
  revoked_at                      DATETIMEOFFSET      -- When token was revoked (NULL = active)
  ip_address                      NVARCHAR(45)        -- IPv4 or IPv6 address of client at issuance
  user_agent                      NVARCHAR(500)       -- Browser/client user agent at issuance

-- ============================================================
-- system_logs
-- ============================================================
-- Comprehensive audit log for all user and system events.
-- Used for security forensics, compliance (GDPR SAR), and monitoring.
-- Logs are immutable and never deleted (soft-deleted via TTL).
-- ============================================================

COLUMN DEFINITIONS:
  id                              BIGINT IDENTITY     -- Auto-incrementing primary key (sequential log ID)
  user_id                         UNIQUEIDENTIFIER    -- User who triggered the event (NULL for system events)
  username_snapshot               NVARCHAR(200)       -- Username at time of event (immutable snapshot for historical context)
  event_type                      NVARCHAR(20)        -- 'Upload' | 'Scan' | 'Delete' | 'Download' | 'Link' | 'Admin' | 'Security' | 'Auth'
  target_type                     NVARCHAR(50)        -- Type of resource affected, e.g. 'File' | 'User' | 'Share' | 'Token'
  target_id                       NVARCHAR(100)       -- ID of the affected resource (file_id, user_id, share_id, etc.)
  ip_address                      NVARCHAR(45)        -- IPv4 or IPv6 address of client
  message                         NVARCHAR(MAX)       -- Free-form event description, e.g. "Uploaded 5MB PDF file"
  created_at                      DATETIMEOFFSET      -- Event timestamp

-- ============================================================
-- Indexes (12 total)
-- ============================================================

-- files table
IX_files_owner_id               -- Composite: (owner_user_id, status, created_at) -- User file listing
IX_files_status                 -- Composite: (status, owner_user_id) -- Filter by file status
IX_files_expires_at             -- Filtered: WHERE expires_at IS NOT NULL AND status='Available' -- File expiration cleanup

-- users table
IX_users_email_hash             -- Single: (email_hash) -- Email login lookup (UNIQUE)
IX_users_username_hash          -- Single: (username_hash) -- Username lookup (UNIQUE)
IX_users_status                 -- Filtered: WHERE status='Active' -- Admin user listing
IX_users_email_verification_token  -- Filtered: WHERE email_verification_token IS NOT NULL
IX_users_deletion_token         -- Filtered: WHERE deletion_token IS NOT NULL

-- refresh_tokens table
IX_refresh_tokens_user_active   -- Composite: (user_id, expires_at) WHERE revoked_at IS NULL -- Active tokens

-- share_links table
IX_share_links_file_id          -- Composite: (file_id, is_active, public_token) -- Share link lookup

-- system_logs table
IX_system_logs_created_at       -- Single: (created_at DESC) -- Recent logs
IX_system_logs_event_type       -- Composite: (event_type, created_at DESC) -- Logs by type

-- ============================================================
-- Foreign Keys (5 total)
-- ============================================================

FK_files_users                  -- files.owner_user_id → users.id (ON DELETE CASCADE)
FK_file_keys_files              -- file_encryption_keys.file_id → files.id (ON DELETE CASCADE)
FK_share_links_files            -- share_links.file_id → files.id (ON DELETE CASCADE)
FK_refresh_tokens_users         -- refresh_tokens.user_id → users.id (ON DELETE CASCADE)
FK_users_quotas                 -- users.quota_id → quotas.id

-- ============================================================
-- Check Constraints (9 total)
-- ============================================================

-- User Constraints
CK_users_role                   -- [role] IN ('User', 'Admin')
CK_users_status                 -- [status] IN ('Active', 'Suspended')
CK_users_storage                -- [storage_used_bytes] >= 0

-- File Constraints
CK_files_status                 -- [status] IN ('Available', 'Blocked', 'Expired')
CK_files_size                   -- [size_bytes] > 0
CK_files_scan                   -- [scan_result] IS NULL OR [scan_result] IN (...)
CK_files_ttl                    -- [ttl_hours] IS NULL OR [ttl_hours] IN (1, 4, 24, 48, 120, 168)

-- Quota Constraints
CK_quotas_storage               -- [storage_limit_bytes] > 0
CK_quotas_filesize              -- [max_file_size_bytes] > 0
CK_quotas_maxfiles              -- [max_files] > 0

-- Share Link Constraints
CK_share_links_dl               -- [max_downloads] IS NULL OR [max_downloads] > 0

-- System Logs Constraints
CK_logs_event_type              -- [event_type] IN ('Upload', 'Scan', ...) -- Enum validation

-- ============================================================
-- Stored Procedures (5 total)
-- ============================================================

sp_GetExpiredFiles
  -- Purpose: Retrieve files ready for physical vault deletion
  -- Parameters: None
  -- Returns: id, stored_path, owner_user_id, expires_at, size_bytes
  -- Used by: File expiry cleanup job

sp_IncrementDownloadCount
  -- Purpose: Atomically increment download_count for a share link
  -- Parameters: @PublicToken CHAR(32)
  -- Returns: None
  -- Benefit: Race-condition safe (no double-counts on concurrent downloads)

sp_MarkFilesExpired
  -- Purpose: Mark vault files as 'Expired' after physical deletion
  -- Parameters: @FileIds dbo.GuidList READONLY
  -- Returns: None
  -- Benefit: Safe batch operation (uses TVP, prevents SQL injection)

sp_RecordFailedLogin
  -- Purpose: Increment failed_login_count and lock account if threshold reached
  -- Parameters: @EmailHash CHAR(64), @MaxAttempts INT, @LockoutMinutes INT
  -- Returns: None
  -- Benefit: Atomic brute-force protection

sp_ResetLoginAttempts
  -- Purpose: Reset failed login counter on successful authentication
  -- Parameters: @UserId UNIQUEIDENTIFIER
  -- Returns: None
  -- Side Effect: Updates last_login_at timestamp

-- ============================================================
-- Custom Types (1 total)
-- ============================================================

dbo.GuidList
  -- Table-valued parameter type for batch operations
  -- Columns: id UNIQUEIDENTIFIER
  -- Used by: sp_MarkFilesExpired, allows safe multi-record updates

-- ============================================================
-- Database Configuration
-- ============================================================

Recovery Mode               FULL (enables transaction log backups)
Read-Committed Snapshot     ON (reduces blocking on concurrent reads)
Query Store                 Enabled (tracks slow queries & execution plans)
Page Verification           CHECKSUM (detects page corruption)
Target Recovery Time        60 seconds RTO (Recovery Time Objective)
Compatibility Level         160 (SQL Server 2022 features)
Application User            leeku_app (db_datareader, db_datawriter roles)
Data File                   P:\DATA\LeekuSecure_prod.mdf (primary drive for I/O)
Log File                    L:\LOGS\LeekuSecure_prod_log.ldf (optimized log drive)

-- ============================================================
-- Encryption Strategy
-- ============================================================

Master Key
  -- Base64-encoded 256-bit key (stored in environment: MASTER_KEY_BASE64)
  -- Used to wrap per-file encryption keys and encrypt PII columns
  
Per-File Key
  -- 256-bit random key generated for each file
  -- Encrypted with master key using AES-256-GCM
  -- Stored in file_encryption_keys table

PII Encryption (email, username, filenames)
  -- Algorithm: AES-256-GCM (authenticated encryption)
  -- IV: 12-byte random (stored as 16 bytes)
  -- Auth Tag: 16-byte GCM tag (validates ciphertext integrity)
  -- Purpose: Protect confidentiality and detect tampering

Hash Indexes (email_hash, username_hash, checksum_sha256)
  -- Algorithm: HMAC-SHA256 (unencrypted, for indexed lookup)
  -- Purpose: Enable fast searches without decryption
  -- Security: Cryptographically distinct from plaintext (HMAC with secret key)

Password Hashing
  -- User Passwords: Argon2id (memory-hard, resistant to GPU/ASIC attacks)
  -- Share Link Passwords: bcrypt (industry standard, cost 12)
  -- Both: One-way hash (cannot be decrypted)

Token Hashing
  -- Refresh Tokens: SHA-256 of opaque random token
  -- Purpose: Prevent token leakage from database (compromised DB ≠ compromised tokens)

-- ============================================================
-- Data Retention & Compliance
-- ============================================================

Soft Deletes
  -- Files: deleted_at timestamp (not physically removed, searchable)
  -- Share Links: is_active flag (can be reactivated)
  -- Purpose: GDPR compliance, audit trail, potential recovery

TTL (Time-To-Live)
  -- Files: expires_at calculated from ttl_hours (1h, 4h, 1d, 2d, 5d, 7d, or NULL permanent)
  -- Automatic cleanup: Expired files moved to 'Expired' status, then deleted after 90 days
  -- Share Links: optional expiration
  -- Tokens: mandatory expiration (typical: 7 days for refresh tokens, 15 min for access tokens)

Audit Logging
  -- All operations logged to system_logs (immutable, append-only)
  -- Captures: user_id, event_type, target, ip_address, message, timestamp
  -- Retained: Per compliance policy (typical: 1-7 years)
  -- GDPR SAR: Join users + files + share_links + system_logs for complete record

-- ============================================================
-- Reference
-- ============================================================

For actual deployment: See production_schema.sql
For common queries: See queries.sql
For validation: See VALIDATION.md
For migration guide: See migrations/001_initial_schema.sql
