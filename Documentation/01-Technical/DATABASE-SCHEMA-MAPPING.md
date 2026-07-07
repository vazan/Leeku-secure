# Database Schema Mapping

Date: 2026-07-07  
Scope: Leeku-MSSQL + Leeku-POSTGRESQL  
Method: Repository evidence only (no runtime DB introspection)

## 1) Mapping Model (Shared-First)

Confidence: High

Shared logical schema (observed in both branches):
- users
- refresh_tokens
- files
- file_encryption_keys
- share_links
- quotas
- system_logs
- system_config

Primary evidence:
- Documentation/01-Technical/DB-DISCOVERY-SCHEMA-REPORT.md
- Documentation/01-Technical/DB-SCHEMA-GAP-MANIFEST.md
- Leeku-MSSQL/src/server.ts
- Leeku-POSTGRESQL/src/server.ts
- Leeku-MSSQL/src/server/routes/sessions.ts
- Leeku-POSTGRESQL/src/server/routes/sessions.ts
- Leeku-MSSQL/src/server/routes/public-sharing.ts
- Leeku-POSTGRESQL/src/server/routes/public-sharing.ts
- Leeku-MSSQL/src/server/middleware/maintenance-mode.ts
- Leeku-POSTGRESQL/src/server/middleware/maintenance-mode.ts

## 2) Contract Drift and DB-Specific Deltas

Confidence: High

### Shared behavior parity
- Same business tables and core query intents are implemented in both branches.
- Sessions, file lifecycle, sharing, quotas, and audit logging operate on the same table set.

### MSSQL branch deltas
- Uses SQL Server-native syntax and semantics in query surface (for example: SYSDATETIMEOFFSET, TOP, MERGE).
- system_config bootstrap is SQL Server-specific and includes explicit PK evidence:
  - PRIMARY KEY CLUSTERED on key.
- Evidence:
  - Leeku-MSSQL/src/server/middleware/maintenance-mode.ts
  - Leeku-MSSQL/src/server.ts

### PostgreSQL branch deltas
- Uses pg adapter that rewrites MSSQL-style SQL at runtime (contract drift risk for native SQL behavior).
- Bootstrap includes inline additive migrations (IF NOT EXISTS) at startup for:
  - files.client_secret_hash
  - files.client_crypto_salt
  - files.client_crypto_iv
  - files.client_crypto_iterations
  - share_links.allow_external_preview with NOT NULL DEFAULT FALSE
- system_config bootstrap is PostgreSQL-native and includes explicit PK evidence:
  - key TEXT PRIMARY KEY.
- Evidence:
  - Leeku-POSTGRESQL/src/server/db.ts
  - Leeku-POSTGRESQL/src/server.ts
  - Leeku-POSTGRESQL/src/server/middleware/maintenance-mode.ts

## 3) Relationship Mapping (Observed vs Proven)

Confidence: Medium

Observed (in joins/ownership columns, not physically proven as FK constraints):
- refresh_tokens.user_id -> users.id
- files.owner_user_id -> users.id
- file_encryption_keys.file_id -> files.id
- share_links.file_id -> files.id
- users.quota_id -> quotas.id

Evidence:
- Leeku-MSSQL/src/server.ts
- Leeku-POSTGRESQL/src/server.ts
- Leeku-MSSQL/src/server/routes/public-sharing.ts
- Leeku-POSTGRESQL/src/server/routes/public-sharing.ts
- Documentation/01-Technical/DB-DISCOVERY-SCHEMA-REPORT.md

Not proven from canonical DDL currently in repository:
- FK enforcement and cascade behavior as DB constraints.
- PK definitions for non-system_config tables.
- Secondary indexes and uniqueness constraints.

## 4) Physical Schema Assurance Status

Confidence: High

Known/proven physical details:
- system_config PK is explicitly evidenced in both branches.
- PostgreSQL has explicit migration evidence for share_links.allow_external_preview and files client-crypto columns.

Unknown/not proven physical details (must remain explicit):
- PK/FK/index/check/default/nullability coverage for:
  - users
  - refresh_tokens
  - files
  - file_encryption_keys
  - share_links
  - quotas
  - system_logs

Blocking gaps (from gap manifest):
- DB-GAP-001: missing canonical schema SQL files referenced by README.
- DB-GAP-002: missing explicit DDL/constraint/index evidence for non-system tables.
- DB-GAP-003: relationship integrity inferred but not provable.

Status:
- Canonical physical schema mapping readiness: NOT READY.
- Application-level mapping readiness: READY.

## 5) Cross-Reference (Compact)

- Discovery inventory and table evidence:
  - Documentation/01-Technical/DB-DISCOVERY-SCHEMA-REPORT.md
- Gap and confidence blockers:
  - Documentation/01-Technical/DB-SCHEMA-GAP-MANIFEST.md
- Branch-specific DB docs:
  - Documentation/01-Technical/DATABASE-MSSQL.md
  - Documentation/01-Technical/DATABASE-POSTGRESQL.md
- Adapter seam details:
  - Documentation/01-Technical/DB-ADAPTER-SEAMS.md
