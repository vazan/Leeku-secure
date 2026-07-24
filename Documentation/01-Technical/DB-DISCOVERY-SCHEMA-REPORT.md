# DB Discovery Schema Report

Date: 2026-07-07
Scope:
- Leeku-MSSQL
- Leeku-POSTGRESQL

Method:
- Repository-evidence only (no runtime DB inspection).
- Sources prioritized: src/server.ts, src/server/db.ts, src/server/routes/*.ts, src/server/middleware/*.ts, README references.
- Dist/build artifacts excluded as non-canonical evidence.

## Evidence Sources

Primary evidence files:
- Leeku-MSSQL/src/server.ts
- Leeku-MSSQL/src/server/middleware/maintenance-mode.ts
- Leeku-MSSQL/src/server/routes/sessions.ts
- Leeku-MSSQL/src/server/routes/public-sharing.ts
- Leeku-MSSQL/src/server/db.ts
- Leeku-POSTGRESQL/src/server.ts
- Leeku-POSTGRESQL/src/server/middleware/maintenance-mode.ts
- Leeku-POSTGRESQL/src/server/routes/sessions.ts
- Leeku-POSTGRESQL/src/server/routes/public-sharing.ts
- Leeku-POSTGRESQL/src/server/db.ts

README evidence:
- Leeku-MSSQL/README.md references Documentation/SQL/*.sql, but those files are not present in this repository snapshot.
- Leeku-POSTGRESQL/README.md references Documentation/SQL/postgresql_schema.sql, but this file is not present in this repository snapshot.

## Discovered Tables (Application-Evidenced)

Total discovered tables: 8

### 1) users (Confidence: High)
Observed columns (direct query evidence):
- id
- email_encrypted
- email_iv
- email_auth_tag
- email_hash
- username_encrypted
- username_iv
- username_auth_tag
- username_hash
- password_hash
- role
- quota_id
- storage_used_bytes
- status
- created_at
- failed_login_count
- locked_until
- last_login_at
- email_verified
- email_verification_token
- email_verification_expires
- deletion_token
- deletion_token_expires

Observed operations:
- SELECT, INSERT, UPDATE, DELETE
- Auth lookup by id/token contexts
- Duplicate checks on email_hash / username_hash
- Admin lifecycle updates (status, quota, password)

Keys/indexes/constraints:
- NOT PROVABLE from repository DDL for PK/UK/FK/index definitions.
- INFERRED relationships: users.quota_id references quotas.id.

Unknowns:
- Actual PK definition (very likely id, but not explicitly proven by DDL).
- Uniqueness constraints on email_hash/username_hash (behavior suggests uniqueness intent).
- Check constraints on role/status enumerations.

### 2) refresh_tokens (Confidence: High)
Observed columns:
- id
- user_id
- token_hash
- expires_at
- created_at
- revoked_at
- ip_address
- user_agent

Observed operations:
- INSERT for new sessions
- SELECT active sessions
- UPDATE revoke/rotate
- DELETE expired/old revoked
- JOIN to users on user_id

Keys/indexes/constraints:
- NOT PROVABLE from DDL.
- INFERRED relationship: refresh_tokens.user_id -> users.id.

Unknowns:
- Unique constraint on token_hash not provable.
- Indexes on token_hash/user_id/expires_at/revoked_at not provable.

### 3) files (Confidence: High)
Observed columns:
- id
- owner_user_id
- original_name_encrypted
- original_name_iv
- original_name_auth_tag
- stored_path
- mime_type
- size_bytes
- encrypted_size_bytes
- status
- checksum_sha256
- scan_result
- scan_message
- scanned_at
- is_encrypted
- leeku_vibe
- ttl_hours
- client_secret_hash
- client_crypto_salt
- client_crypto_iv
- client_crypto_iterations
- expires_at
- created_at
- deleted_at

Observed operations:
- INSERT on upload
- SELECT for user listing/admin listing/download/share validation/expiry cleanup
- UPDATE status/deleted_at
- DELETE by id

Keys/indexes/constraints:
- NOT PROVABLE from DDL.
- INFERRED relationship: files.owner_user_id -> users.id.

Unknowns:
- Enum/check constraints for files.status.
- Nullable rules and default values beyond query behavior.

### 4) file_encryption_keys (Confidence: Medium)
Observed columns:
- file_id
- encrypted_key
- key_iv
- key_auth_tag
- file_iv
- file_auth_tag

Observed operations:
- INSERT after file record creation
- SELECT by file_id during download/stream/decrypt

Keys/indexes/constraints:
- NOT PROVABLE from DDL.
- INFERRED relationship: file_encryption_keys.file_id -> files.id.

Unknowns:
- Whether table has its own id PK or file_id PK/UK.
- Cascade delete behavior.

### 5) share_links (Confidence: High)
Observed columns:
- id
- file_id
- public_token
- password_hash
- expires_at
- max_downloads
- download_count
- is_active
- allow_external_preview
- created_at

Observed operations:
- INSERT, SELECT, UPDATE, DELETE
- JOIN with files and users
- token-based public access

Keys/indexes/constraints:
- NOT PROVABLE from full canonical DDL.
- PostgreSQL branch includes explicit migration evidence:
  - ALTER TABLE share_links ADD COLUMN IF NOT EXISTS allow_external_preview BOOLEAN NOT NULL DEFAULT FALSE
- INFERRED relationship: share_links.file_id -> files.id.

Unknowns:
- Uniqueness of public_token and/or file_id.
- Constraints on max_downloads/download_count consistency.

### 6) quotas (Confidence: High)
Observed columns:
- id
- name
- storage_limit_bytes
- max_file_size_bytes
- max_files
- daily_upload_limit_bytes

Observed operations:
- SELECT list/by id
- UPSERT (MERGE in MSSQL, INSERT ... ON CONFLICT in PostgreSQL)
- DELETE by id
- referenced by users.quota_id

Keys/indexes/constraints:
- NOT PROVABLE from full DDL.
- INFERRED key: id used as natural/admin key.

Unknowns:
- Numeric/range check constraints not provable.

### 7) system_logs (Confidence: High)
Observed columns:
- id
- user_id
- username_snapshot
- event_type
- target_type
- target_id
- ip_address
- message
- created_at

Observed operations:
- INSERT audit/security/ops events
- SELECT top-N log feeds and security-filtered logs

Keys/indexes/constraints:
- NOT PROVABLE from DDL.

Unknowns:
- Index strategy for created_at/event_type filters.
- Foreign key on user_id not provable.

### 8) system_config (Confidence: High)
Observed columns:
- key
- value
- updated_at

Observed operations:
- bootstrap create/seed
- read/write maintenance flags

Keys/indexes/constraints:
- MSSQL explicit DDL evidence:
  - PRIMARY KEY CLUSTERED (key)
- PostgreSQL explicit DDL evidence:
  - key TEXT PRIMARY KEY

Unknowns:
- No additional secondary indexes observed.

## Shared Tables vs Branch-Specific Schema Deltas

### Shared (both branches, evidenced)
- users
- refresh_tokens
- files
- file_encryption_keys
- share_links
- quotas
- system_logs
- system_config

### Branch-specific deltas (repository-evidenced)

MSSQL-specific:
- system_config bootstrap uses SQL Server syntax:
  - IF NOT EXISTS (sys.tables)
  - CREATE TABLE [dbo].[system_config](...)
  - CONSTRAINT [PK_system_config] PRIMARY KEY CLUSTERED
  - MERGE for upsert behavior
- Broad use of SQL Server expressions in queries (SYSDATETIMEOFFSET, GETDATE, ISNULL, TOP).

PostgreSQL-specific:
- system_config bootstrap uses PostgreSQL syntax:
  - CREATE TABLE IF NOT EXISTS system_config (...)
  - INSERT ... ON CONFLICT DO NOTHING / DO UPDATE
- Inline lightweight migrations in bootstrap:
  - ALTER TABLE files ADD COLUMN IF NOT EXISTS client_secret_hash TEXT
  - ALTER TABLE files ADD COLUMN IF NOT EXISTS client_crypto_salt BYTEA
  - ALTER TABLE files ADD COLUMN IF NOT EXISTS client_crypto_iv BYTEA
  - ALTER TABLE files ADD COLUMN IF NOT EXISTS client_crypto_iterations INTEGER
  - ALTER TABLE share_links ADD COLUMN IF NOT EXISTS allow_external_preview BOOLEAN NOT NULL DEFAULT FALSE
- DB adapter in Leeku-POSTGRESQL/src/server/db.ts translates MSSQL-style SQL at runtime (e.g., [dbo], ISNULL, GETDATE, TOP, SYSDATETIMEOFFSET patterns).

## Keys, Indexes, Constraints: What Is Proven vs Unknown

Proven:
- system_config primary key on key (both branches, explicit DDL in source).
- share_links.allow_external_preview default/NOT NULL exists in PostgreSQL via ALTER TABLE evidence.

Partially inferred (not proven by canonical schema file):
- Entity PKs likely id columns on users/files/share_links/quotas/system_logs/refresh_tokens.
- FK-like relationships inferred from joins and ownership columns.
- Expected uniqueness on users.email_hash, users.username_hash, refresh_tokens.token_hash, share_links.public_token.

Unknown (not provable from current repository snapshot):
- Full FK definitions and cascade rules.
- Full index catalog and index types.
- Full CHECK constraints and NOT NULL coverage for all columns.
- Stored procedures/triggers referenced by README are not present as SQL files in this snapshot.

## Confidence Summary

- High confidence: users, refresh_tokens, files, share_links, quotas, system_logs, system_config
- Medium confidence: file_encryption_keys
- Low confidence: none at table existence level

## Discovery Verdict

- Enough evidence exists for an application-level mapping (tables + observed columns + behavioral relationships).
- Not enough evidence exists for a fully canonical physical schema mapping (authoritative PK/FK/index/check/nullability) without the missing SQL schema artifacts or DB introspection output.
