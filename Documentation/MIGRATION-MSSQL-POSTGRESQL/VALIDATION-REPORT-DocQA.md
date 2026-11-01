# VALIDATION-REPORT-DocQA — Migration MSSQL → PostgreSQL (soft-deletion & file versioning)

> Owner: DocQA | date: 2026-10-31 | audit of `Documentation/MIGRATION-MSSQL-POSTGRESQL/`
> Scope: DocArchitect (ARCHITECTURE.md) · DocEngineer (ENGINEER-SCHEMA-PARITY.md) ·
> DocOps (OPS-RUNBOOK.md) · DocScout (DISCOVERY_REPORT.md, GAP_MANIFEST.md)

## Criteria

| Criterion | Weight | Score | Notes |
|---|---|---|---|
| Accuracy / evidence | 30% | 9.0 | Line refs cross-checked against `mssql:src/server.ts` (e.g. OUTPUT at 3306/3361, NEWID 703, UPDATE/DELETE TOP 2314/2395/5677/5761, OFFSET 5710), `postgresql_schema.sql` (deleted_at 179, client_secret_hash 180). Purge job at mssql server.ts:6055-6088 verified. |
| Completeness | 25% | 9.0 | All 28 GAP_MANIFEST items mapped to an artifact (DDL / change list / parity / runbook / tests). |
| Consistency | 15% | 8.5 | DDL ↔ parity table ↔ runbook aligned. One wording redundancy fixed during audit (versions endpoints). |
| Usability / actionability | 20% | 9.0 | Idempotent DDL, ordered runbook with smoke tests, endpoint list, rollback steps — directly executable. |
| Hard gates | 10% | 10.0 | No secrets/PII. Profile + audience present in generation summary. Unverified items labelled (ADR-1 parity by behavior; DDL NOT_RUN on a live DB). |
| **Weighted total** | | **9.0 / 10** | |

## Findings

### Passed
- Gap coverage 28/28 across the suite.
- Schema DDL is PostgreSQL-idiomatic and idempotent, consistent with `postgresql_schema.sql`
  style (BYTEA/uuid/timestamptz, `IF NOT EXISTS`, DO blocks for FK).
- Conversion table (OUTPUT→RETURNING, NEWID→gen_random_uuid, TOP/OFFSET) matches the
  discovered MSSQL constructs and the chosen Option B architecture.
- Runbook orders schema → backfill → deploy → smoke, with rollback.

### Minor / non-blocking
- N/A. All findings during audit were resolved in-line (endpoint list precision,
  redundant trash-version row removed).

### NOT_RUN / NOT_VERIFIED (documented, not fabricated)
- `Documentation/SQL/2026-10-31-postgresql-file-versioning.sql` is provided as DDL in the
  doc but the file itself is not yet written to `Documentation/SQL/` — DocEngineer target.
- No live PostgreSQL execution of the DDL; parity is by code reading (ADR-1).
- Backfill/purge runtime behaviour on PG not executed in this audit.

## Verdict
**PASS (9.0/10)** — above the ≥ 7.0 gate inside a single review; no rework required.
