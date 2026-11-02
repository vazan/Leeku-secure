---
agent: DevEngineer | date: 2026-11-02 | model: dev-engineer
plan: /memories/session/dev-plan.md
---

## Intention
Port the four mssql dashboard-UI commits onto the `postgresql` branch:
- `61d9c78` — add desktop profile dropdown (Settings / Log Out) in the top-right corner
- `9e24bb0` — hide sidebar "Settings" on desktop (lg+) since the dropdown covers it
- `81a89f7` — move the mobile Log Out icon to the top-right corner of the header
- `6b5808e` — fix mobile Log Out anchoring (`top-3`) so it sits above the search bar

## Changement
Classe : STANDARD — isolated client-side UX change in a single component; no
public contract, API, or server change.

The change fully replicates the combined effect of the four mssql commits on
`src/app/features/files/pages/user-dashboard.tsx`. The ported regions were
verified to byte-match the mssql final state (at `6b5808e`): imports, the
`isDesktopNav` matchMedia state+effect, the conditional sidebar "Settings"
entry, the desktop `DropdownMenu` wrapper, and the re-anchored mobile Log Out
button (`absolute right-3 top-3 z-10 … sm:hidden`).

## Fichiers
| Fichier | Raison |
|---|---|
| `src/app/features/files/pages/user-dashboard.tsx` | Add DropdownMenu imports + ChevronDown, wrap desktop profile in dropdown, conditionally hide sidebar Settings on lg+, move & re-anchor mobile Log Out |

## Contrats publics impactés
NON — no API, types, or route changes. `DashboardView`, `DashboardNavItem`,
`navigateDashboard`, `onLogout`, and the `UserDashboard` props interface are
unchanged.

## Risques
Perf : none (no new data fetching or effects; matchMedia listener is cheap).
Sécu : none — reuses existing `onLogout` (CSRF-protected server logout).
Régression : desktop Log Out works via dropdown; mobile (<sm) header LogOut
button retained; sidebar "Settings" hidden only on lg+ (mobile nav keeps it).
Compat : browser `matchMedia` widely supported; guards SSR via
`typeof window !== "undefined"`.

## Dette observée
MINOR — pre-existing `src/server.ts` type errors on the base branch are
unrelated to this change and not addressed here (consistent with prior reports).

## Validation
Build: ✅ (`npx cross-env NODE_ENV=production vite build` ok)
Lint: ✅ (`npx tsc --noEmit` exit 0 — clean, same as base branch)
Type-check: ✅  Smoke: ⚠SKIPPED (no live DB/UI in this environment)

## Approbation CRITICAL
N/A — STANDARD class, no sensitive files.

## Handoff TestEngineer
- Desktop (lg+): click top-right profile → dropdown shows "Settings" and "Log Out".
- "Settings" navigates to the Settings dashboard view.
- "Log Out" logs the user out and returns to the landing view.
- Sidebar "Settings" is hidden at lg+; still present in mobile (<lg) nav select.
- Resize across 1024px: sidebar "Settings" appears/disappears; dropdown intact.
- Mobile (<sm): Log Out icon pinned to top-right corner, above the search bar.
- sm–lg: only the profile dropdown shows Log Out (mobile corner button hidden).
- Keyboard: trigger is focusable; radix-menu arrow-key navigable; Escape closes;
  click-outside closes.
- Regression: sidebar "Log out" button and Settings sidebar entry (mobile) work.

## Handoff QaEngineer
STANDARD-class client-only change; build + type-check green (identical to base).
No CRITICAL approval required. Branch: `feat/port-mssql-profile-dropdown-postgresql`.
