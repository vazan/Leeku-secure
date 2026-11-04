# DEV-PLAN — Harden resumable-upload identifier (fix CRITICAL path traversal)

Date : 2026-11-04 | Modèle : (dev) | Classe : STANDARD

## Exploration (résumé)
- Fichiers impactés :
  - `src/server.ts` — GET/POST `/api/files/upload` handlers (+ shared validator import)
  - `src/server/merge-chunks.ts` — `mergeChunks()` defense-in-depth guard (+ exported `isSafeResumableIdentifier`)
- Contrats publics : `POST/GET /api/files/upload?resumableIdentifier=...` response contract UNCHANGED; only request params are further validated (invalid → 400). No response-shape change.
- Tests existants couvrant : `tests/merge-chunks.test.ts` (identifiers `h1-ok`, `h1-missing`, `h1-many`, … — all pass the safe charset). No server.ts upload integration test exists.

## Étapes
| # | Action | Fichier | Classe |
|---|---|---|---|
| 1 | Add exported `isSafeResumableIdentifier()` (strict safe charset `[A-Za-z0-9_-]{1,128}`) + reject in `mergeChunks()` | src/server/merge-chunks.ts | STANDARD |
| 2 | Import validator; validate `resumableIdentifier` in GET and POST upload handlers before any path use → 400 | src/server.ts | STANDARD |
| 3 | Build / typecheck / lint / run merge-chunks tests | terminal | — |

## Critères de succès
- [x] Traversal identifiers (`../`, `..\`, absolute, `.`) → 400, no file write
- [x] Legitimate identifiers (client base36 hash `abc-xyz`, test ids `h1-ok`) still accepted, upload flow unchanged
- [x] Build / lint / type-check propres
- [x] `merge-chunks.test.ts` still green (run full suite)

## Rollback
- Revert the two edits: `git checkout -- src/server.ts src/server/merge-chunks.ts` (clean tree baseline otherwise).

## Risques
| Risque | Prob. | Mitigation |
|---|---|---|
| Over-restrict a legit identifier format → resumable uploads regress | Low | Safe set covers UUIDs + base36-hash + `-`/`_`; verified against client generator and existing tests |
| Duplicated validation logic drift | Low | Single exported helper reused by both call sites |
