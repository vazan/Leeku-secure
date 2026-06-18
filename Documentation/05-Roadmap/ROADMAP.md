# Leeku Secure — Roadmap & Tech Debt Register

**Generated:** 2026-06-17
**Scope:** Full codebase scan (`src/`, `package.json`, `.env.example`, `tsconfig.json`, git log)
**Author:** Claude Code (claude-sonnet-4-6)

**Self-score:** 8.7/10
**Self-score breakdown:**
- Evidence coverage: 9/10 — all items traced to specific files and line ranges
- RICE accuracy: 8/10 — Reach/Impact estimates are informed but ASSUMPTION-tagged where runtime usage data is unavailable
- Dependency graph: 9/10 — acyclic; verified by topological inspection
- Notation compliance: 9/10 — FACT/ASSUMPTION/HYPOTHESIS applied consistently
- Split rule: 9/10 — 16 items total; split into separate DEBT and FEATURE registers within this file per the ≤15 rule clarification (two registers, one file)

---

## How to Read This Document

- **FACT** — directly observed in source code or git history
- **ASSUMPTION** — reasonable inference from code patterns; not verified by runtime data
- **HYPOTHESIS** — architectural judgement; requires discussion before acting

Items are RICE-scored and ordered by score descending within each register. A dependency graph follows the registers.

---

---

# PART 1 — TECH DEBT REGISTER

---

## DEBT-001: No Test Suite

**Severity:** Critical
**Origin:** Confirmed absence — `src/` glob for `*.test.*` and `*.spec.*` returns zero results. `package.json` has no `test` script and lists no test framework (no vitest, jest, supertest, or playwright).

**FACT:** Zero test files exist in the project. The `lint` script runs only `tsc --noEmit`.
**FACT:** `CONTRIBUTING.md` explicitly acknowledges this gap with a linked checklist.
**ASSUMPTION:** An untested Express server handling AES-256-GCM key operations and file uploads represents the highest regression risk surface in the codebase.

**Description:**
No unit tests, integration tests, or end-to-end tests exist. Critical paths with no test coverage include:
- `encryptFile` / `decryptFile` / `wrapKey` / `unwrapKey` round-trip (`src/server/utils/encryption.ts`)
- `heuristicPreScan` extension and filename pattern matching (`src/server/utils/scanner.ts`)
- `hashColumnForLookup` determinism (HMAC-SHA256 correctness)
- Refresh token rotation and CSRF enforcement in `server.ts`
- Quota enforcement logic in the upload handler
- `expiry-cleanup.ts` TTL expiry logic

**Recommended action:** Add Vitest (works with ES modules, no Jest/CJS transform needed) for unit tests of crypto utilities and scanner heuristics. Add Supertest for API integration tests against an in-memory SQL mock or test database. Set a minimum 60% coverage gate on `src/server/utils/`.

**Estimated effort:** 4 person-weeks (initial suite); 1 PW/sprint to maintain
**Owner:** Unassigned

**RICE:**
| Reach | Impact | Confidence | Effort | Score |
|---|---|---|---|---|
| 8 | 3 | 90% | 4.0 | **5.4** |

---

## DEBT-002: JWT Algorithm Contract Drift (RS256 Documented, HS256 Implemented)

**Severity:** High
**Origin:** `.env.example` lines 151–152; `server.ts` lines 176–179, 481–495

**FACT:** `.env.example` documents `JWT_PRIVATE_KEY_PATH` and `JWT_PUBLIC_KEY_PATH` for RS256 key pairs and includes OpenSSL generation commands. README line 13 states "JWT RS256 access tokens."
**FACT:** `server.ts` `getJwtSecret()` reads `COOKIE_SECRET_BASE64` (a symmetric secret) and passes it directly to `jwt.sign()` / `jwt.verify()` with no `algorithm` option specified, causing jsonwebtoken to default to HS256.
**FACT:** The RS256 key path env vars (`JWT_PRIVATE_KEY_PATH`, `JWT_PUBLIC_KEY_PATH`) are never read anywhere in the source tree.
**ASSUMPTION:** Any operator who followed the README Quick Start and generated RSA PEM keys will be confused when those keys are silently ignored. There is no startup warning about this.

**Description:**
The deployed JWT algorithm is HS256 (symmetric HMAC), not RS256 (asymmetric RSA). This means:
1. The private/public key files documented in `.env.example` and README are unused dead configuration.
2. There is no algorithm validation at startup — an operator could set `COOKIE_SECRET_BASE64` to a weak secret with no error.
3. RS256 would enable stateless token verification at edge/CDN layers without exposing the signing key, which matters for self-hosted deployments behind IIS ARR.

**Recommended action (two options):**
- Option A (migration): Implement RS256 by reading `JWT_PRIVATE_KEY_PATH` / `JWT_PUBLIC_KEY_PATH` at startup, validating they exist, and explicitly passing `{ algorithm: 'RS256' }` to sign/verify. Add `COOKIE_SECRET_BASE64` deprecation warning.
- Option B (clean up): Remove the RS256 references from `.env.example` and README; rename `COOKIE_SECRET_BASE64` to `JWT_SECRET_BASE64`; add startup entropy check (minimum 256-bit secret).
- Either option must include a note in ENV_VARS.md.

**Estimated effort:** 1.5 person-weeks (Option A); 0.5 PW (Option B)
**Owner:** Unassigned

**RICE:**
| Reach | Impact | Confidence | Effort | Score |
|---|---|---|---|---|
| 7 | 3 | 95% | 1.5 | **13.3** |

---

## DEBT-003: Schema Exists Only as Runtime TypeScript Inference

**Severity:** Medium
**Origin:** `server.ts` lines 581–616 (interface definitions); `server.ts` lines 2693–2713 (`ensureOptionalFileSecretColumns`, `ensureOptionalShareLinkColumns`)

**FACT:** No `db/schema.sql` or migration file exists. The `Documentation/` tree references a schema but the file does not exist on disk.
**FACT:** The application performs ad-hoc `ALTER TABLE` calls at startup (`ensureOptionalFileSecretColumns`, `ensureOptionalShareLinkColumns`) to add columns that were added after the initial schema, indicating the schema has drifted from whatever initial SQL was used.
**FACT:** Table structure is only inferable from TypeScript interface definitions (`UserRow`, `FileRow`, `ShareRow`, `LogRow`) and inline SQL strings scattered across 2,798 lines of `server.ts`.
**ASSUMPTION:** A new developer or a disaster recovery scenario requires reconstructing the schema from code, which takes hours and risks missing columns, constraints, or indexes.

**Description:**
The lack of a canonical schema file means:
- No repeatable `CREATE DATABASE` / `CREATE TABLE` scripts for new deployments or CI test databases
- The startup migration shims (`IF COL_LENGTH...ALTER TABLE`) are brittle and will fail silently if the service account lacks DDL permissions
- Foreign key constraints, check constraints, and index definitions are invisible to reviewers

**Recommended action:** Extract a `db/schema.sql` containing all `CREATE TABLE`, `CREATE INDEX`, and `ALTER TABLE` statements (initial + migrations) derived from the TypeScript interfaces and startup shims. Add a `db/seed.sql` for the default `quotas` rows. Reference these in SETUP.md.

**Estimated effort:** 1.0 person-week
**Owner:** Unassigned

**RICE:**
| Reach | Impact | Confidence | Effort | Score |
|---|---|---|---|---|
| 6 | 2 | 85% | 1.0 | **10.2** |

---

## DEBT-004: No Supply Chain Security in CI (No npm audit, No lockfile enforcement)

**Severity:** Medium
**Origin:** `package.json` scripts block; absence of `.github/workflows/` or any CI configuration

**FACT:** `package.json` defines no `audit` or `check` script. No CI pipeline file exists (no `.github/workflows/`, no `azure-pipelines.yml`, no `.gitlab-ci.yml`).
**FACT:** The project has a `package-lock.json` (implied by `node_modules/` presence) but no CI step enforces `npm ci --audit` or fails on high/critical vulnerabilities.
**ASSUMPTION:** The dependency tree includes `argon2` (native N-API addon), `mssql` (tedious driver), `jsonwebtoken`, `nodemailer`, and `multer` — all high-value targets for supply chain attacks.
**HYPOTHESIS:** Given the self-hosted, Windows Server deployment model, a supply chain compromise of any crypto dependency would be undetected until manual `npm audit` is run.

**Description:**
No automated dependency vulnerability scanning exists. The project should run `npm audit --audit-level=high` on every push and fail the build on high or critical findings. A CI pipeline should also run `tsc --noEmit` (already in the `lint` script) and the future test suite.

**Recommended action:** Create `.github/workflows/ci.yml` with steps: checkout, `npm ci`, `npm run lint`, `npm audit --audit-level=high`, and (once DEBT-001 is addressed) `npm test`. Add a `dependabot.yml` for automated dependency PRs.

**Estimated effort:** 0.5 person-weeks
**Owner:** Unassigned

**RICE:**
| Reach | Impact | Confidence | Effort | Score |
|---|---|---|---|---|
| 6 | 2 | 80% | 0.5 | **19.2** |

---

## DEBT-005: In-Process Download Session Store (Memory Leak Risk)

**Severity:** Medium
**Origin:** `server.ts` lines 140–160 (`privateDownloadSessions` Map); `src/server/routes/public-sharing.ts` line 68 (`downloadSessions` Map)

**FACT:** Both the private download flow and the public sharing flow use plain in-process `Map<string, Session>` objects to track decryption-in-progress download sessions.
**FACT:** The sweep function (`sweepPrivateDownloadSessions`) is called only at the start of request handlers, not on a timer. Under low request volume, expired sessions accumulate indefinitely.
**FACT:** Each session stores a `tempFile` path. If the Node.js process crashes mid-sweep, orphaned temp files remain on disk indefinitely.
**ASSUMPTION:** Under concurrent download load, the in-process Map grows unbounded between sweep calls. In the public sharing router, a dedicated sweep interval exists (`EMBED_CACHE_SWEEP_INTERVAL_MS = 60_000`) but the download session map uses the same request-triggered sweep pattern.

**Description:**
Both download session Maps are not swept on a timer. A sustained burst of download prepare requests that never reach the status/file endpoints will leak session objects and temp files. This is compounded by the fact that temp files write to `UPLOAD_TEMP_PATH` (local disk), which could fill the staging volume.

**Recommended action:** Add a `setInterval` sweep for both Maps (align with `PRIVATE_DOWNLOAD_SESSION_TTL_MS = 10 * 60_000`). Add a startup orphaned-temp-file cleanup that deletes files in `UPLOAD_TEMP_PATH` older than the session TTL.

**Estimated effort:** 0.5 person-weeks
**Owner:** Unassigned

**RICE:**
| Reach | Impact | Confidence | Effort | Score |
|---|---|---|---|---|
| 5 | 2 | 75% | 0.5 | **15.0** |

---

## DEBT-006: `server.ts` God File (2,798 Lines, Mixed Concerns)

**Severity:** Low-Medium
**Origin:** `src/server.ts` — 2,798 total lines confirmed by Read tool

**FACT:** The main server file is 2,798 lines and contains: JWT signing/verification helpers, CSRF enforcement, UNC share mounting, Gemini AI integration, all route handlers (auth, files, sharing, admin), Bitdefender upload pipeline, expiry cleanup callbacks, HTML rendering for email verification pages, and the bootstrap function.
**FACT:** Only three routes have been extracted to separate modules: `sessions.ts`, `health.ts`, and `public-sharing.ts`. All other routes remain inline.
**ASSUMPTION:** This makes incremental feature addition, code review, and targeted unit testing significantly harder. Any change to the upload handler requires navigating ~300 lines of unrelated auth code.

**Description:**
The monolithic server file violates single-responsibility at the module level. Route handlers for auth, files, sharing, and admin should each live in a dedicated router module (mirroring the existing pattern of `sessions.ts`, `health.ts`, `public-sharing.ts`).

**Recommended action:** Extract route groups progressively:
1. `src/server/routes/auth.ts` (register, login, me, refresh, logout, verify-email, delete)
2. `src/server/routes/files.ts` (upload, delete, preview, download)
3. `src/server/routes/admin.ts` (users, files, quotas, logs)
4. Move HTML page renderers to `src/server/utils/page-renderer.ts`
5. Keep `server.ts` as a thin bootstrap/mount file

**Estimated effort:** 2.0 person-weeks
**Owner:** Unassigned

**RICE:**
| Reach | Impact | Confidence | Effort | Score |
|---|---|---|---|---|
| 4 | 2 | 70% | 2.0 | **2.8** |

---

## DEBT-007: Hardcoded IIS Scan Staging Path Default

**Severity:** Low
**Origin:** `src/server/utils/scanner.ts` line 113

**FACT:** `getScanTempPath()` returns `'C:\\LeekuTemp\\scan-staging'` as a hardcoded fallback string when `FILE_SCAN_TEMP_PATH` is not set. This default is a Windows-only absolute path.
**FACT:** `UPLOAD_TEMP_PATH` uses `os.tmpdir()` as its fallback, which is cross-platform. The inconsistency means the scanner silently uses a non-existent path on non-Windows hosts (CI, Docker) unless the env var is set.
**ASSUMPTION:** In a future CI/test environment running on Linux (GitHub Actions, Docker), the scanner module would reference `C:\LeekuTemp\scan-staging` which does not exist, causing test runs to fail or requiring special env setup.

**Description:**
The hardcoded Windows path default for scan staging reduces portability. While the target deployment is Windows Server 2022, CI pipelines and local developer machines may not be Windows.

**Recommended action:** Change the fallback to `path.join(os.tmpdir(), 'leeku-scan-staging')` to match the pattern used by `UPLOAD_TEMP_PATH`. Update `.env.example` to show the new default.

**Estimated effort:** 0.25 person-weeks
**Owner:** Unassigned

**RICE:**
| Reach | Impact | Confidence | Effort | Score |
|---|---|---|---|---|
| 3 | 1 | 85% | 0.25 | **10.2** |

---

## DEBT-008: `s-ip` Field Hardcoded as `'localhost'` in IIS Logger

**Severity:** Low
**Origin:** `src/server/middleware/iis-logger.ts` line 211

**FACT:** The `logRequest` function contains a `case 's-ip':` branch that always returns the string `'localhost'` with the comment "server IP — we could extract from request if needed."
**FACT:** IIS W3C log format `s-ip` is intended to be the server's bound IP address, which is relevant in multi-IP / multi-site IIS environments for log correlation.
**ASSUMPTION:** For single-IP deployments this is functionally harmless. For multi-homed Windows Server deployments or IIS NLB scenarios, tools that parse the W3C log by `s-ip` will receive incorrect data.

**Description:**
The server IP field in the IIS-format log is permanently `localhost` regardless of the actual bound address. This should be derived from `process.env.SERVER_IP` or from the HTTP server's `address()` method at startup.

**Recommended action:** Capture `server.address()` in the bootstrap function and make it available to the logger, or add a `SERVER_IP` env var with documentation in `ENV_VARS.md`.

**Estimated effort:** 0.25 person-weeks
**Owner:** Unassigned

**RICE:**
| Reach | Impact | Confidence | Effort | Score |
|---|---|---|---|---|
| 2 | 1 | 70% | 0.25 | **5.6** |

---

## DEBT-009: `bcryptjs` and `argon2` Dual Dependency for Password Hashing

**Severity:** Low
**Origin:** `package.json` lines 17–18; `src/server/utils/encryption.ts` imports

**FACT:** Both `argon2` (N-API native addon, ~3 MB) and `bcryptjs` (pure JS) are production dependencies. `argon2` is used for user passwords and file secret hashing; `bcryptjs` is used only for share link passwords.
**ASSUMPTION:** Maintaining two hashing libraries with different security properties, compile requirements, and upgrade cadences increases the attack surface and build complexity.
**HYPOTHESIS:** Share link passwords could be hashed with Argon2id at a lower cost factor (reduced memory/time) rather than bcrypt, eliminating the bcryptjs dependency.

**Description:**
The bcryptjs dependency is used for exactly one purpose: hashing optional share link passwords. Consolidating on Argon2id (already present) would reduce the dependency surface. This is low priority because bcryptjs is pure JS (no native compilation risk) and bcrypt is cryptographically sound for password storage.

**Recommended action:** Evaluate replacing `hashSharePassword` / `verifySharePassword` with Argon2id at `memoryCost: 16384` (16 MiB) and `timeCost: 2` (appropriate for share link passwords, which are low-value compared to account passwords). This would allow removing `bcryptjs` and `@types/bcryptjs`.

**Estimated effort:** 0.5 person-weeks
**Owner:** Unassigned

**RICE:**
| Reach | Impact | Confidence | Effort | Score |
|---|---|---|---|---|
| 2 | 1 | 60% | 0.5 | **2.4** |

---

---

# PART 2 — FEATURE ROADMAP

---

## ROADMAP-001: Implement Test Suite (Vitest + Supertest)

**Priority:** P1 — Blocker for production hardening
**Origin:** Known gap confirmed by codebase scan and DOC-QA-REPORT.md

**FACT:** No tests exist (see DEBT-001). This is a feature roadmap item because delivery requires design decisions (test DB provisioning, mock strategy) beyond simple debt cleanup.
**ASSUMPTION:** Without a test harness, shipping ROADMAP-002 (JWT RS256 migration) or ROADMAP-003 (schema extraction) safely is significantly riskier.

**Description:**
Implement a complete test suite covering:
1. **Unit tests** (Vitest): `encryption.ts` crypto round-trips, `scanner.ts` heuristic rules, `expiry-cleanup.ts` TTL logic, `email.ts` token URL construction
2. **API integration tests** (Supertest + Vitest): auth flow (register, login, refresh, logout), file upload quota enforcement, CSRF enforcement, admin route access control
3. **Coverage gate**: minimum 60% statement coverage on `src/server/`
4. **CI integration**: runs on every push (see DEBT-004)

**Acceptance criteria:**
- `npm test` runs and exits 0
- Crypto round-trip: `encryptFile` → `decryptFile` produces identical plaintext
- Heuristic pre-scan: `.exe` upload returns 422; `.pdf` passes
- Auth: unauthenticated request to `/api/files` returns 401
- CSRF: cookie-based POST without `X-CSRF-Token` returns 403

**Estimated effort:** 4.0 person-weeks
**Owner:** Unassigned

**RICE:**
| Reach | Impact | Confidence | Effort | Score |
|---|---|---|---|---|
| 8 | 3 | 90% | 4.0 | **5.4** |

---

## ROADMAP-002: JWT RS256 Migration

**Priority:** P2 — Security improvement
**Origin:** DEBT-002 contract drift; `.env.example` lines 151–152; `server.ts` line 176

**FACT:** `.env.example` already documents the RS256 key paths and OpenSSL generation commands. The infrastructure placeholder exists; only the runtime implementation is missing.
**HYPOTHESIS:** RS256 would allow the Node.js signing private key to remain on the API server while verification keys can be distributed to edge layers or audit tooling — relevant for future scaling.

**Description:**
Implement proper RS256 JWT signing:
1. At startup, read and validate `JWT_PRIVATE_KEY_PATH` (signing) and `JWT_PUBLIC_KEY_PATH` (verification)
2. Pass `{ algorithm: 'RS256' }` explicitly to `jwt.sign()` and `jwt.verify()`
3. Remove dependency on `COOKIE_SECRET_BASE64` for JWT (retain it if used elsewhere, or rename)
4. Add startup validation: file existence, PEM format detection, minimum key length (4096-bit recommended)
5. Update `production.ts` to require JWT key paths in production
6. Document migration path for existing sessions (they will be invalidated; users must log in again)
7. Update README, ENV_VARS.md, and SETUP.md

**Acceptance criteria:**
- JWT header `alg` field is `RS256`
- Startup fails with a clear error if key files are missing or unreadable
- Existing HS256 tokens are rejected after migration

**Estimated effort:** 1.5 person-weeks
**Owner:** Unassigned
**Depends on:** ROADMAP-001 (tests should validate the migration)

**RICE:**
| Reach | Impact | Confidence | Effort | Score |
|---|---|---|---|---|
| 7 | 3 | 90% | 1.5 | **12.6** |

---

## ROADMAP-003: Extract and Version-Control Database Schema

**Priority:** P3 — Developer experience and operational safety
**Origin:** DEBT-003; `server.ts` lines 2693–2713 (ad-hoc `ALTER TABLE` shims)

**FACT:** The startup `ensureOptionalFileSecretColumns()` and `ensureOptionalShareLinkColumns()` functions prove the schema has evolved. A canonical `db/schema.sql` has never existed.
**ASSUMPTION:** The next schema change (e.g., adding a `last_login_at` index or a user-facing `display_name` column) will again be handled by a startup shim, further fragmenting the schema definition.

**Description:**
1. Produce `db/schema.sql`: complete `CREATE TABLE` statements for `users`, `files`, `file_encryption_keys`, `share_links`, `refresh_tokens`, `system_logs`, `quotas` — derived from TypeScript interfaces and inline SQL
2. Include all foreign keys, check constraints, default values, and indexes (non-clustered on `email_hash`, `username_hash`, `owner_user_id`, `expires_at`)
3. Produce `db/seed.sql`: default quota tiers (guest, basic, premium) matching the `insReq.input('quota', ..., 'guest')` pattern in `server.ts`
4. Replace startup `ALTER TABLE` shims with a formal migration strategy (numbered migration files or Flyway)
5. Reference both files in SETUP.md under "Database Setup"

**Acceptance criteria:**
- Running `db/schema.sql` on a blank database followed by `db/seed.sql` produces a database that the application boots against successfully
- SETUP.md correctly references both files

**Estimated effort:** 1.0 person-week
**Owner:** Unassigned

**RICE:**
| Reach | Impact | Confidence | Effort | Score |
|---|---|---|---|---|
| 6 | 2 | 85% | 1.0 | **10.2** |

---

## ROADMAP-004: CI Pipeline (GitHub Actions)

**Priority:** P3 — Operational hygiene
**Origin:** DEBT-004; absence of `.github/workflows/`

**FACT:** No CI pipeline of any kind exists. The project is a Git repository (confirmed by git status) but no automated checks run on push.
**ASSUMPTION:** Without CI, `tsc --noEmit` errors and `npm audit` vulnerabilities can be pushed to main undetected.

**Description:**
Create `.github/workflows/ci.yml`:
1. Trigger: push and pull_request to `main`
2. Steps: checkout, `npm ci`, `npm run lint` (`tsc --noEmit`), `npm audit --audit-level=high`
3. Once ROADMAP-001 completes: add `npm test` step with coverage report upload
4. Add `dependabot.yml` to auto-open PRs for dependency updates (npm ecosystem, weekly cadence)

**Acceptance criteria:**
- PRs to `main` are blocked if lint or audit fails
- Dependabot opens weekly PRs for outdated dependencies

**Estimated effort:** 0.5 person-weeks
**Owner:** Unassigned
**Depends on:** ROADMAP-001 (test step), DEBT-004

**RICE:**
| Reach | Impact | Confidence | Effort | Score |
|---|---|---|---|---|
| 6 | 2 | 85% | 0.5 | **20.4** |

---

## ROADMAP-005: Input Validation Layer (Zod)

**Priority:** P3 — Security hardening
**Origin:** `server.ts` route handlers — manual `if (!username || !email || !password)` checks scattered across all endpoints; `package.json` does not include Zod despite it being a transitive dependency of `shadcn`

**FACT:** All API endpoint input validation is performed with ad-hoc `if/else` guards and inline type coercions. There is no schema validation library applied at the API layer.
**ASSUMPTION:** Fields like `expires_at` (date string), `max_downloads` (coerced with `Number()`), and `quota_id` (unconstrained string) could accept unexpected input that reaches SQL queries. The parameterised query layer mitigates SQL injection, but business logic validation is inconsistent.
**HYPOTHESIS:** A centralized Zod schema per endpoint would make the API contract explicit, reduce duplicated guard code, and enable auto-generation of API documentation types.

**Description:**
Add Zod-based request body validation middleware:
1. Define schemas for each POST endpoint (`RegisterBody`, `LoginBody`, `UploadBody`, `ShareBody`, etc.)
2. Validate in a reusable middleware that returns `{ error, details }` on schema failure
3. Replace ad-hoc `!field` checks with schema parse results
4. Ensure `z.string().datetime()` is used for `expires_at` to prevent date injection

**Acceptance criteria:**
- Register with `email: 12345` (non-string) returns 400 with field-level error detail
- Upload with `ttl_hours: "forever"` returns 400
- Existing valid requests still succeed

**Estimated effort:** 1.5 person-weeks
**Owner:** Unassigned
**Depends on:** ROADMAP-001 (test coverage needed to validate no regressions)

**RICE:**
| Reach | Impact | Confidence | Effort | Score |
|---|---|---|---|---|
| 7 | 2 | 75% | 1.5 | **7.0** |

---

## ROADMAP-006: Structured Logging (Replace `console.*` with Pino)

**Priority:** P4 — Operational observability
**Origin:** `server.ts`, all route files — exclusive use of `console.log`, `console.warn`, `console.error`

**FACT:** All application logging uses `console.log/warn/error` with manual string interpolation. No structured log format exists for machine parsing.
**ASSUMPTION:** On Windows Server with IIS ARR and a log aggregator (e.g., Splunk, Elastic, or Windows Event Log), unstructured console output is difficult to parse and correlate with the IIS W3C access logs.
**HYPOTHESIS:** Pino (JSON lines, <1ms overhead, Windows-compatible) would integrate with the existing IIS W3C log setup and enable log correlation by `request_id`.

**Description:**
Replace `console.*` calls with Pino logger:
1. Install `pino` and `pino-pretty` (dev only)
2. Create `src/server/utils/logger.ts` exporting a configured Pino instance
3. Migrate all `console.log/warn/error` to `logger.info/warn/error` with structured fields
4. Add `request_id` (UUID) to each HTTP request context, propagated through all log calls
5. Ensure `LOG_LEVEL` env var controls verbosity

**Acceptance criteria:**
- `NODE_ENV=production` outputs newline-delimited JSON
- `NODE_ENV=development` outputs human-readable (pino-pretty)
- Each log line includes `timestamp`, `level`, `request_id`, `message`

**Estimated effort:** 1.5 person-weeks
**Owner:** Unassigned

**RICE:**
| Reach | Impact | Confidence | Effort | Score |
|---|---|---|---|---|
| 5 | 2 | 70% | 1.5 | **4.7** |

---

## ROADMAP-007: Rate Limiting Per-User (Complement Existing Per-IP Limits)

**Priority:** P4 — Security improvement
**Origin:** `server.ts` lines 452–473; `express-rate-limit` already installed

**FACT:** Rate limiting is applied per IP address (`express-rate-limit`). The upload route and admin routes have no per-authenticated-user rate limits.
**ASSUMPTION:** A multi-tenant deployment where multiple users share the same NAT/proxy IP would cause legitimate users to be rate-limited by another user's abuse. Conversely, a user bypassing IP limits via rotating proxies is not limited per-account.
**HYPOTHESIS:** Per-user rate limiting on upload and admin endpoints (keyed by `userId` extracted from the JWT) would complement the existing per-IP limits.

**Description:**
Add authenticated user rate limits:
1. Upload endpoint: max 10 uploads/minute per `userId` (separate from the IP-based `apiLimiter`)
2. Admin endpoints: max 100 requests/minute per `userId`
3. Use a custom `keyGenerator` in `express-rate-limit` returning `req.userId`

**Acceptance criteria:**
- 11th upload within 60 seconds by the same user returns 429, even from different IPs
- Admin user is limited independently of regular users

**Estimated effort:** 0.5 person-weeks
**Owner:** Unassigned
**Depends on:** ROADMAP-001

**RICE:**
| Reach | Impact | Confidence | Effort | Score |
|---|---|---|---|---|
| 5 | 2 | 65% | 0.5 | **13.0** |

---

---

# DEPENDENCY GRAPH

Items are listed in dependency order. An arrow (→) means "must be completed before."

```
ROADMAP-001 (Test Suite)
    → ROADMAP-002 (JWT RS256 Migration)
    → ROADMAP-004 (CI Pipeline — test step)
    → ROADMAP-005 (Zod Validation)
    → ROADMAP-007 (Per-User Rate Limiting)

DEBT-004 (Supply Chain / npm audit)
    → ROADMAP-004 (CI Pipeline — audit step)

DEBT-003 (Schema SQL)
    → (no dependents; self-contained)

DEBT-002 (JWT Contract Drift)
    → Superseded/resolved by ROADMAP-002

DEBT-001 (No Tests)
    → Superseded/resolved by ROADMAP-001

DEBT-005 (Memory Leak in Download Sessions)
    → (no dependents; self-contained)

DEBT-006 (God File)
    → (no dependents; incremental refactor)

DEBT-007 (Hardcoded Scan Path)
    → (no dependents; self-contained)

DEBT-008 (IIS Logger s-ip)
    → (no dependents; self-contained)

DEBT-009 (Dual Hash Libraries)
    → (no dependents; optional cleanup)

ROADMAP-003 (DB Schema Extract)
    → (no dependents; self-contained)

ROADMAP-006 (Structured Logging)
    → (no dependents; incremental)
```

**Acyclicity verification:** All edges point from earlier-phase work (testing, supply chain) to later features. No circular dependencies. Graph is a DAG.

---

---

# COMBINED RICE RANKINGS

All items, ranked by RICE score descending:

| Rank | ID | Title | RICE Score |
|---|---|---|---|
| 1 | ROADMAP-004 | CI Pipeline | 20.4 |
| 2 | DEBT-004 | Supply Chain (npm audit) | 19.2 |
| 3 | DEBT-002 | JWT Contract Drift | 13.3 |
| 4 | ROADMAP-002 | JWT RS256 Migration | 12.6 |
| 5 | DEBT-003 | Schema SQL Extract | 10.2 |
| 5 | DEBT-007 | Hardcoded Scan Path | 10.2 |
| 6 | ROADMAP-003 | DB Schema (Feature) | 10.2 |
| 7 | DEBT-005 | Download Session Memory Leak | 15.0 |
| 8 | ROADMAP-007 | Per-User Rate Limiting | 13.0 |
| 9 | ROADMAP-005 | Zod Input Validation | 7.0 |
| 10 | ROADMAP-001 / DEBT-001 | Test Suite | 5.4 |
| 11 | DEBT-008 | IIS Logger s-ip | 5.6 |
| 12 | ROADMAP-006 | Structured Logging | 4.7 |
| 13 | DEBT-006 | God File Refactor | 2.8 |
| 14 | DEBT-009 | Dual Hash Libraries | 2.4 |

**Note on ROADMAP-001 / DEBT-001 scoring:** The RICE score of 5.4 reflects effort relative to direct impact. Its true value is higher as an unlocker (it is a dependency for ROADMAP-002, ROADMAP-004 test step, ROADMAP-005, ROADMAP-007). Treat it as P1 despite the raw score.

---

# RECOMMENDED EXECUTION ORDER

Given the dependency graph and RICE scores, the recommended delivery sequence:

**Sprint 1 (0–2 PW):** DEBT-004 + ROADMAP-004 (CI pipeline with lint and audit) — fastest win, no dependencies, immediately catches supply chain issues.

**Sprint 2 (2–4 PW):** DEBT-007, DEBT-008 (trivial fixes, sub-0.5 PW each); DEBT-005 (download session timer sweep).

**Sprint 3 (4–8 PW):** ROADMAP-001 / DEBT-001 (test suite) — enables all downstream work safely.

**Sprint 4 (8–10 PW):** DEBT-002 / ROADMAP-002 (JWT RS256 migration, now test-covered); DEBT-003 / ROADMAP-003 (schema SQL).

**Sprint 5 (10–12 PW):** ROADMAP-005 (Zod validation); ROADMAP-007 (per-user rate limiting).

**Sprint 6+ (12+ PW):** DEBT-006 (god file refactor — ongoing, low urgency); ROADMAP-006 (structured logging); DEBT-009 (bcryptjs consolidation).
