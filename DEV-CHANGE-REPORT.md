---
agent: DevEngineer | date: 2026-11-16 | model: dev (patchwork)
plan: /memories/session/dev-plan-per-user-default-device.md
---

# DEV-CHANGE-REPORT — Per-User Default Storage Device

## Intention
Add an optional per-user default storage device (`users.preferred_storage_device_id`).
When set, the user's NEW uploads provision exclusively to that device (fail-closed);
when NULL, the user falls back to server-wide default provisioning. Admin-only
management; on assignment, the user's existing blobs auto-migrate to the new device.

## Changement
Classe : **CRITICAL** — DB schema change on a core table (`dbo.users`) + upload
routing change + a new admin mutation endpoint (admin-only) with an audit trail.
This is the highest-risk class per the project's convention (DB + provisioning).

## Fichiers
| Fichier | Raison |
|---|---|
| `Documentation/SQL/2026-11-16-add-user-preferred-storage-device.sql` | New idempotent migration: column + FK `ON DELETE SET NULL` + index |
| `src/server/utils/storage-devices.ts` | Service layer: `getUserPreferredStorageDevice`, `selectProvisionDeviceForUser` (fail-closed) |
| `src/server.ts` | Boot guard `ensureUserPreferredStorageColumn` + `bootstrap()` call; upload routing override; new `PUT /api/admin/storage/users/:userId/device`; extended `GET /api/admin/storage/users` |
| `src/app/features/files/components/admin-workspace.tsx` | Admin `StoragePanel`: preferred-device column with per-user set/clear control |
| `tests/storage-migration.test.ts` | Extended harness: preferred-select, NULL fallback, fail-closed cases, auto-migrate FK-target verification |
| `Documentation/01-Technical/MultiStorage/DESIGN-SPEC-MULTI-STORAGE.md` | Provisioning override design + invariants |
| `Documentation/01-Technical/MultiStorage/DB-AND-API-MULTI-STORAGE.md` | `users` column DDL + new API route in the endpoint table |
| `Documentation/01-Technical/API-REFERENCE.md` | New PUT route documented |
| `Documentation/01-Technical/API-CONTRACT-CANONICAL.md` | Admin storage endpoints description extended |
| `memories/session/dev-plan-per-user-default-device.md` | Status-per-phase updated |

## Contrats publics impactés
**OUI.**

- **New column** `dbo.users.preferred_storage_device_id UNIQUEIDENTIFIER NULL`
  (FK → `storage_devices(id)` `ON DELETE SET NULL`; index `IX_users_preferred_storage`).
- **New admin endpoint** `PUT /api/admin/storage/users/:userId/device`:
  - Body `{ device_id }` (set) or `{ device_id: null }` (clear).
  - On set: updates the column, kicks off background auto-migrate of the user's
    existing blobs to the device, returns `{ success, preferred_storage_device_id, migrated, job_id?, status }`.
  - On clear: sets column NULL, no data movement, returns `{ migrated: false }`.
  - Audit-logged via `logSystemEvent`.
- **Extended response** `GET /api/admin/storage/users` now includes
  `preferredDeviceId` (string | null) per user.
- **New service behavior** `selectProvisionDeviceForUser(devices, userId)`:
  fail-closed — throws (clear error) when the user's preferred device is not
  provisioning-enabled, quota-exceeded, or unreachable. It never silently falls
  back to the global default.
- **Upload behavior** (Phase C): new uploads for a user with a preference route
  to that device; users without a preference are unchanged (`selectProvisionDevice`
  untouched = no regression for the NULL/global path).

## Risques
- **Perf**: minimal — `getUserPreferredStorageDevice` is one indexed lookup per
  upload; `selectProvisionDeviceForUser` adds quota/reachability checks only on
  the single preferred device)Skip.
- **Sécu**: admin-gated mutation (`verifyAdmin`); parameterized SQL throughout
  (no interpolation); device id validated against registry; audit trail via
  `logSystemEvent`.
- **Régression**: NULL preference path is unchanged; `selectProvisionDevice`
  left untouched. Auto-migrate reuses the existing atomic `moveUserFiles` +
  job registry (unchanged).
- **Compat**: pre-existing TrashedFileRow `tsc` error is untouched (accepted);
  build succeeds. Multi-source auto-migrate is an enhancement over the
  single-source plan assumption (handled correctly, noted in Dette).
- **Concurrency**: assigns the FK preference BEFORE kicking off auto-migrate, so
  uploads during migration already target the preferred device (consistent with
  plan's sequencing guidance).

## Dette observée
- **MAJOR** — `src/server.ts` around `TrashedFileRow` has a pre-existing
  `tsc` error (`storage_device_id` on `TrashedFileRow`) that predates this change.
  Not introduced here; flagged for a follow-up fix.
- **MINOR** — E2 (user-facing read-only indicator of which device holds data)
  is deferred: there is no small/clean existing user surface for device info;
  adding a dedicated indicator exceeds the "small, clean" scope allowed by the
  plan. Recommend QA/product confirm before adding.
- **MINOR** — `getStorageDeviceUsage` is queried separately per upload when a
  preferred device has a quota; could be cached, but correctness is preserved.

## Validation
Build: ✅  Lint/Type-check: ⚠ (only the 1 pre-existing `TrashedFileRow` error —
  0 NEW errors)  Smoke: ✅ (storage-migration 14/14) | test:all 32/33 (the 1
  failure is the pre-existing `syntax-preview.test.ts` loader
  `ERR_UNKNOWN_FILE_EXTENSION`, unrelated).

- `npm run lint` → `tsc --noEmit`: only pre-existing `src/server.ts(7291,57)`
  `TrashedFileRow` error (present on HEAD, untouched by this change).
- `npm run test:storage-migration` → 14/14 pass (8 original + 6 new).
- `npm run test:all` → 32 pass, 1 fail (pre-existing `syntax-preview` loader issue).
- `npm run build` → ✅ (vite + esbuild server bundle succeed; `import.meta`
  warning is pre-existing).

## Approbation CRITICAL
**GO de midorica 2026-11-16**: "validations on my end appears to be positive";
confirmed fail-closed upload block + actionable error when the assigned device is
disabled, and that new uploads route to the assigned storage. Human sign-off for
this CRITICAL-class change (DB schema on a core table + upload routing) recorded.

## Handoff TestEngineer
- Surface to test: new upload routing per-user override (preferred vs. NULL),
  fail-closed error paths (disabled/full/unreachable device), auto-migrate on
  set (background job + progress polling + FK targets), clear = no data movement.
- Existing `moveUserFiles` regression suite remains green (14/14).
- Gap: no automated test for the HTTP route layer (`PUT .../device`) or the
  `GET /api/admin/storage/users` `preferredDeviceId` field — recommend an
  integration/e2e test against a live SQL Server + temp-dir devices.

## Handoff QaEngineer
- Validation complete per above: build ✅, type-check only pre-existing errors,
  storage-migration 14/14. New unit coverage for the per-user provisioning
  selection and fail-closed behavior.
- State of approbation: CRITICAL — **not yet approved**; awaiting human/QA GO
  before merge/deploy. E2 (user-facing read-only indicator) deferred — flag for
  product decision.
