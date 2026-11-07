---
agent: DevEngineer | date: 2026-11-07 | model: (dev)
plan: /memories/session/dev-plan.md
---

## Intention
Fix public **file sharing** links broken by the DB-backed multi-storage pool
(ADR-0001, commit 966eee4). After that commit, all file downloads/previews for
files stored on a non-primary storage device failed with `"Vault file not found."`
(HTTP 410) or surfaced "Not Found". Root cause: the public share routers still
resolved every blob against the single legacy vault root (`options.vaultPath ==
FILE_VAULT`) via `path.join(options.vaultPath, row.stored_path)`, ignoring each
row's `storage_device_id`. In multi-storage, `stored_path` is a relative name per
device and the actual device root lives in `storage_devices.storage_path`, so the
legacy join pointed at a path that does not exist on the primary device.

## Changement
Classe : STANDARD — bug fix (regression). The public share routes now resolve the
blob path **per-device** the same way the rest of the app already does (see
`resolveVaultPathForRow` in src/server.ts): look up the row's `storage_device_id`,
and if it maps to a registered device use `path.join(device.storage_path,
stored_path)`; otherwise fall back to the legacy `vaultPath` (NULL device id on
pre-multi-storage rows). No change to any public contract, DB schema, or client
API — responses keep the same status codes and JSON shapes.

Affected surfaces:
- `public-sharing.ts` — `GET /:token`, `POST /:token/preview`,
  `POST /:token/download`, `GET /:token/embed_media`(+`dec_embed_media`, incl. the
  background cache warm-up), and the folder-style `GET /:userId/:folderId/:filename`
  direct-link route. Each SELECT now pulls `storage_device_id` (COALESCEd across
  version/current like the other columns) and each `vaultFile` is resolved through
  a new `resolveVaultPath(deviceId, storedPath)` helper.
- `public-folder-sharing.ts` — `POST /:token/manifest`, `GET /:token`,
  `buildFolderShareOgHtml`, and `POST /:token/files/:fileId/download`. Because the
  listing/count routes use synchronous `fs.existsSync` inside `.filter()`, a
  per-request device-root snapshot (`getDeviceRootMap()` +
  `resolveVaultPathSync`) is used so device lookup stays DB-free after the single
  snapshot.

## Fichiers
| Fichier | Raison |
|---|---|
| src/server/routes/public-sharing.ts | Added `resolveVaultPath`; added `storage_device_id` to all share SELECTs; replaced all `path.join(options.vaultPath, ...)` blob resolutions with device-aware resolution; made background embed-cache warm-up async |
| src/server/routes/public-folder-sharing.ts | Added `getDeviceRootMap`/`resolveVaultPathSync`; added `storage_device_id` to folder manifest/list/download SELECTs; device-aware existence checks and download path |

## Contrats publics impactés
NON (breaking). Same routes, same status codes, same response shapes. The only
behavioral change is that blobs on any storage device now resolve to the correct
physical path instead of the legacy root. `vaultPath` remains the safe fallback
for legacy rows with a NULL/unknown device id.

## Risques
Perf/Sécu/Régression/Compat :
- Perf : `resolveVaultPath` issues one extra `getStorageDevice` lookup per request
  (a PK lookup on `storage_devices`), matching what `resolveVaultPathForRow`
  already does across the rest of the app; folder list/count routes do a single
  `listStorageDevices()` snapshot per request regardless of file count.
- Sécu : no change — same share/password/secret-key guards; only the blob path is
  now computed per-device excluding the device's SMB credentials (never returned).
- Régression : legacy single-device deployments are unaffected (device id null →
  legacy `vaultPath` fallback). Multi-device file share links start working again.
- Compat : MS SQL — new `COALESCE(v.storage_device_id,f.storage_device_id)` columns
  require only that `files`/`file_versions` carry the column (true since ADR-0001).

## Dette observée
MINOR — the shared blob-resolution logic is now duplicated in three places
(`resolveVaultPathForRow` in server.ts, `resolveVaultPath` in public-sharing.ts,
`resolveVaultPathSync` in public-folder-sharing.ts). A future refactor could hoist
a single `resolveBlobPathForRow(deviceId, storedPath, fallback)` into
`utils/storage-devices.ts` and reuse it everywhere. Not blocking.

## Validation
Build: ✅ (esbuild/vite unaffected)  Lint: ⚠ (tsc --noEmit reports only the
pre-existing repo-wide `mssql` module-resolution errors and implicit-any errors;
no new errors introduced by this change)  Type-check: ✅ for the edited modules
given the environment baseline  Smoke: ⚠SKIPPED (requires live DB + running
server across two storage devices; handed to QA).

## Approbation CRITICAL
N/A

## Handoff TestEngineer
Surfaces à tester :
- With ≥2 storage devices and a file sharing row whose `files.storage_device_id`
  points at a non-primary device: `GET /api/public/share/:token`,
  `POST /api/public/share/:token/download`, `POST /api/public/share/:token/preview`,
  and `GET /api/public/share/:token/embed_media` must all succeed (no 410
  "Vault file not found.").
- Download flow: POST download → 202 → poll status → ready → GET file serves the
  decrypted bytes and the checksum verifies.
- Video embed: `embed_media` and `dec_embed_media` serve byte ranges; the background
  cache warm-up no longer aborts when the file is on a secondary device.
- Text preview: `POST /:token/preview` returns the text for a file on a secondary
  device.
- Folder sharing (secondary device): `GET /:token/manifest` lists the file
  (previously silently dropped for wrong root), `GET /:token` reports the correct
  file_count/total_size, and `POST /:token/files/:fileId/download` succeeds.
- Legacy regression: with only one device (or rows with NULL `storage_device_id`),
  all of the above still work (fallback path).
Cas limites : file pinned to an *archived version* (share_links.version_id set) on a
secondary device; share whose device row was deleted (should fall back to
`vaultPath`); empty folder; folder share with password/secret-key guards.

## Handoff QaEngineer
Validation : `npm run build` passes. Report : DEV-CHANGE-REPORT.md. Trail
approbation : feature branch `fix/sharing/multi-storage-vault-path`; commit awaits
QA sign-off. No CRITICAL approval required.
