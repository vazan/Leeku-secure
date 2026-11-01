# SQL Documentation (PostgreSQL Branch)

This folder is PostgreSQL-focused on the `postgresql` branch.

## Canonical Schema

- [postgresql_schema.sql](postgresql_schema.sql)

Apply it with:

```sh
psql -U leeku_app -d LeekuSecure -f Documentation/SQL/postgresql_schema.sql
```

## Prerequisites

- Database `LeekuSecure` exists.
- Role used for bootstrap has privileges to create tables, indexes, and constraints in schema `public`.

## Notes

- The schema is idempotent where possible (`CREATE TABLE IF NOT EXISTS`, `ON CONFLICT DO NOTHING`).
- Includes seed data needed by the app (for example quota tiers and system configuration defaults).
- Use this file as the single source of truth for database changes on this branch.
- Incremental migrations are also stored here, including [2026-08-13-postgresql-share-links-decrypted-preview.sql](2026-08-13-postgresql-share-links-decrypted-preview.sql) for decrypted external preview flags on `share_links`, etc.

## Encrypted Image Thumbnails

Before deploying the thumbnail changes to an existing database, apply
[2026-10-18-postgresql-thumbnails.sql](2026-10-18-postgresql-thumbnails.sql)
with a schema-owner role. The application does not run this migration automatically.

`thumbnail_preview` stores an AES-256-GCM envelope (12-byte IV, 16-byte
authentication tag, ciphertext), not a plaintext JPEG. Its key is derived from
the wrapped file key and file ID with HKDF-SHA256 and purpose `leeku-thumbnail-v1`.
The envelope and `thumbnail_generated` timestamp are written atomically.

Authenticated owners and administrators can request `/api/files/:id/thumbnail`.
Desktop update artifacts retain their administrator-only restriction. Images
protected by a user-provided secret, blocked/deleted/expired files, sources over
50 MiB, and images over 40 million pixels are excluded. JPEG output fits inside
128 by 128 pixels. Videos continue using `/preview`.

Missing thumbnails are generated on demand and at startup. An hourly scan also
refreshes thumbnails older than two hours. Each process runs at most two
generation jobs, deduplicates concurrent requests for the same file, and removes
decrypted temporary sources after processing. Scan logs contain counts only.
Install production dependencies with the repository's pnpm lockfile; `sharp`
requires its platform-specific native package. No original-image fallback is used.

This ports `c692a9b` and `ae51414` without the MSSQL-specific schema probes,
plaintext thumbnail storage, filename logging, or split non-atomic updates.
The existing optional file-secret migrations are preserved.

## File Versioning & Soft-Deletion (Trash)

Apply
[2026-10-31-postgresql-file-versioning.sql](2026-10-31-postgresql-file-versioning.sql)
with a schema-owner role. The application does not run this migration automatically.
Port of the MSSQL file-versioning feature (source commits
`d364703f..e82dba6c` on the `mssql` branch) to the PostgreSQL dialect.

### Schema added
- `files.file_name_hash CHAR(64) NULL` — HMAC-SHA256 (hex) of the normalized filename,
  enabling indexed same-name / same-folder detection without storing plaintext names.
- `files.version_count INT NOT NULL DEFAULT 1` — total versions (current + archived).
  The current version stays in `files` (Model B); older versions are archived.
- `files.current_version_id UUID NULL` — reserved (future restore-promote flow).
- `share_links.version_id UUID NULL` — optional pin to a specific archived version
  (NULL = resolve to the current version at access time).
- New `file_versions` — archived older versions (id, file_id, version_no UNIQUE(file_id,
  version_no), encrypted name/metadata, stored_path, size/encrypted_size, status, checksum,
  scan fields, client-secret fields, created_at, `deleted_at`/`deleted_by` for per-version trash).
- New `file_version_keys` — wrapped AES-256-GCM key per archived version (1:1 with
  `file_versions.id`, `ON DELETE CASCADE`).

### Indexes & constraints
- `ix_files_owner_name_hash ON files (owner_user_id, folder_id, file_name_hash) WHERE
  file_name_hash IS NOT NULL` — same-name detection.
- `ix_files_deleted_at ON files (deleted_at) WHERE deleted_at IS NOT NULL` — trash purge scan.
- `ix_file_versions_file_id ON file_versions (file_id, version_no)`.
- `fk_share_links_version` (`share_links.version_id → file_versions(id)`, NO ACTION) — a pinned
  version can only be purged once the app clears the pin (ADR-4).

### Notes
- `files.deleted_at` already existed (soft-deletion) — no DDL was needed for it.
- `file_name_hash` backfill for pre-migration rows is done by the application
  (`scripts/backfill-file-hashes.ts`, `npm run backfill:file-hashes`) because encrypted
  names cannot be derived by the database.
- Idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, guarded FK/constraint).
