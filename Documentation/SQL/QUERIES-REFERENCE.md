# Leeku-Secure — PostgreSQL SQL Query Reference (file versioning & soft-deletion)

This reference documents the SQL statements behind the **soft-deletion (Trash)** and
**file versioning** features on the `postgresql` branch pending the MSSQL→PostgreSQL
migration. The application talks to PostgreSQL through `src/server/db.ts`
(`PgRequest` over `pg`), which keeps the `mssql`-like call sites while transpiling the
query text at runtime via `translateQuery`.

> Scope note: unlike `Documentation/SQL/QUERIES-REFERENCE.md` on the `mssql` branch,
> which is written in the MSSQL dialect and enriched with stored procedures, this file
> documents the migration-specific queries that were added/ported here, in the dialect
> the application actually executes after `translateQuery`. Statements are parameterized
> with `@param` placeholders (the source spelling used in `src/server.ts`).

---

## 1. `translateQuery` — runtime dialect adapter

`translateQuery(queryText, params)` (exported from `src/server/db.ts`) rewrites the
MSSQL-flavored source text into PostgreSQL before execution. The conversions applied are:

| MSSQL source construct | PostgreSQL output |
|---|---|
| `[dbo].` / `[col]` identifiers | stripped / double-quoted `"col"` |
| `ISNULL(a, b)` | `COALESCE(a, b)` |
| `GETDATE()` | `CURRENT_TIMESTAMP` |
| `SYSDATETIMEOFFSET()` | `CURRENT_TIMESTAMP` |
| `DATEADD(day, ±N, SYSDATETIMEOFFSET())` | `CURRENT_TIMESTAMP +/− INTERVAL 'N day'` |
| `CAST(CASE WHEN … THEN 1 ELSE 0 END AS bit)` | `CASE WHEN … THEN TRUE ELSE FALSE END` |
| `SELECT TOP (n) …` | `SELECT … LIMIT n` |
| `@param` placeholders | `$1..$n` (ordered, deduplicated) |

Implications for the versioning/trash feature (see `src/server.ts`):

- `OUTPUT INSERTED/DELETED` is **not** translated — migrated queries use native PG
  `RETURNING` (ADR-1), matching the existing upload INSERT pattern.
- `NEWID()` is **not** translated — the app generates UUIDs with `crypto.randomUUID()`
  for `file_versions.id` / `file_version_keys.version_id`.
- `OFFSET … FETCH NEXT` is **not** translated — the backfill script uses native
  `LIMIT/OFFSET` (see §4).
- **Param type inference:** node-postgres sends parameter values without explicit type
  OIDs. When a `@param`'s first occurrence sits inside an `IS NULL` predicate (so its
  value is `NULL`), PostgreSQL cannot infer the column type. The migrated queries add an
  explicit cast (`CAST(@folderId AS uuid)`) in those spots (fix commit `ee62ac0`).

---

## 2. Soft-deletion (Trash)

`files.deleted_at TIMESTAMPTZ NULL` — set when a file moves to Trash. The vault blob
stays on disk until the purge job (see §5) removes the row after `TRASH_RETENTION_DAYS`.

### 2.1 Soft-delete a file (single / bulk)
```sql
-- Marked soft-deleted; blob stays on disk. Original name is logged separately.
UPDATE files SET deleted_at=SYSDATETIMEOFFSET() WHERE id=@id AND deleted_at IS NULL;
```

### 2.2 Cancel version pins before delete
```sql
-- Soft delete also drops share rows so no `version_id` pin survives to block a later
-- permanent delete (parallel to FK fk_share_links_version).
DELETE FROM share_links WHERE file_id=@id;
```

### 2.3 List trashed files (recycle bin)
```sql
SELECT id, owner_user_id, original_name_encrypted, original_name_iv, original_name_auth_tag,
       stored_path, mime_type, size_bytes, encrypted_size_bytes, status, checksum_sha256,
       is_encrypted, leeku_vibe, ttl_hours, expires_at, created_at, deleted_at, version_count
FROM files
WHERE owner_user_id=@ownerId AND deleted_at IS NOT NULL
ORDER BY deleted_at DESC;
```

### 2.4 Restore a trashed file
```sql
UPDATE files SET deleted_at=NULL WHERE id=@id;   -- guarded by owner + deleted_at checks
```

### 2.5 Permanently delete a trashed file (cascades)
```sql
-- `file_versions`/`file_version_keys` cascade via FK ON DELETE CASCADE.
DELETE FROM files WHERE id=@id;
```

### 2.6 Trash purge job (`src/server/utils/trash-purge.ts`)
```sql
-- Select rows older than TRASH_RETENTION_DAYS ...
SELECT id FROM files
WHERE deleted_at IS NOT NULL
  AND deleted_at < CURRENT_TIMESTAMP - INTERVAL '90 day';
-- ... then remove share pins, delete vault blobs, and DELETE FROM files (cascades).
```

---

## 3. File versioning

### 3.1 Same-name detection on upload (indexed HMAC)
```sql
-- file_name_hash = HMAC-SHA256 hex of the normalized encrypted filename.
SELECT id, version_count FROM files
WHERE owner_user_id=@ownerId AND folder_id=@folderId
  AND file_name_hash=@nameHash AND deleted_at IS NULL AND status='Available';
```
The hashed lookup uses `ix_files_owner_name_hash`. For pre-migration rows with
`file_name_hash IS NULL` the upload path falls back to a bounded (≤20) same-folder scan
that matches by decrypted name and heals the hash.

### 3.2 Archive the current blob as a new version (on upload / restore)
```sql
INSERT INTO file_versions
  (id,file_id,version_no,original_name_encrypted,original_name_iv,original_name_auth_tag,
   stored_path,mime_type,size_bytes,encrypted_size_bytes,status,checksum_sha256,
   scan_result,scan_message,is_encrypted,client_secret_hash,client_crypto_salt,client_crypto_iv,client_crypto_iterations,created_at)
VALUES (@archiveId,@fileId,@versionNo,@nEnc,@nIv,@nTag,@spath,@mime,@sz,@esz,'Available',
        @chk,@scan,@smsg,@isEnc,@secH,@secS,@secI,@secIt,SYSDATETIMEOFFSET());
```

### 3.3 Move the wrapped key to the archived version
```sql
INSERT INTO file_version_keys (version_id,encrypted_key,key_iv,key_auth_tag,file_iv,file_auth_tag,algorithm,created_at)
VALUES (@archiveId,@encK,@kIv,@kTag,@fIv,@fTag,'AES-256-GCM',SYSDATETIMEOFFSET());

DELETE FROM file_encryption_keys WHERE file_id=@fid;   -- old current key now archived
```

### 3.4 Promote the new upload as the current version
```sql
UPDATE files SET
  stored_path=@spath, mime_type=@mime, size_bytes=@sz, encrypted_size_bytes=@esz,
  checksum_sha256=@chk, scan_result=@scan, scan_message=@smsg,
  leeku_vibe=@vibe, ttl_hours=@ttl, expires_at=@exp,
  client_secret_hash=@secH, client_crypto_salt=@secS, client_crypto_iv=@secI, client_crypto_iterations=@secIt,
  file_name_hash=@nameHash, version_count=version_count+1, current_version_id=NULL
WHERE id=@fid;
```

### 3.5 List a file's versions (current first, then archived)
```sql
SELECT id,file_id,version_no,original_name_encrypted,original_name_iv,original_name_auth_tag,
       stored_path,mime_type,size_bytes,encrypted_size_bytes,status,checksum_sha256,
       scan_result,scan_message,is_encrypted,client_secret_hash,client_crypto_salt,client_crypto_iv,client_crypto_iterations,created_at
FROM file_versions WHERE file_id=@fid ORDER BY version_no ASC;
```

### 3.6 Download a specific archived version (wrapped key lookup)
```sql
SELECT id,file_id,version_no,stored_path,mime_type,size_bytes,status,is_encrypted,
       client_secret_hash,client_crypto_salt,client_crypto_iv,client_crypto_iterations,created_at
FROM file_versions WHERE id=@vid AND file_id=@fid;

SELECT encrypted_key,key_iv,key_auth_tag,file_iv,file_auth_tag
FROM file_version_keys WHERE version_id=@vid;
```

### 3.7 Restore an archived version (make it current)
```sql
-- nextArchivedNo avoids UNIQUE(file_id, version_no) collisions across restore cycles:
SELECT MAX(version_no) AS max_no FROM file_versions WHERE file_id=@fid;

-- 1) archive current (as §3.2) + move current key (as §3.3)
-- 2) read restored version's key, delete its file_version_keys row
-- 3) point `files` at the restored blob + key, version_count=version_count+1
DELETE FROM file_version_keys WHERE version_id=@vid;
```

### 3.8 Soft-delete / permanently delete an archived version
```sql
-- Soft-delete (moves the version into the version trash):
UPDATE file_versions SET deleted_at=SYSDATETIMEOFFSET(), deleted_by=@userId WHERE id=@vid AND file_id=@fid;

-- Version trash list joins to the parent file for owner scoping:
SELECT v.id, v.version_no, v.created_at, v.deleted_at, v.deleted_by, f.original_name_encrypted
FROM file_versions v
JOIN files f ON f.id = v.file_id
WHERE f.owner_user_id=@ownerId AND v.deleted_at IS NOT NULL
ORDER BY v.deleted_at DESC;

-- Restore a soft-deleted version:
UPDATE file_versions SET deleted_at=NULL, deleted_by=NULL WHERE id=@vid;

-- Permanent delete of an archived version (key cascades):
DELETE FROM file_version_keys WHERE version_id=@vid;
DELETE FROM file_versions WHERE id=@vid AND file_id=@fid;
```

---

## 4. Share-link version pinning

```sql
-- Create/update a share link with an optional pinned archived version.
-- version_id NULL = resolve to the file's current version at access time.
INSERT INTO share_links (id, file_id, public_token, password_hash, expires_at, max_downloads,
                         download_count, is_active, allow_external_preview, version_id, created_at)
VALUES (@id, @fileId, @publicToken, @passwordHash, @expiresAt, @maxDownloads,
        0, 1, @allowExternalPreview, @versionId, SYSDATETIMEOFFSET());

-- Public resolution: COALESCE archived over current version.
-- (Public-sharing handler reads the pinned file_versions/ file_version_keys instead of
--  files/ file_encryption_keys when version_id IS NOT NULL; a deleted pinned version
--  returns 410 "This shared file version is no longer available.")
SELECT file_id, version_no FROM file_versions WHERE id=@versionId;
```

---

## 5. Backfill script (`scripts/backfill-file-hashes.ts`)

One-time / re-runnable backfill using native PG pagination (no `OFFSET FETCH`):

```sql
-- Select active rows with NULL file_name_hash, paginated:
SELECT id, original_name_encrypted, original_name_iv, original_name_auth_tag
FROM files
WHERE owner_user_id=@cursorOwner AND deleted_at IS NULL AND file_name_hash IS NULL
ORDER BY id
LIMIT @batchSize;
-- (hash is computed app-side with HMAC-SHA256 via MASTER_KEY, then files.file_name_hash is updated)
```

Run with: `npm run backfill:file-hashes`. Idempotent — only touches rows where
`file_name_hash IS NULL AND deleted_at IS NULL`.

---

## 6. Index reference (added by the migration)

| Index | Table | Columns | Filter / notes |
|---|---|---|---|
| `ix_files_owner_name_hash` | `files` | `(owner_user_id, folder_id, file_name_hash)` | partial: `WHERE file_name_hash IS NOT NULL` |
| `ix_files_deleted_at` | `files` | `(deleted_at)` | partial: `WHERE deleted_at IS NOT NULL` (purge scan) |
| `ix_file_versions_file_id` | `file_versions` | `(file_id, version_no)` | supports list + restore order |

## 7. References

- **Migration DDL:** `Documentation/SQL/2026-10-31-postgresql-file-versioning.sql`
- **Schema catalog:** `Documentation/SQL/postgresql_schema.sql` (post-migration)
- **Adapter / translator:** `src/server/db.ts`
- **Query call sites:** `src/server.ts` (upload versioning ~3168–3220, trash ~3396–3701,
  versions ~3895–4080, share pinning ~G-14) and `src/server/utils/trash-purge.ts`
- **Backfill:** `scripts/backfill-file-hashes.ts`
