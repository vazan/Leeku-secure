-- ============================================================
-- Leeku Secure PostgreSQL Schema
-- Canonical bootstrap script for the `postgresql` branch.
-- Run this as a database owner or a role with CREATE on schema `public`.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS quotas (
	id VARCHAR(50) PRIMARY KEY,
	name VARCHAR(100) NOT NULL,
	storage_limit_bytes BIGINT NOT NULL CHECK (storage_limit_bytes > 0),
	max_file_size_bytes BIGINT NOT NULL CHECK (max_file_size_bytes > 0),
	max_files INTEGER NOT NULL CHECK (max_files > 0),
	daily_upload_limit_bytes BIGINT NOT NULL CHECK (daily_upload_limit_bytes > 0)
);

INSERT INTO quotas (id, name, storage_limit_bytes, max_file_size_bytes, max_files, daily_upload_limit_bytes)
VALUES ('guest', 'Guest', 1073741824, 104857600, 10, 524288000)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS users (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	email_encrypted BYTEA NOT NULL,
	email_iv BYTEA NOT NULL,
	email_auth_tag BYTEA NOT NULL,
	email_hash CHAR(64) NOT NULL UNIQUE,
	username_encrypted BYTEA NOT NULL,
	username_iv BYTEA NOT NULL,
	username_auth_tag BYTEA NOT NULL,
	username_hash CHAR(64) NOT NULL UNIQUE,
	password_hash VARCHAR(512) NOT NULL,
	role VARCHAR(10) NOT NULL DEFAULT 'User' CHECK (role IN ('User', 'Admin')),
	quota_id VARCHAR(50) NOT NULL DEFAULT 'guest' REFERENCES quotas(id),
	storage_used_bytes BIGINT NOT NULL DEFAULT 0 CHECK (storage_used_bytes >= 0),
	status VARCHAR(20) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Suspended')),
	failed_login_count INTEGER NOT NULL DEFAULT 0,
	locked_until TIMESTAMPTZ NULL,
	last_login_at TIMESTAMPTZ NULL,
	email_verified BOOLEAN NOT NULL DEFAULT FALSE,
	email_verification_token CHAR(64) NULL,
	email_verification_expires TIMESTAMPTZ NULL,
	deletion_token CHAR(64) NULL,
	deletion_token_expires TIMESTAMPTZ NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS files (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	original_name_encrypted BYTEA NOT NULL,
	original_name_iv BYTEA NOT NULL,
	original_name_auth_tag BYTEA NOT NULL,
	stored_path VARCHAR(1000) NOT NULL,
	mime_type VARCHAR(255) NOT NULL,
	size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
	encrypted_size_bytes BIGINT NOT NULL CHECK (encrypted_size_bytes > 0),
	status VARCHAR(20) NOT NULL DEFAULT 'Available' CHECK (status IN ('Available', 'Blocked', 'Expired')),
	checksum_sha256 CHAR(64) NOT NULL,
	scan_result VARCHAR(20) NULL,
	scan_message TEXT NULL,
	scanned_at TIMESTAMPTZ NULL,
	is_encrypted BOOLEAN NOT NULL DEFAULT TRUE,
	leeku_vibe VARCHAR(500) NULL,
	ttl_hours INTEGER NULL CHECK (ttl_hours IS NULL OR ttl_hours IN (1, 4, 24, 48, 120, 168)),
	expires_at TIMESTAMPTZ NULL,
	deleted_at TIMESTAMPTZ NULL,
	client_secret_hash TEXT NULL,
	client_crypto_salt BYTEA NULL,
	client_crypto_iv BYTEA NULL,
	client_crypto_iterations INTEGER NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS file_encryption_keys (
	file_id UUID PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
	encrypted_key BYTEA NOT NULL,
	key_iv BYTEA NOT NULL,
	key_auth_tag BYTEA NOT NULL,
	file_iv BYTEA NOT NULL,
	file_auth_tag BYTEA NOT NULL
);

CREATE TABLE IF NOT EXISTS share_links (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
	public_token CHAR(32) NOT NULL UNIQUE,
	password_hash VARCHAR(256) NULL,
	expires_at TIMESTAMPTZ NULL,
	max_downloads INTEGER NULL CHECK (max_downloads IS NULL OR max_downloads > 0),
	download_count INTEGER NOT NULL DEFAULT 0,
	is_active BOOLEAN NOT NULL DEFAULT TRUE,
	allow_external_preview BOOLEAN NOT NULL DEFAULT FALSE,
	created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
	id UUID PRIMARY KEY,
	user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	token_hash CHAR(64) NOT NULL UNIQUE,
	expires_at TIMESTAMPTZ NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
	revoked_at TIMESTAMPTZ NULL,
	ip_address VARCHAR(45) NULL,
	user_agent VARCHAR(500) NULL
);

CREATE TABLE IF NOT EXISTS system_logs (
	id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
	user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
	username_snapshot VARCHAR(200) NOT NULL,
	event_type VARCHAR(20) NOT NULL,
	target_type VARCHAR(50) NOT NULL,
	target_id VARCHAR(100) NOT NULL,
	ip_address VARCHAR(45) NOT NULL,
	message TEXT NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS system_config (
	"key" TEXT PRIMARY KEY,
	"value" TEXT NOT NULL,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO system_config ("key", "value")
VALUES ('maintenance_mode', '0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO system_config ("key", "value")
VALUES ('maintenance_auto_unc_share', '0')
ON CONFLICT ("key") DO NOTHING;

CREATE INDEX IF NOT EXISTS ix_files_owner_status_created_at
	ON files (owner_user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_files_expires_at_available
	ON files (expires_at)
	WHERE expires_at IS NOT NULL AND status = 'Available';

CREATE INDEX IF NOT EXISTS ix_refresh_tokens_user_active
	ON refresh_tokens (user_id, expires_at)
	WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_share_links_file_lookup
	ON share_links (file_id, is_active, public_token);

CREATE INDEX IF NOT EXISTS ix_system_logs_created_at_desc
	ON system_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS ix_system_logs_event_type_created_at
	ON system_logs (event_type, created_at DESC);
