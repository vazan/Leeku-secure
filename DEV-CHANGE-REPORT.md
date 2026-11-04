---
agent: DevEngineer | date: 2026-11-04 | model: (dev)
plan: /memories/session/dev-plan.md
---

## Intention
Fix the CRITICAL resumable-upload path-traversal (arbitrary file write) by validating the
`resumableIdentifier` query parameter before it reaches any `path.join`, while keeping the
legitimate upload flow intact.

## Changement
Classe : STANDARD — a well-scoped input-validation hardening of two upload handlers plus a
defense-in-depth guard in the merge module. No public API contract or response shape changes;
no shared infra touched.

## Fichiers
| Fichier | Raison |
|---|---|
| src/server/merge-chunks.ts | Add exported `isSafeResumableIdentifier()`; reject unsafe identifiers inside `mergeChunks()` |
| src/server.ts | Validate `resumableIdentifier` in GET and POST `/api/files/upload` before path use → 400 |

## Contrats publics impactés
NON. Request params are further validated (returns 400 for unsafe identifiers); the response
contract and all legitimate-client behaviour are unchanged.

## Risques
- Perf: negligible (single regex per chunk request).
- Sécu: closes arbitrary file write / path-existence oracle. Defense-in-depth in merge module.
- Régression: safe charset `[A-Za-z0-9_-]{1,128}` accepts the client's real identifier format
  (base36 `<hash>-<time>`), UUIDs, and all pre-existing test identifiers — verified by
  `tests/merge-chunks.test.ts` (5/5 pass) and a 13-case validator matrix.
- Compat: non-resumable upload path untouched.

## Dette observée
MINOR — pre-existing `tsc` noise (52 errors: missing `mssql` type declarations + unrelated
implicit-any) is unrelated to this change and present on baseline. Not introduced here.

## Validation
Build: ✅ (esbuild bundles server.cjs cleanly; pre-existing `import.meta` warning only)
Lint: ✅ (tsc 52 errors before = 52 after; **none** in edited regions)
Type-check: ✅ (no new errors)
Smoke: ✅ (validator matrix 13/13; merge-chunks tests 5/5 pass)

## Approbation CRITICAL
N/A — STANDARD class.

## Handoff TestEngineer
Surfaces modified:
1. `GET /api/files/upload?resumableIdentifier=…` — must reject traversal/`.`/`..`/absolute paths
   with 400 and must not write/read any file; must still accept legitimate identifiers (200/204).
2. `POST /api/files/upload` resumable branch — same rejection before chunk persist/merge.
3. `mergeChunks()` defense-in-depth — throws `Invalid resumable identifier.` on unsafe input.

Cas limites to cover:
- `../`, `..\`, `/abs/path`, `C:\abs`, `..`, `.`, empty, whitespace, `>128` chars → 400/no write.
- Legitimate client format (`<base36>-<base36>`), UUIDs, large multi-chunk upload still merges.
- Confirmed no regression in the non-resumable (direct) upload path.

## Handoff QaEngineer
Change is STANDARD scope: adds strict identifier validation (server.ts) plus a defense-in-depth
guard (merge-chunks.ts). Build/lint/type-check/smoke validated; no contract break; existing
merge-chunks suite green. This directly remediates Finding #1 (CRITICAL) from the audit report.
