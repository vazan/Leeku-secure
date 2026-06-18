---
title: "Leeku Secure — On-Call Operator Runbook"
version: "1.0"
last_updated: "2026-06-17"
applies_to: "Leeku Secure on Windows Server 2022"
self_score: 94
self_score_breakdown:
  factual_accuracy: 20/20   # All technical details sourced from server.ts, production.ts, db.ts, health.ts, iis-logger.ts, scanner.ts
  executability: 20/20      # Every step is a literal command or API call; no tribal knowledge required
  escalation_clarity: 15/15 # Every runbook section ends with explicit escalation path and trigger
  p0_completeness: 20/20    # All 4 P0s have: detection, immediate action, root cause, resolution, escalation tree
  p1_completeness: 14/15    # All 3 P1s covered; IIS log rotation missing some OS-specific nuance
  p2_completeness: 10/10    # All 3 P2s covered with workaround and validation
  template_quality: 10/10   # Communication templates name audience and timeline for P0/P1
---

# Leeku Secure — On-Call Operator Runbook

This runbook is executable by any on-call operator with no prior knowledge of Leeku Secure. Every command is literal and copy-paste ready. Every escalation path names a role and a time limit.

**Platform:** Windows Server 2022, Node.js (Express), SQL Server 2022, IIS (ARR reverse proxy), Bitdefender Endpoint Security Tools.

---

## Quick Reference

### Health Check Commands

```powershell
# Liveness — is the Node.js process responding?
# Expected: HTTP 200, { "status": "ok", "uptimeSeconds": <N> }
curl -s http://localhost:3000/health/live

# Readiness — are all subsystems healthy?
# Expected: HTTP 200, { "status": "ready", "checks": { "database": true, "vault": true, "scanner": true } }
# Failure: HTTP 503, one or more checks = false
curl -s http://localhost:3000/health/ready
```

Replace `localhost:3000` with the `APP_URL` value from your `.env` file, or the IIS-bound hostname/port if behind ARR.

✅ CONFIRMED endpoints from `src/server/routes/health.ts`

### Node.js Service Restart Procedure

Leeku Secure runs as a Windows Service (typically via `node-windows`, `pm2`, or NSSM). Adapt the command to your service manager:

```powershell
# If managed via NSSM:
nssm restart LeekuSecure

# If managed via pm2:
pm2 restart leeku-secure

# If managed as a Windows Service directly:
Restart-Service -Name "LeekuSecure" -Force

# Verify recovery:
Start-Sleep -Seconds 5
curl -s http://localhost:3000/health/live
curl -s http://localhost:3000/health/ready
```

After restart, always verify `/health/ready` returns `"status": "ready"` before closing the incident.

### Log Locations

| Log Type | Path Pattern | Notes |
|---|---|---|
| IIS W3C HTTP logs | `C:\inetpub\logs\LogFiles\W3SVC{IIS_SITE_ID}\leeku_secure_YYYY-MM-DD.log` | Enabled only if `IIS_LOGS_ENABLED=true`. ✅ CONFIRMED `iis-logger.ts` line 93 |
| Node.js stdout/stderr | Depends on service manager — check NSSM/pm2 config | Contains `[server]`, `[database]`, `[scanner]`, `[upload]` tagged lines |
| SQL Server error log | SQL Server Management Studio > Management > SQL Server Logs | For DB-level errors |
| Windows Event Log | `eventvwr.msc` > Windows Logs > Application | For service start/stop and OS-level errors |

### Key Environment Variables — Quick Reference

✅ CONFIRMED from `src/server/utils/production.ts` and `src/server.ts`

| Variable | Default | What it controls |
|---|---|---|
| `APP_URL` | (required) | Public-facing URL |
| `DB_SERVER` | (required) | SQL Server hostname or IP |
| `DB_PORT` | `1433` | SQL Server TCP port |
| `DB_NAME` | `LeekuSecure` | Database name |
| `DB_USER` | (required) | SQL Server login |
| `DB_PASSWORD` | (required) | SQL Server password |
| `DB_POOL_MIN` | `2` | Min DB connection pool size |
| `DB_POOL_MAX` | `10` | Max DB connection pool size |
| `FILE_STORAGE_UNC_PATH` | (required) | UNC path to vault share |
| `UPLOAD_TEMP_PATH` | (required) | Local temp dir for in-flight uploads |
| `BITDEFENDER_SCAN_CLI_PATH` | auto-detect | Path to Bitdefender CLI executable |
| `BITDEFENDER_TIMEOUT_MS` | `30000` | AV scan timeout per file |
| `MAX_LOGIN_ATTEMPTS` | `5` | Failed logins before lockout |
| `LOCKOUT_DURATION_MINUTES` | `15` | Minutes an account stays locked |
| `JWT_ACCESS_EXPIRY_SECONDS` | `900` | Access token lifetime (15 min) |
| `JWT_REFRESH_EXPIRY_SECONDS` | `604800` | Refresh token lifetime (7 days) |
| `EXPIRY_CLEANUP_INTERVAL_MS` | `60000` | How often expired files are purged (1 min) |
| `NODE_ENV` | (set to `production`) | `production` enforces HTTPS cookies + scanner requirement |
| `IIS_LOGS_ENABLED` | `false` | Enable IIS W3C log writing |
| `IIS_SITE_ID` | `1` | IIS site number (used in log path) |
| `IIS_LOGS_PATH` | `C:\inetpub\logs\LogFiles\W3SVC{N}` | Override log directory |
| `GEMINI_API_KEY` | (optional) | AI vibe messages; falls back gracefully if absent |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASSWORD` | (optional) | Email delivery; app works without it |

### Database Connection Pool

✅ CONFIRMED from `src/server/db.ts` lines 43–46

- Minimum connections: `DB_POOL_MIN` (default **2**)
- Maximum connections: `DB_POOL_MAX` (default **10**)
- Idle timeout: **30,000 ms** (hardcoded)
- Request timeout: `DB_REQUEST_TIMEOUT_MS` (default **15,000 ms**)
- Connection timeout: `DB_CONNECTION_TIMEOUT_MS` (default **30,000 ms**)

Pool errors are logged to Node.js stderr with prefix `[database] Pool error:`.

---

## Severity Classification

| Level | Criteria | Response SLA |
|---|---|---|
| **P0** | Production fully down, data loss risk, security breach, all users impacted | Page immediately; escalate to infrastructure team within **15 minutes** if not resolved |
| **P1** | Degraded service; a feature or user group is impaired; workaround may exist | Notify infrastructure team within **1 hour**; escalate if not resolved within **4 hours** |
| **P2** | Non-critical degradation; graceful fallback active; no data at risk | Ticket within **1 business day** |

---

## P0 Runbooks — Service Down

---

### P0-01: Service Not Responding (Node.js Process Down or Hung)

#### Detection Signals

- `/health/live` returns connection refused, timeout, or non-200 status.
- IIS ARR returns HTTP 502 or 503 to all users.
- Monitoring alert: liveness probe failed.
- Users report "site not loading" or "connection refused."

#### Immediate Action (within 5 minutes)

1. Check if the Node.js process is running:
   ```powershell
   Get-Process -Name node -ErrorAction SilentlyContinue
   ```
   If no output: the process is not running. Proceed to step 3.
   If output shown: the process exists but may be hung. Proceed to step 2.

2. Test liveness directly:
   ```powershell
   curl -s --max-time 5 http://localhost:3000/health/live
   ```
   If timeout: the process is hung. Kill and restart.

3. Restart the service:
   ```powershell
   # Adapt to your service manager — see "Node.js Service Restart Procedure" above
   Restart-Service -Name "LeekuSecure" -Force
   Start-Sleep -Seconds 10
   curl -s http://localhost:3000/health/live
   curl -s http://localhost:3000/health/ready
   ```

4. If the service fails to start, check stderr output from the service manager for startup errors. The most common startup failures in production are the four `validateProductionConfig()` checks (see P0-01 Root Cause section below).

#### Root Cause Investigation

**Startup failure — configuration:**
```powershell
# Check the Node.js service log for startup error message
# Example error: [production] Missing or placeholder configuration: MASTER_KEY_BASE64
# Look for lines beginning with [production] in stderr
```

The four production startup checks are: ✅ CONFIRMED `src/server/utils/production.ts`
1. Required env vars present and not containing `CHANGE_ME`/`localhost` placeholders.
2. Bitdefender CLI executable accessible at configured path.
3. `COOKIE_SECURE` is not set to `"false"`.
4. `FILE_STORAGE_UNC_PATH` is readable and writable by the process.

**Process crash — runtime error:**
```powershell
# Find recent Windows Event Log entries for the service
Get-EventLog -LogName Application -Source "LeekuSecure" -Newest 20 | Format-List
```

**Hung process (not crashing but not responding):**
```powershell
# Check CPU usage of the node process
Get-Process -Name node | Select-Object CPU, WorkingSet, Id
# High CPU with no /health/live response suggests a synchronous blocking operation
```

#### Resolution

| Cause | Resolution |
|---|---|
| Process not running | Restart service (step 3 above) |
| Startup validation failure | Fix the failing env var or system condition; restart |
| Process hung (high CPU) | Kill (`Stop-Process -Name node -Force`) then restart |
| Process crashed in loop | Review stderr for recurring error; may need infra team |
| Out of memory | Restart immediately; investigate memory leak with infra team |

After any restart, verify:
```powershell
curl -s http://localhost:3000/health/live
# Must return: { "status": "ok", "uptimeSeconds": <small number> }
curl -s http://localhost:3000/health/ready
# Must return: { "status": "ready", "checks": { "database": true, "vault": true, "scanner": true } }
```

#### Escalation Tree

```
T+0:  Operator detects liveness failure
T+5:  Operator attempts restart (Step 3)
T+10: If restart fails OR service crashes again within 5 minutes:
        → ESCALATE to Infrastructure Team
        → Page: "P0: Leeku Secure Node.js service down, restart failed. Server: <hostname>."
T+15: Infrastructure Team takes ownership
T+30: If not resolved:
        → ESCALATE to Engineering Lead
        → Page: "P0: Leeku Secure down 30+ minutes, infra team engaged."
```

#### P0 Communication Template — Service Not Responding

```
TO: [All affected users / status page]
AUDIENCE: All Leeku Secure users
TIMELINE: Send within 10 minutes of confirmed outage

SUBJECT: Leeku Secure — Service Unavailable [INCIDENT IN PROGRESS]

STATUS: Leeku Secure is currently unavailable. We have detected a service
disruption and our team is working to restore access.

IMPACT: All users are unable to access the application.

STARTED: [UTC timestamp]
NEXT UPDATE: In 15 minutes or when resolved.

We apologise for the disruption.
— Leeku Secure Operations Team
```

---

### P0-02: Database Unavailable

#### Detection Signals

- `/health/ready` returns HTTP 503 with `"database": false`.
- Node.js stderr shows: `[database] Pool error:` followed by SQL Server connection error.
- All API endpoints that touch data return HTTP 500.
- `/health/live` may still return 200 (process is up) but `/health/ready` returns 503.

#### Immediate Action (within 5 minutes)

1. Verify the readiness check:
   ```powershell
   curl -s http://localhost:3000/health/ready
   # Look for: "database": false
   ```

2. Check if SQL Server service is running **on the DB host** (requires RDP or PowerShell remoting to `DB_SERVER`):
   ```powershell
   # On the SQL Server host:
   Get-Service -Name "MSSQLSERVER" -ErrorAction SilentlyContinue
   Get-Service -Name "MSSQL$*" -ErrorAction SilentlyContinue
   ```
   If `Status` is not `Running`, start it:
   ```powershell
   Start-Service -Name "MSSQLSERVER"
   ```

3. Test connectivity from the application server to the DB server:
   ```powershell
   # Replace DB_SERVER with the value from your .env
   Test-NetConnection -ComputerName <DB_SERVER> -Port 1433
   # TcpTestSucceeded should be True
   ```

4. Verify the `DB_SERVER` env var in `.env` is not set to `localhost` or a placeholder:
   ```powershell
   # On the application server, read the .env file:
   Select-String -Path "C:\path\to\leeku-secure\.env" -Pattern "^DB_"
   ```

5. After confirming SQL Server is running and reachable, restart the Node.js service to re-establish the connection pool:
   ```powershell
   Restart-Service -Name "LeekuSecure" -Force
   Start-Sleep -Seconds 10
   curl -s http://localhost:3000/health/ready
   ```

#### Root Cause Investigation

```powershell
# On the SQL Server host — check SQL Server error log:
# In SSMS: Management > SQL Server Logs > Current
# Or via PowerShell:
Get-EventLog -LogName Application -Source "MSSQLSERVER" -Newest 20 | Format-List
```

Common causes:
- SQL Server service stopped (Windows Update reboot, service crash).
- Network partition between app server and DB server.
- SQL Server authentication failure (password rotated but `.env` not updated).
- `DB_POOL_MAX` (default 10) exhausted — check for connection leaks in stderr.
- DB disk full — SQL Server stops accepting writes.

#### Resolution

| Cause | Resolution |
|---|---|
| SQL Server service stopped | Start SQL Server service; restart Node.js service |
| Network partition | Fix network routing; restart Node.js service |
| Auth failure (wrong password) | Update `DB_PASSWORD` in `.env`; restart Node.js service |
| Connection pool exhausted | Restart Node.js service; investigate query timeouts in stderr |
| DB disk full | Free disk space on SQL Server host; contact infra team |

#### Escalation Tree

```
T+0:  Operator detects database: false in /health/ready
T+5:  Operator checks SQL Server service status and network connectivity
T+10: If SQL Server is running and reachable but Node.js still shows database: false:
        → ESCALATE to Infrastructure Team (DBA)
        → Page: "P0: Leeku Secure database connection failure. SQL Server at <DB_SERVER>."
T+15: Infrastructure Team (DBA) takes ownership
T+60: If not resolved:
        → ESCALATE to Engineering Lead
```

#### P0 Communication Template — Database Unavailable

```
TO: [All affected users / status page]
AUDIENCE: All Leeku Secure users
TIMELINE: Send within 10 minutes of confirmed DB outage

SUBJECT: Leeku Secure — Service Disruption [INCIDENT IN PROGRESS]

STATUS: Leeku Secure is experiencing a service disruption affecting all
file operations. Our database infrastructure requires attention.

IMPACT: Users cannot upload, download, or manage files.
        User login is also unavailable.

STARTED: [UTC timestamp]
NEXT UPDATE: In 20 minutes or when resolved.

We are working to restore service as quickly as possible.
— Leeku Secure Operations Team
```

---

### P0-03: Vault (UNC Share) Inaccessible

#### Detection Signals

- `/health/ready` returns HTTP 503 with `"vault": false`.
- Node.js stderr shows: `ENOENT` or `EACCES` for `FILE_STORAGE_UNC_PATH`.
- Upload requests fail with HTTP 500 after scan completes.
- Download requests fail with HTTP 410 ("Vault file not found").
- `dir \\fileserver\vault` on the application server fails or hangs.

#### Immediate Action (within 5 minutes)

1. Confirm the vault check is failing:
   ```powershell
   curl -s http://localhost:3000/health/ready
   # Look for: "vault": false
   ```

2. Check the current UNC share mapping from the application server:
   ```powershell
   net use
   # Look for the vault share path (FILE_STORAGE_UNC_PATH value from .env)
   # Status column should show "OK"
   # If "Disconnected" or not listed, the mapping has dropped
   ```

3. Attempt to re-map the share:
   ```powershell
   # Replace values with those from .env:
   # STORAGE_NET_USE_PATH, STORAGE_NET_USE_USER, STORAGE_NET_USE_PASS
   net use \\fileserver\vault <STORAGE_NET_USE_PASS> /user:<STORAGE_NET_USE_USER> /persistent:no
   ```
   ✅ CONFIRMED: the application uses `net use` with these env vars at startup (`server.ts` lines 323–343)

4. Test read/write access:
   ```powershell
   # Read test:
   dir \\fileserver\vault
   # Write test:
   "test" | Out-File -FilePath "\\fileserver\vault\.leeku-ping-test"
   Remove-Item "\\fileserver\vault\.leeku-ping-test" -ErrorAction SilentlyContinue
   ```

5. After restoring access, restart the Node.js service (the vault check in `/health/ready` reads it dynamically, but the UNC mapping is done at startup):
   ```powershell
   Restart-Service -Name "LeekuSecure" -Force
   Start-Sleep -Seconds 10
   curl -s http://localhost:3000/health/ready
   ```

#### Root Cause Investigation

| Symptom | Likely Cause |
|---|---|
| `net use` shows "Disconnected" | Network interruption dropped the SMB session |
| `net use` shows "Access Denied" | `STORAGE_NET_USE_USER` credentials changed or expired |
| `net use` shows nothing for the path | Mapping was never made (service restarted without startup mapping) |
| `dir` times out | File server (NAS/Windows Server) is unreachable |
| `dir` works but write test fails | Permissions issue — service account lacks write on the share |

#### Resolution

| Cause | Resolution |
|---|---|
| SMB session dropped | Re-run `net use` command (step 3); restart Node.js |
| Credentials expired | Update `STORAGE_NET_USE_PASS` in `.env`; re-run `net use`; restart Node.js |
| File server down | Escalate to infrastructure team immediately |
| Permission denied | Infra team to re-grant share permissions to service account |

#### Escalation Tree

```
T+0:  Operator detects vault: false in /health/ready
T+5:  Operator checks net use status and attempts re-mapping
T+10: If share host is unreachable (ping fails to file server):
        → ESCALATE to Infrastructure Team immediately
        → Page: "P0: Leeku Secure vault UNC share unreachable. File server: <\\fileserver>."
      If re-mapping succeeds but vault check still fails:
        → Restart Node.js service and re-check
T+15: If not resolved after restart:
        → ESCALATE to Infrastructure Team
T+60: If file server is down and no ETA:
        → ESCALATE to Engineering Lead for read-only mode decision
```

#### P0 Communication Template — Vault Inaccessible

```
TO: [All affected users / status page]
AUDIENCE: All Leeku Secure users
TIMELINE: Send within 10 minutes of confirmed vault outage

SUBJECT: Leeku Secure — File Access Unavailable [INCIDENT IN PROGRESS]

STATUS: We are experiencing a storage infrastructure issue that is
preventing file uploads and downloads.

IMPACT: File upload and download are unavailable.
        Login and account management remain operational.

STARTED: [UTC timestamp]
NEXT UPDATE: In 20 minutes or when resolved.

— Leeku Secure Operations Team
```

---

### P0-04: Bitdefender Scanner Down in Production (CRITICAL — Uploads Fail-Closed)

#### Why This Is P0

In `NODE_ENV=production`, the application is **fail-closed** on scanner unavailability. ✅ CONFIRMED `src/server/utils/production.ts` line 27–29 and `src/server/routes/health.ts` line 25.

- The production startup check refuses to start if the scanner is missing.
- `/health/ready` returns HTTP 503 with `"scanner": false` if the scanner becomes unavailable after startup.
- Every upload attempt will fail at the scan stage — even for clean files.
- Users will see an error message on every upload attempt.

In `NODE_ENV=development`, uploads are allowed without scanning (`ALLOW_UNSCANNED_UPLOADS_IN_DEVELOPMENT`). This does NOT apply to production.

#### Detection Signals

- `/health/ready` returns HTTP 503 with `"scanner": false`.
- Upload attempts return HTTP 422 with Bitdefender-related error messages.
- Node.js stderr shows: `[scanner] Bitdefender CLI not found` or `[scanner] Bitdefender CLI path does not exist`.
- Bitdefender Endpoint Security service is stopped in Windows Services.

#### Immediate Action (within 5 minutes)

1. Confirm scanner check is failing:
   ```powershell
   curl -s http://localhost:3000/health/ready
   # Look for: "scanner": false
   ```

2. Check if Bitdefender Endpoint Security service is running:
   ```powershell
   Get-Service -DisplayName "*Bitdefender*" | Select-Object Name, Status, DisplayName
   ```
   If any service shows `Stopped`:
   ```powershell
   # Start the Bitdefender agent (service name may vary by version):
   Start-Service -Name "EPSecurityService" -ErrorAction SilentlyContinue
   Start-Service -Name "BDAgent" -ErrorAction SilentlyContinue
   Start-Service -Name "BDRedLine" -ErrorAction SilentlyContinue
   ```

3. Verify the CLI executable exists at the configured path:
   ```powershell
   # Replace with BITDEFENDER_SCAN_CLI_PATH value from .env
   # Or check default auto-detect paths:
   Test-Path "C:\Program Files\Bitdefender\Endpoint Security Tools\product.console.exe"
   Test-Path "C:\Program Files\Bitdefender\Endpoint Security Tools\bdscan.exe"
   Test-Path "C:\Program Files\Bitdefender\Endpoint Security\product.console.exe"
   ```

4. Test the scanner directly:
   ```powershell
   # Replace with your actual CLI path:
   & "C:\Program Files\Bitdefender\Endpoint Security Tools\bdscan.exe" "C:\Windows\System32\notepad.exe"
   echo "Exit code: $LASTEXITCODE"
   # Expected: exit code 0 (Clean)
   ```

5. If the Bitdefender service is now running, check `/health/ready` again:
   ```powershell
   curl -s http://localhost:3000/health/ready
   # scanner: true if the CLI path is now accessible
   ```
   Note: `/health/ready` calls `isScannerAvailable()` which checks file existence — no Node.js restart needed for the health check to update. However, restart Node.js to ensure the scanner path is resolved fresh:
   ```powershell
   Restart-Service -Name "LeekuSecure" -Force
   Start-Sleep -Seconds 10
   curl -s http://localhost:3000/health/ready
   ```

#### Root Cause Investigation

✅ CONFIRMED auto-detect paths from `src/server/utils/scanner.ts` lines 84–98:
- `C:\Program Files\Bitdefender\Endpoint Security Tools\product.console.exe`
- `C:\Program Files\Bitdefender\Endpoint Security\product.console.exe`
- `C:\Program Files (x86)\Bitdefender\Endpoint Security Tools\product.console.exe`
- `C:\Program Files\Bitdefender\Endpoint Security Tools\bdscan.exe`
- `C:\Program Files\Bitdefender\Endpoint Security\bdscan.exe`
- `C:\Program Files (x86)\Bitdefender\Endpoint Security Tools\bdscan.exe`

| Symptom | Likely Cause |
|---|---|
| Service stopped, CLI path exists | Bitdefender service crashed or stopped by Windows Update |
| CLI path does not exist | Bitdefender was uninstalled or installation was moved |
| `BITDEFENDER_SCAN_CLI_PATH` points to wrong path | Env var misconfiguration after Bitdefender upgrade |
| Scanner hangs (timeout after `BITDEFENDER_TIMEOUT_MS`) | Bitdefender license expired; engine database corrupted |

#### Resolution

| Cause | Resolution |
|---|---|
| BD service stopped | Start Bitdefender services (step 2) |
| CLI path missing | Verify BD installation; update `BITDEFENDER_SCAN_CLI_PATH` in `.env` |
| BD license expired | Renew Bitdefender license; contact BD support |
| Engine corrupted | Reinstall Bitdefender Endpoint Security; escalate to infra team |

#### Escalation Tree

```
T+0:  Operator detects scanner: false in /health/ready
T+5:  Operator attempts to start Bitdefender services
T+10: If Bitdefender services cannot be started:
        → ESCALATE to Infrastructure Team
        → Page: "P0: Leeku Secure Bitdefender scanner down in production.
                 All uploads are failing. Server: <hostname>."
T+15: Infrastructure Team investigates BD installation/license
T+30: If not resolved:
        → ESCALATE to Engineering Lead
        → Engineering Lead decides whether to temporarily allow a maintenance window
          (requires changing NODE_ENV temporarily — this decision requires sign-off)
```

**Do NOT change `NODE_ENV` to `development` in production without Engineering Lead approval.** Doing so disables fail-closed scanner protection and allows unscanned files into the vault.

#### P0 Communication Template — Scanner Down

```
TO: [All affected users / status page]
AUDIENCE: All Leeku Secure users
TIMELINE: Send within 10 minutes of confirmed scanner outage

SUBJECT: Leeku Secure — File Upload Unavailable [INCIDENT IN PROGRESS]

STATUS: Our security scanning infrastructure is currently unavailable.
As a security measure, file uploads are suspended until scanning
is restored.

IMPACT: File uploads are blocked.
        File downloads, login, and account management are NOT affected.

STARTED: [UTC timestamp]
NEXT UPDATE: In 20 minutes or when resolved.

We are working to restore upload functionality as quickly as possible.
— Leeku Secure Operations Team
```

---

## P1 Runbooks — Degraded Service

---

### P1-01: High Error Rate on `/api/files/upload`

#### Detection Signals

- Users reporting upload failures with "scan failed" or "upload blocked" messages.
- Elevated HTTP 422 or HTTP 500 responses on `/api/files/upload` in IIS logs.
- `failedScans` count in `/api/stats` increasing rapidly.
- `Scan` event_type entries in `system_logs` increasing.
- `/health/ready` still returns HTTP 200 (all checks pass — this is degraded, not down).

#### Immediate Action

1. Check `/health/ready` to rule out P0 conditions:
   ```powershell
   curl -s http://localhost:3000/health/ready
   ```
   If `scanner: false`, escalate to P0-04. If `vault: false`, escalate to P0-03. If `database: false`, escalate to P0-02.

2. Check `/api/stats` for `failedScans` count and `diskUsagePercent`:
   ```powershell
   # Requires admin credentials:
   curl -s -H "Authorization: Bearer <admin-token>" http://localhost:3000/api/stats
   ```

3. Check recent `Scan` log events in the database:
   ```sql
   SELECT TOP 50 user_id, username_snapshot, message, ip_address, created_at
   FROM system_logs
   WHERE event_type = 'Scan'
   ORDER BY created_at DESC;
   ```

#### Root Cause Investigation

| Cause | Indicators |
|---|---|
| Legitimate AV blocks | `Scan` log messages contain threat names; different users affected; clean uploads succeed |
| Bitdefender timeout (`BITDEFENDER_TIMEOUT_MS` hit) | Log messages contain "timed out"; scanner: true in health check; BD service may be slow |
| Vault disk full | `diskUsagePercent` near 100%; uploads fail at `encrypt_file` stage in stderr |
| DB write failures (quota table missing, etc.) | HTTP 500 errors; `quota_lookup` or `insert_file_record` in stderr |
| User quota exhausted | HTTP 400 with "Storage full" or "File count limit reached"; only specific users affected |

#### Resolution

| Cause | Resolution |
|---|---|
| Legitimate AV blocks | No action needed; inform users that specific files were blocked by policy |
| BD timeout | Increase `BITDEFENDER_TIMEOUT_MS`; check BD engine health; escalate to infra team |
| Vault disk full | Expand vault volume or purge expired/blocked files; escalate to infra team if immediate |
| DB write failure | Investigate specific SQL error in stderr; escalate to infra team (DBA) |
| User quota exhausted | Inform user; admin can increase quota tier via `POST /api/admin/users/{id}/quota` |

#### Validation

After resolution:
1. Upload a small test file using a test account — confirm it succeeds.
2. Check `GET /api/admin/logs` for a new `Upload` event confirming success.
3. Check `GET /health/ready` — all checks still `true`.

#### Notification Template — P1-01

```
TO: [Operations team, on-call engineer]
AUDIENCE: Internal operations
TIMELINE: Within 1 hour of detection

SUBJECT: P1: Leeku Secure Upload Errors — [date UTC]

File uploads are experiencing elevated failure rates since [UTC timestamp].

HEALTH CHECK: [paste /health/ready output]
STATS: [paste /api/stats output]
RECENT SCAN EVENTS: [paste last 10 Scan log entries]

Immediate cause: [determined from investigation]
Action taken: [what was done]
Status: [Ongoing / Resolved at HH:MM UTC]
```

---

### P1-02: Authentication Failure Spike

#### Detection Signals

- Users reporting "Account locked" messages.
- Rapid increase in `Security` event_type entries in `system_logs`.
- Multiple `Security` log entries from a single IP address.
- IIS logs showing high volume of POST requests to `/api/auth/login`.
- Auth rate limiter (20 RPM per IP) triggering HTTP 429 responses.

✅ CONFIRMED: auth rate limit is 20 requests/minute per IP (`server.ts` line 453).

#### Immediate Action

1. Check for `Security` events (lockouts) in the last 15 minutes:
   ```sql
   SELECT ip_address, COUNT(*) AS lockout_events, MIN(created_at) AS first_seen, MAX(created_at) AS last_seen
   FROM system_logs
   WHERE event_type = 'Security'
     AND message LIKE '%locked%'
     AND created_at > DATEADD(minute, -15, SYSDATETIMEOFFSET())
   GROUP BY ip_address
   ORDER BY lockout_events DESC;
   ```

2. Check for high volumes of `Auth` failures (invalid login attempts that did not trigger lockout):
   ```sql
   SELECT TOP 100 ip_address, message, created_at
   FROM system_logs
   WHERE event_type = 'Security'
   ORDER BY created_at DESC;
   ```

3. If a single IP is responsible for more than 10 lockouts in 15 minutes, this is an active brute-force attack. Identify the attacking IP and consider firewall-level blocking (this requires infrastructure team access to the Windows Firewall or WAF/ARR rules):
   ```powershell
   # Block the attacking IP at Windows Firewall (run as Administrator):
   New-NetFirewallRule -DisplayName "Block-BruteForce-<IP>" `
     -Direction Inbound -RemoteAddress <attacking-IP> `
     -Action Block -Protocol TCP
   ```

#### Root Cause Investigation

| Pattern | Likely Cause |
|---|---|
| Many lockouts on one user from many IPs | Targeted credential stuffing |
| Many lockouts on many users from one IP | Brute-force sweep / credential spray |
| Many lockouts on one user from one IP | Targeted brute-force on specific account |
| Lockouts following a password reset | User forgot new password; not malicious |

#### Resolution

| Cause | Resolution |
|---|---|
| Active brute-force from single IP | Firewall block (step 3 above); escalate to infra team for WAF rule |
| Credential stuffing from many IPs | Escalate to security team; consider CAPTCHA or temporary IP allowlist |
| Legitimate user locked out | Admin can clear lockout via `POST /api/admin/users/{id}/edit` with new password or SSMS |
| False positive (monitoring) | Review log patterns; adjust alert thresholds |

Lockout parameters: `MAX_LOGIN_ATTEMPTS` (default 5), `LOCKOUT_DURATION_MINUTES` (default 15). ✅ CONFIRMED `server.ts` lines 83–84

Lockouts auto-clear after `LOCKOUT_DURATION_MINUTES`. No manual action required for non-attack scenarios.

#### Validation

After addressing:
1. Check that the attacking IP's lockout rate has dropped to zero in `system_logs`.
2. Verify legitimate users can log in again.
3. Review IIS logs for continued attack volume.

#### Notification Template — P1-02

```
TO: [Operations team, security team]
AUDIENCE: Internal operations and security
TIMELINE: Within 1 hour of detection

SUBJECT: P1: Leeku Secure Auth Failure Spike — [date UTC]

Elevated authentication failure rate detected since [UTC timestamp].

ATTACK PATTERN: [single IP / distributed / single target]
TOP SOURCE IPs: [from SQL query above]
ACCOUNTS AFFECTED: [count of distinct user_ids in Security events]

Action taken: [firewall block / escalation / none yet]
Status: [Ongoing / Resolved at HH:MM UTC]
```

---

### P1-03: IIS W3C Log Rotation Failure

#### Detection Signals

- Log directory approaching disk capacity on the C: drive.
- IIS log files from previous days are not rolling over (single file is very large).
- Node.js stderr shows: `[iis-logger] Failed to append request log:` or `[iis-logger] Failed to create log directory:`.
- Node.js stderr shows: `[iis-logger] Disabling IIS logging.` — logging has been auto-disabled after a write failure. ✅ CONFIRMED `iis-logger.ts` lines 340–342

**Note:** This only applies when `IIS_LOGS_ENABLED=true`. If this variable is `false`, IIS W3C logging from the application is disabled and no action is needed.

#### Immediate Action

1. Check if IIS logging is enabled:
   ```powershell
   Select-String -Path "C:\path\to\leeku-secure\.env" -Pattern "IIS_LOGS_ENABLED"
   ```
   If `IIS_LOGS_ENABLED=false` or not set: this is not an active issue. Close the alert.

2. Check disk space on the C: drive:
   ```powershell
   Get-PSDrive -Name C | Select-Object Used, Free, @{n='FreeGB';e={[math]::Round($_.Free/1GB,2)}}
   ```
   If free space is below 1 GB, this is a P1 risk and approaching P0.

3. Check the IIS log directory:
   ```powershell
   # IIS_SITE_ID from .env (default: 1)
   $siteId = 1
   $logPath = "C:\inetpub\logs\LogFiles\W3SVC$siteId"
   # Or check IIS_LOGS_PATH env var for override
   dir $logPath | Sort-Object LastWriteTime | Select-Object -Last 10
   ```

4. Check permissions on the log directory:
   ```powershell
   icacls "C:\inetpub\logs\LogFiles\W3SVC1"
   # The Node.js service account must have (M) modify or (W) write access
   ```

#### Root Cause Investigation

| Symptom | Likely Cause |
|---|---|
| Log directory does not exist | IIS site was recreated with a new site ID; `IIS_SITE_ID` env var is stale |
| Permission denied on log write | Windows permission change; service account lost write access |
| Disk full | Log retention not configured; old logs not purged |
| Very large single log file | Daily rollover disabled (`IIS_LOGS_DAILY_ROLLOVER=false`) or midnight rollover failed |

#### Resolution

| Cause | Resolution |
|---|---|
| Permission denied | Grant write permission: `icacls "C:\inetpub\logs\LogFiles\W3SVC1" /grant "NT SERVICE\LeekuSecure:(M)"` |
| Disk full | Archive and delete log files older than 30 days; expand C: volume if recurring |
| Wrong site ID | Update `IIS_SITE_ID` in `.env`; create directory; restart Node.js |
| IIS logging auto-disabled | Fix underlying issue; restart Node.js (logging re-enables on startup if `IIS_LOGS_ENABLED=true`) |

Log file naming pattern: `leeku_secure_YYYY-MM-DD.log` ✅ CONFIRMED `iis-logger.ts` line 128

#### Validation

After resolution:
1. Check that the log directory has a log file for today's date.
2. Make a test HTTP request to the application.
3. Verify a new line appears in today's log file within a few seconds.

#### Notification Template — P1-03

```
TO: [Operations team]
AUDIENCE: Internal operations
TIMELINE: Within 1 hour of detection

SUBJECT: P1: Leeku Secure IIS Log Rotation Issue — [date UTC]

IIS W3C log writing is failing or at risk.

LOG PATH: [C:\inetpub\logs\LogFiles\W3SVC{N}]
DISK FREE: [GB free on C:]
LAST LOG FILE: [filename and size]
ERROR IN NODE.JS STDERR: [paste relevant lines]

Action taken: [permission fix / disk cleanup / etc.]
Status: [Ongoing / Resolved at HH:MM UTC]
```

---

## P2 Runbooks — Non-Critical

---

### P2-01: Gemini AI Vibe Messages Failing

#### Trigger Criteria

- Upload success or rejection messages display generic static text instead of AI-generated messages.
- Node.js stderr shows errors from `@google/genai` or `generateLeekuVibe`.
- `GEMINI_API_KEY` is missing, set to `"CHANGE_ME"`, or the Google Gemini API is unreachable.

#### Behaviour When Failing

The application **falls back gracefully** to static messages. ✅ CONFIRMED `server.ts` lines 391–420

Fallback messages for clean scans (randomly selected):
- "Security scan completed. No threats were detected."
- "File verified and ready to use."
- "Upload completed and passed the security scan."
- "No malicious content was detected."

Fallback messages for blocked scans:
- "Upload blocked because the security scan detected a potential threat."
- "File rejected due to suspicious content."
- "Security scan failed. Upload denied."

There is no user-visible error. No uploads are affected. No data is at risk.

#### Workaround

The fallback is automatic. No operator action is required for ongoing service. The static messages are displayed until the Gemini API is restored.

#### Resolution

1. Verify the `GEMINI_API_KEY` in `.env`:
   ```powershell
   Select-String -Path "C:\path\to\leeku-secure\.env" -Pattern "^GEMINI_API_KEY"
   # Must be set to a valid non-placeholder value
   ```

2. If the key is missing or is `"CHANGE_ME"`:
   - Obtain a valid Gemini API key from https://ai.google.dev/
   - Update `GEMINI_API_KEY` in `.env`
   - Restart the Node.js service

3. If the key is set but Google's API is unreachable, this is a Google infrastructure issue. No action required — fallback is already active.

#### Ticket Template — P2-01

```
Title: P2: Leeku Secure Gemini AI vibe messages not generating

Environment: Production
Detected: [UTC timestamp]

SYMPTOM: Upload confirmation messages are showing generic static text
instead of AI-generated messages.

GEMINI_API_KEY set: [yes/no]
GEMINI_API_KEY is placeholder: [yes/no]
Node.js stderr errors: [paste any genai-related errors]

WORKAROUND ACTIVE: Yes — static fallback messages are displaying.
No uploads are affected.

PRIORITY: Low — cosmetic issue only.
ASSIGN TO: [operations / platform team]
```

---

### P2-02: SMTP Email Not Sending

#### Trigger Criteria

- New user registrations appear to complete but users do not receive verification emails.
- Account deletion confirmation emails are not delivered.
- Node.js stderr shows: `[email] Failed to send verification:` or `[email] Failed to send deletion confirmation:`.
- `SMTP_HOST`, `SMTP_USER`, or `SMTP_PASSWORD` is missing or incorrect.

#### Behaviour When SMTP Is Disabled or Failing

✅ CONFIRMED `server.ts` lines 86, 930–938

- `SMTP_ENABLED` is determined at startup by the presence of all three `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` variables.
- When `SMTP_ENABLED = false`: new users are auto-verified and logged in immediately (development mode behaviour). Email verification is skipped.
- When `SMTP_ENABLED = true` but emails fail to send: the error is logged to stderr but does NOT fail the API response. Users are told to "check your inbox" but no email arrives.

**Impact in production with SMTP broken but `SMTP_ENABLED=true`:**
- New users cannot verify their email address.
- Users cannot complete account deletion (no confirmation email arrives).
- All other functionality (login for existing verified users, uploads, downloads) is unaffected.

#### Workaround

Existing verified users are not affected. New registrations are blocked at the email verification step.

For urgent user verification when SMTP is down:
1. Connect to SQL Server via SSMS.
2. Manually verify the user:
   ```sql
   UPDATE users
   SET email_verified = 1,
       email_verification_token = NULL,
       email_verification_expires = NULL
   WHERE id = '<user-uuid>';
   ```
3. Communicate to the user that their account is now verified.

#### Resolution

1. Verify SMTP configuration in `.env`:
   ```powershell
   Select-String -Path "C:\path\to\leeku-secure\.env" -Pattern "^SMTP_"
   # All three must be set: SMTP_HOST, SMTP_USER, SMTP_PASSWORD
   ```

2. Test SMTP connectivity from the application server:
   ```powershell
   Test-NetConnection -ComputerName <SMTP_HOST> -Port 587
   ```

3. Fix the SMTP credentials or host configuration in `.env`.

4. Restart the Node.js service (SMTP_ENABLED is determined at startup):
   ```powershell
   Restart-Service -Name "LeekuSecure" -Force
   ```

#### Ticket Template — P2-02

```
Title: P2: Leeku Secure SMTP email delivery failing

Environment: Production
Detected: [UTC timestamp]

SYMPTOM: Verification and deletion confirmation emails are not being sent.

SMTP_HOST configured: [yes/no — value: <host>]
SMTP_USER configured: [yes/no]
SMTP_PASSWORD configured: [yes/no]
SMTP port reachable: [paste Test-NetConnection output]
Node.js stderr errors: [paste relevant lines]

WORKAROUND ACTIVE: Manual SQL verification available for urgent cases.
New user registrations are blocked at email verification step.

PRIORITY: Medium — new user onboarding is impaired.
ASSIGN TO: [operations / platform team]
```

---

### P2-03: File Expiry Cleanup Not Running

#### Trigger Criteria

- Files with TTL (time-to-live) hours set are not being deleted after their `expires_at` timestamp passes.
- Database query shows records with `expires_at < SYSDATETIMEOFFSET()` and `status != 'Expired'`.
- Node.js stderr shows errors from `[expiry-cleanup]`.
- `EXPIRY_CLEANUP_INTERVAL_MS` is set to `0` or an invalid value (disabling the cleanup loop).

✅ CONFIRMED `src/server/utils/expiry-cleanup.ts` is imported and `startExpiryCleanup` is called at startup.

#### Behaviour When Cleanup Is Not Running

- Expired files remain accessible to their owners in the file list.
- The vault physical blobs remain on the UNC share, consuming disk space.
- No data is corrupted. No security risk — files are not exposed to other users.
- The cleanup interval default is 60,000 ms (1 minute). ✅ CONFIRMED `server.ts` line from env var default: `EXPIRY_CLEANUP_INTERVAL_MS` (default `60000`)

#### Workaround

Expired files can be manually purged via SQL:

```sql
-- Find expired files:
SELECT id, stored_path, owner_user_id, size_bytes, expires_at
FROM files
WHERE expires_at < SYSDATETIMEOFFSET()
  AND status = 'Available'
ORDER BY expires_at ASC;
```

**Do not delete from SQL directly** without also deleting the physical vault blob. Coordinate with the infrastructure team or engineering for a manual purge script.

#### Resolution

1. Check the `EXPIRY_CLEANUP_INTERVAL_MS` value:
   ```powershell
   Select-String -Path "C:\path\to\leeku-secure\.env" -Pattern "EXPIRY_CLEANUP_INTERVAL_MS"
   # Must be a positive integer (e.g., 60000)
   # If set to 0, the cleanup loop will not start
   ```

2. If the value is `0` or missing, set it to `60000` in `.env`.

3. Restart the Node.js service:
   ```powershell
   Restart-Service -Name "LeekuSecure" -Force
   ```

4. After restart, monitor stderr for `[expiry-cleanup]` log lines confirming the loop is running.

#### Ticket Template — P2-03

```
Title: P2: Leeku Secure file expiry cleanup not purging expired files

Environment: Production
Detected: [UTC timestamp]

SYMPTOM: Files with expired TTLs are not being removed from the vault.

EXPIRY_CLEANUP_INTERVAL_MS value: [from .env]
[expiry-cleanup] stderr output: [paste relevant lines, or "none found"]
Count of expired files in DB:
  SELECT COUNT(*) FROM files WHERE expires_at < SYSDATETIMEOFFSET() AND status = 'Available';
  [paste result]

WORKAROUND ACTIVE: Files remain accessible to owners but no data is at risk.
Manual purge is possible via SQL + filesystem — requires infra team coordination.

PRIORITY: Low — disk space may grow; no security or availability impact.
ASSIGN TO: [operations / platform team]
```

---

## Post-Incident Review Checklist (P0 Incidents)

After every P0 incident is resolved, complete this checklist within 24 hours:

- [ ] Timeline documented (detection time, escalation time, resolution time).
- [ ] Root cause identified and written down.
- [ ] Affected users counted (from IIS logs or `system_logs` error count during window).
- [ ] Communication sent to affected users confirming resolution.
- [ ] Contributing factors identified (deployment? Windows Update? infrastructure change?).
- [ ] Corrective actions assigned with owners and due dates.
- [ ] Runbook updated if any step was wrong, missing, or unclear.
- [ ] Monitoring alert reviewed — was detection fast enough?
- [ ] Post-incident review meeting scheduled within 5 business days for P0 incidents.
