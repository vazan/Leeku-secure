# DocArchitect — Migration Architecture : Soft-deletion & File versioning (MSSQL → PostgreSQL)

> Owner: DocArchitect | date: 2026-10-31 | input: `DISCOVERY_REPORT.md`, `GAP_MANIFEST.md`

## 1. Objective & constraints

Port soft-deletion + file versioning from `mssql` to `postgresql` while keeping the two
branches behaviorally equivalent)Skip. Constraint: the `postgresql` branch keeps an
`mssql`-like query API over `pg` via `src/server/db.ts` (`translateQuery`), and queries
today are written in a hybrid MSSQL-flavored dialect that is transpiled at runtime.

## 2. Architectural options considered

### Option A — Extend `translateQuery` to cover the missing MSSQL constructs
Add rules for `OUTPUT INSERTED/DELETED → RETURNING`, `NEWID() → gen_random_uuid()`,
`UPDATE/DELETE TOP (n)` and `OFFSET ... FETCH NEXT`.
- Pros: single source of truth, portable SQL, minimal churn in migrated `server.ts`.
- Cons: `OUTPUT`/`RETURNING` transpilation is regex-fragile (multi-line column lists,
  `OUTPUT DELETED`, `OUTPUT INSERTED.version_no`); the existing codebase already avoids
  this by writing native `RETURNING` in hot paths (upload INSERT ~line 3078).

### Option B — Rewrite the migrated queries to native PostgreSQL in `server.ts` (chosen)
Keep the `@param`/`sql.*` input layer (already DB-agnostic) but write the query bodies
in native PG dialect with `RETURNING` and PG pagination, matching the existing upload
INSERT pattern.

- **CHOSEN.** Rationale:
  1. Matches the established convention in `postgresql/src/server.ts` (native `RETURNING`).
  2. Avoids regex fragility in the translator for the many `OUTPUT` forms.
  3. The `@param` layer and `sql.*` type descriptors remain identical, so the diff is
     scoped to query text only, keeping the mssql→pg symmetry reviewable.
- Net effect: the same `server.ts` code migrated, with `OUTPUT INSERTED.*` → `RETURNING *`
  (or explicit column list), `NEWID()` → `gen_random_uuid()`, `UPDATE/DELETE TOP` → LIMIT
  subqueries, `OFFSET ... FETCH NEXT` → `LIMIT/OFFSET`.

### Option C — New translator module + keep all MSSQL text
Not recommended: two translation layers to maintain, harder parity validation.

## 3. Component design

```
postgresql/src/server.ts
  └─ db.ts (sql.* types)      ── unchanged API, minor additions if needed
  └─ routes (upload, trash, versions, sharing)
       • Upload path: same-name detection via file_name_hash → archive current → new version
       • Trash path: soft-delete (deleted_at), trash list, restore, purge job
       • Versions path: list / download / restore / soft-delete / purge version
  └─ scripts/backfill-file-hashes.ts  (pg-native pagination)
```

PostgreSQL schema additions (see DocEngineer DDL): `files` +3 columns, `share_links`
+1 column, `file_versions` + `file_version_keys` tables, indexes, FKs.

## 4. ADRs

### ADR-1 : `RETURNING` over translator expansion (Option B)
- Decision: native `RETURNING` in migrated queries.
- Consequence: migrated query text diverges from `mssql` at `OUTPUT` sites — parity is
  validated by behavior, not byte-equality.
- Revisit: if a future feature adds many `OUTPUT` sites, reconsider Option A.

### ADR-2 : Soft-delete keeps vault blob on disk
- Trash moves = `UPDATE files SET deleted_at=...`; blob stays until purge job runs after
  `TRASH_RETENTION_DAYS`. Storage already released from quota at trash time (mssql behavior).
- Revisit: none; mirrors mssql.

### ADR-3 : `file_versions.deleted_at/deleted_by` for per-version trash
- Soft-deleted archived versions kept (blob + key) and recoverable, matching mssql.

### ADR-4 : FK `share_links.version_id → file_versions(id)` NO ACTION
- A share link can pin a specific version; pin must be cleared before version purge.
- Consequence: version-delete endpoints must NULL out `share_links.version_id` first.

## 5. Sequencing & dependencies

1. **Schema DDL** (DocEngineer) — hard dependency for all code. `G-01..G-09`.
2. **Backend** (upload → trash → versions → sharing). `G-10..G-19`.
3. **Scripts/config**. `G-24..G-26`.
4. **Frontend**. `G-20..G-23`.
5. **Tests**. `G-27..G-28`.

Parallelizable: {schema} then {backend + scripts} then {frontend} then {tests}.
Backend trash(G-10/11) and versioning(G-12..14) are independent after schema lands.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Regex fragility avoided but manual `RETURNING` errors | Review each `OUTPUT` site against behavior; parity table (DocEngineer §5) |
| Same-name detection needs `file_name_hash` backfill before new versions work | Run backfill script as part of migration (runbook) |
| FK pin blocks version purge | Endpoints clear `share_links.version_id` before purge (ADR-4) |
| Trash purge job missing on pg | Port `startTrashPurge` behind env flag |
