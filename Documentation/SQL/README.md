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
