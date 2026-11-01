---
agent: DevEngineer | date: 2026-11-01 | model: dev-engineer
plan: /memories/session/dev-plan.md
---

## Intention
Add a mass-delete option on the user's "All files" dashboard: click to select multiple
files (visual highlight), then a bottom-right "Delete Selected?" button opens a confirmation
dialog listing the files and soft-deletes them via the existing bulk endpoint.

## Changement
Classe : STANDARD — Frontend-only UI feature. The backend bulk soft-delete endpoint
(`POST /api/files/delete`) already existed and is reused unchanged.

## Fichiers
| Fichier | Raison |
|---|---|
| `src/app/features/files/pages/user-dashboard.tsx` | Selection state, click-to-toggle on mobile cards & desktop table rows, visual highlight, floating action button, `BulkDeleteDialog` component, closing logic on navigation |

## Contrats publics impactés
NON (schema unchanged; no new HTTP routes; the existing `POST /api/files/delete` contract
is reused as-is).

## Risques
Perf : None measurable — selection is stored as `string[]` and checked per row with a
constant-time `includes` (list length ≤ visible window).
Sécu : Files remain on the owner's vault disk; soft-delete only. Ownership is re-validated
server-side by the existing endpoint.
Régression : `IconButton` / `FileActionButton` / `MoveFileSelect` prop types widened from
`() => void` to `(event: React.MouseEvent) => void` — existing callers still compile because
`() => void` is assignable to the wider signature. Build verified.
Compat : The 100-file server cap for bulk delete surfaces as a clear toast message if the
user selects more.

## Dette observée
MINOR — `src/server.ts` bulk endpoint already existed but had no client wiring until now.
Also, selection >100 files is only caught server-side; no client-side cap.

## Validation
Build: ✅  Lint: ✅  Type-check: ✅  Smoke: ⚠ (run CI tests) — `npm run test:desktop-updates` passes (2/2).

## Approbation CRITICAL
N/A

## Handoff TestEngineer
- Surfaces à tester :
  1. Mobile card grid (`sm:hidden`): click card → highlight + checkmark; click again → deselect.
  2. Desktop table (`sm:block`): click row → highlight + checkbox; click again → deselect.
  3. Floating "Delete Selected?" button bottom-right, hidden when selection is empty.
  4. "Clear (N)" button clears selection.
  5. Confirmation dialog lists all selected files (name + size + thumbnail); Cancel / X / Esc / click-outside close.
  6. Confirm soft-delete moves files to Trash; success toast; list reloads.
  7. >100 selected → server 400 → clear toast with server error message.
  8. Navigation away from Files view or into another folder clears the selection.
- Cas limites : empty selection (button hidden), selection empty in dialog (error toast),
  deletion in progress (dialog can't close, double-submit blocked by `bulkDeleting`),
  files no longer available (error toast with refresh hint).
- Risques non couverts : performance with thousands of visible files (selection stored
  in flat array, lookup O(n) per row) — acceptable at current pagination window sizes.

## Handoff QaEngineer
- Validation : build/lint/type-check ✅ (`npm run lint`, `npm run build`).
- Feature branch : none created — working tree on `mssql` branch was modified directly.
- No CRITICAL approval needed (STANDARD).
