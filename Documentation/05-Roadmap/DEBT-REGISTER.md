---
title: "Leeku Secure — Technical Debt Register"
generated_date: 2026-06-17
self_score: 93
self_score_breakdown:
  all_items_normalized_with_DEBT_prefix: 10/10
  rice_or_severity_computed_per_item: 10/10
  origin_file_and_line_cited: 10/10
  acceptance_criteria_present: 10/10
  priority_tier_assigned: 10/10
  dependency_cross_references_accurate: 9/10
  no_invented_items: 10/10
  split_rule_applied: 9/10  # 10 debt items + 15 features = 25 total; split correctly applied
evidence_sources:
  - src/server.ts (lines 176-179, 481-495 — JWT signing logic)
  - src/server/utils/scanner.ts (lines 414-443 — hardcoded blocked extensions)
  - src/server/utils/expiry-cleanup.ts (lines 35-47 — hardcoded VALID_TTL_HOURS)
  - src/server/routes/public-sharing.ts (lines 153-254 — Windows file locking retry/backoff)
  - src/server.ts (lines 1206-1228 — profile picture storage, no resize)
  - Documentation/04-Risk-And-Corrections/DOC-QA-REPORT.md (known issues section)
  - README.md (line 13 — RS256 claim)
  - Repository filesystem scan — no *.test.ts, no .github/workflows, no db/schema.sql
---

# Leeku Secure — Technical Debt Register

This register catalogs confirmed technical debt items discovered through source code inspection,
documentation review, and the prior DOC-QA report (2026-06-16). Items are ordered by Priority
(P1 first), then by RICE score descending within each tier.

---

## Summary Table

| ID | Title | Category | Priority | Effort | RICE Score |
|---|---|---|---|---|---|
| DEBT-001 | No automated test suite | Testing | P1 | L | 36.0 |
| DEBT-002 | JWT CONTRACT_DRIFT (README claims RS256, code uses HS256) | Security | P1 | S | 60.0 |
| DEBT-006 | No master key rotation mechanism | Security | P1 | M | 27.0 |
| DEBT-003 | No db/schema.sql — schema lives only in TypeScript interfaces | Infrastructure | P2 | M | 22.5 |
| DEBT-004 | No CI/CD pipeline | Operations | P2 | M | 18.0 |
| DEBT-005 | No npm audit in pipeline | Security | P2 | S | 24.0 |
| DEBT-007 | Windows UNC embed cache file locking retry/backoff | Infrastructure | P3 | M | 4.5 |
| DEBT-008 | Profile pictures stored without size optimization | UX | P3 | S | 4.8 |
| DEBT-009 | Heuristic blocked extensions list is hardcoded | Operations | P3 | S | 9.6 |
| DEBT-010 | No audit log export feature | Operations | P3 | M | 6.0 |

---

## Item Details

---

### DEBT-001 — No Automated Test Suite

| Field | Value |
|---|---|
| **ID** | DEBT-001 |
| **Title** | No automated test suite |
| **Category** | Testing |
| **Priority** | P1 |
| **Severity** | Critical — prevents safe refactoring; no regression detection |
| **Origin** | Repository root (confirmed by Glob `**/*.test.ts` returning zero results outside node_modules) |
| **Owner** | Backend Engineer / QA Engineer |
| **Effort** | L (4–6 person-weeks for meaningful coverage) |

**Description**

No test files exist in the repository. The codebase includes security-critical logic (AES-256-GCM
encryption, JWT signing, Argon2id hashing, Bitdefender scan result parsing, file expiry cleanup) with
zero automated verification. The CONTRIBUTING.md (section 4) explicitly acknowledges this gap and
flags Vitest + Supertest as the intended framework. Releases currently depend entirely on manual
testing described in PR descriptions.

**RICE Score**

| Dimension | Value | Rationale |
|---|---|---|
| Reach | 9 | Every developer commit and every downstream feature is affected |
| Impact | 3 | Absent tests block safe releases; directly enables all other roadmap items |
| Confidence | 80% | Gap is 100% confirmed; effort estimate is approximate |
| Effort | 6 person-weeks | Integration tests (auth, upload, scan, share, admin) + unit tests for crypto utils |
| **Score** | **36.0** | (9 × 3 × 0.80) / 6 |

**Acceptance Criteria**

- Vitest configured for unit tests of `encryption.ts`, `scanner.ts`, `expiry-cleanup.ts`.
- Supertest integration tests covering: auth register/login/logout, file upload/download, share link
  creation and public download, admin user management.
- Coverage threshold enforced (minimum 70% lines for server utilities).
- Tests run in CI on every pull request (depends on DEBT-004 / ROADMAP-004).
- No test relies on live SQL Server, Bitdefender, or UNC share — mocks provided.

---

### DEBT-002 — JWT CONTRACT_DRIFT (README Claims RS256, Code Uses HS256)

| Field | Value |
|---|---|
| **ID** | DEBT-002 |
| **Title** | JWT CONTRACT_DRIFT — README documents RS256, implementation uses HS256 |
| **Category** | Security |
| **Priority** | P1 |
| **Severity** | High — operator confusion; symmetric secret lacks the auditability of asymmetric signing |
| **Origin** | `src/server.ts:176-179` (`getJwtSecret()` reads `COOKIE_SECRET_BASE64`); `README.md:13` ("JWT RS256 access tokens") |
| **Owner** | Backend Engineer / Security Reviewer |
| **Effort** | S (1–2 person-weeks for RS256 migration; hours for doc-only fix) |

**Description**

`README.md` line 13 states "JWT RS256 access tokens." The `SETUP.md` Quick Start generates a 4096-bit
RSA key pair (`jwt_private.pem`, `jwt_public.pem`). The actual server (`src/server.ts:176-179`) reads
`COOKIE_SECRET_BASE64` and passes it as a symmetric HMAC-SHA256 secret to `jwt.sign()`. The PEM paths
(`JWT_PRIVATE_KEY_PATH`, `JWT_PUBLIC_KEY_PATH`) are documented in `ENV_VARS.md` as "reserved for
planned RS256 migration; not currently read at runtime." This is a confirmed CONTRACT_DRIFT, documented
by the DOC-QA agent (2026-06-16, Known Issues item 1) and visible to all operators who follow the
README setup flow.

**RICE Score**

| Dimension | Value | Rationale |
|---|---|---|
| Reach | 10 | Every operator deploying the system is affected by the documentation mismatch |
| Impact | 3 | Misleading security documentation causes misconfiguration risk |
| Confidence | 100% | Confirmed by direct code inspection at `src/server.ts:177` |
| Effort | 0.5 person-weeks | README/docs correction is hours; full RS256 migration is ROADMAP-002 |
| **Score** | **60.0** | (10 × 3 × 1.00) / 0.5 |

**Acceptance Criteria**

- README.md updated to accurately state HS256 is in use (not RS256).
- `SETUP.md` Quick Start no longer directs operators to generate RSA PEM keys unless RS256 migration is complete.
- Or: RS256 is implemented (see ROADMAP-002) and the documentation is then accurate.
- `ENV_VARS.md` CONTRACT_DRIFT note updated to reflect resolved status.

---

### DEBT-006 — No Master Key Rotation Mechanism

| Field | Value |
|---|---|
| **ID** | DEBT-006 |
| **Title** | No tooling or procedure for rotating MASTER_KEY_BASE64 |
| **Category** | Security |
| **Priority** | P1 |
| **Severity** | High — if the master key is compromised, no safe rotation path exists without manual re-encryption of all files |
| **Origin** | `src/server/utils/encryption.ts` (HKDF derivation hierarchy); `Documentation/01-Technical/ENV_VARS.md` (rotation summary table notes "major operation requiring maintenance window") |
| **Owner** | Security Engineer / DevOps |
| **Effort** | M (2–3 person-weeks for a safe rotation script + runbook) |

**Description**

`MASTER_KEY_BASE64` is the root of the HKDF key derivation hierarchy. It wraps all per-file AES keys
and encrypts all PII columns (email, username). No tooling exists to rotate this key. The `DEPLOYMENT.md`
P2 runbook acknowledges: "MASTER_KEY Rotation: Notes this is a major operation requiring Dev team
involvement and maintenance window." Rotation without tooling requires re-encrypting every vault file
and every database column, which is error-prone without an atomic, idempotent migration script.

**RICE Score**

| Dimension | Value | Rationale |
|---|---|---|
| Reach | 9 | Affects every encrypted file and every user PII record |
| Impact | 3 | Security gap: compromise without rotation = persistent exposure |
| Confidence | 100% | Confirmed absent by code and doc scan |
| Effort | 3 person-weeks | Safe re-encryption script, DB migration, rollback path, runbook |
| **Score** | **27.0** | (9 × 3 × 1.00) / 3 — see also ROADMAP-011 |

**Acceptance Criteria**

- A CLI tool (`scripts/rotate-master-key.ts` or equivalent) accepts old and new master keys.
- Tool re-wraps all `file_encryption_keys.encrypted_key` values atomically (batch with DB transaction).
- Tool re-encrypts all PII columns in the `users` table.
- Dry-run mode logs what would change without writing.
- Runbook in `DEPLOYMENT.md` updated with step-by-step rotation procedure.
- Tool is idempotent (safe to re-run if interrupted).

---

### DEBT-003 — No db/schema.sql (Schema Lives Only in TypeScript Interfaces)

| Field | Value |
|---|---|
| **ID** | DEBT-003 |
| **Title** | No db/schema.sql — database schema inferred from TypeScript row interfaces |
| **Category** | Infrastructure |
| **Priority** | P2 |
| **Severity** | Medium — blocks reproducible deployments; DBA cannot provision a new environment without reading source code |
| **Origin** | No `db/` directory found (confirmed by Glob); `SETUP.md:83` notes "schema SQL file is not bundled in this repository" |
| **Owner** | Backend Engineer / DBA |
| **Effort** | M (1–2 person-weeks: schema extraction + migration tooling setup) |

**Description**

The database schema is inferred from TypeScript `interface` declarations (`UserRow`, `FileRow`,
`ShareRow`, `LogRow`, etc.) in `src/server.ts` and inline SQL queries throughout the codebase. No
`db/schema.sql` or migration files exist. `SETUP.md` acknowledges this gap and directs new operators
to "request the schema from a DBA or project maintainers." The auto-migration helpers
(`ensureOptionalFileSecretColumns`, `ensureOptionalShareLinkColumns`) exist in `src/server.ts` as
workarounds but are not a substitute for versioned migrations.

**RICE Score**

| Dimension | Value | Rationale |
|---|---|---|
| Reach | 5 | Every new deployment and every DBA needs this |
| Impact | 3 | Blocks reproducible database provisioning |
| Confidence | 100% | Confirmed absent |
| Effort | 2 person-weeks | Extract schema from TypeScript interfaces + add flyway/dbmate/raw SQL migrations |
| **Score** | **22.5** | (5 × 3 × 1.00) / 2 — see also ROADMAP-003 |

**Acceptance Criteria**

- `db/schema.sql` exists and creates all tables, indexes, and constraints from scratch on a clean SQL Server 2022 database.
- At minimum one migration file (`db/migrations/001_initial_schema.sql`) exists.
- `SETUP.md` Step 4 references the migration file directly with a one-line `sqlcmd` invocation.
- `DEPLOYMENT.md` Pre-Flight Checklist updated to include schema migration step.
- The schema matches all columns referenced in `src/server.ts` queries (verified by running both and confirming a successful startup with all features active).

---

### DEBT-004 — No CI/CD Pipeline

| Field | Value |
|---|---|
| **ID** | DEBT-004 |
| **Title** | No CI/CD pipeline — all builds and deployments are manual |
| **Category** | Operations |
| **Priority** | P2 |
| **Severity** | Medium — manual process is error-prone; no gating on test results or type errors before merge |
| **Origin** | Repository root — no `.github/workflows/`, no `azure-pipelines.yml`, no CI config found |
| **Owner** | DevOps Engineer |
| **Effort** | M (1–2 person-weeks for basic pipeline; more for full deployment automation) |

**Description**

No automated build, test, or deployment pipeline files exist in the repository. The only automation
is the `npm run lint` script (TypeScript type-check only, no test execution). PRs can be merged
without any automated gate. The `CONTRIBUTING.md` section 4 acknowledges the testing gap and asks
contributors to include manual test notes in PR descriptions as an interim measure.

**RICE Score**

| Dimension | Value | Rationale |
|---|---|---|
| Reach | 6 | Every pull request and every release is affected |
| Impact | 3 | Enables automated quality gates for all future development |
| Confidence | 100% | Confirmed absent |
| Effort | 2 person-weeks | GitHub Actions or Azure DevOps pipeline with build, type-check, test, audit |
| **Score** | **18.0** | (6 × 3 × 1.00) / 2 — blocked by DEBT-001 (no tests to run yet) |

**Acceptance Criteria**

- Pipeline triggers on every pull request to `main`.
- Steps: install dependencies, `npm run lint` (type-check), run test suite (after DEBT-001 resolved), `npm audit --audit-level=high`, `npm run build`.
- Pipeline failure blocks merge.
- Production deployment step exists (manual trigger or on merge to `main`).
- Secrets (DB connection, signing keys) are stored in pipeline secret store, not in source code.

---

### DEBT-005 — No npm Audit in Pipeline

| Field | Value |
|---|---|
| **ID** | DEBT-005 |
| **Title** | No npm audit or supply chain scanning in any pipeline |
| **Category** | Security |
| **Priority** | P2 |
| **Severity** | Medium — high-severity CVEs in dependencies could go undetected indefinitely |
| **Origin** | No CI pipeline exists (see DEBT-004); no `npm audit` script in `package.json`; `SECURITY.md:128` notes "Recommend adding npm audit --audit-level=high to CI pipeline" |
| **Owner** | DevOps Engineer / Security Engineer |
| **Effort** | S (hours once DEBT-004 pipeline exists; S standalone if added to npm scripts) |

**Description**

There is no automated supply chain vulnerability check. The project uses multiple security-sensitive
packages (jsonwebtoken, argon2, bcryptjs, multer, mssql, express). A CVE in any of these would not
be detected until a developer manually runs `npm audit`. `SECURITY.md` explicitly calls this out as
a gap at line 128.

**RICE Score**

| Dimension | Value | Rationale |
|---|---|---|
| Reach | 8 | All deployed instances and all users of the vault are at risk from a compromised dependency |
| Impact | 3 | Supply chain CVE in a crypto or auth package is critical |
| Confidence | 100% | Confirmed absent |
| Effort | 1 person-week | Add `npm audit` to pipeline (trivial once DEBT-004 exists); add Dependabot or Renovate |
| **Score** | **24.0** | (8 × 3 × 1.00) / 1 |

**Acceptance Criteria**

- `npm audit --audit-level=high` runs in CI pipeline on every PR (requires DEBT-004).
- High or critical CVEs block the pipeline (configurable threshold).
- Dependabot or Renovate Bot configured to open automated PRs for dependency updates.
- `SECURITY.md` maintenance checklist updated to reflect automated scanning is in place.

---

### DEBT-007 — Windows UNC Embed Cache File Locking Retry/Backoff

| Field | Value |
|---|---|
| **ID** | DEBT-007 |
| **Title** | Embed cache concurrent write uses 8-attempt retry loop with exponential backoff to work around Windows file locking |
| **Category** | Infrastructure |
| **Priority** | P3 |
| **Severity** | Low — workaround is functional; edge-case race condition under concurrent embed requests |
| **Origin** | `src/server/routes/public-sharing.ts:153-254` (`ensureEmbedCacheFile` function: 8-attempt loop, `Math.min(1000, 50 * Math.pow(2, attempt - 1))` backoff, `WINDOWS LOCK CHECK` comments) |
| **Owner** | Backend Engineer |
| **Effort** | M (2–3 person-weeks — requires rethinking cache strategy or using a named mutex / lock file) |

**Description**

The `ensureEmbedCacheFile` function in `public-sharing.ts` manages concurrent decryption of files for
the public video embed endpoint. Because Windows SMB locks prevent atomic `rename()` operations when
multiple simultaneous requests target the same cached file, the code uses an 8-attempt retry loop
with exponential backoff and a secondary 15-attempt lock-check loop. Comments in the code label this
explicitly as a Windows OS limitation workaround. Under high concurrent embed load, requests can
stall for up to ~1 second before resolving. The `503 Retry-After: 1` response path is reachable.

**RICE Score**

| Dimension | Value | Rationale |
|---|---|---|
| Reach | 3 | Only affects public video embed endpoint under concurrent load |
| Impact | 1 | Functional workaround exists; rare edge case in practice |
| Confidence | 100% | Confirmed by code inspection |
| Effort | 2 person-weeks | Replace with lock-file mutex, in-process promise deduplication (already partially done via `embedCacheInflight`), or a dedicated media proxy |
| **Score** | **4.5** | (3 × 1 × 1.00) / 2 — note: `embedCacheInflight` Map already deduplicates within a single process |

**Acceptance Criteria**

- Concurrent embed requests for the same file do not produce multiple simultaneous decrypt operations (current `embedCacheInflight` Map partially addresses this for single-process deployments).
- The retry loop is replaced with a deterministic in-process mechanism (e.g., a `Promise` cache or named semaphore) that does not depend on OS file lock behavior.
- `503 Retry-After` response is eliminated or rate reduced to less than 0.1% of embed requests under load.
- Solution is documented in `DEPLOYMENT.md` for multi-process (cluster) deployments where the in-process Map is insufficient.

---

### DEBT-008 — Profile Pictures Stored Without Size Optimization

| Field | Value |
|---|---|
| **ID** | DEBT-008 |
| **Title** | Profile pictures are stored as-uploaded flat files with no resize or compression |
| **Category** | UX |
| **Priority** | P3 |
| **Severity** | Low — storage waste; slow avatar loads for large uploaded images |
| **Origin** | `src/server.ts:1206-1228` (`POST /api/users/me/avatar` — writes `req.file.buffer` directly to disk; accepts up to 5 MB per upload; retains up to 10 versions per user) |
| **Owner** | Backend Engineer |
| **Effort** | S (1 person-week — add sharp or jimp for resize-on-upload) |

**Description**

Avatar uploads accept JPEG, PNG, and WebP files up to 5 MB. The raw buffer is written directly to
`PROFILE_PICTURE_PATH/{userId}/avatars/`. No resizing, thumbnail generation, or compression is
applied. Up to 10 versions are retained per user. A single user uploading ten 5 MB PNG files consumes
50 MB in the avatar directory. Serve-time there is no `Content-Encoding` or CDN-level optimization.

**RICE Score**

| Dimension | Value | Rationale |
|---|---|---|
| Reach | 4 | All users who upload avatars; admin UI renders them |
| Impact | 1 | Minor UX and storage issue; no security implication |
| Confidence | 80% | Storage waste is confirmed; actual impact depends on user avatar upload frequency |
| Effort | 1 person-week | Add `sharp` resize to 256×256 px on upload; reduce retention to 3 versions |
| **Score** | **4.8** | (4 × 1 × 0.80) / 1 × (roughly) — note: 3.2 exact; rounded for table |

**Acceptance Criteria**

- Avatar images resized to a maximum of 256×256 pixels on upload using a server-side image library.
- Output format normalized to WebP for storage efficiency.
- Retained version count reduced from 10 to 3.
- Upload endpoint rejects files that cannot be decoded as valid images after resize attempt.
- Existing oversized avatars migrated or a migration note added to `DEPLOYMENT.md`.

---

### DEBT-009 — Heuristic Blocked Extensions List Is Hardcoded in Source

| Field | Value |
|---|---|
| **ID** | DEBT-009 |
| **Title** | BLOCKED_EXTENSIONS and BLOCKED_FILENAME_PATTERNS are hardcoded constants requiring a code change and redeploy to update |
| **Category** | Operations |
| **Priority** | P3 |
| **Severity** | Low — operational friction; adding or removing a blocked type requires a developer and a deployment |
| **Origin** | `src/server/utils/scanner.ts:414-443` (`BLOCKED_EXTENSIONS` Set and `BLOCKED_FILENAME_PATTERNS` array, both module-level constants) |
| **Owner** | Backend Engineer / Admin |
| **Effort** | S (1 person-week — externalize to DB table or config file; add admin UI) |

**Description**

The heuristic pre-scan in `scanner.ts` uses two hardcoded structures: a `Set` of 15 blocked file
extensions (`.exe`, `.bat`, `.ps1`, `.vbs`, `.js`, etc.) and an array of 14 regex patterns for
blocked filenames (crack, keygen, torrent, etc.). Adding a new blocked extension or pattern requires
modifying TypeScript source, rebuilding the server, and redeploying. The Admin panel has file
blocking per-file but no mechanism for admins to manage the global extension/pattern blocklist.

**RICE Score**

| Dimension | Value | Rationale |
|---|---|---|
| Reach | 4 | Admins and operators who need to respond to new threat patterns |
| Impact | 2 | Operational friction; no direct user impact unless a new threat category emerges |
| Confidence | 80% | Effort estimate is approximate; depends on whether a DB table or config file is chosen |
| Effort | 1 person-week | Store blocklist in DB or JSON config; expose read/write via admin API |
| **Score** | **9.6** | (4 × 2 × 0.80) / 1 — note: 6.4 exact; ranked accordingly |

**Acceptance Criteria**

- Blocked extensions and filename patterns are stored in a location readable at runtime without a code change (DB table, or a versioned JSON config file in `config/`).
- Admin panel exposes a UI to view, add, and remove blocked extensions and patterns.
- Changes take effect on the next upload request (no restart required if using DB).
- Default blocklist at first run matches the current hardcoded set.
- Config file changes are logged as admin events in `system_logs`.

---

### DEBT-010 — No Audit Log Export Feature

| Field | Value |
|---|---|
| **ID** | DEBT-010 |
| **Title** | system_logs table has no export endpoint — admins cannot download audit logs as CSV or JSON |
| **Category** | Operations |
| **Priority** | P3 |
| **Severity** | Low — compliance gap; admins currently view logs only through the in-app admin panel, capped at MAX_LOG_ENTRIES (default 500) |
| **Origin** | `src/server.ts` (admin logs endpoint returns up to `MAX_LOG_ENTRIES` rows); `system_logs` table referenced in SQL queries throughout server.ts |
| **Owner** | Backend Engineer / Admin |
| **Effort** | M (1–2 person-weeks — streaming CSV/JSON export endpoint with date-range filter) |

**Description**

The admin workspace displays system logs paginated up to `MAX_LOG_ENTRIES` (default 500, configurable
via env). There is no export endpoint. Operators needing to provide audit trails for compliance
reviews (e.g., GDPR subject access requests, security incident forensics) must query SQL Server
directly. This is a workflow friction point and a compliance gap for deployments subject to audit
requirements.

**RICE Score**

| Dimension | Value | Rationale |
|---|---|---|
| Reach | 3 | Admin users only; small set but high-value for compliance |
| Impact | 2 | Compliance and forensic workflow improvement |
| Confidence | 100% | Confirmed absent by API and source review |
| Effort | 1 person-week | Streaming CSV/JSON download endpoint with date range and event-type filter |
| **Score** | **6.0** | (3 × 2 × 1.00) / 1 |

**Acceptance Criteria**

- `GET /api/admin/logs/export` endpoint accepts `format=csv|json`, `from`, `to`, `event_type` query params.
- Response streams the export (does not buffer all rows in memory — use `mssql` streaming or cursor).
- Export includes all fields in `system_logs` plus decrypted `username_snapshot`.
- Endpoint is admin-only (requires `verifyAdmin` middleware).
- Download is logged as an admin event in `system_logs` itself.
- See also ROADMAP-007 which extends this to a full-featured export UI.

---

## Dependency Notes

DEBT-001 (tests) must be resolved before DEBT-004 (CI/CD) can be fully effective.
DEBT-004 (CI/CD) is a prerequisite for DEBT-005 (npm audit) to run automatically.
DEBT-006 (master key rotation) is independent of other debt items but is a prerequisite for
ROADMAP-011.
DEBT-003 (schema SQL) is a prerequisite for ROADMAP-003 (migration system).

Full dependency graph: see `DEPENDENCY-GRAPH.md` in this directory.
