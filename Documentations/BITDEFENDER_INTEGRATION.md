# Bitdefender Endpoint Security Integration Guide

This document describes how to integrate Bitdefender Endpoint Security Tools (BEST) with Leeku Secure for file scanning.

## Overview

Leeku Secure scans uploaded files using the **Bitdefender Endpoint Security Tools (BEST)** command-line interface to detect malware and suspicious content before they are stored in the vault.

- **Method:** On-premise command-line scanner (`bdscan.exe` or `product.console.exe`)
- **Supported:** Bitdefender Endpoint Security Tools 7.x+
- **Reference:** [Bitdefender CLI Documentation](https://www.bitdefender.com/business/support/en/77209-36849-using-the-command-line-interface.html)

---

## Installation & Setup

### Prerequisites

1. **Windows Server 2022** with Bitdefender Endpoint Security Tools installed
2. **Service account** running the Node.js application (must have read/write access to scan temp directory)
3. **Active Bitdefender license** on the server

### 1. Verify Bitdefender Installation

Run this in PowerShell to find the scanner executable:

```powershell
Get-ChildItem "C:\Program Files\Bitdefender\" -Recurse -Filter "product.console.exe"
Get-ChildItem "C:\Program Files\Bitdefender\" -Recurse -Filter "bdscan.exe"
```

Common paths (in priority order — application tries these in sequence):

1. **product.console.exe** (newer, faster — recommended)
   ```
   C:\Program Files\Bitdefender\Endpoint Security Tools\product.console.exe
   C:\Program Files\Bitdefender\Endpoint Security\product.console.exe
   ```

2. **bdscan.exe** (legacy, still works)
   ```
   C:\Program Files\Bitdefender\Endpoint Security Tools\bdscan.exe
   C:\Program Files\Bitdefender\Endpoint Security\bdscan.exe
   ```

### 2. Configure Leeku Environment Variables

Edit `.env` and set:

```bash
# Explicit path (if auto-detect fails or you want to specify a version)
BITDEFENDER_SCAN_CLI_PATH=C:\Program Files\Bitdefender\Endpoint Security Tools\bdscan.exe

# Maximum time to wait for a scan (milliseconds)
BITDEFENDER_TIMEOUT_MS=30000

# Extra command-line arguments (optional, space-separated)
# Common options: --quarantine, --remove, --log-all
BITDEFENDER_EXTRA_ARGS=

# Local temp directory for staging files before scan (must be local, not UNC)
FILE_SCAN_TEMP_PATH=C:\LeekuTemp\scan-staging
```

### 3. Create & Secure Temp Directory

```powershell
New-Item -ItemType Directory -Force -Path "C:\LeekuTemp\scan-staging"

# Restrict permissions — only the service account can access
$acl = Get-Acl "C:\LeekuTemp\scan-staging"
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    "LEEKUUSER",
    "FullControl",
    "ContainerInherit, ObjectInherit",
    "None",
    "Allow"
)
$acl.AddAccessRule($rule)
Set-Acl -Path "C:\LeekuTemp\scan-staging" -AclObject $acl
```

### 4. Ensure Service Account Permissions

The service account running Node.js must have:
- Read/write access to `C:\LeekuTemp\scan-staging`
- Execute permission on the Bitdefender scanner executable
- Access to the Bitdefender engine (automatic if BEST is installed)

```powershell
# Grant execute permission to the scanner
$scannerPath = "C:\Program Files\Bitdefender\Endpoint Security Tools\bdscan.exe"
$acl = Get-Acl $scannerPath
$acl.SetAccessRuleProtection($false, $true)  # inherit from Program Files
Set-Acl -Path $scannerPath -AclObject $acl
```

---

## Scanning Flow

### 1. **Pre-scan (Heuristic)**
   - Fast pattern checks (blocked extensions, etc.)
   - If blocked → file rejected immediately (no Bitdefender call)

### 2. **Bitdefender Scan**
   - File is written to `FILE_SCAN_TEMP_PATH`
   - `bdscan.exe /path/to/file.scan` is invoked
   - Results parsed from stdout/stderr
   - Temp file deleted

### 3. **Result Mapping**

| Exit Code | Status | Meaning |
|-----------|--------|---------|
| 0 | `Clean` | No threats detected |
| 1 | `Infected` | Malware/trojan found — **file blocked** |
| 2 | `Suspicious` | Heuristic flags (PUA, archive bomb) — **file blocked** |
| 3+ | `Error` | Engine error, permission denied, timeout issue — **file blocked** |
| Timeout | `Timeout` | Scan exceeded `BITDEFENDER_TIMEOUT_MS` — **file blocked** |

### 4. **Fail-Closed Security Policy (Current Implementation)**

Leeku Secure currently uses a fail-closed upload policy:

- `Clean` -> upload continues.
- Any non-clean status (`Infected`, `Suspicious`, `Error`, `Timeout`, `Unavailable`) -> upload is rejected.

This means scanner outages or misconfiguration do not allow uploads to bypass malware controls.

Development exception: when `NODE_ENV=development`, an `Unavailable` scanner result is accepted after heuristic checks so local development works without Bitdefender installed. Set `ALLOW_UNSCANNED_UPLOADS_IN_DEVELOPMENT=false` to force production-style fail-closed behavior locally.

---

## Troubleshooting

### Scanner Auto-detection Failed

**Error:** `Bitdefender CLI not found in common paths`

**Solution:**
1. Verify BEST is installed: `Get-Service "Bitdefender*"`
2. Find the actual path: `Get-ChildItem "C:\Program Files" -Recurse -Filter "bdscan.exe"`
3. Set `BITDEFENDER_SCAN_CLI_PATH` explicitly in `.env`
4. Restart the application

For local development without Bitdefender, keep `NODE_ENV=development` and leave `ALLOW_UNSCANNED_UPLOADS_IN_DEVELOPMENT` unset or set to `true`. Do not use that development exception in production.

### Permission Denied on Scan

**Error:** `Scanner exited with code 3. Access denied`

**Solution:**
1. Check that the service account has read/write access to `FILE_SCAN_TEMP_PATH`
2. Check that the service account can execute the scanner:
   ```powershell
   & "C:\Program Files\Bitdefender\...\bdscan.exe" "C:\test.txt"
   ```
3. Check Bitdefender service status:
   ```powershell
   Get-Service "Bitdefender*" | Select Status
   ```

### Scan Timeout Frequently Occurs

**Solution:**
1. Increase `BITDEFENDER_TIMEOUT_MS` (e.g., `60000` for 60 seconds)
2. Check system resources (CPU, RAM, disk I/O)
3. Check Bitdefender engine status in Windows Defender & Threat Protection

### Files Stuck in "Suspicious" Status

**Behavior:** Legitimate files are flagged as `Suspicious` (exit code 2)

**Solution:**
1. Review Bitdefender false-positive reports via the admin UI
2. Add hashes/paths to exclusion lists in Bitdefender management console
3. Whitelist specific threat names by updating the application's heuristic function

---

## CLI Command Reference

### Basic Scan
```bash
bdscan.exe "C:\path\to\file.txt"
```

### Scan with Quarantine
```bash
bdscan.exe --quarantine "C:\path\to\file.txt"
```

### Scan with Detailed Logging
```bash
bdscan.exe --log-all "C:\path\to\file.txt"
```

### Scan Recursively (for testing)
```bash
bdscan.exe --recursive "C:\test_folder"
```

### Check Bitdefender Version
```bash
bdscan.exe --version
```

---

## Performance Tuning

### Reduce Scan Latency

1. **Use `product.console.exe`** if available — often faster than `bdscan.exe`
   ```bash
   BITDEFENDER_SCAN_CLI_PATH=C:\Program Files\Bitdefender\...\product.console.exe
   ```

2. **Lower the timeout** if you want fast failures:
   ```bash
   BITDEFENDER_TIMEOUT_MS=15000  # 15 seconds instead of 30
   ```

3. **Enable heuristic pre-scan** in the application to skip scanning known-safe file types

### Handle High Volume

1. Run the scanner on a local SSD (not network share)
2. Monitor temp directory size: `Dir C:\LeekuTemp\scan-staging | Measure-Object -Property Length -Sum`
3. Increase `DB_POOL_MAX` if database connections become a bottleneck
4. Consider implementing a scan queue to throttle requests

---

## Monitoring & Logging

### Check Scan Logs in SQL Server

```sql
SELECT TOP 100
    created_at,
    username_snapshot,
    message,
    scan_result,
    scan_message
FROM system_logs
WHERE event_type = 'Scan'
  AND created_at > DATEADD(HOUR, -1, SYSDATETIMEOFFSET())
ORDER BY created_at DESC;
```

### Monitor Bitdefender Events

On the Windows server, check:
- Event Viewer → Application and Services Logs → Bitdefender
- Bitdefender Management Console (web UI)
- Bitdefender agent status in the system tray

---

## License & Support

- **License:** Ensure your Bitdefender license covers Endpoint Security Tools
- **Renewal:** Check renewal dates in the Bitdefender management console
- **Support:** Contact Bitdefender support if scan results are inconsistent

For issues with the Leeku application's scanner integration, refer to the application logs and check [scanner.ts](../../src/lib/scanner.ts).
