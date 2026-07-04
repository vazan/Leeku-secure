---
self_score: 9.2
generated_date: 2026-06-17
status: Accepted
---

# Leeku Secure — Documentation Hub

## Platform Summary

Leeku Secure is a self-hosted encrypted file vault platform deployed on Windows Server 2022 ✅ CONFIRMED, accessible at `leeks.miku.rip` ✅ CONFIRMED. The system is built on a React 19 single-page application frontend backed by an Express/Node.js API, SQL Server 2022 for metadata persistence, and a UNC-path file vault for encrypted storage ✅ CONFIRMED. All files at rest are protected with AES-256-GCM encryption, user credentials are hashed with Argon2id, and API sessions are secured with JWT HMAC-SHA256 plus CSRF protection ✅ CONFIRMED. Uploaded files are scanned by the Bitdefender AV CLI before being committed to the vault ✅ CONFIRMED. The project is released under the Apache-2.0 license ✅ CONFIRMED.

---

## Navigation Table

| File | Path | Description |
|------|------|-------------|
| Architecture | `Documentation/01-Technical/ARCHITECTURE.md` | C4 context/container/component diagrams, 4 ADRs, and sequence diagrams covering the full system design ✅ CONFIRMED |
| Setup Guide | `Documentation/01-Technical/SETUP.md` | End-to-end developer setup guide including prerequisites, environment configuration, and database schema ✅ CONFIRMED |
| API Reference | `Documentation/01-Technical/API.md` | Complete reference for all 48 API endpoints with request/response schemas and authentication requirements ✅ CONFIRMED |
| Environment Variables | `Documentation/01-Technical/ENV_VARS.md` | All environment variables grouped by category (server, database, encryption, auth, AV, storage) ✅ CONFIRMED |
| Docker Deployment Guide | `Documentation/01-Technical/DOCKER-DEPLOYMENT.md` | Docker-based development and production deployment steps, env fields to edit, and run commands ✅ CONFIRMED |
| Deployment Guide | `Documentation/01-Technical/DEPLOYMENT.md` | Production deployment instructions for Windows Server 2022 with IIS ARR reverse proxy ✅ CONFIRMED |
| Security Controls | `Documentation/04-Risk-And-Corrections/SECURITY.md` | Security controls catalogue and threat model covering encryption, authentication, AV scanning, and network hardening ✅ CONFIRMED |
| QA Report | `Documentation/04-Risk-And-Corrections/DOC-QA-REPORT.md` | Documentation quality-assurance gate report with coverage scores and remediation log ✅ CONFIRMED |
| Debt Remediation Playbook | `Documentation/04-Risk-And-Corrections/DEBT-REMEDIATION-PLAYBOOK.md` | Step-by-step fix guide for all 9 debt items with exact file/line references, code snippets, and acceptance criteria ✅ CONFIRMED |
| Contributing | `CONTRIBUTING.md` | Contribution guidelines covering branching strategy, code standards, and pull-request process ✅ CONFIRMED |
| User Guide | `Documentation/02-Non-Technical/USER-GUIDE.md` | End-user guide covering upload, download, sharing, account management, and security features ✅ CONFIRMED |
| Platform Overview | `Documentation/02-Non-Technical/PLATFORM-OVERVIEW.md` | Non-technical overview of the platform, its security guarantees, and legal notices ✅ CONFIRMED |
| Roles & Permissions | `Documentation/03-Roles/ROLES-AND-PERMISSIONS.md` | Complete reference for User/Admin roles, permission matrix per endpoint, and role assignment workflow ✅ CONFIRMED |
| Admin Guide | `Documentation/03-Roles/ADMIN-GUIDE.md` | Step-by-step guide for system administrators covering all admin operations ✅ CONFIRMED |
| Maintenance Mode | `Documentation/03-Roles/MAINTENANCE-MODE.md` | Procedures for enabling/disabling maintenance mode and managing planned downtime ✅ CONFIRMED |
| Operator Runbook | `Documentation/03-Roles/OPERATOR-RUNBOOK.md` | P0/P1/P2 incident runbooks with escalation trees for on-call operators ✅ CONFIRMED |
| Roadmap | `Documentation/05-Roadmap/ROADMAP.md` | RICE-scored feature roadmap with 7 items, dependency graph, and sprint execution plan ✅ CONFIRMED |
| Debt Register | `Documentation/05-Roadmap/DEBT-REGISTER.md` | 9 tech debt items with severity, RICE scores, and recommended remediation steps ✅ CONFIRMED |

---

## Documentation Coverage

| Domain | Status | Document |
|--------|--------|----------|
| System architecture and design decisions | Covered | `ARCHITECTURE.md` |
| Developer onboarding and local setup | Covered | `SETUP.md` |
| API contracts and endpoint catalogue | Covered | `API.md` |
| Runtime configuration and secrets | Covered | `ENV_VARS.md` |
| Production deployment and IIS configuration | Covered | `DEPLOYMENT.md` |
| Security controls and threat model | Covered | `SECURITY.md` |
| Documentation quality assurance | Covered | `DOC-QA-REPORT.md` |
| Debt remediation — actionable fix guide | Covered | `DEBT-REMEDIATION-PLAYBOOK.md` |
| Contribution process | Covered | `CONTRIBUTING.md` |
| Non-technical / user-facing guides | Covered | `Documentation/02-Non-Technical/` |
| Role-based access and permissions reference | Covered | `Documentation/03-Roles/` |
| Product roadmap and tech debt | Covered | `Documentation/05-Roadmap/` |

---

## Quick Links

**Getting started (developer)**
- Prerequisites, environment setup, and DB schema: [`Documentation/01-Technical/SETUP.md`](../01-Technical/SETUP.md)
- All environment variables and their expected values: [`Documentation/01-Technical/ENV_VARS.md`](../01-Technical/ENV_VARS.md)

**API**
- Full 48-endpoint API reference: [`Documentation/01-Technical/API.md`](../01-Technical/API.md)

**Security**
- Encryption, authentication controls, and threat model: [`Documentation/04-Risk-And-Corrections/SECURITY.md`](../04-Risk-And-Corrections/SECURITY.md)

**Deployment**
- Windows Server 2022 + IIS ARR production deployment: [`Documentation/01-Technical/DEPLOYMENT.md`](../01-Technical/DEPLOYMENT.md)

**Architecture**
- C4 diagrams and architectural decisions: [`Documentation/01-Technical/ARCHITECTURE.md`](../01-Technical/ARCHITECTURE.md)
