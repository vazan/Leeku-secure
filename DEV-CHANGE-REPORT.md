---
agent: DevEngineer | date: 2026-11-02 | model: dev-engineer
plan: /memories/session/dev-plan.md
---

## Intention
For desktop users, make the profile in the top-right corner of the dashboard
clickable, opening a dropdown menu with "Settings" and "Log Out".

## Changement
Classe : STANDARD — isolated client-side UX change in a single component; no
public contract, API, or server change.

The desktop (sm+) top-right profile block (avatar + username/role) is wrapped
in a `DropdownMenu` whose trigger is a button containing the existing
`ProfileAvatar`. The dropdown places two items:
- **Settings** → `navigateDashboard("settings")` (existing settings view)
- **Log Out** → `onLogout` (existing dashboard logout handler)

The mobile fallback "Log out" icon button (visible below `lg`) is preserved as
is, since the new dropdown wrapper is hidden on small screens (`hidden sm:flex`).

## Fichiers
| Fichier | Raison |
|---|---|
| `src/app/features/files/pages/user-dashboard.tsx` | Add DropdownMenu imports, ChevronDown icon, and wrap profile in dropdown |

## Contrats publics impactés
NON — no API, types, or route changes. `DashboardView`, `navigateDashboard`,
`onLogout`, and the `UserDashboard` props interface are unchanged.

## Risques
- Perf : none (no new data fetching or effects).
- Sécu : none — reuses existing `onLogout` (CSRF-protected server logout).
- Régression : desktop Log Out still works via dropdown; sidebar "Log out" and
  mobile header LogOut button unchanged and still functional. Settings view
  already exists and is reachable via the dropdown exactly as via sidebar.

## Dette observée
MINOR — pre-existing `src/server.ts` type errors and `mssql` module resolution
failures on the base branch are unrelated to this change and not addressed here
(same as noted in the previous DEV-CHANGE-REPORT).

## Validation
Build: ✅ (`npx vite build` ok)  Lint: ✅ (type-check clean for `src/app/`;
pre-existing server-side errors unchanged)  Type-check: ✅ (per-file)
Smoke: ⚠SKIPPED (no live DB/UI in this environment)

## Approbation CRITICAL
N/A — STANDARD class, no sensitive files.

## Handoff TestEngineer
- Desktop viewport: click the top-right profile → dropdown shows "Settings" and "Log Out".
- "Settings" navigates to the Settings dashboard view.
- "Log Out" logs the user out and returns to the landing view.
- Keyboard: trigger is focusable (button), dropdown is a radix-menu (arrow-key
  navigable); Escape closes.
- Regression: sidebar "Log out" button, mobile (<lg) header LogOut button, and
  the Settings sidebar entry all still work.
- Confirm dropdown closes when clicking outside / pressing Escape.

## Handoff QaEngineer
STANDARD-class client-only change; build + type-check green for touched file.
No CRITICAL approval required. Branch: `feat/profile-dropdown-desktop`.
