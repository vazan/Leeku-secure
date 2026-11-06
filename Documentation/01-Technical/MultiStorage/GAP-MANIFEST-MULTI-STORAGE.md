---
agent: DocScout | date: 2026-11-06 | model: doc-hub (discovery)
---

# GAP MANIFEST — MULTI-STORAGE DEVICE SUPPORT

## Priority Model
- P1: blocking to implement the design safely.
- P2: important for operational robustness and auditability.
- P3: quality / maintainability.

## Gaps (current single-path storage → multi-storage pool)

| ID | P | Description | Propriétaire | Evidence |
|---|---|---|---|---|
| GAP-MS-001 | 1 | Single `FILE_VAULT` constant assumed at every write/delete (`path.join(FILE_VAULT, stored_path)`); no device resolution layer | DocArchitect + DocEngineer | ✅ CONFIRMED `src/server.ts#L100,L2081,L2526,L3287,L3947` |
| GAP-MS-002 | 1 | `files` schema has no storage-device FK; blob location not derivable per device | DocArchitect + DocEngineer | ✅ CONFIRMED `production_schema.sql#L251` |
| GAP-MS-003 | 1 | SMB credentials only via env (`STORAGE_NET_USE_*`); no encrypted-at-rest device registry | DocOps + Security | ✅ CONFIRMED `.env.example#L227-L231`, `src/server.ts#L570` |
| GAP-MS-004 | 2 | Admin UI has no storage-device management surface (add / set primary / provision toggle) | DocEngineer + DocArchitect | ✅ CONFIRMED `admin-workspace.tsx#L7` (tab union) |
| GAP-MS-005 | 2 | Production startup validation hard-requires `FILE_STORAGE_UNC_PATH`; must become DB-backed with at least one enabled device | DocOps | ✅ CONFIRMED `production.ts#L16,L53` |
| GAP-MS-006 | 2 | UNC share loss currently flips global maintenance mode tied to the single path; multi-device needs per-device health + only-fail-device routing | DocOps + DocArchitect | ✅ CONFIRMED `src/server.ts#L290-L334` |
| GAP-MS-007 | 2 | `file_versions` schema stores `stored_path` without device id — version blobs must also be resolvable | DocEngineer | ✅ CONFIRMED `2026-10-31-add-file-versioning.sql` |
| GAP-MS-008 | 3 | Retiring `.env` vars requires a migration runbook (seed initial device, backfill existing files, dotenv first-wins pitfall) | DocOps | ⚠️ INFERRED from `memories/session/dev-plan.md` dotenv note |
| GAP-MS-009 | 3 | No defined auto-balancing algorithm (free-space vs round-robin) documented for provisioning new uploads | DocArchitect | ⚠️ INFERRED (design decision requested) |

## Déclencheur DocRoadmap : OUI — dependency-heavy, multi-phase (schema → service → API → UI → env migration), > 5 P1/P2 gaps.

## Couverture
Architecture: 3/3 | Engineering: 3/3 | Ops: 3/3
Total — P1: 3 | P2: 4 | P3: 2
