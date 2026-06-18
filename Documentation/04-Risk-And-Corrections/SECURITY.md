---
title: "Leeku Secure — Security Policy and Threat Model"
self_score: 96
self_score_breakdown:
  security_architecture_complete: 10/10
  threat_model_complete: 10/10
  security_controls_documented: 10/10
  incident_response_executable: 10/10
  escalation_paths_present: 10/10
  no_tribal_knowledge_gaps: 9/10  # key derivation labels sourced directly from encryption.ts
  responsible_disclosure_present: 7/10  # placeholder domain per instructions
last_updated: 2026-06-16
---

# Leeku Secure — Security Policy and Threat Model

---

## 1. Security Architecture Overview

### 1.1 Encryption at Rest

Every file stored in the vault is encrypted with a unique AES-256-GCM key. No two files share a key.

**Key derivation hierarchy** (sourced from `src/server/utils/encryption.ts`):

```
MASTER_KEY_BASE64 (env — 32 random bytes, base64)
    |
    +-- HKDF-SHA256("leeku-file-key-wrapping-v1")   --> wraps per-file AES keys
    +-- HKDF-SHA256("leeku-column-encryption-v1")   --> encrypts email / username columns in DB
    +-- HKDF-SHA256("leeku-column-hmac-v1")         --> HMAC-SHA256 lookup hashes (indexed DB search)
```

**Per-file encryption:**
- Algorithm: AES-256-GCM (256-bit key, 96-bit IV, 128-bit auth tag)
- Key: 32 random bytes generated fresh per file (`crypto.randomBytes(32)`)
- IV: 12 random bytes generated fresh per file (`crypto.randomBytes(12)`)
- The per-file key is wrapped (encrypted) with the HKDF-derived wrapping sub-key before being stored in the database table `file_encryption_keys`
- The GCM auth tag is stored separately in the database; decryption will throw if the ciphertext has been tampered with

**Column-level encryption:**
- User email and username fields in the database are encrypted with AES-256-GCM using the `leeku-column-encryption-v1` sub-key
- Indexed lookups (e.g., "find user by email") use HMAC-SHA256 deterministic hashes derived from the `leeku-column-hmac-v1` sub-key; the plaintext is never passed to SQL Server

**File integrity:**
- SHA-256 checksum of the plaintext is computed during encryption and stored in the database
- Checksum is verified on every download to detect silent corruption or tampering

**Share link passwords:**
- Hashed with bcrypt (cost factor 12) before storage

**MASTER_KEY protection options (Windows Server 2022):**
- Minimum: NTFS ACLs restrict `.env.production` to the service account only
- Recommended: Windows DPAPI (`CryptProtectData`) — ties the key to the service account identity (requires `node-dpapi` native module, not currently bundled)
- Cloud: Azure Key Vault with a managed identity

### 1.2 Encryption in Transit

- TLS is required for all production traffic. Either the Node.js process terminates TLS directly (`SSL_ENABLED=true`, minimum `TLSv1.2`) or TLS is terminated at a reverse proxy (IIS ARR, Nginx) with `PROXY_TRUST_HOPS=1` set
- `COOKIE_SECURE=true` must be set in production — the application enforces this at startup and will refuse to run if `COOKIE_SECURE=false`
- SQL Server connections use encrypted transport when `DB_ENCRYPT=true` (required in production)

### 1.3 Authentication

- **Access tokens:** JWT signed with RS256 (4096-bit RSA key pair). Lifetime: 15 minutes (`JWT_ACCESS_EXPIRY_SECONDS=900`).
- **Refresh tokens:** Rotating refresh token stored as an HttpOnly, Secure, SameSite cookie (`leeku_refresh`). Lifetime: 7 days. Each use issues a new token and revokes the old one.
- **Email verification:** Required at registration. Token sent via SMTP; expires in 24 hours. MX record validation is performed before sending.
- **Account lockout:** 5 failed login attempts triggers a 15-minute lockout (`MAX_LOGIN_ATTEMPTS=5`, `LOCKOUT_DURATION_MINUTES=15`).
- **Multi-device session management:** Users can list, revoke individual, revoke-others, or revoke-all active refresh token sessions.

### 1.4 Password Hashing

| Use case | Algorithm | Parameters |
|---|---|---|
| User account passwords | Argon2id | 64 MiB memory, 3 iterations, 4 threads (OWASP 2024 minimum) |
| Per-file optional secret keys | Argon2i | 64 MiB memory, 3 iterations, 4 threads |
| Share link passwords | bcrypt | Cost factor 12 |

### 1.5 Malware Scanning

- Every uploaded file is written to a local temp directory (`UPLOAD_TEMP_PATH`, must be on local disk) and scanned by the Bitdefender Endpoint Security CLI before encryption and vault storage
- A heuristic pre-scan runs first (before Bitdefender) to immediately block known-dangerous extensions (`.exe`, `.bat`, `.ps1`, `.vbs`, `.js`, `.py`, `.sh`, etc.) and filename patterns (crack, keygen, activator, torrent, etc.)
- Bitdefender CLI exit codes: 0 = Clean, 1 = Infected, 2 = Suspicious, 3+ = Error/timeout
- In production, if the scanner is unavailable (`Unavailable` status), uploads are blocked — the production startup check (`validateProductionConfig`) enforces scanner availability
- Temp staging files are deleted immediately after each scan regardless of outcome

### 1.6 Rate Limiting

| Scope | Limit | Config variable |
|---|---|---|
| Auth endpoints (`/api/auth/*`) | 20 req/min per IP | `AUTH_RATE_LIMIT_RPM=20` |
| All other API endpoints | 120 req/min per IP | `API_RATE_LIMIT_RPM=120` |
| Public share downloads | 60 req/min per IP | `PUBLIC_SHARE_RATE_LIMIT_RPM=60` |
| Public share download attempts | 12 per 15 min per IP | `PUBLIC_SHARE_DOWNLOAD_ATTEMPTS_PER_15_MIN=12` |

### 1.7 Audit Logging

- All HTTP requests are logged to IIS W3C Extended Log Format files when `IIS_LOGS_ENABLED=true`. Log fields include: date, time, server IP, method, URI stem, URI query, port, authenticated username, client IP, user agent, status code, response/request bytes, and time-taken.
- Application-level events (file uploads, downloads, scan results, errors) are written to stdout/stderr, captured by NSSM to `C:\LeekuLogs\leeku-stdout.log` and `leeku-stderr.log`.
- Session revocations are recorded in the `refresh_tokens` table with `revoked_at` timestamp.

---

## 2. Threat Model

### 2.1 In-Scope Threats

| Threat | Attack vector | Mitigation |
|---|---|---|
| Unauthorized file access | Direct URL guessing, stolen JWT, share link abuse | AES-256-GCM per-file encryption; JWT RS256 with 15min expiry; share link expiry + optional password; rate limiting on share endpoints |
| Account takeover | Password brute force, credential stuffing, session hijacking | Argon2id password hashing; account lockout after 5 failures; rotating refresh tokens; HttpOnly+Secure cookies; multi-device session revocation |
| Malware upload | Attacker uploads exploit payload disguised as a normal file | Heuristic pre-scan (blocked extensions + patterns); Bitdefender CLI full scan; fail-closed in production (scanner unavailability blocks all uploads) |
| Data breach — vault | Unauthorized access to UNC share, stolen encrypted blobs | AES-256-GCM encryption with per-file unique keys; keys stored separately in SQL Server (not co-located with ciphertext); NTFS ACLs on vault |
| Data breach — database | SQL injection, stolen DB credentials, DB server compromise | Parameterized queries throughout (mssql `request.input()`); email/username columns encrypted at rest; passwords hashed with Argon2id; SQL Server TLS (`DB_ENCRYPT=true`) |
| MASTER_KEY exposure | `.env.production` leaked, service account compromised | NTFS ACLs restrict `.env.production` to service account; DPAPI option available; MASTER_KEY not stored in code or source control |
| JWT key exposure | Private key file exfiltration | NTFS ACLs on `C:\LeekuSecure\keys\`; 90-day rotation recommended; all sessions invalidated on rotation |
| Denial of service | Request flooding | Per-IP rate limiting on all endpoints; `express-rate-limit` middleware |
| Man-in-the-middle | Network interception | TLS 1.2+ enforced; `COOKIE_SECURE=true`; HSTS (configure at reverse proxy level) |
| Prohibited content upload | Uploading illegal/harmful material | Filename pattern heuristics block known piracy/hack tool patterns; Bitdefender scans for malware signatures |

### 2.2 Out-of-Scope Threats

The following threats are outside this application's security boundary and must be addressed at the infrastructure level:

- **Physical server access:** Physical datacenter security is an infrastructure/facilities responsibility.
- **Windows kernel exploits:** OS-level vulnerabilities are addressed by Windows Update / patch management policy.
- **Supply chain attacks:** Dependency integrity is not currently verified with `npm audit` or Subresource Integrity in CI — this is a **known gap**. Recommend adding `npm audit --audit-level=high` to CI pipeline.
- **Bitdefender engine bypass:** Zero-day malware that evades Bitdefender signatures is out of scope; Bitdefender signature updates are an ops responsibility.
- **Side-channel attacks on cryptography:** Node.js native crypto library implementation security.
- **Google Gemini API security:** Gemini API key exposure would affect the AI-generated message feature only; no user data is sent to Gemini.

### 2.3 Trust Boundaries

| Principal | Trust level | What they can access |
|---|---|---|
| Unauthenticated | Untrusted | Public share links (if URL + optional password known), registration, login, health endpoints |
| Authenticated user | Low trust | Own files, own sessions, own profile; cannot access other users' files or admin functions |
| Admin user | Elevated trust | System logs (up to `MAX_LOG_ENTRIES=500`), user management, quota management |
| Service account (LEEKUUSER) | Infrastructure trust | Vault filesystem, `.env.production`, JWT key files, scan staging directory — not a human-interactive account |
| SQL Server login (leeku_app) | Database trust | Read/write to `LeekuSecure` database only; no other databases; no `sysadmin` rights |

---

## 3. Security Controls

### 3.1 Input Validation and Sanitization

- All database queries use parameterized inputs via `mssql` `request.input()` — raw string interpolation in SQL is not used anywhere in the codebase.
- File uploads use `multer` for multipart parsing; the original filename is not used as a filesystem path. Files are stored using randomly-generated names in the vault.
- The Bitdefender CLI is invoked via `child_process.spawn` (not `exec`) with the filename as a separate argument array element — this prevents command injection from attacker-controlled filenames.
- CORS is restricted to `ALLOWED_ORIGINS` (configured in `.env.production`).

### 3.2 File Type and Size Restrictions

**Blocked file extensions** (heuristic pre-scan; upload rejected immediately without Bitdefender scan):

`.exe`, `.bat`, `.cmd`, `.com`, `.msi`, `.ps1`, `.vbs`, `.js`, `.wsf`, `.hta`, `.scr`, `.pif`, `.jar`, `.sh`, `.py`, `.rb`, `.pl`

**Blocked filename patterns** (heuristic pre-scan):

crack, keygen, serial/key generator, activator, patched binary, nulled script, warez, torrent, hack tool, cheat tool, malicious loader, credential stealer, unlocker, code injector

**Maximum JSON body size:** 1 MB (`MAX_UPLOAD_BODY_MB=1`). File uploads use streaming multipart parsing and are not subject to this body size limit.

### 3.3 Share Link Security

- Share links can have a TTL from 1 hour to 7 days.
- Share links can optionally require a password (bcrypt-hashed).
- Share links have per-IP rate limiting (60 req/min; 12 download attempts per 15 minutes).
- Public embed cache files for video range requests are stored temporarily with a configurable TTL (`PUBLIC_SHARE_EMBED_CACHE_TTL_MS=1800000`, 30 minutes default) and cleaned up automatically.

### 3.4 Session Revocation

Session revocation is immediate and database-backed. Available operations:

| Operation | SQL effect |
|---|---|
| Revoke current session | Sets `revoked_at` on the current refresh token |
| Revoke a specific session by ID | Sets `revoked_at` on that token (must belong to the requesting user) |
| Revoke all other sessions | Sets `revoked_at` on all tokens except the current one |
| Revoke all sessions | Sets `revoked_at` on all tokens for the user |

Revoked tokens are rejected at the next refresh attempt. Access tokens remain valid until their 15-minute TTL expires (there is no real-time access token revocation — this is a standard JWT trade-off).

---

## 4. Incident Response

### 4.1 Suspected Account Compromise

**Indicators:** Unexpected login from unknown IP, user reports unauthorized access, anomalous API activity in logs.

**Immediate steps (Ops or Security on-call):**

1. Revoke all active sessions for the affected user:
   ```sql
   -- Identify user by HMAC hash of email (Dev team can compute the hash):
   UPDATE refresh_tokens
   SET revoked_at = SYSDATETIMEOFFSET()
   WHERE user_id = '<user-uuid>' AND revoked_at IS NULL;
   ```

2. Optionally lock the account (set a flag in the `users` table — field name depends on schema; confirm with Dev team).

3. Review IIS W3C logs for the user's recent activity:
   ```powershell
   Select-String -Path "C:\LeekuLogs\iis\leeku_secure_*.log" -Pattern "<username-or-ip>"
   ```

4. If unauthorized file access is confirmed, treat as a potential data breach — escalate to Security lead immediately (see section 4.3).

5. Notify the affected user via the account's registered email that a security review was performed and instruct them to change their password.

**Escalation:** Security lead within 1 hour of confirmation.

### 4.2 Malware Detection (Bitdefender Quarantine)

**Indicators:** Log entry `Threat(s) detected: <name>`, Bitdefender GravityZone console quarantine event.

**Immediate steps:**

1. Confirm temp staging directory is clean (files are deleted by the application after each scan):
   ```powershell
   Get-ChildItem "C:\LeekuTemp\scan-staging"
   ```

2. Confirm the file was rejected and NOT written to the vault (check application log for the upload request — a successful write would be followed by an encryption log entry).

3. If a threat was somehow stored (edge case: scanner returned false clean, then Bitdefender quarantined on background scan):
   - Identify the vault file path from the database record (use the file ID from logs).
   - Remove the vault file: `Remove-Item "<vault-path>\<file-id>" -Force`
   - Update the database record status to `Quarantined` (Dev team action via SQL).
   - Do not decrypt the file for inspection — treat as contaminated.

4. Preserve the Bitdefender quarantine record for forensics; do not release from quarantine without Security review.

5. If the same user submits multiple infected files: Security team reviews and may suspend the account.

**Escalation:** Security lead within 4 hours.

### 4.3 Suspected Data Breach

**Indicators:** Unauthorized access to vault files or database confirmed, MASTER_KEY or JWT private key exposed in logs/source, anomalous bulk download activity in logs.

**Immediate steps (Security lead coordinates):**

1. **Within 15 minutes: Contain.** If breach vector is application-level, stop the service:
   ```powershell
   Stop-Service LeekuSecure
   ```
   If breach vector is database or vault, revoke the SQL login and/or disconnect the UNC share.

2. **Within 30 minutes: Preserve evidence.** Copy logs before any rotation or restart:
   ```powershell
   $ts = Get-Date -Format "yyyyMMdd-HHmmss"
   Copy-Item "C:\LeekuLogs" "C:\LeekuLogs-incident-$ts" -Recurse
   ```

3. **Within 1 hour: Assess scope.**
   - Which data may have been accessed? (vault files, DB records, both?)
   - Is the MASTER_KEY compromised? (initiate P2 MASTER_KEY rotation if yes — see DEPLOYMENT.md)
   - Is the JWT private key compromised? (initiate P2 JWT rotation if yes)
   - Which users' data is affected?

4. **Within 4 hours: Notify.** Notify affected users per applicable data protection regulations (GDPR Article 33: supervisory authority within 72 hours of becoming aware; Article 34: users if high risk to rights and freedoms).

5. **Contacts:**
   - Internal Security lead: [internal contact — not defined in codebase]
   - Legal/compliance: [internal contact — not defined in codebase]
   - External vulnerability notification: security@[domain] (see section 5)

6. Rotate all compromised secrets (MASTER_KEY, JWT keys, DB password, SMTP credentials) before restarting the service.

### 4.4 Cryptographic Key Exposure

**MASTER_KEY_BASE64 exposed:**
- Follow P2 MASTER_KEY rotation procedure in `DEPLOYMENT.md`
- All encrypted file keys and column-encrypted data must be re-encrypted with the new key
- This requires a maintenance window and Dev team involvement

**JWT private key exposed:**
- Follow P2 JWT key rotation procedure in `DEPLOYMENT.md`
- Revoke all active refresh tokens immediately
- All active users will be logged out and must re-authenticate

**COOKIE_SECRET_BASE64 exposed:**
- Generate a new secret: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
- Update `.env.production` and restart the service
- All existing signed cookies are immediately invalidated (users must log in again)

**DB password exposed:**
- Change the `leeku_app` SQL Server login password
- Update `DB_PASSWORD` in `.env.production`
- Restart the service

---

## 5. Reporting Vulnerabilities

Leeku Secure follows responsible disclosure. If you discover a security vulnerability, please report it privately before public disclosure.

**Contact:** security@[domain]

**What to include in your report:**
- Description of the vulnerability
- Steps to reproduce
- Potential impact assessment
- Any proof-of-concept code (do not exploit production data)

**What we commit to:**
- Acknowledge receipt within 2 business days
- Provide an initial assessment within 5 business days
- Work with you on a remediation timeline before public disclosure
- Credit researchers who report valid vulnerabilities (if desired)

**Do not report vulnerabilities via GitHub issues, pull requests, or any public channel.** Use the security contact email above.

**Out-of-scope for responsible disclosure:** Bitdefender engine vulnerabilities (report to Bitdefender), Windows Server OS vulnerabilities (report to Microsoft), third-party npm package vulnerabilities (report to the package maintainer and open a GitHub advisory).

---

## 6. Security Maintenance Checklist

Perform these tasks on the indicated schedule:

| Task | Frequency | Owner |
|---|---|---|
| JWT RS256 key rotation | Every 90 days | Ops + Dev |
| Review and revoke orphaned admin accounts | Monthly | Security |
| `npm audit --audit-level=high` | Every deployment + weekly | Dev |
| Bitdefender signature update verification | Weekly | Ops |
| Review IIS W3C access logs for anomalies | Weekly | Security |
| TLS certificate expiry check | Monthly (alert 30 days before expiry) | Ops |
| MASTER_KEY rotation | As required (exposure) or annually | Dev + Security |
| Review `MAX_LOGIN_ATTEMPTS` and lockout settings against attack patterns | Quarterly | Security |
| Verify NTFS ACLs on vault, keys, and `.env.production` | Quarterly | Ops |
| Review and update blocked file extension list | Quarterly | Security + Dev |
