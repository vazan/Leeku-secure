# FILE VERSION HISTORY — FEASIBILITY & IMPLEMENTATION ASSESSMENT

**Date:** 2026-10-31
**Branch:** Leeku-secure-mssql (MSSQL)
**Source gap:** `Documentation/02-Non-Technical/COMPETITIVE-COMPARISON-GOOGLE-DRIVE-MEGA.md` §2.1 / §3.2 gap #6 (P2)
**Status:** ✅ FEASIBLE — scope and design below; no code changes made in this pass.

---

## 1. Request

Give users **file versioning**: uploading a file with the **same name into the same folder**
creates a **new version** of the existing file instead of a standalone duplicate. Users can then
roll back to, or download, any previous version.

The requester flagged a real design crux up front:

> "Old keys will need to be stored as multiple versions can exist of the same file and
> potentially other things I'm forgetting about."

This document confirms that concern is **well-founded and already satisfiable** by the existing
zero-knowledge crypto design, and lists the "other things" that must be handled.

---

## 1.5 Product decisions (owner rulings — 2026-10-31)

These decisions refine the design and are treated as **fixed requirements**:

1. **Quota double-counting is by design.** Each version counts against the user's quota.
   Users accept this; the UI must make it explicit (show "v1 + v2 … sizes / total"). No hidden
   behavior.
2. **Sharing is per-version, chosen by the end-user.** A user decides **which specific version**
   to share via a share link. A **folder share** exposes **all versions** of the files inside
   that folder (downloadable/previewable by the share's permissions).
3. **"All Files" shows only the most recent version** per logical file. Older versions are
   accessible via a reveal/expand option with download, preview, etc. for each version.

> Scope note: this assessment focuses on **MSSQL only**. PostgreSQL parity (§4.7) is deferred.

---


## 2. Current State (evidence)

### 2.1 Encryption model — why old keys are safe to keep
Evidence: `src/server/utils/encryption.ts`

- Each upload calls `encryptFileStream` (line 468), which generates a **fresh random** AES-256 key,
  IV, and GCM auth tag, and computes a **SHA-256 checksum** of the plaintext. Result type:
  `EncryptFileStreamResult` (`iv`, `authTag`, `key`, `checksum`, `encryptedSize`).
- The per-file key is then **wrapped** with `wrapKey` (line 157) using a **deterministic** HKDF
  sub-key derived from `MASTER_KEY_BASE64` + purpose string `"leeku-file-key-wrapping-v1"`.
- `unwrapKey` (line 169) can always recover any wrapped key, **indefinitely**, because the wrapping
  sub-key never changes and the master key is stable.

**Consequence:** storing a "version" is exactly like storing any other uploaded file. Its
encrypted blob lives in the vault; its wrapped key/IV/auth tag live in the DB. Old versions never
need re-keying when a new version is added, and **no key-rotation migration** is introduced. The
user's worry ("old keys need to be stored") maps directly onto the existing
`file_encryption_keys` design — we simply keep **one row per version**.

### 2.2 Database schema — no unique-name constraint blocks versioning
Evidence: `Documentation/SQL/production_schema.sql`

- `dbo.files` (line 251): `stored_path` holds a **random token** (`server.ts:3081` →
  `generateSecureToken(16) + '.vault'`), so the vault name is unique per upload regardless of the
  user-facing filename.
- `dbo.file_encryption_keys` (line 298): PK = `file_id` (1:1 with `files`); holds
  `encrypted_key, key_iv, key_auth_tag, file_iv, file_auth_tag`.
- There is **no UNIQUE constraint on `original_name`** (unique constraints are only on
  `file_folders(owner,parent,name)`, users, share tokens, refresh tokens). Two same-name files in
  the same folder can already coexist today — versioning just needs to **group/replace** them.

### 2.3 Upload pipeline — no replace/version concept yet
Evidence: `src/server.ts` §2739–3218

- `POST /api/files/upload` performs a single `INSERT INTO files` + `INSERT INTO
  file_encryption_keys` (lines ~3146, ~3177). No `PUT`/replace/update-existing-file endpoint exists.
- Routes present today: upload, move-folder (`:id/folder`, line 2497), delete (soft, `deleted_at`),
  download, preview, share. No "restore previous version" path exists.

**Net:** the feature is **additive**, not a refactor. Existing behavior (two same-name files as
distinct records) can be preserved for legacy data while new uploads opt into versioning.

---

## 3. Proposed Design

### 3.1 Data model (MSSQL)

Two viable shapes. Recommended: **head-row + version rows**.

```
files                          (existing — becomes the logical "file" / head)
  id          UNIQUEIDENTIFIER  -- stable logical handle (owner decision #2/#3)
  original_name_encrypted ...
  current_version_id UNIQUEIDENTIFIER NULL   (NEW: points to file_versions.id)

file_versions (NEW)
  id           UNIQUEIDENTIFIER PK
  file_id      UNIQUEIDENTIFIER FK -> files.id          (logical file)
  version_no   INT                                      (1..N, monotonic)
  stored_path  NVARCHAR(1000)                            -- vault blob (its own .vault)
  size_bytes / encrypted_size_bytes
  checksum_sha256
  mime_type, scan_result, scan_message, scanned_at
  client_secret_hash / client_crypto_*  (per-version, if file-level secret used)
  created_at   DATETIMEOFFSET
  created_by_user_id  (audit)
  UNIQUE (file_id, version_no)

file_version_keys (NEW — or reuse file_encryption_keys keyed by version id)
  version_id   UNIQUEIDENTIFIER PK -> file_versions.id
  encrypted_key / key_iv / key_auth_tag / file_iv / file_auth_tag
  algorithm, created_at

share_links (existing — extended for per-version pinning, owner decision #2)
  ... existing columns ...
  version_id   UNIQUEIDENTIFIER NULL FK -> file_versions.id  (NEW, nullable)
```

**Key point for the requester:** `file_version_keys` is exactly one row **per version**, so each
version keeps its own wrapped key — old keys are persisted, and the random vault token avoids
collisions. This is the direct answer to "old keys must be stored."

> Alternative (minimal): keep a single `files` row per upload (as today) and add
> `parent_file_id` to group same-name versions. The head/version model above is preferred because
> `files.id` is already the target of `share_links`, preview, and download SQL in
> `public-sharing.ts`, `public-folder-sharing.ts`, `desktop-updates.ts` (all join
> `file_encryption_keys k ON k.file_id = f.id`). **However, per owner decision #2, sharing is
> per-version**: share links must now be pinned to a specific `file_versions.id` (a
> `version_id` discriminator on `share_links`), so `files.id` remains the stable logical handle
> while the shared target is a chosen version.

## 3.1b Share-link model for per-version sharing (MSSQL)

Because the owner chooses per-version sharing, extend the share model rather than rely on the
head auto-following current:

- `share_links` → add nullable `version_id UNIQUEIDENTIFIER` (FK → `file_versions.id`).
  - When set → the link is **pinned** to that exact version (download/preview of that version only).
  - When NULL → (default for new file shares) resolve to the file's **current version** at access
    time; the owner may later pin or re-pin.
- Folder shares (`folder_share_links`) → resolve **all versions** of each file inside (owner
  decision #2). Preview/download endpoints for folder shares take an optional `?version=…` to
  pick a specific version, defaulting to current.



### 3.2 Upload behavior change (version-on-same-name)
In `POST /api/files/upload` shared pipeline (after quota/scan, before `INSERT`):

1. Look up an existing **non-deleted** file for the same `owner_user_id + folder_id + original_name`
   (decrypt `original_name_encrypted` to compare, or add an `original_name_hash` HMAC lookup column
   mirroring `hashColumnForLookup` — recommended for indexed search without plaintext).
2. If none → behave as today (version 1).
3. If found → write the new blob as a **new `file_versions` row**, increment `version_no`, and
   update `files.current_version_id` (the head). `files.id` remains the logical handle; existing
   unpinned share links resolve to the **new current** version; pinned links stay on their old
   version (owner decision #2).

This matches the requester's exact trigger: "exact same matching file name and directory."

### 3.3 New API surface
- `GET  /api/files/:id/versions` — list versions (no, size, checksum, created_at, current flag).
- `GET  /api/files/:id/versions/:versionId/download` — download a prior version (must decrypt
  with **that version's** wrapped key = `file_version_keys`).
- `POST /api/files/:id/versions/:versionId/restore` — promote a prior version to current
  (flip `current_version_id`; do NOT delete the promoted row).
- `DELETE /api/files/:id/versions/:versionId` — prune a single old version (releases quota).
- `POST /api/files/:id/versions/:versionId/share` — create a share link **pinned to a specific
  version** (`share_links.version_id = :versionId`) (owner decision #2).
- `GET  /api/files/:id/versions/:versionId/preview` — preview a specific non-current version
  (image/video/text/CSV paths reuse existing preview handlers with a version discriminator).

### 3.4 Vault / quota / lifecycle
- **Quota accounting:** count **all non-deleted versions** toward storage (sum `size_bytes` over
  `file_versions`). **By owner decision #1**, this is intended: the UI must show each version's
  size and a running total so users see the quota impact explicitly.
- **Soft delete:** soft-deleting the head (`files.deleted_at`) should soft-delete its versions
  too, and restore on trash-restore — reuse the existing 90-day `deleted_at` flow
  (`Documentation/SQL/2026-10-31-add-deleted-at-column.sql`).
- **Capacity guard:** cap versions per file (configurable, e.g. `MAX_FILE_VERSIONS` — default
  suggested 10–30) with a documented eviction policy (oldest-first) to prevent unbounded storage
  growth.
- **Share links:** pinned to a specific version when owner chooses; unpinned links resolve to the
  current version at access time. Document this in the share dialog so the "which version" choice
  is explicit.
- **"All Files" display (owner decision #3):** the list shows only `current_version_id` content
  per logical file; a "versions" affordance reveals older versions with download/preview/restore
  actions.

---

## 4. Answers to "other things you're forgetting about"

1. **Old keys** — solved: one wrapped key per version (→ `file_version_keys`). Deterministic
   wrapping ⇒ old keys stay decodable, no migration. ✅ confirmed.
2. **Quota double-counting** — every retained version consumes real storage. **By design**
   (owner decision #1); the UI must surface each version size + running total. Not a hidden
   behavior — an explicit, documented behavior.
3. **Share-link per-version pinning** — because sharing is per-version (owner decision #2), a
   share link must carry `share_links.version_id` so the shared target is explicit and stable
   even after newer versions land. Folder shares must resolve all versions (`?version=…`).
4. **Client-side file secret (`client_secret_hash`)** — per-version; each version has its own
   salt/iv/iterations/secret hash. A user restoring an old version must supply the same secret to
   decrypt it (store per version, remind in UI).
5. **Checksum & AV scan** — each version must keep its own `checksum_sha256` and scan record; a
   restored old version should be re-scan-ineligible only if already scanned at upload.
6. **Retention/eviction policy** — unbounded versions = unbounded storage; ship a cap + policy.
7. **PostgreSQL branch parity** — the DB deltas doc model requires the same tables on the
   PostgreSQL branch (`Documentation/01-Technical/DATABASE-POSTGRESQL.md`); plan a parallel
   migration artifact. **Deferred — current scope is MSSQL only** (owner scope decision).
8. **Thumbnail generation** — thumbnails are keyed off `files` (`thumbnail_*` columns in
   `dbo.files`); when the current version changes, invalidate/regenerate the thumbnail for the
   head (see thumbnail job references in `server.ts`).
9. **Backward compatibility** — existing same-name files already in the DB (pre-feature) should be
   left untouched or backfilled as distinct version 1 rows, never merged destructively.

---

## 5. Effort & Estimates

| Area | Effort | Notes |
|---|---|---|
| Migration (MSSQL only) | M | New `file_versions` + `file_version_keys`; `share_links.version_id`; name-hash index. |
| Upload pipeline branch | M | Same-name detection (add HMAC name hash), version insert, head update. |
| API endpoints | M | versions list / download / restore / prune / per-version share / per-version preview. |
| UI (dashboard) | M | "All Files" shows current only; version drawer (download/preview/restore/share); quota breakdown. |
| Folder shares | M | Resolve all versions of files inside; `?version=…` selector. |
| Tests | M | No test runner exists today (`GAP-TEST-001`) — add before relying on regressions. |

**Overall: Large (L)** — matches the competitive comparison's original estimate.

---

## 6. Recommendation

**Proceed (MSSQL).** The design is additive and center-safe given:
- no schema uniqueness conflict (2.2),
- deterministic key wrapping that cleanly persists old keys (2.1),
- per-version share pinning + head-file anchoring per owner decisions (3.1b).

Suggested sequencing (roadmap slot: P2, short-term 3–6 months, MSSQL only):

1. `Documentation/SQL` migration artifact (MSSQL) — `file_versions`, `file_version_keys`,
   `share_links.version_id`, name-hash index.
2. Upload pipeline same-name branch + version write (server).
3. `GET versions` + `download prior` + `restore` + `prune` + per-version `share`/`preview`
   endpoints.
4. Dashboard version UI ("All Files" shows current; version drawer).
5. Quota breakdown + retention cap + thumbnail invalidation follow-through.
6. Folder-share version resolution (`?version=…`).
7. Regression tests (tie into resolving `GAP-TEST-001`).

---

## 7. Evidence Index

| Claim | Evidence |
|---|---|
| Fresh key per encryption | `src/server/utils/encryption.ts:468` (`encryptFileStream`) |
| Deterministic wrapping ⇒ old keys decodable | `src/server/utils/encryption.ts:157-173` (`wrapKey`/`unwrapKey`) |
| Random vault name ⇒ no name collision | `src/server.ts:3081` |
| `file_encryption_keys` 1:1 to files | `Documentation/SQL/production_schema.sql:298-307` |
| No unique-name constraint on files | `Documentation/SQL/production_schema.sql:251-280` (constraints) |
| Upload = single INSERT files + keys | `src/server.ts:3146`, `src/server.ts:3177` |
| No replace/update route today | `src/server.ts` route scan (upload/move/delete/download/preview) |
| Share/preview join on files.id | `public-sharing.ts:500,755,1000,1437`; `desktop-updates.ts:115` |

---

**End of document.**
