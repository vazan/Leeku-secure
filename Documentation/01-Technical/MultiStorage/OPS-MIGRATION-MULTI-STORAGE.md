---
agent: DocOps | date: 2026-11-06 | model: doc-hub (ops lens) | self-score: 8.0/10
---

# OPS & MIGRATION — MULTI-STORAGE DEVICE POOL

> Companion to ADR-0001. Deployment, migration and retirement runbook (MSSQL).

## 1. Migration Runbook (single vault → pool)

Order matters. Do **not** flip code before data is ready.

### Step 1 — Schema (forward-compatible)
```sql
-- create storage_devices (see DB-AND-API-MULTI-STORAGE.md §1)
-- ALTER files + file_versions add nullable storage_device_id + FKs
```
Run in a maintenance window. Existing `FILE_STORAGE_UNC_PATH` value is
captured for seeding.

### Step 2 — Seed initial device
- Insert one `storage_devices` row:
  - `storage_id` = e.g. `DATA-00`
  - `storage_path` = legacy `FILE_STORAGE_UNC_PATH` value (e.g. `\\TRUENAS\hyperv_storage`)
  - encrypted SMB creds from `STORAGE_NET_USE_USER` / `STORAGE_NET_USE_PASS`
    (or `NULL` if pre-mapped service account)
  - `provisioning_enabled = 1`, `is_primary = 1`

### Step 3 — Backfill existing rows
```sql
UPDATE files       SET storage_device_id = @seedId WHERE storage_device_id IS NULL
UPDATE file_versions SET storage_device_id = @seedId WHERE storage_device_id IS NULL
```
Then `ALTER ... SET NOT NULL` on both FKs and add the device index.

### Step 4 — Deploy code
- Shipping the engine-side changes + Storage tab.
- New uploads now use the balancer; legacy rows resolve via seed device.

### Step 5 — Retire env vars
- Remove `FILE_STORAGE_UNC_PATH`, `STORAGE_NET_USE_*` from `.env`.
- Remove the boot-time `net use` block.
- Keep `PROFILE_PICTURE_PATH` decision: point at the primary device root, or
  make profile pictures device-aware in a follow-up.

## 2. Env Retirement Matrix

| Env var | Retire? | Replacement |
|---|---|---|
| `FILE_STORAGE_UNC_PATH` | ✅ remove | `storage_devices.storage_path` (seeded) |
| `STORAGE_NET_USE_PATH` | ✅ remove | per-device `net use` via service |
| `STORAGE_NET_USE_USER` | ✅ remove | `storage_devices.smb_username_encrypted` |
| `STORAGE_NET_USE_PASS` | ✅ remove | `storage_devices.smb_password_encrypted` |
| `PROFILE_PICTURE_PATH` | ⚠️ review | derive from primary device or new per-device profile bucket |
| `UNC_SHARE_HEALTHCHECK_INTERVAL_MS` | keep | now drives per-device monitor |

> ⚠️ dotenv first-wins pitfall (memories/session/dev-plan.md): if duplicates
> exist in `.env`, dotenv keeps the first. During Step 5 remove both the old
> vars and any stale duplicates.

## 3. Operational Procedures

### Add a new device (runtime, no code deploy)
1. Provision the share / disk on the storage host (e.g. `P:\DATA-00\` or new SMB share).
2. In `/#dashboard/admin` → Storage → **Add device**: enter `storage_id`,
   `storage_path`, SMB creds (encrypted at rest), enable provisioning.
3. If desired, **Set primary**. The balancer picks it for new uploads
   (primary first; otherwise most free space among enabled devices).

### Replace primary
- Set the new device as primary in the Storage tab → the old device is
  un-set, remains enabled for reads of existing blobs. No upload downtime.

### Device outage / disk full
- The per-device monitor marks the device offline / below watermark.
- Balancer skips it; new uploads go to the next enabled device.
- Existing blobs on the device still stream (read path resolves by FK).
- Admin sees per-device status in the Storage tab.

### Remove a device (read-only decommission)
- DELETE is refused while `files`/`file_versions` reference it. An admin must
  first migrate/archive those blobs (follow-up re-homing tool), then delete.

## 4. Start-up Validation (production)
- `validateProductionConfig()` drops `FILE_STORAGE_UNC_PATH` and instead
  asserts: at least one `storage_devices` row with `provisioning_enabled=1`
  and reachable root.
- Boot if none → fail fast with actionable message (no silent single-path path).

## 5. Backup / Restore implications
- `storage_devices` is a regular table → included in DB backups.
- SMB credential ciphertext is DB-backed, so the existing DB backup/restore
  posture now covers device creds too (no separate secret store).
- Blob migration (device→device) must be coordinated with `files.storage_device_id`
  updates (transactional: update FK + move blob + verify).
