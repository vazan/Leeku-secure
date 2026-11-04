# QA-VALIDATION-REPORT — Finding 2 Remediation Audit (RS256 JWT)

**Date:** 2026-11-04
**Auditor:** QaEngineer (solo, DevEngineer/TestEngineer evidence gathered directly)
**Scope:** Validate the Finding-2 remediation on branch `fix/jwt-rs256-signing`
(commit `ec7f6a7 feat(auth): sign session tokens with RS256 using dedicated RSA key pair`).
**Method:** static code review + targeted reproductions (jsonwebtoken v9.0.3) + test-suite
baseline + type/build gates.

---

## Executive summary

The remediation **correctly resolves the original finding**: session access tokens are now
signed with RS256 using a dedicated RSA key pair, the JWT signing secret is decoupled from
`COOKIE_SECRET_BASE64`, verification accepts only RS256, and both key files fail fast at
boot with actionable messages. The change is functionally sound and validated by
reproduction and build gates.

The dominant risk is **process, not defects**: this CRITICAL-class auth change shipped with
**zero automated tests** covering the new sign/verify path. There is no regression net if a
future PR touches `signToken`/`verifyToken`, key loading, or algorithm handling. The verdict
is therefore **CONDITIONAL** — deployable, but a dedicated JWT test must be added before the
remediation is closed.

| # | Severity | Title | Status |
|---|----------|-------|--------|
| F-01 | **HIGH** | No automated test coverage for the RS256 JWT path | Open |
| F-02 | **MEDIUM** | 4/8 test files fail on pre-existing missing `mssql` package (baseline, not this change) | Pre-existing |
| F-03 | **MEDIUM** | Avatar-token HMAC chain still permits unkeyed fallback; `PUBLIC_AVATAR_TOKEN_SECRET` undocumented | Pre-existing / adjacent |
| F-04 | **LOW** | No key-rotation utility or documented rotation procedure | Open (ops) |

Findings F-01, F-02, F-03 apply to the *remediation as shipped*; none invalidates the
security of the RS256 change itself.

---

## F-01 — HIGH: No automated tests cover the JWT/RS256 path

**Evidence**
- `grep -rln "signToken\|verifyToken\|RS256\|jsonwebtoken\|jwt\." tests` → **no matches**.
- `tests/` contains only: `merge-chunks`, `profile-picture`, `syntax-preview`,
  `text-preview`, `public-share-*`, `share-video-warning`, `desktop-updates-path`.
- No test imports/exercises `getJwtSigningKey`, `getJwtVerifyKey`, `signToken`, or
  `verifyToken`. Validation to date is manual/smoke only.

**Why it matters:** `signToken`/`verifyToken` are the auth boundary of the whole application;
the algorithm (`RS256`), issuer/audience, and key decoupling are exactly the class of change
that silently regresses (e.g., reverting to HS256, dropping the `algorithms` allow-list,
removing BOM handling). Finding 1 shipped with 5 dedicated tests; this change has none.

**Recommendation (blocking for closure, not for deploy):**
- Add a `tests/jwt-auth.test.ts` using the repo's `tsx --test` runner (`node:test`) that:
  1. Generates an ephemeral RSA keypair in a temp dir and points
     `JWT_PRIVATE_KEY_PATH`/`JWT_PUBLIC_KEY_PATH` at them.
  2. Asserts RS256 sign→verify round-trip; correct `sub`/`role`/issuer/audience.
  3. Asserts an **HS256** token is rejected (`verify` returns null).
  4. Asserts a **tampered payload** token is rejected (signature mismatch).
  5. Asserts missing/invalid/bad-PEM key files **throw** (fail-fast at boot),
     including the UTF-8 BOM case.

---

## F-02 — MEDIUM: Pre-existing test-suite breakage (missing `mssql`)

**Evidence**
- `tests/desktop-updates-path`, `syntax-preview`, `public-share-cache-cleanup`,
  `public-share-embed-crawler` fail with `ERR_MODULE_NOT_FOUND: mssql` at module load.
- Confirmed **identical on baseline** (`git stash` then re-run) → pre-existing
  environment/tooling state, **not introduced by this change**.
- Runnable tests are green: `merge-chunks` 5/5, `profile-picture` 2/2,
  `share-video-warning` 2/2, `text-preview` 4/4.

**Recommendation:** install/declare `mssql` as a dev dependency (or mock it) so the full
suite runs; document the limitation until then. Non-blocking for this change.

---

## F-03 — MEDIUM: Avatar-token HMAC chain allows unkeyed fallback (pre-existing)

**Evidence:** `src/server/utils/profile-picture.ts:7-16`
```
PUBLIC_AVATAR_TOKEN_SECRET || JWT_SECRET || COOKIE_SECRET_BASE64 || SESSION_SECRET || APP_SECRET || ''
```
After the RS256 migration, `COOKIE_SECRET_BASE64` is no longer required at boot, so a
deployment that sets none of these falls back to the constant-prefix token
`leeku-avatar:<userId>` — a small IDOR-adjacent weakness for public avatar URLs (low
sensitivity, user's own public avatar only). Confirm `PUBLIC_AVATAR_TOKEN_SECRET` is set.

**Recommendation (ops hardening, non-blocking):** document `PUBLIC_AVATAR_TOKEN_SECRET` in
`.env.example` and treat the unkeyed fallback as must-not-happen.

---

## F-04 — LOW: No key-rotation utility

Replacing `jwt_private.pem` invalidates active access tokens; refresh tokens survive only
while the key is unchanged between access-token refreshes. `.env.example` documents
generation but not rotation. Operational, non-blocking.

---

## Validation evidence (the change itself is correct)

| Check | Result | Evidence |
|---|---|---|
| RS256 sign/verify round-trip | **PASS** | reproduction with real RSA key, jsonwebtoken v9.0.3 |
| HS256 token rejected by verifier | **PASS** | `algorithms:['RS256']` → throws, `verifyToken`→null |
| Forged-payload token rejected | **PASS** | signature mismatch → verification failure |
| Invalid/bad-PEM key fails at boot | **PASS** | `crypto.createPrivateKey/PublicKey` validation + clear error |
| UTF-8 BOM stripped | **PASS** | BOM-prefixed PEM accepted after strip |
| `getJwtSecret` fully removed | **PASS** | no leftover HMAC coupling in access-token path |
| Type gate (`tsc`) | **PASS** | 52 errors == baseline (zero new) |
| Build gate (esbuild) | **PASS** | 0 errors |
| Runnable tests unchanged | **PASS** | 4 green files identical to baseline |

---

## Auto-validation & quality gates

**Gate result: CONDITIONAL (score ≥ 7.0 but CRITICAL coverage gap on auth code).**

| Criterion | Score | Notes |
|-----------|------:|-------|
| Remediation correctness (evidence) | 2.0/2 | reproducible RS256 + rejection tests |
| Regression safety (build/type/baseline) | 1.5/2 | clean gates; 4 test files broken pre-existing |
| Automated coverage of new code | 0.5/2 | **no JWT tests** — primary gap (F-01) |
| Docs/ops parity (`.env.example`) | 1.7/2 | self-contained; missing `PUBLIC_AVATAR_TOKEN_SECRET` (F-03) |
| Report completeness | 1.5/2 | static + reproduction; no live e2e server ran |
| **Total** | **7.2/10** | |

Per CORE rules, ≥7.0 with no blocked deploy is PASS-worthy on score, **but** the CRITICAL
class (auth boundary) plus **zero automated coverage** triggers **CONDITIONAL**: a dedicated
`tests/jwt-auth.test.ts` (per F-01) is required before closing the remediation. No
distribute-blocking defect was found; deploy is safe.

**BLOCKING conditions:** none for deployment. One **closure-blocking condition**: add the
JWT test coverage (F-01).

---

## Recommended remediation order (post-deploy)

1. Add `tests/jwt-auth.test.ts` per F-01 (sign/verify round-trip, HS256 rejection, forged
   rejection, bad-PEM fail-fast, BOM).
2. Fix the `mssql` test-suite breakage (F-02) so the baseline suite is fully green on CI.
3. Document `PUBLIC_AVATAR_TOKEN_SECRET` and confirm it is set (F-03).
4. Document a key-rotation runbook (F-04).
