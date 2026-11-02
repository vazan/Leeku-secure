# DEV-PLAN — Shared tab shows real file names (server returns name per link)
Date : 2026-11-02 | Modèle : dev-engineer | Classe : STANDARD

## Exploration (résumé subagent)
- Bug : Shared tab rendered `file?.original_name || "Shared file"`. `files` state only
  holds the current folder's current server page (M-3 pagination), so shared files
  outside that window/scope resolved to undefined => "Shared file" placeholder.
- First iteration loaded the whole (unpaginated) inventory client-side, but that
  decrypted every file name server-side just to show a handful of shared names.
- Better: `/api/sharing/links` already `INNER JOIN files f` (for `stored_path`), so
  add the encrypted-name columns + decrypt them per returned link. Client stops
  fetching the inventory entirely.
- Fichiers impactés :
  - `src/server.ts` — ShareRow + mapShareRow + GET /api/sharing/links SQL
  - `src/app/shared/types/index.ts` — ShareLink.original_name (optional, BC)
  - `src/app/features/files/pages/user-dashboard.tsx` — use link.original_name
- Contrats publics : additive optional field on existing endpoint response (BC-safe).
- Tests existants : aucuns for the shared-links endpoint.

## Étapes
| # | Action | Fichier | Classe |
|---|---|---|---|
| 1 | Add encrypted-name columns to ShareRow + decrypt in mapShareRow | server.ts | STANDARD |
| 2 | SELECT the name columns in GET /api/sharing/links | server.ts | STANDARD |
| 3 | Add optional original_name to ShareLink type | types/index.ts | STANDARD |
| 4 | Render link.original_name (fallback to files lookup) in Shared tab | user-dashboard.tsx | STANDARD |
| 5 | Validate build (client+server) + type-check | terminal | — |

## Critères de succès
- [ ] Build/lint/type-check propres (52 pre-existing server errors unchanged)
- [ ] GET /api/sharing/links returns each link's real `original_name`
- [ ] Shared tab shows real file names without loading the full inventory

## Rollback
```
git checkout mssql -- src/server.ts src/app/shared/types/index.ts src/app/features/files/pages/user-dashboard.tsx
```

## Risques
| Risque | Prob. | Mitigation |
|---|---|---|
| Per-row decrypt cost for large share sets | Low | Only shared links' names decrypted, not the whole inventory; count is small in practice |
| Client cache holding old links without original_name | Low | optional field + `file` fallback + "Shared file" default preserved |
