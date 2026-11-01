# GAP_MANIFEST — Migration MSSQL → PostgreSQL (soft-deletion & file versioning)

> DocHub / DocScout | date: 2026-11-01 (ALL 28 gaps DONE — Milestones A-E incl. docs G-26 and tests G-27/G-28)
> Priority: P1 = blocks the feature, P2 = required, P3 = hygiene.
> Status legend: OPEN / PLAN / DONE

## A. Schema (database)

| # | Gap | Priority | Status | Owner |
|---|---|---|---|---|
| G-01 | `files.file_name_hash CHAR(64)` + index on `(owner_user_id, folder_id, file_name_hash)` | P1 | DONE (DDL authored & validated) | DB engineer |
| G-02 | `files.version_count INT NOT NULL DEFAULT 1` | P1 | DONE (DDL authored & validated) | DB engineer |
| G-03 | `files.current_version_id UUID` (reserved) | P2 | DONE (DDL authored & validated) | DB engineer |
| G-04 | `share_links.version_id UUID` + FK → `file_versions(id)` NO ACTION | P1 | DONE (DDL authored & validated) | DB engineer |
| G-05 | `file_versions` table (23 cols, UNIQUE(file_id, version_no)) | P1 | DONE (DDL authored & validated) | DB engineer |
| G-06 | `file_version_keys` table (7 cols, PK version_id, FK cascade) | P1 | DONE (DDL authored & validated) | DB engineer |
| G-07 | `file_versions.deleted_at` / `deleted_by` (soft-delete per version) | P1 | DONE (DDL authored & validated) | DB engineer |
| G-08 | `files.deleted_at` present but **purge/retention** DDL absent (no `TRASH_RETENTION_DAYS`) | P1 | DONE (scan index + purge job G-11 + env G-25) | DB engineer |
| G-09 | PostgreSQL migration file (`Documentation/SQL/2026-10-31-postgresql-file-versioning.sql`) consistent with the SQL folder — **[written & validated on PG 16]** | P1 | DONE (schema applied) | DB engineer |

## B. Backend code (`src/server.ts` + `db.ts`)

| # | Gap | Priority | Status | Owner |
|---|---|---|---|---|
| G-10 | Soft-delete mutation: replace hard `DELETE FROM files` with `UPDATE files SET deleted_at=...` in `/api/files/:id/delete` and bulk delete | P1 | DONE (commit 740eb58) | Backend engineer |
| G-11 | Trash list + restore endpoints (`GET /api/files/trash`, restore) and `TRASH_RETENTION_DAYS` purge job | P1 | DONE (commit 740eb58) | Backend engineer |
| G-12 | Upload version-detection: `file_name_hash` same-name/same-folder check; archive current blob → `file_versions`/`file_version_keys` before writing new version | P1 | DONE (commit 740eb58) | Backend engineer |
| G-13 | Version endpoints: list, download specific, restore, soft-delete version, purge version | P1 | DONE (commit 740eb58) | Backend engineer |
| G-14 | Share links `version_id` pinning + latest-vs-pinned resolution in public-sharing | P1 | DONE (commit 740eb58) | Backend engineer |
| G-15 | Convert MSSQL `OUTPUT INSERTED/*DELETED` → `RETURNING` in all migrated queries | P1 | DONE (commit 740eb58) | Backend engineer |
| G-16 | Convert `NEWID()` → `gen_random_uuid()` / client UUID | P2 | DONE (client `crypto.randomUUID()` already used; no `NEWID()` remains) | Backend engineer |
| G-17 | Convert `UPDATE TOP (@n)` / `DELETE TOP (@n)` batch patterns → LIMIT subselects | P2 | DONE (no `TOP` patterns remain; translator handles `SELECT TOP`) | Backend engineer |
| G-18 | Convert backfill `OFFSET ... ROWS FETCH NEXT` to PG pagination | P1 | DONE (native `LIMIT/@OFFSET` in `scripts/backfill-file-hashes.ts`) | Backend engineer |
| G-19 | Decide translator expansion vs native rewrite for the above (recommend native `RETURNING`, matching existing pattern) | P2 | DONE (ADR-1 Option B: native `RETURNING` chosen) | Backend engineer |

## C. Frontend

| # | Gap | Priority | Status | Owner |
|---|---|---|---|---|
| G-20 | Trash tab + version history UI in `user-dashboard.tsx` | P1 | DONE (Milestone C) | Frontend engineer |
| G-21 | Version dropdown / hide-versions-when-single rule (`version_count > 1`) | P2 | DONE (Milestone C) | Frontend engineer |
| G-22 | Sharing UI for versioned files + download-specific-version | P2 | DONE (Milestone C) | Frontend engineer |
| G-23 | Types: `FileVersion`, `version_count`, `file_name_hash` in `types/index.ts` | P1 | DONE (Milestone B types landed with 740eb58) | Frontend engineer |

## D. Scripts / config

| # | Gap | Priority | Status | Owner |
|---|---|---|---|---|
| G-24 | Port `scripts/backfill-file-hashes.ts` (pg + native pagination) + `backfill:file-hashes` npm script | P1 | DONE (commit 740eb58, verified on dev) | Backend/DevOps |
| G-25 | Add `TRASH_RETENTION_DAYS=90` to `.env.example` | P2 | DONE (commit 740eb58) | DevOps |
| G-26 | Update `DEV-CHANGE-REPORT.md` / SQL `README.md` / `QUERIES-REFERENCE.md` on postgresql | P2 | DONE (commit — DEV-CHANGE-REPORT entry, README versioning section, PG-dialect QUERIES-REFERENCE.md) | DocEngineer |

## E. Tests / quality

| # | Gap | Priority | Status | Owner |
|---|---|---|---|---|
| G-27 | No versioning/trash tests on postgresql branch → add regression coverage | P2 | DONE (tests/trash-purge.test.ts — purge cycle, retention, failure isolation; npm `test:trash-purge`) | QA/TestEngineer |
| G-28 | `translateQuery` unit tests for any new conversion (RETURNING/NEWID/pagination) | P2 | DONE (tests/translate-query-versioning.test.ts — CAST(@x AS uuid), RETURNING pass-through, versioning/trash queries; npm `test:translate-query-versioning`) | QA/TestEngineer |

## Summary
- **Total gaps: 28** (P1: 17, P2: 11).
- **Completed: 28/28** — ALL gaps are DONE and validated (schema, backend, frontend,
  scripts/config, docs, and tests). The migration is feature-complete on `postgresql`.
- **Remaining: 0**. Recommended execution order A → B → D → C → E has been followed; the
  schema remains the hard dependency for the code and all layers are now landed.
- **Recommended execution order**: A (schema DDL) → B (backend) → D (scripts/config)
  → C (frontend) → E (tests). The schema is the hard dependency for everything else.
