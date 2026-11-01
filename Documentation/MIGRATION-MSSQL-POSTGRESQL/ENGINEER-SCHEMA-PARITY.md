# DocEngineer — Schema DDL & Parity : Soft-deletion & File versioning (MSSQL → PostgreSQL)

> Owner: DocEngineer | date: 2026-10-31 | input: `DISCOVERY_REPORT.md`, `GAP_MANIFEST.md`, `ARCHITECTURE.md`

## 1. PostgreSQL migration DDL

Materialized & applied at `Documentation/SQL/2026-10-31-postgresql-file-versioning.sql`
(validated on PostgreSQL 16 — idempotent, cascade + pin FK behavior confirmed). It is
styled after `postgresql_schema.sql`. Reference copy:

```sql
-- Migration: File version history + soft-deletion retention (PostgreSQL)
-- Idempotent. Run as DB owner.

-- 1. files.file_name_hash (HMAC-SHA256, hex 64) for same-name/same-folder detection
ALTER TABLE files ADD COLUMN IF NOT EXISTS file_name_hash CHAR(64) NULL;

-- 2. files.version_count — current + archived count, default 1
ALTER TABLE files ADD COLUMN IF NOT EXISTS version_count INTEGER NOT NULL DEFAULT 1;

-- 3. files.current_version_id — reserved (UUID), nullable
ALTER TABLE files ADD COLUMN IF NOT EXISTS current_version_id UUID NULL;

-- 4. share_links.version_id — optional pin to a specific file_versions.id
ALTER TABLE share_links ADD COLUMN IF NOT EXISTS version_id UUID NULL;

-- 5. file_versions — archived older versions
CREATE TABLE IF NOT EXISTS file_versions (
    id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id                    UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    version_no                 INTEGER NOT NULL,
    original_name_encrypted    BYTEA NOT NULL,
    original_name_iv           BYTEA NOT NULL,
    original_name_auth_tag     BYTEA NOT NULL,
    stored_path                TEXT NOT NULL,
    mime_type                  VARCHAR(255) NOT NULL,
    size_bytes                 BIGINT NOT NULL,
    encrypted_size_bytes       BIGINT NOT NULL,
    status                     VARCHAR(20) NOT NULL DEFAULT 'Available',
    checksum_sha256            CHAR(64) NOT NULL,
    scan_result                VARCHAR(20) NULL,
    scan_message               TEXT NULL,
    is_encrypted               BOOLEAN NOT NULL DEFAULT TRUE,
    client_secret_hash         TEXT NULL,
    client_crypto_salt         BYTEA NULL,
    client_crypto_iv           BYTEA NULL,
    client_crypto_iterations   INTEGER NULL,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at                 TIMESTAMPTZ NULL,
    deleted_by                 UUID NULL,
    CONSTRAINT uq_file_versions_file_version UNIQUE (file_id, version_no)
);

-- 6. file_version_keys — wrapped key per archived version (1:1)
CREATE TABLE IF NOT EXISTS file_version_keys (
    version_id     UUID PRIMARY KEY REFERENCES file_versions(id) ON DELETE CASCADE,
    encrypted_key  BYTEA NOT NULL,
    key_iv         BYTEA NOT NULL,
    key_auth_tag   BYTEA NOT NULL,
    file_iv        BYTEA NOT NULL,
    file_auth_tag  BYTEA NOT NULL,
    algorithm      VARCHAR(20) NOT NULL DEFAULT 'AES-256-GCM',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 7. share_links.version_id FK (pin, NO ACTION like mssql)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        INNER JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'share_links' AND c.conname = 'fk_share_links_version'
    ) THEN
        ALTER TABLE share_links
            ADD CONSTRAINT fk_share_links_version
            FOREIGN KEY (version_id) REFERENCES file_versions(id);
    END IF;
END $$;

-- 8. Index for same-name same-folder detection
CREATE INDEX IF NOT EXISTS ix_files_owner_name_hash
    ON files (owner_user_id, folder_id, file_name_hash)
    WHERE file_name_hash IS NOT NULL;

-- 9. Trash: expired-purge scan index
CREATE INDEX IF NOT EXISTS ix_files_deleted_at
    ON files (deleted_at)
    WHERE deleted_at IS NOT NULL;
```

> Notes:
> - `files.deleted_at` already exists — no DDL needed for base soft-delete column.
> - Backfill of `file_name_hash` is done by `scripts/backfill-file-hashes.ts` (app-side,
>   since names are encrypted). See runbook.

## 2. `server.ts` change list (migration surface)

| Area | Endpoint / symbol | Change |
|---|---|---|
| Upload | `/api/files/upload` | Same-name detection via `file_name_hash`; on match → archive current blob to `file_versions`/`file_version_keys`, then update `files` with new version; `version_count+1` |
| Soft-delete | `POST /api/files/:id/delete` | `UPDATE files SET deleted_at=...` instead of unlink+`DELETE`; remove share links |
| Trash | `GET /api/files/trash`, restore, purge | List soft-deleted files + soft-deleted versions; endpoints to restore/purge |
| Purge | `startTrashPurge` / `runTrashPurgeCycle` | Port job honoring `TRASH_RETENTION_DAYS` (default 90) |
| Versions | `GET /api/files/:id/versions` · `GET /api/files/:id/versions/:vid/download` · `POST .../versions/:vid/restore` · `DELETE .../versions/:vid` (soft-delete→version trash) · `POST .../versions/:vid/restore-trashed` · `POST .../versions/:vid/delete-permanent` | list / download / restore / soft-delete / restore-from-trash / purge version |
| Sharing | `src/server/routes/public-sharing.ts` | Resolve latest vs pinned `version_id`; download specific version |
| Types | `FileVersion`, `version_count`, `file_name_hash` in `mapFileRow`/`FileRow` | Extend row types (mssql `types/index.ts` +19) |

## 3. SQL construct conversion table (DocEngineer parity)

| MSSQL (mssql branch) | PostgreSQL (target) | Where |
|---|---|---|
| `OUTPUT INSERTED.id, ...` | `RETURNING id, ...` | upload new/version, folder, share, user INSERT |
| `OUTPUT DELETED.folder_id` | `RETURNING folder_id` (DELETE ... RETURNING) | admin folder delete |
| `OUTPUT INSERTED.version_no` | `RETURNING version_no` | restore-trashed version |
| `NEWID()` | `gen_random_uuid()` | refresh_token insert |
| `UPDATE TOP (@n) files` | `UPDATE files ... WHERE id IN (SELECT id FROM files ... LIMIT @n)` | cleanup batch |
| `DELETE TOP (@n) FROM files` | `DELETE FROM files WHERE id IN (SELECT id FROM files ... LIMIT @n)` | cleanup batch |
| `OFFSET @o ROWS FETCH NEXT @n ROWS ONLY` | `LIMIT @n OFFSET @o` | backfill script |
| `dbo.files` | `files` (translator already strips `[dbo].`) | backfill script |
| `VARBINARY(n)` param | `bytea` (sql.VarBinary) | unchanged via `sql.*` |
| `UNIQUEIDENTIFIER` param | `uuid` (sql.UniqueIdentifier) | unchanged via `sql.*` |
| `DATETIMEOFFSET(7)` param | `timestamptz` (sql.DateTimeOffset) | unchanged via `sql.*` |

## 4. Frontend parity
- `user-dashboard.tsx`: Trash tab (files + soft-deleted versions), version dropdown,
  version history panel, hide versions button unless `version_count > 1` (mssql `44a35d6`).
- `public-sharing.ts`/`public-download-page.tsx`: pinned version resolution + download.
- `types/index.ts`: `FileVersion` interface + `version_count` + `file_name_hash`.

## 5. Validation
- After migration, run the existing `tests/database.test.ts` plus new versioning/trash
  coverage (G-27/G-28).
- Parity spot-check: for each `OUTPUT`/`NEWID`/`TOP`/`OFFSET` site in the mssql branch,
  confirm the pg equivalent returns the same columns by behavior (ADR-1).
