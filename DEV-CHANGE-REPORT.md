---
agent: DevEngineer | date: 2026-11-01 | model: dev-engineer
plan: /memories/session/dev-plan.md (not persisted — /memories unavailable; plan embedded in session)
---

## Intention
Let an administrator disable Bitdefender scanning via `.env` in ANY environment,
including production. Previously the bypass only worked in development.

## Changement
Classe : STANDARD — config/env behaviour change affecting the production
fail-closed security guarantee; no API, schema, or route change.

## Fichiers
| Fichier | Raison |
|---|---|
| `src/server.ts` | Generalised the bypass gate: introduced `ALLOW_UNSCANNED_UPLOADS` (env-independent, default off) while keeping the legacy `ALLOW_UNSCANNED_UPLOADS_IN_DEVELOPMENT` var (renamed identifier internally) with its historical dev default. When the flag is set the Bitdefender CLI is skipped entirely (fail-open) instead of only accepting an `Unavailable` result, so uploads no longer invoke the scanner even when installed. Updated log messages and persisted scan message. |
| `src/server/utils/production.ts` | Startup validation no longer hard-fails on a missing Bitdefender CLI when scanning is explicitly disabled (`ALLOW_UNSCANNED_UPLOADS=true` or legacy dev var set), so production can boot without a scanner. |
| `.env.example` | Documented the new general-purpose `ALLOW_UNSCANNED_UPLOADS` var (default `false`, fail-closed) and clarified the legacy dev-only toggle. |

## Contrats publics impactés
Config surface : new optional env var `ALLOW_UNSCANNED_UPLOADS` (no breaking change —
old var still honoured with identical default semantics in development). No API/DB/schema contract change.

## Risques
Perf   : None (only affects the decision branch when scanner returns Unavailable).
Sécu   : Inherent to the feature — an admin explicitly opting out of AV scanning in
         production knowingly accepts unscanned uploads. Fail-closed default preserved
         (var unset ⇒ scanning still required, both at startup and per-upload).
Régression : Dev behaviour unchanged (legacy var keeps its `true` default in dev).
         Production with var unset behaves exactly as before.
Compat : Backward-compatible alias kept for the legacy env var.

## Dette observée
MINOR — `.env.example` section headers/comments for Bitdefender could be re-grouped,
and `CONTRIBUTING.md` line 43 still describes only dev behaviour (still accurate).

## Validation
Build: ✅  Lint: ✅ (`tsc --noEmit`)  Type-check: ✅  Smoke: ⚠️ SKIPPED (no test targets
the scanner bypass path; covered in Handoff TestEngineer).

## Approbation CRITICAL
N/A (STANDARD)

## Handoff TestEngineer
- Verify skip path: `ALLOW_UNSCANNED_UPLOADS=true` (any env), scanner present OR absent ⇒ CLI is
  never invoked; upload succeeds after heuristics and persists status `Clean`.
- Verify dev default: `NODE_ENV=development` with no vars set ⇒ scanner still runs when present
  (legacy default `true` only applies when the scanner is *absent*).
- Verify production fail-closed: `NODE_ENV=production`, `ALLOW_UNSCANNED_UPLOADS` unset/`false`,
  scanner unavailable ⇒ upload rejected (422) and `validateProductionConfig` throws.
- Verify production opt-out: `NODE_ENV=production`, `ALLOW_UNSCANNED_UPLOADS=true`, scanner
  unavailable OR present ⇒ server boots and uploads proceed without scanning.
- Verify legacy var respects `false` in dev (still fail-closed).
- Boundary: `ALLOW_UNSCANNED_UPLOADS` set to non-`true` values (`false`, `0`, empty) ⇒ not enabled.

## Handoff QaEngineer
Build/lint/type-check pass; no contract breaking change; new optional env var; fail-closed
default preserved. No CRITICAL approval required.
