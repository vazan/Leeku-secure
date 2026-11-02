---
agent: DevEngineer | date: 2026-11-02 | model: dev-engineer
plan: /memories/session/dev-plan.md
---

## Intention
Port the mssql dashboard-UI commits onto the `postgresql` branch:
- `61d9c78` — add desktop profile dropdown (Settings / Log Out) in the top-right corner
- `9e24bb0` — hide sidebar "Settings" on desktop (lg+) since the dropdown covers it
- `81a89f7` — move the mobile Log Out icon to the top-right corner of the header
- `6b5808e` — fix mobile Log Out anchoring (`top-3`) so it sits above the search bar
- `8736339` — replace spinning wheels with a multicolored progression bar
  (All files / Trash / other sections)

## Changement
Classe : STANDARD — isolated client-side UX change in a single dashboard
component plus two new leaf UI modules; no public contract, API, or server
change.

The reported regions replicate the combined effect of the five mssql commits on
`src/app/features/files/pages/user-dashboard.tsx`, verified byte-for-byte
against the mssql final state: imports, the `DropdownMenu` desktop profile
wrapper, `isDesktopNav` matchMedia state+effect, the conditional sidebar
"Settings" entry, the re-anchored mobile Log Out button, and the multicolored
`LoadingProgressBar` that replaces the spinning wheels (weighted across
files/folders/trash/versions). Two new modules (`use-loading-progress.ts`,
`loading-progress-bar.tsx`) also match the mssql sources exactly.

## Fichiers
| Fichier | Raison |
|---|---|
| `src/app/features/files/pages/user-dashboard.tsx` | Dropdown imports+ChevronDown, desktop profile dropdown, hide sidebar Settings on lg+, move & re-anchor mobile Log Out, replace spinning wheels with progression bar |
| `src/app/shared/hooks/use-loading-progress.ts` | NEW — blends weighted loading operations into a 0–100 eased progress value |
| `src/app/shared/components/common/loading-progress-bar.tsx` | NEW — multicolored progression bar UI driven by the hook |

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
- Progression bar: while files/trash load, a multicolored bar fills from the left
  at the top of the dashboard content; it completes to 100% and fades out when
  loading settles (All files, Trash, folder navigation, search).
- No spinning wheels remain under All files / Trash / folder sections.

## Handoff QaEngineer
STANDARD-class client-only change; build + type-check green (identical to base).
No CRITICAL approval required. Branch: `feat/port-mssql-profile-dropdown-postgresql`.
