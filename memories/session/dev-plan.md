# DEV-PLAN — Port 4 mssql dashboard-UI commits to postgresql branch
Date : 2026-11-02 | Modèle : dev-engineer | Classe : STANDARD

## Exploration (résumé subagent)
- Fichiers impactés : `src/app/features/files/pages/user-dashboard.tsx`
- Contrats publics : AUCUN (purely client-side UI change; no API/types/routes)
- Tests existants : aucuns — change is JSX-only inside the dashboard header.
- UI primitives : `DropdownMenu*` (radix-ui) exists in
  `src/app/shared/components/ui/dropdown-menu.tsx` (incl. `variant="destructive"`),
  `ChevronDown` available from lucide-react, no new deps required.
- `DashboardView` includes `"settings"`; `navigateDashboard("settings")` and
  `onLogout` prop are already threaded (from `dashboard-sidebar.tsx` types +
  `App.tsx`).

## Commits to port (mssql → postgresql)
| # | Commit | Changement |
|---|---|---|
| 1 | `61d9c78` | Desktop profile dropdown (Settings / Log Out) top-right |
| 2 | `9e24bb0` | Hide sidebar "Settings" on desktop (lg+) via `isDesktopNav` matchMedia |
| 3 | `81a89f7` | Move mobile Log Out icon to top-right corner (`absolute right-3`, `sm:hidden`) |
| 4 | `6b5808e` | Fix mobile Log Out anchor (`top-3`) so it sits above the search bar |

## Étapes
| # | Action | Fichier | Classe |
|---|---|---|---|
| 1 | Import `ChevronDown` + `DropdownMenu*` | user-dashboard.tsx | STANDARD |
| 2 | Add `isDesktopNav` matchMedia state + effect; conditionally drop sidebar Settings on lg+ | user-dashboard.tsx | STANDARD |
| 3 | Wrap desktop profile in DropdownMenu (Settings + Log Out) | user-dashboard.tsx | STANDARD |
| 4 | Re-anchor mobile Log Out button to top-right (`absolute right-3 top-3 z-10 sm:hidden`) | user-dashboard.tsx | STANDARD |
| 5 | Validate build + type-check | terminal | — |

## Critères de succès
- [ ] Build/lint/type-check propres (no new errors; pre-existing server.ts errors unchanged)
- [ ] Desktop (lg+) profile is clickable → dropdown with Settings + Log Out
- [ ] Sidebar "Settings" hidden on lg+ (via profile dropdown), kept on <lg
- [ ] Mobile (<sm) Log Out pinned top-right corner above search bar

## Rollback
```bash
git checkout postgresql -- src/app/features/files/pages/user-dashboard.tsx
```

## Risques
| Risque | Prob. | Mitigation |
|---|---|---|
| Dropdown overlay z-index | Low | default z-50; header content may scroll beneath, acceptable for menu |
| Mobile double logout entry | Low | mobile LogOut scoped to `sm:hidden`; dropdown visible from `sm+` |
| matchMedia breakpoint drift | Low | mirrors sidebar's own `lg` (1024px) breakpoint |
