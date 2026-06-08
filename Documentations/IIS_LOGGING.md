# IIS W3C Extended Log Format Integration

Leeku Secure can log all HTTP requests in IIS W3C Extended Log Format for integration with IIS analytics tools, compliance reporting, and performance analysis in IIS Manager on Windows Server 2022.

## Overview

When enabled, every HTTP request to the Leeku Secure API is logged to:

```
C:\inetpub\logs\LogFiles\W3SVC{IIS_SITE_ID}\leeku_secure_YYYY-MM-DD.log
```

This complements the application's built-in console/file logging and SQL Server audit trail, providing:
- **IIS Manager integration** — view request metrics directly in IIS
- **Compliance reporting** — export logs for security audits (HIPAA, PCI-DSS, SOC2)
- **Performance analysis** — identify slow endpoints and traffic patterns
- **Security monitoring** — track failed authentication attempts, suspicious user agents

---

## Setup

### 1. Verify IIS is Installed

```powershell
Get-Service W3SVC
Get-IISSite
```

### 2. Enable IIS Logging in `.env`

```bash
IIS_LOGS_ENABLED=true

# IIS Site ID (run: Get-IISSite | Select-Object Name, Id)
# Default: 1 (Default Web Site)
IIS_SITE_ID=1

# (Optional) Custom log directory instead of C:\inetpub\logs\LogFiles\W3SVC1
# IIS_LOGS_PATH=C:\inetpub\logs\LeekuSecure

# W3C fields to log (space-separated)
IIS_LOG_FIELDS=date time s-ip cs-method cs-uri-stem cs-uri-query s-port cs-username c-ip cs(User-Agent) sc-status sc-bytes cs-bytes time-taken

# Create new log file daily (true) or append to same file (false)
IIS_LOGS_DAILY_ROLLOVER=true
```

### 3. Ensure Service Account Permissions

The service account running Node.js must have **Read/Write** access to the IIS logs directory:

```powershell
# Grant permissions
$logPath = "C:\inetpub\logs\LogFiles\W3SVC1"
$acl = Get-Acl $logPath
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    "LEEKUUSER",
    "FullControl",
    "ContainerInherit, ObjectInherit",
    "None",
    "Allow"
)
$acl.AddAccessRule($rule)
Set-Acl -Path $logPath -AclObject $acl
```

### 4. Restart the Application

```powershell
# If running as a Windows Service
Restart-Service LeekuSecure

# If running manually
# Stop the Node process, then: npm run start
```

---

## Log Format

IIS W3C Extended Log Format (RFC 3161 compliant).

### Header

Each log file begins with metadata:

```
#Software: Leeku Secure
#Version: 1.0
#Date: 2026-06-07 10:30:45
#Fields: date time s-ip cs-method cs-uri-stem cs-uri-query s-port cs-username c-ip cs(User-Agent) sc-status sc-bytes cs-bytes time-taken
```

### Entry Example

```
2026-06-07 10:30:45 192.168.1.100 POST /api/files/upload - 443 admin@leeks.miku.rip 203.0.113.42 Mozilla/5.0 201 4192 2048 1250
```

**Fields (left to right):**
- `date` — Request date (YYYY-MM-DD)
- `time` — Request time (HH:MM:SS)
- `s-ip` — Server IP address
- `cs-method` — HTTP method (GET, POST, etc.)
- `cs-uri-stem` — URI path without query string
- `cs-uri-query` — Query string parameters
- `s-port` — Server port (443 for HTTPS)
- `cs-username` — Authenticated username or `-`
- `c-ip` — Client IP address
- `cs(User-Agent)` — User-Agent header
- `sc-status` — HTTP status code (200, 401, 500, etc.)
- `sc-bytes` — Response body size in bytes
- `cs-bytes` — Request body size in bytes
- `time-taken` — Request duration in milliseconds

---

## Viewing Logs in IIS Manager

### 1. Open IIS Manager

```powershell
inetmgr
```

### 2. Navigate to Your Site

- Expand the server node in the left panel
- Click on your website (e.g., "Leeku Secure")

### 3. View Logs

- Double-click **Logging** in the center panel
- Click **Browse** to open the log directory
- Or open directly: `C:\inetpub\logs\LogFiles\W3SVC{SiteID}`

### 4. Log Analysis Tools

IIS logs can be analyzed with:
- **IIS Log Parser** — Microsoft's command-line utility
- **LogParser Studio** — GUI for IIS Log Parser
- **Splunk**, **ELK Stack**, **Datadog** — enterprise SIEM integration

---

## Log Rotation

By default, Leeku creates a new log file **every day** (UTC midnight):

```
leeku_secure_2026-06-07.log
leeku_secure_2026-06-08.log
leeku_secure_2026-06-09.log
```

To append to the same file instead:

```bash
IIS_LOGS_DAILY_ROLLOVER=false
```

---

## Performance Considerations

- **Disk I/O:** Each request triggers a synchronous file write. On high-traffic systems, this may increase latency by 1–5 ms per request.
- **Disk Space:** Typical log growth is ~500 bytes per request. Estimate 1–2 GB per million requests.
- **Log Rotation:** Configure OS-level log archival (Windows Task Scheduler) to compress and move old logs.

### Archive Old Logs (Example)

```powershell
# Archive logs older than 30 days (run daily via Task Scheduler)
$logPath = "C:\inetpub\logs\LogFiles\W3SVC1"
$archivePath = "C:\inetpub\logs\Archive"
$cutoffDate = (Get-Date).AddDays(-30)

Get-ChildItem $logPath -Filter "leeku_secure_*.log" |
  Where-Object { $_.LastWriteTime -lt $cutoffDate } |
  ForEach-Object {
    Compress-Archive -Path $_.FullName -DestinationPath "$archivePath\$($_.Name).zip" -Force
    Remove-Item $_.FullName
  }
```

---

## Troubleshooting

### Logs Not Being Written

**Check:**
1. `IIS_LOGS_ENABLED` is set to `true` in `.env`
2. Log directory exists and service account has write access
3. Application startup logs show: `[iis-logger] IIS logging enabled. Path: C:\inetpub\logs\LogFiles\W3SVC1`

**Fix:**
```powershell
# Verify permissions
icacls "C:\inetpub\logs\LogFiles\W3SVC1" /grant "LEEKUUSER:(OI)(CI)F"

# Check service account
Get-WmiObject Win32_Service -Filter "Name='NodeApp'" | Select-Object Name, StartName
```

### Log Directory Permission Errors

**Error:** `Failed to write to IIS log directory: Access denied`

**Fix:**
```powershell
$logPath = "C:\inetpub\logs\LogFiles\W3SVC1"
$acl = Get-Acl $logPath

# Remove any inherited restrictions
$acl.SetAccessRuleProtection($false, $true)

# Grant full control to service account
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    "LEEKUUSER",
    "FullControl",
    "ContainerInherit, ObjectInherit",
    "None",
    "Allow"
)
$acl.AddAccessRule($rule)
Set-Acl $logPath $acl
```

### High Disk Usage

- Check log file sizes: `Get-ChildItem C:\inetpub\logs\LogFiles\W3SVC1 | Sort-Object Length -Descending`
- Enable daily rollover (default) to split logs by date
- Implement archival (compress + delete old logs after 30–90 days)

---

## Integration with SQL Server Audit Logs

The IIS logs **complement** the application's SQL Server `system_logs` table, which stores higher-level events (uploads, deletions, scans). Combined:

| Storage | Data | Retention | Use Case |
|---------|------|-----------|----------|
| IIS W3C Logs | Raw HTTP requests | 30–90 days (archived) | Performance analysis, intrusion detection |
| SQL `system_logs` | Application events | Indefinite (compressed) | Compliance audit trail, user action history |
| Console logs | Real-time app state | While running | Debugging, operational monitoring |

---

## Performance Baseline

On a typical Windows Server 2022 with SSD:

| Requests/sec | CPU Impact | Disk I/O | Storage/Day (1KB/req avg) |
|--------------|-----------|---------|--------------------------|
| 10 | <1% | Negligible | ~10 MB |
| 100 | ~2% | ~1 MB/s | ~100 MB |
| 1000 | ~5–10% | ~10 MB/s | ~1 GB |

For high-traffic scenarios (>1000 req/s), consider:
- Offloading to a dedicated log aggregation service (ELK, Splunk)
- Using event tracing (ETW) instead of file I/O
- Batching writes to reduce disk operations

---

## References

- [IIS Logging Documentation](https://docs.microsoft.com/en-us/iis/get-started/planning-for-security/understanding-iis-logs)
- [W3C Extended Log Format](https://www.w3.org/TR/WD-logfile.html)
- [IIS Log Parser Queries](https://docs.microsoft.com/en-us/iis/extensions/working-with-urlscan/using-urlscan-to-analyze-iis-logs)
- [Windows Server 2022 Logging Best Practices](https://docs.microsoft.com/en-us/windows-server/administration/windows-commands/wevtutil)
