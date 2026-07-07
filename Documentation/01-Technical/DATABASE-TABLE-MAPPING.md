# Database Table Mapping

Date: 2026-07-07  
Scope: Leeku-MSSQL + Leeku-POSTGRESQL  
Method: Repository evidence only

## Confidence Scale
- High: Direct multi-file query evidence for columns and usage.
- Medium: Table/relationship inferred from joins and access patterns but not backed by canonical DDL.
- Low: Mentioned behavior without direct table-level query evidence (none used below).

## Shared Table Catalog

Total mapped tables: 8

### 1) users
Confidence: High

Purpose:
- Identity, authentication state, account lifecycle, and quota linkage.

Observed columns:
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

Inferred relationships (not physically proven FK):
- users.quota_id -> quotas.id

Where used in code:
- Leeku-MSSQL/src/server.ts
- Leeku-POSTGRESQL/src/server.ts
- Leeku-MSSQL/src/server/routes/public-sharing.ts
- Leeku-POSTGRESQL/src/server/routes/public-sharing.ts

Unknown physical-schema details:
- PK definition not explicitly proven in canonical DDL.
- FK enforcement for quota_id not proven.
- Unique constraints for email_hash/username_hash not proven.
- Index/check/default/nullability guarantees not proven.

### 2) refresh_tokens
Confidence: High

Purpose:
- Session persistence, revocation, and token rotation lifecycle.

Observed columns:
- id
- user_id
- token_hash
- expires_at
- created_at
- revoked_at
- ip_address
- user_agent

Inferred relationships (not physically proven FK):
- refresh_tokens.user_id -> users.id

Where used in code:
- Leeku-MSSQL/src/server.ts
- Leeku-POSTGRESQL/src/server.ts
- Leeku-MSSQL/src/server/routes/sessions.ts
- Leeku-POSTGRESQL/src/server/routes/sessions.ts

Unknown physical-schema details:
- PK and FK constraints not proven by canonical DDL.
- Uniqueness of token_hash not proven.
- Index coverage for token_hash/user_id/expires_at/revoked_at not proven.

### 3) files
Confidence: High

Purpose:
- File metadata, security/scan state, ownership, and download/share controls.

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

Inferred relationships (not physically proven FK):
- files.owner_user_id -> users.id

Where used in code:
- Leeku-MSSQL/src/server.ts
- Leeku-POSTGRESQL/src/server.ts
- Leeku-MSSQL/src/server/routes/public-sharing.ts
- Leeku-POSTGRESQL/src/server/routes/public-sharing.ts
- Leeku-MSSQL/src/server/utils/expiry-cleanup.ts
- Leeku-POSTGRESQL/src/server/utils/expiry-cleanup.ts

DB-specific delta notes:
- PostgreSQL branch evidences startup ALTER TABLE additions for client crypto columns.

Unknown physical-schema details:
- PK/FK/index/check/default/nullability guarantees not proven from canonical DDL.

### 4) file_encryption_keys
Confidence: Medium

Purpose:
- Per-file wrapped key material and streaming crypto metadata.

Observed columns:
- file_id
- encrypted_key
- key_iv
- key_auth_tag
- file_iv
- file_auth_tag

Inferred relationships (not physically proven FK):
- file_encryption_keys.file_id -> files.id

Where used in code:
- Leeku-MSSQL/src/server.ts
- Leeku-POSTGRESQL/src/server.ts
- Leeku-MSSQL/src/server/routes/public-sharing.ts
- Leeku-POSTGRESQL/src/server/routes/public-sharing.ts
- Leeku-MSSQL/src/server/utils/encryption.ts
- Leeku-POSTGRESQL/src/server/utils/encryption.ts

Unknown physical-schema details:
- Whether file_id is PK/UK/FK is not proven.
- Cascade delete semantics not proven.
- Index coverage not proven.

### 5) share_links
Confidence: High

Purpose:
- Public sharing contract, access policy, password gating, download limits, and activity state.

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

Inferred relationships (not physically proven FK):
- share_links.file_id -> files.id

Where used in code:
- Leeku-MSSQL/src/server.ts
- Leeku-POSTGRESQL/src/server.ts
- Leeku-MSSQL/src/server/routes/public-sharing.ts
- Leeku-POSTGRESQL/src/server/routes/public-sharing.ts

DB-specific delta notes:
- PostgreSQL branch includes startup migration evidence for allow_external_preview BOOLEAN NOT NULL DEFAULT FALSE.

Unknown physical-schema details:
- PK/FK/uniqueness/index constraints not proven from canonical DDL.
- Constraint semantics between max_downloads and download_count not proven.

### 6) quotas
Confidence: High

Purpose:
- Quota policy definitions used for user limits and admin management.

Observed columns:
- id
- name
- storage_limit_bytes
- max_file_size_bytes
- max_files
- daily_upload_limit_bytes

Inferred relationships (not physically proven FK):
- referenced by users.quota_id

Where used in code:
- Leeku-MSSQL/src/server.ts
- Leeku-POSTGRESQL/src/server.ts

DB-specific delta notes:
- Upsert semantics differ by branch implementation (MSSQL MERGE vs PostgreSQL ON CONFLICT).

Unknown physical-schema details:
- PK/FK/index/check/default/nullability guarantees not proven from canonical DDL.

### 7) system_logs
Confidence: High

Purpose:
- Security/operations audit event persistence and admin review feed.

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

Inferred relationships (not physically proven FK):
- Possible user_id -> users.id linkage by usage intent; FK not proven.

Where used in code:
- Leeku-MSSQL/src/server.ts
- Leeku-POSTGRESQL/src/server.ts

Unknown physical-schema details:
- PK/FK/index/check/default/nullability guarantees not proven from canonical DDL.
- Hot-path index evidence (created_at/event_type) not proven.

### 8) system_config
Confidence: High

Purpose:
- Runtime feature/system switches (maintenance mode and UNC auto-maintenance state).

Observed columns:
- key
- value
- updated_at

Inferred relationships:
- None observed.

Where used in code:
- Leeku-MSSQL/src/server/middleware/maintenance-mode.ts
- Leeku-POSTGRESQL/src/server/middleware/maintenance-mode.ts

Proven physical details:
- MSSQL: explicit PRIMARY KEY CLUSTERED (key) in bootstrap SQL.
- PostgreSQL: explicit key TEXT PRIMARY KEY in bootstrap SQL.

Unknown physical-schema details:
- Secondary indexes and additional constraints not evidenced.

## Table-Level Unknowns Summary (Physical Schema)

Confidence: High

Unknown or unproven across non-system tables:
- Canonical PK definitions
- FK definitions/cascade actions
- Unique indexes
- Non-unique indexes for query hot paths
- CHECK constraints
- Full nullability/default coverage

Reason:
- README-referenced canonical schema SQL files are missing from repository snapshot.

## Compact Cross-Reference

- Discovery base: Documentation/01-Technical/DB-DISCOVERY-SCHEMA-REPORT.md
- Gap manifest: Documentation/01-Technical/DB-SCHEMA-GAP-MANIFEST.md
- Branch DB docs: Documentation/01-Technical/DATABASE-MSSQL.md
- Branch DB docs: Documentation/01-Technical/DATABASE-POSTGRESQL.md
- Adapter seam context: Documentation/01-Technical/DB-ADAPTER-SEAMS.md
