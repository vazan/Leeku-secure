---
agent: DocArchitect | date: 2026-11-06 | model: doc-hub (architecture lens) | self-score: 8.5/10 | status: PROPOSED
---

# ADR-0001 — Database-Backed Multi-Storage Availability Group

## Status
PROPOSED (design spec; pending implementation review)

## Deciders
- Backend Engineer (storage layer)
- Ops Engineer (SMB provisioning)
- Project Manager (roadmap)
- Security Engineer (encrypted credentials)

## Context
The platform currently stores all encrypted vault blobs under a **single
vault root**: `FILE_STORAGE_UNC_PATH` (with optional `STORAGE_NET_USE_*`
env vars to auto-mount that single UNC share at startup).

Problems:
1. A single device/path is a **capacity and availability single point of
   failure** — when the disk fills, uploads stop with no route to add
   another device.
2. Storage topology is configured in `.env`, which is admin-friction and
   mixes deployment config with storage provisioning.
3. Per-device blob location cannot be derived from the DB — `files`
   only stores `stored_path` (a relative name), not *which* device it
   lives on.
4. SMB credentials live in plaintext env vars; there is no encrypted
   at-rest device registry.

## Decision
Adopt a **DB-backed multi-storage availability group**:

1. **New `storage_devices` table** (one row per device):
   - `id` (GUID, PK)
   - `storage_id` (logical/stable identifier, e.g. `DATA-00`)
   - `storage_path` (e.g. `P:\DATA-00\` or `\\SERVER\DATA-00\`)
   - `smb_username_encrypted`, `smb_password_encrypted` (column-encrypted,
     per-column IV + auth tag via `encryptColumn`, keyed by `MASTER_KEY_BASE64`)
   - `provisioning_enabled` (bit: allow new uploads on this device)
   - `is_primary` (bit: preferred default device)
2. **`files.storage_device_id`** FK → `storage_devices.id` so each blob is
   locatable per device.
3. **Admin `/#dashboard/admin` → new Storage tab** to add devices, set
   primary, toggle provisioning.
4. **Auto-balancing provisioning**: new uploads spread across devices
   with `provisioning_enabled = 1`, preferring `is_primary`, then by
   free-space (and round-robin fallback).
5. **Retire env vars**: `FILE_STORAGE_UNC_PATH`, `STORAGE_NET_USE_PATH`,
   `STORAGE_NET_USE_USER`, `STORAGE_NET_USE_PASS`.

## Consequences

### Positive
- Capacity scales horizontally — add a device via the admin UI, no code
  or env change.
- Per-device availability: losing one share fails that device only, not
  the whole platform.
- Credentials encrypted at rest in the registry (consistent with existing
  column-encryption posture).
- Blob-to-device mapping is queryable and auditable.

### Negative / Trade-offs
- **Boot can no longer rely on a single env path**: startup must resolve a
  device set from the DB and validate ≥ 1 enabled device is reachable.
- **Data migration needed** for existing blobs: backfill a default device
  row matching the legacy `FILE_STORAGE_UNC_PATH` and assign
  `files.storage_device_id` / `file_versions.device` accordingly.
- **Auto-mount moves from boot-time `net use`** to a device-provisioning
  routine (per-device mount on first use / admin action).
- **UNC health monitor** must become per-device rather than global.

## Options considered (not selected)
- **Keep env-only, multi-var per device** (e.g. `STORAGE_1_*` … `STORAGE_N_*`):
  rejected — no admin surface, credentials still in plaintext env, no
  auto-balancing, scales poorly.
- **Object storage / external CDN**: rejected — out of scope, breaks
  self-hosted Windows/SMB model.

## Open Questions (to resolve during implementation)
- Free-space cap / watermark rules for the auto-balancer (when to stop
  sending to a device).
- Device offline + `provisioning_enabled=1`: soft-fail to next device?
- Migration ordering: schema → backfill → code flip → env cleanup.
