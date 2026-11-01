# DISCOVERY_REPORT — Soft-deletion & File versioning : MSSQL → PostgreSQL

> DocHub / DocScout | date: 2026-10-31 | repo: Leeku-secure

## 1. Context

The repository has two database branches: `mssql` (source) and `postgresql` (target,
current working HEAD). The **soft-deletion** and **file versioning** functionality was
implemented and stabilized on `mssql` in the commit range:

```
d364703f8b89baced180e5a565ee55d62d19ad99 .. e82dba6c8816258713409cd294f2835f3e0b5861  (22 commits)
```

The user wants to schedule (plan + document) this migration onto `postgresql`.

## 2. Target architecture (postgresql)

- Driver: `pg` (`node-postgres`), package.json `"pg": "^8.16.3"`.
- **Adapter `src/server/db.ts`** exposes an `mssql`-like API (`.input()`, `.query()`) over
  `pg`. Queries written with `@param` are transpiled at runtime to `$1..$n` by
  `translateQuery()`.
- `sql` descriptor types map to pg types (`UniqueIdentifier→uuid`, `VarBinary→bytea`,
  `DateTimeOffset→timestamptz`, `Char→char`, `NVarChar→text`, `Bit→bit`).

### 2.1 `translateQuery()` — current coverage
| MSSQL construct | Supported? |
|---|---|
| `@param` → `$n` | ✅ |
| `[dbo].` stripped | ✅ |
| `[col]` → `"col"` | ✅ |
| `N'...'` → `'...'` | ✅ |
| `ISNULL(` → `COALESCE(` | ✅ |
| `GETDATE()` / `SYSDATETIMEOFFSET()` → `CURRENT_TIMESTAMP` | ✅ |
| `DATEADD(day,±N, SYSDATETIMEOFFSET())` | ✅ |
| `CAST(CASE... AS bit)` | ✅ |
| `SELECT TOP (n)` → `LIMIT n` | ✅ |
| **`OUTPUT INSERTED.*` / `OUTPUT DELETED.*`** | ❌ not handled |
| **`NEWID()`** | ❌ not handled |
| **`UPDATE TOP (n)` / `DELETE TOP (n)`** | ❌ not handled |
| **`OFFSET @o ROWS FETCH NEXT @n ROWS ONLY`** | ❌ not handled |
| **`CAST(created_at AS DATE)`** | ❌ not handled |

## 3. Schema deltas

### 3.1 Soft-deletion (Trash)
- `postgresql` **already has** `files.deleted_at TIMESTAMPTZ NULL` (schema line 179), and the
  read queries already filter `deleted_at IS NULL`.
- **Missing on `postgresql`**: `TRASH_RETENTION_DAYS` env var, purge job, Trash UI, restore
  endpoint, and the actual `UPDATE files SET deleted_at=...` mutation. The current
  `/api/files/:id/delete` **hard-deletes**: unlinks the vault blob, then `DELETE FROM files`.

### 3.2 File versioning — schema missing on postgresql
From the `mssql` migration `2026-10-31-add-file-versioning.sql`, the following do **not
exist** in `postgresql_schema.sql`:

| Object | MSSQL type | PostgreSQL equivalent |
|---|---|---|
| `files.file_name_hash` | `CHAR(64)` | `CHAR(64)` |
| `files.version_count` | `INT NOT NULL DEFAULT 1` | `INT NOT NULL DEFAULT 1` |
| `files.current_version_id` | `UNIQUEIDENTIFIER` | `UUID` |
| `share_links.version_id` | `UNIQUEIDENTIFIER NULL` | `UUID NULL` |
| `file_versions` table | see MSSQL | see mapping §5 |
| `file_version_keys` table | see MSSQL | see mapping §5 |
| Index `IX_files_owner_name_hash` | `(owner_user_id, folder_id, file_name_hash) INCLUDE (status)` | PG index |
| FK `share_links.version_id → file_versions.id` | `NO ACTION` (pin) | PG FK |

`files.deleted_at` already exists, so the soft-delete DDL is **partially done**.

## 4. Code deltas

### 4.1 Counts
- `mssql` `src/server.ts` : **47** references to `file_versions|version_count|file_name_hash`.
- `postgresql` `src/server.ts` : **0**.
- Range delta on `mssql` : `src/server.ts` **+1263 lines** (feature code),
  `user-dashboard.tsx` **+820**, `public-sharing.ts` **+104**.

### 4.2 MSSQL constructs in server.ts that require adaptation
Identified in `mssql:src/server.ts` (versioning + trash):
- `OUTPUT INSERTED.id, ...` at lines 1364, 1647, 2214, 2252, 2552, **3306, 3361**, 4640,
  5043, 5105, 5133, 5228, 5302, 5419, 5470, 5512, 5533, 5576 → **`RETURNING`** in PG.
- `OUTPUT DELETED.folder_id` (5043) → `RETURNING`.
- `NEWID()` (703) → `gen_random_uuid()` / client UUID.
- `UPDATE TOP (@batchSize) files` (2314, 5677) → `UPDATE ... WHERE id IN (SELECT ... LIMIT n)`.
- `DELETE TOP (@batchSize)` (2395, 5761) → subselect + LIMIT.
- `OUTPUT INSERTED.version_no` (4640) → `RETURNING version_no`.
- `OFFSET @offset ROWS FETCH NEXT @batch ROWS ONLY` (backfill script) → `LIMIT/OFFSET`.

### 4.3 Translator — required changes
Option A (preferred, aligned with the existing pattern): handle these constructs in
`translateQuery()` **or** rewrite the specific `server.ts` queries to native PG syntax
(as already done with `RETURNING` in the current upload INSERT, ~line 3078). The branch
already uses native `RETURNING` in the files INSERT. Follow that pattern — convert
`OUTPUT` to `RETURNING` rather than adding `OUTPUT` support to the translator.

## 5. file_versions table mapping (MSSQL → PG)

| Column MSSQL | MSSQL type | PostgreSQL type |
|---|---|---|
| id | UNIQUEIDENTIFIER | UUID PK |
| file_id | UNIQUEIDENTIFIER FK | UUID FK → files(id) CASCADE |
| version_no | INT | INT |
| original_name_encrypted | VARBINARY(2048) | BYTEA |
| original_name_iv | VARBINARY(16) | BYTEA |
| original_name_auth_tag | VARBINARY(16) | BYTEA |
| stored_path | NVARCHAR(1000) | TEXT |
| mime_type | NVARCHAR(255) | VARCHAR(255) |
| size_bytes | BIGINT | BIGINT |
| encrypted_size_bytes | BIGINT | BIGINT |
| status | NVARCHAR(20) | VARCHAR(20) |
| checksum_sha256 | CHAR(64) | CHAR(64) |
| scan_result | NVARCHAR(20) | VARCHAR(20) |
| scan_message | NVARCHAR(MAX) | TEXT |
| is_encrypted | BIT | BOOLEAN |
| client_secret_hash | NVARCHAR(512) | TEXT |
| client_crypto_salt/iv/iterations | VARBINARY/INT | BYTEA/BYTEA/INT |
| created_at | DATETIMEOFFSET(7) | TIMESTAMPTZ |
| deleted_at | DATETIMEOFFSET(7) NULL | TIMESTAMPTZ NULL |
| deleted_by | UNIQUEIDENTIFIER NULL | UUID NULL |
| **UNIQUE** | (file_id, version_no) | UNIQUE (file_id, version_no) |

`file_version_keys` :
| version_id | UNIQUEIDENTIFIER PK/FK | UUID PK/FK → file_versions(id) CASCADE |
| encrypted_key / key_iv / key_auth_tag / file_iv / file_auth_tag | VARBINARY | BYTEA |
| algorithm | NVARCHAR(20) | VARCHAR(20) |
| created_at | DATETIMEOFFSET(7) | TIMESTAMPTZ |

## 6. Scripts & tooling
- `scripts/backfill-file-hashes.ts` (new, +113 lines): backfills `file_name_hash`.
  Uses `dbo.files`, `OFFSET/FETCH`, and `hashColumnForLookup` → requires adaptation.
- `package.json`: new script `backfill:file-hashes`.
- `.env.example`: `TRASH_RETENTION_DAYS=90`.

## 7. Frontend & sharing
- `user-dashboard.tsx` (+820): Trash tab, version dropdown, version history panel.
- `public-sharing.ts` (+104): latest vs pinned version, version download in share.
- `types/index.ts` (+19): `FileVersion`, `version_count`, `file_name_hash`.

## 8. Tests
- The range adds no versioning-specific tests; `tests/` on the postgresql branch has no
  versioning coverage today → coverage gap.
