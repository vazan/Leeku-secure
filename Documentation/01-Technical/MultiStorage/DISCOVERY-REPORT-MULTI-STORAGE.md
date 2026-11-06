---
agent: DocScout | date: 2026-11-06 | model: doc-hub (discovery) | self-score: 8.0/10
---

# DISCOVERY REPORT — MULTI-STORAGE DEVICE SUPPORT
> Scope: current single-path vault storage → planned DB-backed storage pool.
> Mode: read-only discovery of the existing storage implementation (no runtime validation).

## 1) Scope and Method
- Repo: `Leeku-secure-mssql` (branch: `mssql`)
- Focus areas:
  - Current vault path provisioning (env vars + `net use` + UNC monitor)
  - File write / read / delete path (where `FILE_VAULT` and `stored_path` are used)
  - `files` table schema and existing versioning
  - Admin dashboard tabs (`/#dashboard/admin`)
  - Production startup validation
- Exclusions: PostgreSQL branch (this ADR targets the MSSQL branch first), no runtime tests.

## 2) Current Storage Implementation

| Aspect | Evidence (code path) | Notes |
|---|---|---|
| Vault root | `src/server.ts#L100` — `FILE_VAULT = FILE_STORAGE_UNC_PATH \|\| ./vault` | single path constant |
| Profile pictures | `src/server.ts#L103` — `PROFILE_PICTURE_PATH \|\| FILE_VAULT/users` | derives from vault root |
| UNC auto-mount (`net use`) | `src/server.ts#L570-L589` | reads `STORAGE_NET_USE_PATH/USER/PASS` at startup |
| UNC share health monitor | `src/server.ts#L290-L334` — `isUncShareAvailable(FILE_VAULT)` | maintenance-mode toggle on share loss |
| Local vault bootstrap | `src/server.ts#L592-L594` | mkdir if not `\\` UNC |
| Upload write | `src/server.ts#L3287` — `vaultFilePath = path.join(FILE_VAULT, vaultFileName)` | stream-encrypt to vault |
| File delete | `src/server.ts#L2526,2533,3947` — `path.join(FILE_VAULT, file.stored_path)` | single-root assumption |
| Production validation | `src/server/utils/production.ts#L53,L16` | requires `FILE_STORAGE_UNC_PATH` readable+writable |
| Files table | `Documentation/SQL/production_schema.sql#L251` | `files.stored_path` only; no device FK |
| Versioning | `2026-10-31-add-file-versioning.sql` | `file_versions.stored_path` also single-root |

## 3) Admin Dashboard Surface

| Tab (current) | Evidence | Notes |
|---|---|---|
| overview/users/files/quotas/logs/security/health/maintenance | `src/app/features/files/components/admin-workspace.tsx#L7` (`AdminTab` union) | new `storage` tab to be added |

Evidence: the `#dashboard/admin` view is `AdminWorkspace` rendered in
`user-dashboard.tsx` when `view === "admin" && role === "Admin"` (#L3573).

## 4) Env Variables to be Retired

| Env var | Current location | Consumers |
|---|---|---|
| `FILE_STORAGE_UNC_PATH` | `.env.example#L199`, `src/server.ts#L100` | server, production.ts, cleanup-vault-orphans.ts |
| `STORAGE_NET_USE_PATH` | `.env.example#L227` | src/server.ts startup |
| `STORAGE_NET_USE_USER` | `.env.example#L229` | src/server.ts startup |
| `STORAGE_NET_USE_PASS` | `.env.example#L231` | src/server.ts startup |

## 5) Encryption Precedent (for SMB credential encryption)

| Mechanism | Evidence | Fit |
|---|---|---|
| Column encryption (`encryptColumn`, per-column IV + auth tag) | `src/server/utils/encryption.js` | ✅ reuse for SMB user/pass at rest |
| `MASTER_KEY_BASE64` derived sub-keys | README, encryption util | ✅ wrap mechanism |

## 6) Evidence Buckets
- → DocArchitect: server topology, vault/monitor + admin UI seams
- → DocEngineer: `files` / `file_versions` schema, env consumers, encryption util
- → DocOps: deployment impact, `net use` retirement, migration runbook
- → DocRoadmap: phasing of schema → API → UI → env migration

Confidence: High (code-verified paths).
