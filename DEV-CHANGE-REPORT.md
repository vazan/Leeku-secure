---
agent: DevEngineer | date: 2026-11-08 | model: (dev)
plan: /memories/session/dev-plan.md
---

## Intention
Add a **per-device storage quota** to the multi-storage system so admins can
restrict how much data is stored under each storage device (e.g. DATA-00).
When the **primary** device reaches ~90% of its quota, a yellow warning banner
is shown to admins (visible across all admin tabs) suggesting they switch
primary to another device (DATA-01 / DATA-02) in the Storage tab.

## Changement
Classe : STANDARD — additive feature. A new nullable `quota_bytes BIGINT`
column (`NULL` = unlimited, preserving behaviour for all existing devices)
plus enforcement in device selection and an admin-facing warning.

**Backend**
- `storage_devices.quota_bytes` (nullable) added via a new idempotent SQL
  migration and a runtime boot-time schema guard.
- `selectProvisionDevice()`: devices with `quota_bytes` set AND current usage
  `>=` quota are excluded from new-upload selection (fail-closed when all
  enabled reachable devices are over quota). Devices with a NULL quota remain
  unlimited and keep auto-balancing behaviour.
- `StorageDeviceDto` now reports `quota_bytes` and `quota_usage` (usage/quota
  ratio, or `null` when unlimited), consumed by the admin Storage panel and
  the banner.
- `POST /api/admin/storage` accepts `quota_bytes` (GB→bytes conversion done
  client-side); `POST /api/admin/storage/:id` passes it through to update.

**Frontend**
- `StoragePanel`: quota progress bar + usage % per device (turns yellow at ≥90%),
  an "Unlimited" indicator when unset, a `Quota` button to set/clear a device
  cap (prompt in GB), and a quota (GB) field on the "Add storage device" form.
- `AdminWorkspace`: on mount (and re-checked every 60 s) fetches
  `/api/admin/storage`, and if the primary device is ≥90% of its quota shows a
  yellow banner with a shortcut to the Storage tab.

## Fichiers
| Fichier | Raison |
|---|---|
| Documentation/SQL/2026-11-08-add-storage-device-quota.sql | Idempotent migration adding `quota_bytes` + guard constraint |
| src/server/utils/storage-devices.ts | Added `quota_bytes` to types/DTO/SELECT/mapRow/create/update; quota enforcement in `selectProvisionDevice`; `quota_usage` in `toDto` |
| src/server.ts | Accept `quota_bytes` in POST create route; added `ensureStorageDeviceQuotaColumn()` (boot-time idempotent guard) |
| src/app/features/files/components/admin-workspace.tsx | Quota input/display/edit in StoragePanel; yellow banner in AdminWorkspace |
| memories/session/dev-plan.md | Plan for this change |

## Contrats publics impactés
NON (breaking). `StorageDeviceDto` gains two new read-only fields
(`quota_bytes`, `quota_usage`) and the admin storage create/update routes accept
an optional `quota_bytes`; existing clients ignore unknown fields. No change to
status codes or response shapes.

## Risques
Perf/Sécu/Régression/Compat :
- Perf : `selectProvisionDevice` now calls `getStorageDeviceUsage` per device
  that has a quota (one small UNION query per device per upload). Acceptable for
  typical 2–4 device pools. `toDto` already made the same call for usage.
- Sécu : no change — quota is a soft cap on DB-tracked storage; SMB credentials
  remain encrypted and never exposed.
- Régression : devices with `quota_bytes = NULL` keep their exact previous
  behaviour (unlimited, auto-balancing). The boot-time guard + idempotent SQL
  ensure the column exists before any device is seeded/read.
- Compat : existing devices/deployments unaffected until an admin sets a quota.

## Dette observée
MINOR — the quota feature uses a `window.prompt` for editing an existing
device's quota (consistent with the existing `confirm()`-style UX on this
panel, but not as polished as an inline form). Future work could add an inline
edit field.

## Validation
Build: ✅ (esbuild bundles of `storage-devices.ts` and `admin-workspace.tsx` succeed)
Lint: ✅ (`tsc --noEmit` — no new errors; only pre-existing `mssql` module / implicit-any errors remain)
Type-check: ✅ (same as lint)
Smoke: ⚠️ SKIPPED (no running DB/server; SQL migration is idempotent and reviewed)

## Approbation CRITICAL
N/A (STANDARD change — no CRITICAL scope touched).

## Handoff TestEngineer
Surfaces to test:
1. **Quota enforcement** — set a quota on DATA-00; upload until usage meets
   quota; verify new uploads are routed to the next enabled device, and fail
   closed with a clear message when all quota-constrained devices are full.
2. **Unlimited default** — devices with no quota keep receiving uploads.
3. **Quota lifecycle** — create a device with a quota; edit it; clear it back
   to unlimited; verify DTO reflects `quota_bytes`/`quota_usage`.
4. **Yellow banner** — with primary DATA-00 ≥90% quota, admins see the banner
   across all tabs, and it disappears after switching primary or freeing space.

Case boundaries:
- `quota_bytes` validation (0/negative rejected, non-numeric rejected).
- Primary at exactly 90% vs 89.9%.
- All devices full → upload fail-closed with a clear error.
- Migration from a non-full device to a quota-constrained destination.

## Handoff QaEngineer
Resumen validation: STANDARD additive feature; lint/type-check clean (no new
errors), esbuild bundles succeedees. Backend logic reviewed for quota
enforcement and DTO shape. Frontend banner + StoragePanel quota UI verified by
code review; runtime smoke on a live SQL Server + dev server remains
outstanding. Trail approbation: not required (STANDARD).
