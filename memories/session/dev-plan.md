# DEV-PLAN — Finding 2: switch session tokens to RS256 (RSA) with dedicated key paths

Date : 2026-11-04 | Modèle : (dev) | Classe : CRITICAL (auth/security contract, deployment key dependency)

## Exploration (résumé subagent)
- Fichiers impactés :
  - `src/server.ts` — `getJwtSecret()` (357), `signToken()` (666), `verifyToken()` (674), startup (`validateProductionConfig()` call at 6697), plus new key-loading helper.
  - `src/server/utils/production.ts` — add JWT key-path validation (fail-fast at boot).
  - `.env.example` — already documents RS256 + key paths; verify/keep consistent (comments only).
- Contrats publics : JWT tokens are delivered via HttpOnly cookie + Bearer/`x-leek-token` header. Transport/shape UNCHANGED; only the signature algorithm changes (HS256 → RS256). Token consumers are internal (server.ts only). Frontend never decodes tokens client-side.
- Tests existants : none exercise JWT sign/verify directly; no integration tests for auth tokens.

## Étapes
| # | Action | Fichier | Classe |
|---|---|---|---|
| 1 | Add lazy-loading `getJwtSigningKey()` (private PEM) / `getJwtVerifyKey()` (public PEM) with clear errors | src/server.ts | CRITICAL |
| 2 | Sign with `algorithm:'RS256'` + private key; verify with `algorithms:['RS256']` + public key | src/server.ts | CRITICAL |
| 3 | Add `JWT_PRIVATE_KEY_PATH` / `JWT_PUBLIC_KEY_PATH` to startup validation (missing/unreadable → throw with clear message before listen) | src/server/utils/production.ts | STANDARD |
| 4 | Build / typecheck / lint / smoke (sign→verify round-trip, RS256 rejection of malicious/HS256) | terminal | — |

## Critères de succès
- [x] New sessions signed RS256; verify accepts only RS256 (rejects HS256 + forged/altered tokens → 401)
- [x] Missing/unreadable key files → startup fails fast with actionable message (no silent outage)
- [x] Frontend unaffected (no client-side token decode)
- [x] Build / lint / type-check no new errors

## Rollback
- `git revert` the feature commit; tokens back to HS256 immediately. Because access tokens are 15-min
  and refresh tokens are separate random hashes, reverting requires users to re-authenticate once.

## Risques
| Risque | Prob. | Mitigation |
|---|---|---|
| Service account cannot read `jwt_private.pem` (ACL) → verify startup | Med | Fail-fast at boot with explicit path so ops fixes ACL once; keys stored outside project per `.env.example` |
| Old HS256 sessions invalidated on cutover | High (accepted) | User accepts maintenance-window outage during deploy; users re-login after |
| Key rotation complexity (new private key) | Med | Document rotation: replace key + re-login; refresh-token hash table means refresh survives if key unchanged between access-token generations |
| Private key read on every login (perf) | Low | Lazy-cache the loaded key object |

### ACL dependency — direct answer to user's concern
The RSA change adds one new filesystem dependency: the Node service account must be able to
READ `jwt_private.pem` (only to SIGN — it never leaves the process). This is a single `icacls`
grant, much like `MASTER_KEY_BASE64`. The code will fail fast at boot with a clear message if
the file is missing or unreadable, so a misconfigured ACL cannot cause a silent partial outage —
it fails loudly at deploy time. Verify key is public (low sensitivity).

## Deployment notes (learned during validation)
- **dotenv first-wins**: if `.env` has the same var defined twice, dotenv keeps the FIRST line and
  silently ignores later ones. On the server, a duplicate `JWT_PRIVATE_KEY_PATH` pointing at the
  SSL cert (`star_miku_rip.crt`) beat the intended JWT key path. Fix: keep exactly one definition.
- **Key loaders validate PEM** via `crypto.createPrivateKey`/`createPublicKey` (jsonwebtoken's own
  backend) and strip a UTF-8 BOM, so a bad/mis-encoded key fails at BOOT with the real reason,
  not cryptically at login ("secretOrPrivateKey must be an asymmetric key when using RS256").
