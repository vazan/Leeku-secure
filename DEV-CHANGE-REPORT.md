---
agent: DevEngineer | date: 2026-11-01 | model: dev-engineer
plan: /memories/session/dev-plan.md
---

## Intention
On desktop ("All files" view), folders should appear only in the side navigation
menu, not duplicated in the main content area. Mobile behaviour is unchanged.

## Changement
Classe : TRIVIAL — single className edit, frontend-only, no logic change.

## Fichiers
| Fichier | Raison |
|---|---|
| `src/app/features/files/pages/user-dashboard.tsx` | Hide the folder cards grid in the main "All files" section on `lg+` screens by switching `lg:grid-cols-3` → `lg:hidden`. The sidebar (which already renders the folder tree) is visible from `lg+`, so desktop keeps folders only in the sidebar. On mobile (< `lg`) the grid still renders as before. |

## Contrats publics impactés
NON (no schema, route, or API change).

## Risques
Perf : None (removes DOM on desktop; mobile unchanged).
Sécu : None.
Régression : Only affects the `visibleFolders` cards grid in the "files" view on `lg+`. The active-folder file listings and "New folder" flow are untouched.
Compat : `lg:hidden` is an existing Tailwind utility already used in the same file (header select at line ~2292).

## Dette observée
AUCUNE

## Validation
Build: ✅  Lint: ✅ (`tsc --noEmit`)  Type-check: ✅  Smoke: ✅ (`npm run test:desktop-updates` 2/2 pass)

## Approbation CRITICAL
N/A (TRIVIAL)

## Handoff TestEngineer
- Verify on desktop (`lg+` breakpoint, sidebar visible): opening "All files" shows no folder cards in the main section; folders are navigable only via sidebar tree.
- Verify on mobile (< `lg`, sidebar hidden): folder cards still render in the main section and navigation via them still works.
- Verify search/`visibleFolders` logic still populates the sidebar folder tree correctly.

## Handoff QaEngineer
Frontend-only trivial className change; build/lint/type-check pass; no contract impact. No CRITICAL approval required.
