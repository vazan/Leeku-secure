# DB Schema Gap Manifest

Date: 2026-07-07
Scope:
- Leeku-MSSQL
- Leeku-POSTGRESQL

Method:
- Repository-only evidence.
- No invented schema objects.

## P1 Gaps (Block canonical physical schema mapping)

### DB-GAP-001: Canonical SQL schema files referenced by README are missing in repository snapshot
Owner: DocArchitect + Backend Engineer
Priority: P1
Evidence:
- Leeku-MSSQL/README.md references Documentation/SQL/*.sql files not found.
- Leeku-POSTGRESQL/README.md references Documentation/SQL/postgresql_schema.sql not found.
Impact:
- Cannot prove definitive PK/FK/index/check/default/nullability coverage.
Required evidence to close:
- Commit canonical MSSQL and PostgreSQL DDL files used for deployment.

### DB-GAP-002: Non-system tables lack explicit DDL evidence for keys/constraints/indexes
Owner: Backend Engineer
Priority: P1
Affected tables:
- users, refresh_tokens, files, file_encryption_keys, share_links, quotas, system_logs
Impact:
- Table/column usage is known, but physical schema guarantees are unverified.
Required evidence to close:
- CREATE TABLE + ALTER statements, or DB introspection exports for each branch.

### DB-GAP-003: Relationship integrity is inferred but not provable
Owner: Backend Engineer
Priority: P1
Inferred-only relationships:
- refresh_tokens.user_id -> users.id
- files.owner_user_id -> users.id
- file_encryption_keys.file_id -> files.id
- share_links.file_id -> files.id
- users.quota_id -> quotas.id
Impact:
- FK enforcement/cascade semantics unknown.
Required evidence to close:
- FK definitions from canonical DDL or constraint dumps.

## P2 Gaps (High-value, does not block table-level mapping)

### DB-GAP-004: Runtime SQL-translation adapter obscures DB-native query surface in PostgreSQL branch
Owner: Backend Engineer
Priority: P2
Evidence:
- Leeku-POSTGRESQL/src/server/db.ts rewrites MSSQL-style SQL to PostgreSQL syntax.
Impact:
- Harder to validate true PostgreSQL-native SQL compatibility and performance assumptions.
Required evidence to close:
- Explicit documentation listing translated patterns and non-supported patterns, plus tests.

### DB-GAP-005: Inline bootstrap migrations are partial and non-versioned
Owner: Backend Engineer + Ops Engineer
Priority: P2
Evidence:
- Leeku-POSTGRESQL/src/server.ts applies ALTER TABLE ... ADD COLUMN IF NOT EXISTS for files/share_links at startup.
Impact:
- Drift risk between environments; migration order/history not tracked.
Required evidence to close:
- Versioned migration mechanism and migration history documentation.

### DB-GAP-006: Index coverage for hot paths is unknown
Owner: Backend Engineer
Priority: P2
Evidence:
- Frequent predicates on token_hash, email_hash, username_hash, status, created_at, file_id, owner_user_id.
Impact:
- Performance and lock contention risk under load.
Required evidence to close:
- Indexed-column matrix from DDL or DB catalog snapshot.

## P3 Gaps (Documentation quality and assurance)

### DB-GAP-007: Constraint intent not explicitly documented per table
Owner: DocEngineer
Priority: P3
Impact:
- Consumers cannot distinguish hard DB guarantees vs app-level assumptions.
Required evidence to close:
- Per-table constraint map with source citations.

### DB-GAP-008: Confidence rationale not yet embedded in canonical mapping artifact
Owner: DocEngineer
Priority: P3
Impact:
- Reviewers cannot quickly assess trust level of each field/relationship.
Required evidence to close:
- Canonical mapping document with High/Medium/Low confidence at table and column granularity.

## Current Shared vs Branch-Specific Risk Notes

Shared risks:
- Missing authoritative DDL for core business tables in both branches.
- Relationship and index guarantees not provable from application queries alone.

Branch-specific risks:
- MSSQL: no repository-local canonical schema script available for verification.
- PostgreSQL: schema can drift due to startup-time ALTER TABLE migrations; translation layer can mask non-native SQL usage.

## Closure Criteria for Canonical Mapping Readiness

Minimum evidence package required:
1. Canonical MSSQL DDL and canonical PostgreSQL DDL committed in-repo.
2. Constraint/index inventory exported per branch.
3. Mapping reconciliation matrix: shared tables/columns + branch deltas + compatibility notes.
4. Validation run showing app queries align with declared schema.

Readiness status:
- Canonical physical mapping readiness: NOT READY (P1 open).
- Application-level mapping readiness: READY (based on current source evidence).
