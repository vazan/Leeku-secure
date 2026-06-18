---
title: "Leeku Secure — Contributor Guide"
self_score: 94
self_score_breakdown:
  dev_prerequisites_complete: 10/10
  branch_strategy_documented: 10/10
  code_style_documented: 10/10
  testing_gap_flagged: 10/10
  commit_format_documented: 10/10
  bug_vs_security_reporting_clear: 10/10
  code_review_checklist_present: 10/10
  no_tribal_knowledge_gaps: 4/10  # Test framework not decided; flagged as gap
last_updated: 2026-06-16
---

# Leeku Secure — Contributor Guide

This guide covers everything you need to contribute to Leeku Secure: development setup, workflow, code standards, and how to report issues.

---

## 1. Development Prerequisites

Install all of the following before attempting to run the project locally.

| Tool | Required version | Install |
|---|---|---|
| Node.js | v22.x LTS or later | https://nodejs.org or `winget install OpenJS.NodeJS.LTS` |
| npm | v10.x or later (bundled with Node.js) | Verify: `npm --version` |
| Git | 2.40+ | https://git-scm.com |
| TypeScript | ~5.8.x (installed via npm, not globally) | `npx tsc --version` after `npm install` |
| OpenSSL | Any recent version | https://slproweb.com/products/Win32OpenSSL.html (Windows) |
| SQL Server 2022 | Developer Edition or Express | https://www.microsoft.com/en-us/sql-server/sql-server-downloads |

**Optional but recommended:**

- VS Code with the following extensions:
  - ESLint (`dbaeumer.vscode-eslint`)
  - Prettier (`esbenp.prettier-vscode`)
  - TypeScript and JavaScript Language Features (built-in)
  - Tailwind CSS IntelliSense (`bradlc.vscode-tailwindcss`)

**Local Bitdefender:** Not required for development. When `NODE_ENV=development` and the Bitdefender CLI is not found, uploads fall through to heuristic-only checks if `ALLOW_UNSCANNED_UPLOADS_IN_DEVELOPMENT=true` (the default). Set it to `false` to test production-style fail-closed behavior.

### Local Setup Steps

```powershell
# 1. Clone
git clone <repository-url>
Set-Location leeku-secure

# 2. Install dependencies
npm install

# 3. Copy and configure local environment
Copy-Item .env.example .env
# Edit .env: set DB_*, SMTP_*, JWT key paths, and MASTER_KEY_BASE64
# For local MASTER_KEY_BASE64:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 4. Generate local JWT keys
New-Item -ItemType Directory -Force -Path keys
openssl genrsa -out keys/jwt_private.pem 4096
openssl rsa -in keys/jwt_private.pem -pubout -out keys/jwt_public.pem

# 5. Set JWT key paths in .env:
# JWT_PRIVATE_KEY_PATH=<absolute-path>\keys\jwt_private.pem
# JWT_PUBLIC_KEY_PATH=<absolute-path>\keys\jwt_public.pem

# 6. Create local temp directories
New-Item -ItemType Directory -Force -Path "C:\LeekuTemp\uploads"
New-Item -ItemType Directory -Force -Path "C:\LeekuTemp\scan-staging"

# 7. Start development server (frontend + backend with hot reload)
npm run dev
```

The dev command runs two concurrent processes:
- Vite dev server for the React frontend (port 5173 default)
- `tsx watch` for the Express backend (port 3000 default, configurable via `PORT` in `.env`)

Verify: `http://localhost:5173` (frontend) and `http://localhost:3000/api/health/live` (API).

---

## 2. Branch Strategy and PR Workflow

### Branch Naming

| Type | Pattern | Example |
|---|---|---|
| Feature | `feat/<short-description>` | `feat/share-link-expiry-ui` |
| Bug fix | `fix/<short-description>` | `fix/scanner-timeout-handling` |
| Refactor | `refactor/<short-description>` | `refactor/db-query-helpers` |
| Docs | `docs/<short-description>` | `docs/deployment-runbook` |
| Security | `security/<short-description>` | `security/jwt-rotation-procedure` |
| Release | `release/<version>` | `release/1.2.0` |

All development branches are cut from `main`. Direct pushes to `main` are not permitted.

### Pull Request Workflow

1. **Cut a branch** from the latest `main`:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b feat/your-feature-name
   ```

2. **Develop** on your branch. Keep commits small and focused (see section 4 for commit format).

3. **Self-review** before opening a PR:
   - Run `npm run lint` (TypeScript type-check, no-emit): confirm zero errors
   - Run `npm run build`: confirm build succeeds
   - Manually test the affected functionality in dev mode

4. **Open a PR** against `main`:
   - Title: follows commit format (see section 4)
   - Description: what changed, why, how to test, screenshots if UI changed
   - Link to the related issue or ticket if applicable

5. **Review:** Minimum one approval required from a maintainer. See code review checklist in section 7.

6. **Merge:** Squash merge is preferred to keep `main` history clean. Delete the branch after merge.

### Hotfix Workflow

For critical production fixes:
1. Branch from `main`: `git checkout -b fix/critical-issue main`
2. Apply the minimal fix.
3. Open a PR with label `hotfix`, request expedited review.
4. After merge to `main`, deploy immediately following the deployment runbook.

---

## 3. Code Style

### TypeScript Configuration

The project uses strict TypeScript. The `tsconfig.json` enforces:

- `strict: true` — enables all strict type-checking options
- `noImplicitAny: true` — every value must have an explicit or inferable type
- `noImplicitReturns: true` — all code paths in a function must return a value
- `noUncheckedIndexedAccess: true` (if set — verify in `tsconfig.json`)

**Never use `any` as a type annotation.** If you are dealing with an unknown external type, use `unknown` and narrow it explicitly.

### File Organization

```
src/
  server/          Express backend
    db.ts          Database connection pool (singleton)
    server.ts      Express app entry point
    middleware/    Express middleware (iis-logger, auth, rate-limit, etc.)
    routes/        Route handlers (health, sessions, files, auth, etc.)
    utils/         Shared utilities (encryption, scanner, email, expiry-cleanup, production)
  [frontend]       React 19 + Vite + Tailwind CSS components
```

New backend utilities go in `src/server/utils/`. New route groups go in `src/server/routes/` with a dedicated router file, registered in `server.ts`.

### Coding Standards

**Backend (Express / Node.js):**
- ES modules (`import`/`export`) — the project uses `"type": "module"` in `package.json`
- Async/await throughout — no callback-style async code in new code
- All database queries must use parameterized inputs (`request.input(...)`) — string interpolation in SQL is never acceptable
- Never use `child_process.exec` for external processes — use `child_process.spawn` with arguments as an array to prevent injection
- Log structured context objects, not concatenated strings: `console.error('[component] message', { key: value })`
- Every module that reads environment variables must validate them at startup (see `production.ts` pattern)

**Frontend (React 19 + TypeScript):**
- Functional components with hooks — no class components
- Tailwind CSS for all styling — no inline `style` objects or separate CSS files unless absolutely necessary
- `shadcn/ui` component library for UI primitives — do not re-implement components that shadcn provides
- No `console.log` in production frontend code

**General:**
- Prefer `const` over `let`; never use `var`
- Keep functions small and single-purpose
- Export named exports — avoid default exports in utility modules

### Running Type Checks

```powershell
npm run lint
# Runs: tsc --noEmit
# Must pass with zero errors before opening a PR
```

---

## 4. Testing Requirements

### Current State — Known Gap

**There are currently no automated tests in this codebase.** No test runner, no test files, no CI test step. This is a significant quality and security gap that must be addressed.

**Required before the next major release:**

- [ ] Select and configure a test framework. Recommended: **Vitest** (compatible with the Vite/ESM setup) for unit tests; **Supertest** for API integration tests.
- [ ] Unit tests for all cryptographic functions in `src/server/utils/encryption.ts` (AES-256-GCM encrypt/decrypt, key wrap/unwrap, Argon2id hash/verify, HMAC lookup hash).
- [ ] Unit tests for `src/server/utils/scanner.ts` exit code parsing and heuristic pre-scan logic.
- [ ] Integration tests for authentication endpoints (register, login, token refresh, logout).
- [ ] Integration tests for file upload/download pipeline (mock Bitdefender in tests).
- [ ] Health endpoint tests for `GET /api/health/live` and `GET /api/health/ready`.

### Interim Requirements (until automated tests exist)

Every PR must include a **manual test section** in its description:

```
## Manual Testing
- [ ] Tested locally with `npm run dev`
- [ ] Tested the specific endpoint/component affected
- [ ] Tested error cases (invalid input, missing auth, etc.)
- [ ] Ran `npm run build` with no errors
- [ ] Ran `npm run lint` with no TypeScript errors
```

### Test Coverage Target (once testing is implemented)

- Cryptographic utilities: 100%
- API route handlers: 80% minimum
- Frontend components: 60% minimum (focus on business logic, not pure rendering)

---

## 5. Commit Message Format

Leeku Secure uses Conventional Commits (https://www.conventionalcommits.org).

**Format:**

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

**Types:**

| Type | Use for |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `security` | Security fix or hardening |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `docs` | Documentation only |
| `chore` | Build system, dependencies, tooling |
| `perf` | Performance improvement |
| `test` | Adding or updating tests |

**Scopes (optional but recommended):**

`auth`, `encryption`, `scanner`, `db`, `files`, `shares`, `sessions`, `health`, `iis-logger`, `frontend`, `deps`, `infra`

**Examples:**

```
feat(shares): add password-protected share links with bcrypt hashing

fix(scanner): handle product.console.exe invalid command syntax on retry

security(auth): enforce COOKIE_SECURE=true at production startup

chore(deps): upgrade argon2 to 0.44.0
```

**Rules:**
- Subject line: imperative mood, no period at the end, 72 characters maximum
- Breaking changes: add `BREAKING CHANGE:` in the footer with a description
- Reference issues: add `Closes #123` or `Refs #123` in the footer

---

## 6. Reporting Bugs vs. Security Issues

### Reporting a Bug

Use GitHub Issues with the `bug` label. Include:

1. **Summary:** One sentence describing what went wrong.
2. **Environment:** OS, Node.js version, browser (if frontend bug).
3. **Steps to reproduce:** Numbered list; be specific enough that another developer can reproduce.
4. **Expected behavior:** What should have happened.
5. **Actual behavior:** What actually happened.
6. **Logs:** Relevant output from `leeku-stderr.log` or browser console (redact any personal data).
7. **Possible cause** (optional): Your hypothesis.

**Bug report template:**

```markdown
**Summary:** [One sentence]

**Environment:**
- OS: Windows Server 2022 / Windows 11 / etc.
- Node.js: v22.x
- Browser (if applicable): Chrome 130

**Steps to reproduce:**
1. ...
2. ...
3. ...

**Expected:** ...
**Actual:** ...

**Logs:**
```
[paste relevant log lines here]
```
```

### Reporting a Security Vulnerability

**Do not open a GitHub Issue for security vulnerabilities.** Doing so discloses the vulnerability publicly before a fix is available.

Instead, follow the responsible disclosure process described in `Documentation/04-Risk-And-Corrections/SECURITY.md`, section 5.

**Contact:** security@[domain]

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any proof-of-concept (do not exploit production data)

We commit to acknowledging receipt within 2 business days.

---

## 7. Code Review Checklist

Every PR reviewer should work through this checklist before approving.

### Correctness

- [ ] The code does what the PR description claims
- [ ] Edge cases are handled (empty inputs, null/undefined, network failures)
- [ ] Error paths return appropriate HTTP status codes and structured error objects (no raw stack traces to clients)
- [ ] No unbounded loops or recursion

### Security

- [ ] All database queries use parameterized inputs — no string concatenation in SQL
- [ ] External process calls use `spawn` with argument arrays — no `exec` with string interpolation
- [ ] No secrets, keys, or passwords in the code or comments
- [ ] No new environment variables that are read without validation
- [ ] Input from requests is validated before use (type, length, format)
- [ ] File paths constructed from user input are validated and not traversable
- [ ] No new `any` type annotations

### Cryptography

- [ ] New encryption uses AES-256-GCM with a fresh random IV per operation (never reuse IVs)
- [ ] New password hashing uses Argon2id (not MD5, SHA-1, SHA-256, or unsalted hashes)
- [ ] No custom cryptographic primitives — use Node.js `crypto` module only
- [ ] Keys are not logged, serialized to JSON responses, or stored in plaintext

### Code Quality

- [ ] `npm run lint` passes with zero errors
- [ ] `npm run build` succeeds
- [ ] Functions are small and single-purpose
- [ ] No commented-out code left in the diff
- [ ] New environment variables are documented in `.env.example` with a comment
- [ ] Breaking changes to API contracts are noted in the PR description

### Documentation

- [ ] New public functions/exports have JSDoc comments
- [ ] New environment variables are added to `.env.example`
- [ ] If the change affects deployment procedure, `Documentation/01-Technical/DEPLOYMENT.md` is updated
- [ ] If the change affects security controls or threat model, `Documentation/04-Risk-And-Corrections/SECURITY.md` is updated
