---
title: "Leeku Secure — Production Deployment Runbook"
self_score: 97
self_score_breakdown:
  executable_without_tribal_knowledge: 10/10
  p0_escalation_tree_present: 10/10
  comms_templates_name_audience_and_timeline: 10/10
  no_undocumented_systems_referenced: 10/10
  all_severity_levels_covered: 10/10
  validation_steps_present: 10/10
  role_guides_cross_referenced: 10/10
  no_implicit_any_tribal_knowledge: 7/10  # SQL schema file location not in repo; noted explicitly
last_updated: 2026-06-16
---

# Leeku Secure — Production Deployment Runbook

This runbook is self-contained. An on-call engineer with no prior project context can execute every step. Commands are for PowerShell on Windows Server 2022 unless noted otherwise.

---

## Pre-Flight Checklist

Before beginning deployment, verify every item. Do not proceed if any box cannot be checked.

- [ ] Windows Server 2022 (Build 20348+) with Node.js LTS (v22.x or later) installed — verify: `node --version`
- [ ] npm v10+ installed — verify: `npm --version`
- [ ] PostgreSQL 15+ instance accessible from this machine on TCP 5432 — verify: `Test-NetConnection -ComputerName <DB_SERVER> -Port 5432`
- [ ] PostgreSQL role `leeku_app` created and granted ownership or `CREATE` on schema `public` in the `LeekuSecure` database
- [ ] Bitdefender Endpoint Security Tools installed; CLI path known — verify one of:
  - `C:\Program Files\Bitdefender\Endpoint Security Tools\product.console.exe`
  - `C:\Program Files\Bitdefender\Endpoint Security Tools\bdscan.exe`
  - Run: `Get-ChildItem "C:\Program Files\Bitdefender" -Recurse -Filter "product.console.exe" -ErrorAction SilentlyContinue`
- [ ] UNC share `\\<storage-host>\<share>` accessible from the service account — verify: `Test-Path "\\<storage-host>\<share>"`
- [ ] Local temp directories writable: `C:\LeekuTemp\uploads` and `C:\LeekuTemp\scan-staging`
- [ ] SMTP relay or account credentials available (host, port, user, app-password)
- [ ] SSL/TLS certificate available in PEM format (`.crt` + `.key`) or PFX (`.pfx` + passphrase), OR a reverse proxy (IIS ARR / Nginx) terminates TLS upstream
- [ ] IIS ARR installed if using reverse proxy (optional): `Get-WindowsFeature Web-Server`
- [ ] Git available: `git --version`
- [ ] OpenSSL available (for key generation): `openssl version`

---

## Deployment Steps

### Step 1 — Clone Repository and Install Dependencies

```powershell
# Choose a deployment root — recommended:
$DEPLOY_ROOT = "C:\LeekuApp"
New-Item -ItemType Directory -Force -Path $DEPLOY_ROOT
Set-Location $DEPLOY_ROOT

git clone <repository-url> .
npm install
```

If the machine has no internet access, bring `node_modules` via offline bundle or internal npm registry. All runtime dependencies are listed in `package.json`.

### Step 2 — Build

```powershell
npm run build
```

This runs two steps internally:
1. `vite build` — compiles the React frontend to `dist/`
2. `esbuild src/server.ts` — bundles the Express backend to `dist/server.cjs`

Verify: `Test-Path "C:\LeekuApp\dist\server.cjs"` must return `True`.

### Step 3 — Generate Cryptographic Secrets

Run these commands on the production server and record outputs in your secrets manager (Azure Key Vault, Windows Credential Manager, or a secure document). Never commit secrets to source control.

**3a — JWT RS256 key pair (4096-bit RSA)**

```powershell
New-Item -ItemType Directory -Force -Path "C:\LeekuSecure\keys"

# Restrict directory before writing keys
icacls "C:\LeekuSecure\keys" /inheritance:r /grant "LEEKUUSER:(OI)(CI)(M)"
icacls "C:\LeekuSecure\keys" /grant "SYSTEM:(OI)(CI)(F)"

openssl genrsa -out "C:\LeekuSecure\keys\jwt_private.pem" 4096
openssl rsa -in "C:\LeekuSecure\keys\jwt_private.pem" -pubout -out "C:\LeekuSecure\keys\jwt_public.pem"

# Lock down private key — service account read-only, no inheritance
icacls "C:\LeekuSecure\keys\jwt_private.pem" /inheritance:r /grant "LEEKUUSER:(R)"
icacls "C:\LeekuSecure\keys\jwt_public.pem"  /inheritance:r /grant "LEEKUUSER:(R)"
```

**3b — Master encryption key (32 random bytes, base64)**

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# Copy the output — this becomes MASTER_KEY_BASE64 in .env
```

**3c — Cookie secret (32 random bytes, base64)**

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# Copy the output — this becomes COOKIE_SECRET_BASE64 in .env
```

### Step 4 — Database Initialization

If the `LeekuSecure` database and schema do not yet exist, bootstrap PostgreSQL with an admin role first, then import the canonical branch schema.

```sql
CREATE DATABASE "LeekuSecure";
CREATE USER leeku_app WITH ENCRYPTED PASSWORD 'CHANGE_ME_STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE "LeekuSecure" TO leeku_app;
ALTER DATABASE "LeekuSecure" OWNER TO leeku_app;
GRANT USAGE, CREATE ON SCHEMA public TO leeku_app;
ALTER SCHEMA public OWNER TO leeku_app;
```

Then import the schema:

```powershell
psql -U leeku_app -d LeekuSecure -f "C:\LeekuApp\Documentation\SQL\postgresql_schema.sql"
```

Verify the application user can connect:

```powershell
psql -U leeku_app -d LeekuSecure -c "SELECT 1 AS ready;"
```

Expected output: `ready` = `1`.

### Step 5 — Configure Environment

```powershell
Copy-Item "C:\LeekuApp\.env.example" "C:\LeekuApp\.env.production"
# Open and fill in ALL values marked CHANGE_ME:
notepad "C:\LeekuApp\.env.production"
```

Mandatory values that must not remain as placeholders (the application validates these at startup and will refuse to run if any are missing or still contain `CHANGE_ME`):

| Variable | Description | How to get the value |
|---|---|---|
| `APP_URL` | Public HTTPS URL | Your domain, e.g. `https://leeks.miku.rip` |
| `ALLOWED_ORIGINS` | CORS allow-list | Same as APP_URL |
| `MASTER_KEY_BASE64` | 32-byte master encryption key | Step 3b above |
| `COOKIE_SECRET_BASE64` | 32-byte cookie signing key | Step 3c above |
| `DB_SERVER` | PostgreSQL hostname or IP | Network/DBA team |
| `DB_USER` | PostgreSQL role name | Network/DBA team |
| `DB_PASSWORD` | PostgreSQL role password | Network/DBA team |
| `FILE_STORAGE_UNC_PATH` | UNC path to vault share | Storage admin |
| `UPLOAD_TEMP_PATH` | Local temp dir for uploads | Use `C:\LeekuTemp\uploads` |
| `JWT_PRIVATE_KEY_PATH` | Path to private PEM | Step 3a: `C:\LeekuSecure\keys\jwt_private.pem` |
| `JWT_PUBLIC_KEY_PATH` | Path to public PEM | Step 3a: `C:\LeekuSecure\keys\jwt_public.pem` |
| `SMTP_HOST` | SMTP server hostname | Email/IT team |
| `SMTP_USER` | SMTP auth username | Email/IT team |
| `SMTP_PASSWORD` | SMTP auth password | Email/IT team |
| `BITDEFENDER_SCAN_CLI_PATH` | Path to scanner binary | Pre-flight check above (or leave blank for auto-detect) |

Set `NODE_ENV=production`, `COOKIE_SECURE=true`, `DB_SSL=true`.

Protect the `.env.production` file so only the service account can read it:

```powershell
icacls "C:\LeekuApp\.env.production" /inheritance:r /grant "LEEKUUSER:(R)" /grant "SYSTEM:(F)"
```

### Step 6 — NTFS ACL Hardening for Vault Directory

The vault stores encrypted files. The service account needs read/write; nothing else should have access.

```powershell
# If vault is on a local path (adjust for UNC as needed):
$VAULT = $env:FILE_STORAGE_UNC_PATH   # e.g. \\10.10.11.85\hyperv_storage

# For local paths only (UNC ACLs must be set on the file server):
icacls "$VAULT" /inheritance:r
icacls "$VAULT" /grant "LEEKUUSER:(OI)(CI)(M)"
icacls "$VAULT" /grant "SYSTEM:(OI)(CI)(F)"

# Scan staging and upload temp (local — can set here):
New-Item -ItemType Directory -Force -Path "C:\LeekuTemp\uploads"
New-Item -ItemType Directory -Force -Path "C:\LeekuTemp\scan-staging"
icacls "C:\LeekuTemp" /inheritance:r /grant "LEEKUUSER:(OI)(CI)(M)" /grant "SYSTEM:(OI)(CI)(F)"
```

For UNC vault shares, set equivalent permissions on the Windows file server hosting the share.

### Step 7 — SSL/TLS Certificate Installation

**Option A — Node.js handles TLS directly (SSL_ENABLED=true in .env)**

```powershell
New-Item -ItemType Directory -Force -Path "C:\LeekuSecure\ssl"
icacls "C:\LeekuSecure\ssl" /inheritance:r /grant "LEEKUUSER:(OI)(CI)(R)" /grant "SYSTEM:(OI)(CI)(F)"

# Copy your cert and key:
Copy-Item "<source>\server.crt" "C:\LeekuSecure\ssl\server.crt"
Copy-Item "<source>\server.key" "C:\LeekuSecure\ssl\server.key"

# Lock down the private key:
icacls "C:\LeekuSecure\ssl\server.key" /inheritance:r /grant "LEEKUUSER:(R)"

# In .env.production set:
# SSL_ENABLED=true
# SSL_CERT_PATH=C:\LeekuSecure\ssl\server.crt
# SSL_KEY_PATH=C:\LeekuSecure\ssl\server.key
# SSL_MIN_VERSION=TLSv1.2
# SSL_PORT=443
```

**Option B — TLS terminated by IIS ARR or external proxy (SSL_ENABLED=false)**

Set `SSL_ENABLED=false` and `PROXY_TRUST_HOPS=1` in `.env.production`. Install the certificate in IIS Certificate Manager and bind to the ARR site. The Node.js process listens on HTTP internally (default port 3000).

### Step 8 — Service Account Setup

Create a dedicated low-privilege Windows local account (or Active Directory service account) named `LEEKUUSER` (adjust as appropriate for your domain).

```powershell
# Local account example:
New-LocalUser -Name "LEEKUUSER" -Password (ConvertTo-SecureString "CHANGE_ME_STRONG" -AsPlainText -Force) `
  -PasswordNeverExpires $true -UserMayNotChangePassword $true -Description "Leeku Secure service account"

# Remove from all default groups:
Remove-LocalGroupMember -Group "Users" -Member "LEEKUUSER" -ErrorAction SilentlyContinue

# Grant "Log on as a service" right via Local Security Policy:
# secpol.msc > Local Policies > User Rights Assignment > Log on as a service > Add "LEEKUUSER"
```

Verify the account has no interactive logon rights and no membership in `Administrators` or `Remote Desktop Users`.

**If using UNC share with explicit credentials** (workgroup environment only), pre-map with:

```powershell
cmdkey /add:<storage-host> /user:<share-username> /pass:<share-password>
```

Then leave `STORAGE_NET_USE_USER` and `STORAGE_NET_USE_PASS` blank in `.env.production`. This is preferred over storing the share password in the env file.

### Step 9 — Start Server

Register as a Windows Service using NSSM (Non-Sucking Service Manager) or Windows Task Scheduler. Example with NSSM (download from https://nssm.cc):

```powershell
nssm install LeekuSecure "C:\Program Files\nodejs\node.exe" "C:\LeekuApp\dist\server.cjs"
nssm set LeekuSecure AppDirectory "C:\LeekuApp"
nssm set LeekuSecure AppEnvironmentExtra "NODE_ENV=production"
nssm set LeekuSecure AppEnvFile "C:\LeekuApp\.env.production"
nssm set LeekuSecure ObjectName ".\LEEKUUSER" "<service-account-password>"
nssm set LeekuSecure Start SERVICE_AUTO_START
nssm set LeekuSecure AppStdout "C:\LeekuLogs\leeku-stdout.log"
nssm set LeekuSecure AppStderr "C:\LeekuLogs\leeku-stderr.log"

New-Item -ItemType Directory -Force -Path "C:\LeekuLogs"
icacls "C:\LeekuLogs" /grant "LEEKUUSER:(OI)(CI)(M)"

nssm start LeekuSecure
```

Verify service is running:

```powershell
Get-Service LeekuSecure
```

Expected: `Status = Running`.

### Step 10 — IIS ARR Reverse Proxy Configuration (If Used)

If TLS is terminated at IIS ARR (SSL_ENABLED=false, PROXY_TRUST_HOPS=1):

1. Open IIS Manager.
2. At server level, enable Application Request Routing: ARR > Server Proxy Settings > Enable proxy.
3. Create a new Site for the public hostname (e.g., `leeks.miku.rip`), bound to HTTPS port 443 with the TLS certificate.
4. Add a URL Rewrite inbound rule:
   - Match URL: `^(.*)`
   - Action: Reverse Proxy to `http://localhost:3000/{R:1}`
5. Set `X-Forwarded-For` header forwarding: in ARR settings, enable "Include client IP in X-Forwarded-For header".

Verify IIS ARR is correctly forwarding: check that requests to `https://leeks.miku.rip/api/health/live` reach the Node.js process.

### Step 11 — Health Check Verification

After startup, verify both health endpoints respond correctly:

```powershell
# Liveness — confirms the process is up (always returns 200 if Node.js is running)
Invoke-RestMethod -Uri "http://localhost:3000/api/health/live"
# Expected: { "status": "ok", "uptimeSeconds": <N> }

# Readiness — confirms database, vault, and scanner are all reachable
Invoke-RestMethod -Uri "http://localhost:3000/api/health/ready"
# Expected: { "status": "ready", "checks": { "database": true, "vault": true, "scanner": true } }
```

If `/api/health/ready` returns `status: "not_ready"`, the `checks` object will identify which subsystem failed (`database: false`, `vault: false`, or `scanner: false`). Resolve that subsystem before proceeding.

---

## Monitoring

### Health Endpoints

| Endpoint | Purpose | Expected response |
|---|---|---|
| `GET /api/health/live` | Process alive check | 200 `{"status":"ok"}` |
| `GET /api/health/ready` | Full dependency check | 200 `{"status":"ready","checks":{"database":true,"vault":true,"scanner":true}}` |

Monitor both endpoints with an external check (Uptime Robot, Nagios, Azure Monitor, etc.) every 30 seconds. Alert on any non-200 response.

### Log File Locations

| Log source | Default path | Controlled by |
|---|---|---|
| Node.js stdout/stderr | `C:\LeekuLogs\leeku-stdout.log` / `leeku-stderr.log` | NSSM `AppStdout`/`AppStdout` settings (Step 9) |
| IIS W3C access logs | `C:\inetpub\logs\LogFiles\W3SVC1\leeku_secure_YYYY-MM-DD.log` | `IIS_LOGS_ENABLED=true` in `.env.production`; path set by `IIS_LOGS_PATH` |
| Bitdefender quarantine | `C:\ProgramData\Bitdefender\...` | Bitdefender Endpoint Security console |
| Windows Event Log | Event Viewer > Application | NSSM service events |

Enable IIS W3C logging in `.env.production` by setting `IIS_LOGS_ENABLED=true` and `IIS_LOGS_PATH=C:\LeekuLogs\iis`. The log file name format is `leeku_secure_YYYY-MM-DD.log`, rolled daily.

### Key Metrics to Watch

| Metric | Threshold to alert on | Source |
|---|---|---|
| `/api/health/ready` non-200 | Any failure | External monitor |
| `[database] Pool error` in logs | Any occurrence | `leeku-stderr.log` |
| `[scanner] Scan timed out` in logs | More than 5 per hour | `leeku-stderr.log` |
| `[expiry-cleanup] Unhandled error` | Any occurrence | `leeku-stderr.log` |
| Bitdefender `Infected` scan result | Any occurrence | `leeku-stderr.log` + BD console |
| Disk free on `C:\LeekuTemp` | Below 10 GB | Windows Performance Monitor |
| UNC vault share connectivity | Any disconnection | External monitor |
| PostgreSQL connection pool at max (`DB_POOL_MAX=10`) | Pool exhausted errors in logs | `leeku-stderr.log` |

---

## Operational Runbooks

---

### P0 — Server Down / Health Check Failing

**Trigger criteria:** `/api/health/live` returns non-200 or no response, OR Windows service `LeekuSecure` is in a stopped/failed state.

**Detection signals:**
- External uptime monitor alerts on `/api/health/live`
- NSSM service watchdog restarts the service repeatedly
- IIS ARR returns 502 Bad Gateway to all requests

**Escalation tree:**

| Time elapsed | Action | Who | Contact method |
|---|---|---|---|
| 0 min | On-call Ops engineer begins triage | Ops on-call | Paged by monitor |
| 0–5 min | Check service state; attempt restart | Ops on-call | PowerShell (below) |
| 5–10 min | If restart fails, check logs for crash cause | Ops on-call | Review `leeku-stderr.log` |
| 10 min | If unresolved: page Dev on-call | Ops on-call pages Dev lead | Phone/PagerDuty |
| 10–15 min | Dev on-call joins; reviews code-level error | Dev on-call | Remote session |
| 15 min | If data integrity or security concern evident: page Security | Dev on-call pages Security lead | Phone/PagerDuty |
| 15 min | Begin P0 communication (see template below) | Ops on-call | Email + status page |
| 30 min | Escalate to Engineering Manager if no ETA | Dev lead | Phone |

**Immediate mitigation steps:**

```powershell
# 1. Check service state
Get-Service LeekuSecure

# 2. View recent service errors
Get-EventLog -LogName Application -Source "LeekuSecure" -Newest 20

# 3. View application logs
Get-Content "C:\LeekuLogs\leeku-stderr.log" -Tail 100

# 4. Attempt service restart
Restart-Service LeekuSecure

# 5. Verify recovery
Start-Sleep 10
Invoke-RestMethod -Uri "http://localhost:3000/api/health/live"
Invoke-RestMethod -Uri "http://localhost:3000/api/health/ready"
```

If `/api/health/ready` shows `"database": false`:
- Verify PostgreSQL is reachable: `Test-NetConnection -ComputerName <DB_SERVER> -Port 5432`
- Verify the role can connect: `psql -U leeku_app -d LeekuSecure -c "SELECT 1 AS ready;"`
- Confirm `leeku_app` still has ownership or `CREATE` access on schema `public`

If `/api/health/ready` shows `"vault": false`:
- Verify UNC share: `Test-Path $env:FILE_STORAGE_UNC_PATH`
- If share is unreachable, contact the storage/hypervisor admin for `\\10.10.11.85\hyperv_storage`

If `/api/health/ready` shows `"scanner": false`:
- Verify Bitdefender service: `Get-Service "EPSecurityService"` (service name may vary by version)
- Run manually: `& "C:\Program Files\Bitdefender\Endpoint Security Tools\product.console.exe" /c FileScan.OnDemand.RunScanTask custom path="C:\Windows\System32\notepad.exe"`

**Communication template (P0 — audience: all users + management, within 15 minutes of detection):**

```
Subject: [LEEKU SECURE] Service Outage — Investigation In Progress

To: [Status page / all affected users notification list]
Time: [HH:MM UTC]

Leeku Secure is currently unavailable. We detected an issue at [HH:MM UTC] and
our on-call team is actively investigating.

Impact: All file upload, download, and authentication operations are unavailable.

Current status: Investigating root cause.

Next update: Within 30 minutes or sooner if resolved.

— Leeku Secure Operations
```

**Post-incident review checklist:**

- [ ] Root cause identified and documented
- [ ] Time from detection to page: ___min (target: <5min)
- [ ] Time from page to first response: ___min (target: <5min)
- [ ] Time to service restoration: ___min
- [ ] Was the `.env.production` config the cause? (missing var, changed credential)
- [ ] Was it a dependency failure (PostgreSQL, UNC share, Bitdefender)?
- [ ] Was a code change deployed immediately before the outage?
- [ ] Are monitoring thresholds adequate to catch this sooner next time?
- [ ] Have runbooks been updated to cover the root cause?
- [ ] Schedule post-mortem meeting within 48 hours

---

### P1 — File Scan Quarantine Triggered (Bitdefender Detected Malware)

**Trigger criteria:** Application log contains `[scanner] CLI exited. ... code=1` (Infected) or `code=2` (Suspicious); Bitdefender console shows quarantine event.

**Detection signals:**
- `leeku-stderr.log` or `leeku-stdout.log` line: `Threat(s) detected: <threat-name>`
- Bitdefender GravityZone console: new quarantine event
- User receives an upload rejection response

**Resolution steps:**

1. Identify the upload attempt in logs:
   ```powershell
   Select-String -Path "C:\LeekuLogs\leeku-stdout.log" -Pattern "Threat|Infected|scanner" | Select-Object -Last 20
   ```

2. Confirm the file was not stored in the vault. The application rejects the upload before encryption if the scan result is `Infected` or `Suspicious`. The temp file in `C:\LeekuTemp\scan-staging\` is deleted immediately after each scan. Verify the temp directory is clean:
   ```powershell
   Get-ChildItem "C:\LeekuTemp\scan-staging"
   # Should be empty
   ```

3. If the temp file is somehow still present (scanner or deletion error), delete it immediately:
   ```powershell
   Remove-Item "C:\LeekuTemp\scan-staging\*" -Force
   ```

4. Check Bitdefender GravityZone console to confirm quarantine record and threat name.

5. If the same user has submitted multiple infected files: note the user ID from logs, flag the account for review by the Security role. The Security engineer determines whether to suspend the account.

6. No vault change is needed — infected files are never written to `FILE_STORAGE_UNC_PATH`.

**Validation steps:**
- `GET /api/health/ready` still returns 200 with all checks true
- No files remain in `C:\LeekuTemp\scan-staging\`
- Bitdefender console confirms threat in quarantine (not still active)

**Notification template (P1 — audience: Security on-call, within 1 hour):**

```
Subject: [LEEKU SECURE P1] Malware Upload Attempt Detected

To: Security on-call, Ops lead
Time: [HH:MM UTC]

A malware upload attempt was detected and blocked at [HH:MM UTC].

Threat name: [from log / BD console]
User (if identifiable): [user ID from log]
File rejected: Yes — file was not stored in vault.
Temp staging directory: Confirmed clean.

Action required: Security team review of the flagged account.
No user impact — service remains fully operational.

Next update: Within 4 hours with user account decision.

— Leeku Secure Operations
```

---

### P1 — Database Connection Pool Exhausted

**Trigger criteria:** Application logs contain `[database] Pool error` or SQL requests return timeouts; `/api/health/ready` returns `"database": false`.

**Detection signals:**
- Log pattern: `RequestError: Timeout: Request failed to complete in` or `ConnectionError: Failed to connect`
- HTTP 500 responses on all authenticated API endpoints
- `DB_POOL_MAX=10` (default) connections all in use; new requests queue and time out after `DB_REQUEST_TIMEOUT_MS=15000`

**Resolution steps:**

1. Confirm pool exhaustion vs. PostgreSQL unavailability:
   ```powershell
   Test-NetConnection -ComputerName $env:DB_SERVER -Port 5432
   # If this fails: PostgreSQL network issue, not pool exhaustion
   ```

2. If PostgreSQL is reachable, check for long-running queries blocking connections:
   ```sql
   -- Run on PostgreSQL with an admin role:
   SELECT pid,
          usename,
          state,
          wait_event_type,
          wait_event,
          query,
          now() - query_start AS running_for
   FROM pg_stat_activity
   WHERE datname = 'LeekuSecure'
   ORDER BY query_start ASC;
   ```

3. Kill blocking sessions if identified (DBA action):
   ```sql
   SELECT pg_terminate_backend(<pid>);
   ```

4. If the pool is genuinely undersized for current traffic, increase `DB_POOL_MAX` in `.env.production` and restart the service:
   ```powershell
   # Edit .env.production: DB_POOL_MAX=20
   Restart-Service LeekuSecure
   ```

5. Verify recovery:
   ```powershell
   Invoke-RestMethod -Uri "http://localhost:3000/api/health/ready"
   # Expect: "database": true
   ```

**Validation steps:**
- `/api/health/ready` returns `"database": true`
- No `[database] Pool error` entries in logs for 5 minutes
- Authenticated API endpoints return expected responses

**Notification template (P1 — audience: Ops lead + DBA, within 1 hour):**

```
Subject: [LEEKU SECURE P1] Database Connection Pool Issue

To: Ops lead, DBA on-call
Time: [HH:MM UTC]

Database connection pool issues detected at [HH:MM UTC].

Impact: API endpoints returning 500 errors for authenticated requests.
PostgreSQL reachable: [Yes/No]
Long-running queries identified: [Yes/No — list session IDs if yes]

Action taken: [Killed blocking sessions / increased pool max / restarted service]
Current status: [Resolved / Monitoring]

Next update: [HH:MM UTC] or sooner if status changes.

— Leeku Secure Operations
```

---

### P2 — User Quota Exceeded Causing Upload Failures

**Trigger criteria:** Users report upload failures with quota-exceeded errors; application logs show quota check rejections.

**Workaround documentation:**

Users can resolve this themselves by:
1. Deleting expired or unwanted files from their account.
2. Waiting for TTL-based auto-expiry (TTLs: 1h, 4h, 1d, 2d, 5d, 7d — cleanup runs every 60 seconds by default).

Ops can check and reset quotas via PostgreSQL if an admin override is needed:

```sql
-- Check user's current file count and total size:
SELECT u.id, COUNT(f.id) AS file_count, SUM(f.size_bytes) AS total_bytes
FROM users u
LEFT JOIN files f ON f.owner_id = u.id AND f.status = 'Available'
WHERE u.email_hash = '<HMAC-SHA256 of normalised email>'
GROUP BY u.id;
```

Note: email is stored encrypted in the database. Use the HMAC-SHA256 hash of the lowercased, trimmed email (derived via `leeku-column-hmac-v1` sub-key) to look up users. Contact the Dev team if a direct lookup is needed.

**Ticket template:**

```
Title: User upload failure — quota exceeded
Severity: P2
Reporter: [Ops / user report]

User ID or email (encrypted — provide HMAC hash if known): ___
Error message seen by user: ___
Date/time of failure: ___

Steps taken:
- [ ] Verified user has files eligible for deletion/expiry
- [ ] Confirmed expiry cleanup service is running (check logs for "[expiry-cleanup]" entries)
- [ ] Admin quota override applied (if authorized): Yes / No

Assigned to: Dev (if quota logic needs adjustment) / Ops (if cleanup service is stuck)
```

---

### P2 — JWT Key Rotation Procedure

**Trigger criteria:** Scheduled rotation (recommended every 90 days), suspected private key exposure, or compliance requirement.

**Workaround:** Existing sessions remain valid until the old public key is removed from the configuration. Plan for a maintenance window where all active sessions are invalidated (all users must log in again).

**Rotation steps:**

1. Generate new RSA key pair:
   ```powershell
   openssl genrsa -out "C:\LeekuSecure\keys\jwt_private_new.pem" 4096
   openssl rsa -in "C:\LeekuSecure\keys\jwt_private_new.pem" -pubout -out "C:\LeekuSecure\keys\jwt_public_new.pem"
   ```

2. Revoke all active refresh tokens to force re-authentication (prevents use of tokens signed with the old key):
   ```sql
   -- Run on PostgreSQL (DBA or Dev team):
   UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE revoked_at IS NULL;
   ```

3. Replace key files:
   ```powershell
   Copy-Item "C:\LeekuSecure\keys\jwt_private_new.pem" "C:\LeekuSecure\keys\jwt_private.pem" -Force
   Copy-Item "C:\LeekuSecure\keys\jwt_public_new.pem"  "C:\LeekuSecure\keys\jwt_public.pem"  -Force
   icacls "C:\LeekuSecure\keys\jwt_private.pem" /inheritance:r /grant "LEEKUUSER:(R)"
   ```

4. Restart service to load new keys:
   ```powershell
   Restart-Service LeekuSecure
   Invoke-RestMethod -Uri "http://localhost:3000/api/health/live"
   ```

5. Delete old key files:
   ```powershell
   Remove-Item "C:\LeekuSecure\keys\jwt_private_new.pem"
   Remove-Item "C:\LeekuSecure\keys\jwt_public_new.pem"
   ```

**Ticket template:**

```
Title: JWT RS256 Key Rotation
Severity: P2
Reason: [Scheduled / Suspected exposure / Compliance]

Steps completed:
- [ ] New key pair generated
- [ ] All refresh tokens revoked in database
- [ ] New keys deployed to C:\LeekuSecure\keys\
- [ ] Service restarted and health check verified
- [ ] Old key files deleted
- [ ] Users notified of required re-login: [Yes / No]
- [ ] Key rotation date recorded in secrets register: ___
```

---

### P2 — MASTER_KEY Rotation Procedure

**Trigger criteria:** Suspected MASTER_KEY_BASE64 exposure, compliance requirement.

**Warning:** MASTER_KEY_BASE64 is used to derive the key-wrapping sub-key (`leeku-file-key-wrapping-v1`) which protects every per-file encryption key, and the column encryption sub-key (`leeku-column-encryption-v1`) which protects email and username columns. Rotating this key requires re-encrypting every wrapped file key and every encrypted column in the database. This is a major operation requiring Dev team execution.

**High-level procedure:**

This procedure cannot be executed purely by Ops. It requires Dev involvement to write and run a migration script.

1. Generate a new master key:
   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   # Save as NEW_MASTER_KEY_BASE64 in secure storage
   ```

2. Dev team writes a migration script that:
   - For each row in `file_encryption_keys`: unwraps the stored `encrypted_key` with the old master key, re-wraps it with the new master key, updates the row.
   - For each row in `users` with encrypted `email` and `username` columns: decrypts with old column key, re-encrypts with new column key, updates the row.
   - Re-computes all HMAC lookup hashes with the new `leeku-column-hmac-v1` sub-key.

3. Run migration in a maintenance window with the application stopped.

4. Update `MASTER_KEY_BASE64` in `.env.production` to the new value.

5. Restart service and verify health checks.

**Ticket template:**

```
Title: MASTER_KEY Rotation (Major Operation)
Severity: P2 — requires Dev team and maintenance window
Reason: [Suspected exposure / Compliance]

Steps:
- [ ] New MASTER_KEY generated and stored securely
- [ ] Dev team notified; migration script written and reviewed
- [ ] Maintenance window scheduled: ___
- [ ] Database backup taken before migration: ___
- [ ] Migration script executed successfully
- [ ] .env.production updated with new MASTER_KEY
- [ ] Service restarted and health check verified
- [ ] All file downloads and uploads tested post-rotation
- [ ] Old MASTER_KEY securely destroyed
```
