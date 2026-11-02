# DEV-PLAN — Shared tab shows real file names (load all files on Shared view)
Date : 2026-11-02 | Modèle : dev-engineer | Classe : STANDARD

## Exploration (résumé subagent)
- Bug : Shared tab renders `file?.original_name || "Shared file"`. `files` state
  only holds the current folder's current server page (M-3 pagination, FILES_SERVER_PAGE=500,
  folder-scoped). Any shared file outside that window/scope resolves to undefined =>
  "Shared file" placeholder instead of the real name.
- Fichiers impactés : `src/app/features/files/pages/user-dashboard.tsx` (client only)
- Contrats publics : AUCUN (no API/type/route change)
- Server : `GET /api/files` without limit/offset returns the FULL unpaginated
  inventory (legacy contract preserved), which the client can use to resolve names.
- Tests existants : aucuns client-selectionnels; no shared-tab test suite.

## Étapes
| # | Action | Fichier | Classe |
|---|---|---|---|
| 1 | Add `sharedFiles` state + `loadSharedFiles()` (unpaginated GET /api/files) | user-dashboard.tsx | STANDARD |
| 2 | Fetch it in the `view === "shared"` effect (mirrors trash/admin pattern) | user-dashboard.tsx | STANDARD |
| 3 | Resolve shared file name from `sharedFiles` in the Shared tab render | user-dashboard.tsx | STANDARD |
| 4 | Validate build + lint/type-check | terminal | — |

## Critères de succès
- [ ] Build/lint/type-check propres
- [ ] Loading the Shared tab loads all the user's files; each shared link card shows
      the file's real `original_name` (never "Shared file" when the file exists)

## Rollback
```
git checkout mssql -- src/app/features/files/pages/user-dashboard.tsx
```

## Risques
| Risque | Prob. | Mitigation |
|---|---|---|
| Full inventory fetch cost (only names needed) | Low-Med | Shared view is rarely the default; throttled by server; fallback "Shared file" preserved if fetch fails |
| Stale names after rename | Low | Refetch on each Shared-view entry (mirrors trash/admin behavior) |
