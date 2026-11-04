---
agent: DevEngineer | date: 2026-11-02 | model: dev-engineer
plan: /memories/session/dev-plan.md
---

## Intention
Fix the "Shared" dashboard tab showing the generic "Shared file" placeholder instead of
each file's real name — without the client loading and decrypting the whole inventory.

## Changement
Classe : STANDARD — additive server field + client tweak; no breaking contract change.

## Fichiers
| Fichier | Raison |
|---|---|
| src/server.ts | ShareRow + mapShareRow + GET /api/sharing/links SELECT decrypt & return each file's name |
| src/app/shared/types/index.ts | ShareLink gains optional `original_name` |
| src/app/features/files/pages/user-dashboard.tsx | Use `link.original_name` (fallback to `files` lookup) |

## Contrats publics impactés
OUI — additive only: `GET /api/sharing/links` returns a new optional `original_name`
per link. Old clients ignore unknown fields; existing fields unchanged. BC-safe.

## Risques
Perf : improved — only shared links' names are decrypted (small set), instead of the
whole inventory (thousands) on every Shared-view load. Initial client approach (load
all files) reversed.
Sécu : none — name comes from the owner's own file rows under existing authz.
Régression : low — `link.original_name` is optional; fallback to `files` lookup and the
"Shared file" default are preserved.
Compat : none — same endpoint/response shape plus an additive field.

## Dette observée
AUCUNE — the prior MINOR debt (client loading the whole inventory for names) is resolved
by this server-side field.

## Validation
Build (client `vite build`): ✅ | Build (server esbuild bundle): ✅ | Lint/type-check: ✅
(52 pre-existing server errors unchanged; 0 new in edited regions) | Smoke: ⚠SKIPPED
(no DB runtime available)

## Approbation CRITICAL
N/A

## Handoff TestEngineer
- GET /api/sharing/links returns `original_name` matching the file's real name.
- Shared tab shows the real name even when the file is in another folder / beyond the
  first page (no full-inventory fetch fired).
- Fallback path: cached/older link without `original_name` still resolves via `files`
  or shows "Shared file" — no crash.

## Handoff QaEngineer
Validated: both client and server build clean; no new type errors elsewhere; report +
trail on branch `fix/files-shared-tab-names`.
