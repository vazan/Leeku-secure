# DEV-PLAN — Profile Dropdown (Settings / Log Out) for Desktop
Date : 2026-11-02 | Modèle : dev-engineer | Classe : STANDARD

## Exploration (résumé subagent)
- Fichiers impactés : `src/app/features/files/pages/user-dashboard.tsx`
- Contrats publics : AUCUN (purely client-side UI change; no API/types/routes)
- Tests existants : aucuns — change is JSX-only inside the dashboard header.
- UI primitives déjà disponibles : `DropdownMenu*` (radix-ui) +
  `Popover`/`Button` in `src/app/shared/components/ui/` — no new deps required.
- `DashboardView` includes `"settings"`; `navigateDashboard("settings")` exists.
- `onLogout` prop is already threaded from `App.tsx`.

## Étapes
| # | Action | Fichier | Classe |
|---|---|---|---|
| 1 | Import DropdownMenu primitives + ChevronDown | user-dashboard.tsx | STANDARD |
| 2 | Wrap desktop top-right profile in DropdownMenu (trigger = avatar) with Settings + Log Out items | user-dashboard.tsx | STANDARD |
| 3 | Validate build + type-check | terminal | — |

## Critères de succès
- [x] Build/lint/type-check propres (no new errors; pre-existing server.ts/mssql errors unchanged)
- [x] Desktop (sm+) top-right profile is clickable and opens dropdown with "Settings" and "Log Out"
- [x] "Settings" navigates to the existing settings dashboard view; "Log Out" invokes existing onLogout

## Rollback
```
git checkout mssql -- src/app/features/files/pages/user-dashboard.tsx
```

## Risques
| Risque | Prob. | Mitigation |
|---|---|---|
| Dropdown overlay z-index | Low | default z-50; header content may scroll beneath, acceptable for menu |
| Mobile double logout entry | Low | mobile LogOut button preserved (lg:hidden); dropdown is hidden on <sm via wrapper `hidden sm:flex` |
