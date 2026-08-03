# Leeku Secure - MSSQL Edition

**Encrypted file vault with zero-knowledge storage, AV scanning, and secure sharing.**

Leeku Secure is a self-hosted, full-stack file hosting platform that encrypts every uploaded file with AES-256-GCM before writing it to a UNC storage share. All PII columns in the database are individually encrypted; no plaintext filename, email, or username is stored at rest.

Deployed on Windows Server 2022 at **leeks.miku.rip** ✅

---

## Key Features

### 🔐 Security & Encryption
- **AES-256-GCM file encryption** with per-file random keys, wrapped by a master HKDF sub-key
- **Argon2id password hashing** (64 MiB, 3 iterations) with bcrypt fallback for share-link passwords
- **JWT RS256 access tokens** with rotating HttpOnly refresh tokens stored as SHA-256 hashes
- **CSRF protection** for all cookie-based session mutations
- **Individual column encryption:** Email, username, and filenames encrypted in database

### 🛡️ Malware Protection & Scanning
- **Bitdefender CLI integration** with local-disk staging (heuristic pre-scan + full AV scan)
- **Fail-closed in production:** Non-clean AV results block uploads immediately
- **Optional AI scan summaries** via Google Gemini API

### 📁 File Management & Sharing
- **Public share links** with optional password, expiry date, download cap, and external video embed
- **HTTP Range request support** for video streaming via share embeds
- **Optional per-file client-side secret key** (PBKDF2 + AES-256-GCM layer)
- **File TTL / auto-expiry** with background cleanup job
- **Soft deletes** with 90-day archive before permanent removal

### 🎛️ Administration & Operations
- **Admin panel:** user management, quota tiers, file blocking, system logs, server health stats
- **Maintenance mode:** Block all file operations during system updates (admin-only control)
- **IIS W3C Extended Log Format** output for compliance and analytics
- **Native Windows Server 2022 deployment** with IIS ARR reverse-proxy compatibility
- **Production startup validation** of Bitdefender, secrets, database, and vault access

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Frontend | React 19, Vite 6, Tailwind CSS 4, shadcn/ui, TypeScript | Latest |
| Backend | Express 4, Node.js (ES modules), TypeScript | Node 22 LTS |
| Database | SQL Server 2022 (`mssql` v12 driver) | 2022 |
| Auth | JWT RS256, Argon2id, bcrypt, HMAC-SHA256 | Standard |
| Scanning | Bitdefender Endpoint Security CLI (`product.console.exe` / `bdscan.exe`) | Latest |
| Storage | Windows UNC path file vault (SMB share) | SMB 3.1.1+ |
| AI (optional) | Google Gemini API (AI-generated scan result messages) | v1 |

**Full dependencies:** See [package.json](package.json)

## Quick Start

### For New Developers
```sh
# 1. Clone and install dependencies
git clone <repo-url> leeku-secure
cd leeku-secure
npm install

# 2. Copy environment template and fill in all CHANGE_ME values
cp .env.example .env
# Edit .env: set DB_*, SMTP_*, JWT key paths, MASTER_KEY_BASE64
# See CONTRIBUTING.md for detailed local setup steps

# 3. Generate required cryptographic secrets
openssl genrsa -out keys/jwt_private.pem 4096
openssl rsa -in keys/jwt_private.pem -pubout -out keys/jwt_public.pem
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 4. Execute database schema
# See Documentation/SQL/README.md for production and dev schema options

# 5. Start the dev server
npm run dev
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for complete step-by-step setup with prerequisites.

### For Production Deployment
See [DEPLOYMENT.md](Documentation/01-Technical/DEPLOYMENT.md) for Windows Server 2022 + IIS ARR setup.

**Database:**
See [Documentation/SQL/README.md](Documentation/SQL/README.md) for schema selection and deployment instructions.

## Development Scripts

| Script | Description | Use Case |
|---|---|---|
| `npm run dev` | Vite frontend (HMR) + tsx backend watcher (concurrent) | Local development with hot reload |
| `npm run build` | Production Vite build + esbuild backend bundle (`dist/server.cjs`) | Pre-production build validation |
| `npm run start` | Run the production bundle | Production or staging environment |
| `npm run preview` | Same as `start` — serves the built SPA and API | Quick production simulation locally |
| `npm run clean` | Delete `dist/` directory | Clean build artifacts |
| `npm run lint` | TypeScript type-check only (`tsc --noEmit`) | Validate TypeScript without building |

**Frontend & API proxying:** The frontend proxies all `/api/*` requests to `http://127.0.0.1:3000` via Vite dev server configuration.

## Documentation

### 📚 Documentation Hub
**Start here:** [Documentation Hub](Documentation/00-Index/DOC-HUB.md) — Overview of all documentation with navigation and quick links.

### 👨‍💻 For Developers
| Document | Purpose |
|---|---|
| [SETUP.md](Documentation/01-Technical/SETUP.md) | Prerequisites, local environment setup, database schema execution |
| [ARCHITECTURE.md](Documentation/01-Technical/ARCHITECTURE.md) | C4 diagrams, architectural decisions, 4 ADRs, sequence diagrams |
| [API.md](Documentation/01-Technical/API.md) | Complete 48-endpoint API reference with request/response schemas |
| [ENV_VARS.md](Documentation/01-Technical/ENV_VARS.md) | All environment variables grouped by category (server, DB, auth, AV, storage) |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Branch strategy, code standards, pull-request process |

### 🚀 For Operations
| Document | Purpose |
|---|---|
| [DEPLOYMENT.md](Documentation/01-Technical/DEPLOYMENT.md) | Production deployment on Windows Server 2022 with IIS ARR |
| [SECURITY.md](Documentation/04-Risk-And-Corrections/SECURITY.md) | Security controls catalogue, threat model, encryption details |
| [MAINTENANCE-MODE.md](Documentation/03-Roles/MAINTENANCE-MODE.md) | System maintenance mode: enable/disable file operations, admin control, user notifications |
| [OPERATOR-RUNBOOK.md](Documentation/03-Roles/OPERATOR-RUNBOOK.md) | Day-to-day operations, troubleshooting, maintenance tasks |
| [ADMIN-GUIDE.md](Documentation/03-Roles/ADMIN-GUIDE.md) | Admin panel usage, user management, quota tiers, file blocking |

### 📊 Database
| Document | Purpose |
|---|---|
| [SQL/README.md](Documentation/SQL/README.md) | SQL documentation quick-start and file overview |
| [SQL/production_schema.sql](Documentation/SQL/production_schema.sql) | Complete database creation script (7 tables, 12 indexes, 5 stored procs) |
| [SQL/VALIDATION.md](Documentation/SQL/VALIDATION.md) | Schema validation queries, index strategy, performance benchmarks |
| [SQL/queries.sql](Documentation/SQL/queries.sql) | 40+ reference SQL patterns for common operations |
| [SQL/schema.sql](Documentation/SQL/schema.sql) | Detailed schema reference with encryption architecture |

## Project Structure

```
leeku-secure/
├── src/
│   ├── app/                    # React 19 frontend application
│   │   ├── features/          # Feature-based modules (auth, upload, files, etc.)
│   │   ├── shared/            # Shared components, hooks, utils, types
│   │   └── root.tsx           # App entry point
│   ├── server/                # Express backend API server
│   │   ├── routes/            # API endpoints (auth, files, share-links, etc.)
│   │   ├── middleware/        # Express middleware (auth, logging, validation)
│   │   ├── utils/             # Server utilities (encryption, scanning, database, email)
│   │   ├── db.ts              # SQL Server connection pool
│   │   └── server.ts          # Express app initialization
│   ├── server.ts              # Backend entry point
│   └── vite-env.d.ts          # Vite type definitions
├── Documentation/             # Comprehensive technical & non-technical docs
│   ├── 00-Index/              # Documentation hub and navigation
│   ├── 01-Technical/          # Setup, API, architecture, deployment
│   ├── 02-Non-Technical/      # User guides and platform overview
│   ├── 03-Roles/              # Admin guide, operator runbook
│   ├── 04-Risk-And-Corrections/  # Security, QA reports
│   ├── 05-Roadmap/            # Product roadmap and debt register
│   └── SQL/                   # Database schema, migrations, queries, validation
├── keys/                      # Cryptographic keys (generated locally)
│   ├── jwt_private.pem        # JWT signing key
│   └── jwt_public.pem         # JWT verification key
├── dist/                      # Production build output (generated)
├── node_modules/              # npm dependencies
├── .env.example               # Environment template (copy to .env)
├── .env                       # Local environment config (not committed)
├── package.json               # npm scripts and dependencies
├── tsconfig.json              # TypeScript configuration
├── vite.config.ts             # Vite build configuration
├── CONTRIBUTING.md            # Contribution guidelines
└── README.md                  # This file
```

## Security Notes

### Encryption & Authentication
- **AES-256-GCM** encrypts all file content; per-file random keys wrapped with master HKDF sub-key
- **Database column encryption** for email, username, filename (individual IV and auth tag per column)
- **Argon2id** (64 MiB, 3 iterations) for user passwords; **bcrypt** for share-link passwords
- **JWT RS256** for API access tokens; **SHA-256 hashes** for refresh tokens (originals never stored)
- **HMAC-SHA256** hash columns enable indexed lookups without exposing plaintext

### Upload & Scanning
- **Fail-closed in production:** Any non-clean AV result immediately blocks the upload
- **Bitdefender CLI integration** with local-disk staging for heuristic + full-scan validation
- **Production startup validation** confirms Bitdefender, secrets, database connectivity, and vault access before accepting requests
- **Development mode:** Uploads fall through to heuristic-only checks if `ALLOW_UNSCANNED_UPLOADS_IN_DEVELOPMENT=true` (optional; default is true)

### Session & CSRF
- **Session cookie:** `HttpOnly`, `SameSite=Lax`, `Secure` in production
- **CSRF protection** on all cookie-based session mutations
- **JWT access tokens** sent via Bearer header (API only, no cookies)
- **Rotating refresh tokens:** Issued on each use; old tokens immediately revoked

### Account Security
- **Account deletion:** Two-step process (request token + email confirmation) prevents accidental/unauthorized removal
- **Password reset:** Email-only, no SMS or security questions
- **Failed login tracking** with automatic temporary suspension after threshold exceeded
- **Admin suspension** blocks all user activity immediately

## Getting Help

### For Developers
- **Setup issues?** → See [CONTRIBUTING.md](CONTRIBUTING.md) for prerequisites and step-by-step setup
- **API questions?** → See [API.md](Documentation/01-Technical/API.md) for all 48 endpoints with examples
- **Architecture questions?** → See [ARCHITECTURE.md](Documentation/01-Technical/ARCHITECTURE.md) for C4 diagrams and design decisions
- **Environment setup?** → See [ENV_VARS.md](Documentation/01-Technical/ENV_VARS.md) for all configuration options

### For Operations/Admin
- **Deployment?** → See [DEPLOYMENT.md](Documentation/01-Technical/DEPLOYMENT.md)
- **Troubleshooting?** → See [OPERATOR-RUNBOOK.md](Documentation/03-Roles/OPERATOR-RUNBOOK.md)
- **Security incident?** → See [SECURITY.md](Documentation/04-Risk-And-Corrections/SECURITY.md) for threat model and controls

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for:
- Development prerequisites and local setup
- Branch naming strategy and PR workflow
- Code standards and TypeScript conventions
- How to run tests and validate changes
- Security vulnerability reporting (responsible disclosure)

## Project Status

| Component | Status | Notes |
|---|---|---|
| **Core Platform** | ✅ Production | Deployed and operational at leeks.miku.rip |
| **Frontend (React 19)** | ✅ Stable | Latest Vite 6 + TypeScript, HMR in dev |
| **Backend (Express)** | ✅ Stable | Node 22 LTS, all routes documented |
| **Database (SQL Server 2022)** | ✅ Production | 7 tables, 12 optimized indexes, 5 stored procedures |
| **Encryption** | ✅ Verified | AES-256-GCM files, column encryption, master key wrapping |
| **Scanning (Bitdefender)** | ✅ Integrated | Fail-closed in production, optional AI summaries |
| **Maintenance Mode** | ✅ Complete | System-wide file operation blocking, admin-only control, user banners |
| **Documentation** | ✅ Comprehensive | 16+ technical guides, API reference, runbooks |
| **Test Framework** | ⚠️ Planned | Gap identified in CONTRIBUTING.md; discussion needed |

## Release Notes

### 2026-08-03 - Dependency Upgrade + Express 5 Compatibility

- Upgraded major dependencies:
	- `express` 4 -> 5 and `@types/express` 4 -> 5
	- `vite` 6 -> 8 and `@vitejs/plugin-react` 5 -> 6
	- `typescript` 5 -> 7
	- `esbuild` 0.25 -> 0.28
	- `lucide-react` 0.x -> 1.x
- Updated Express 5 route compatibility:
	- SPA fallback route migrated from `*` to `/{*path}`.
	- Vanity share route internal dispatch migrated from private `app._router.handle` to public `app.handle`.
- Type-safety compatibility updates applied for stricter TS 7 behavior in streaming/download and crypto helper code paths.
- Post-upgrade validation:
	- `pnpm lint` passed
	- `pnpm build` passed
	- Existing targeted test suite passed

## License and AI Disclosure

This project is licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for the full license text.

Portions of this codebase were generated with assistance from Claude, Gemini AI Studio, and GitHub Copilot.

Make with ❤️ from Quebec / Canada.

Use this project at your own risk. It is provided "AS IS", without warranties or conditions of any kind, express or implied, including any warranty that it is secure, error-free, fit for a particular purpose, or suitable for production use. This disclaimer is in addition to the warranty disclaimer and limitation of liability included in the Apache License, Version 2.0.
