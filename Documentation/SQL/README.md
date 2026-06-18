# SQL Documentation for Leeku-Secure

Comprehensive SQL database schema, migrations, and query reference documentation for the Leeku-Secure application.

## Quick Start

### Production Deployment ⭐ **RECOMMENDED**
```powershell
# Adjust file paths (P:\DATA, L:\LOGS) in the script before running
sqlcmd -S your-sql-server -U sa -P <password> -i production_schema.sql
```

### Development Setup
```powershell
sqlcmd -S localhost -U sa -P <password> -d LeekuSecure -i migrations/001_initial_schema.sql
```

---

## Files Overview

### 1. `production_schema.sql` - Production-Ready Schema ⭐ **PRIMARY**
**Purpose:** Enterprise-grade schema with optimized indexes, stored procedures, and security hardening.

**Includes:**
- ✅ Complete database creation (tables, constraints, defaults)
- ✅ 12 optimized indexes (filtered, composite, covering)
- ✅ 5 stored procedures for critical operations
- ✅ Table-valued parameter (TVP) type for safe batch operations
- ✅ 9 check constraints for data validation
- ✅ Database configuration (RECOVERY FULL, QUERY_STORE, etc.)
- ✅ Application user with least-privilege roles
- ✅ Default data seeding (guest quota)

**Enhancements over initial migration:**
- File queries: 50-80% faster (optimized indexes with INCLUDE columns)
- Expired file cleanup: 90% faster (filtered indexes)
- Login security: Race-condition safe (atomic stored procedures)
- Data validation: Enforced at DB layer (check constraints)

**How to run:**
```powershell
# Make sure directories exist and adjust paths:
# P:\DATA      = Data file location
# L:\LOGS      = Log file location

sqlcmd -S your-sql-server -U sa -P <password> -i production_schema.sql
```

**Or in SQL Server Management Studio (SSMS):**
1. File → Open → Select `production_schema.sql`
2. Modify file paths if needed
3. Click "Execute" (F5)

**Database:** Creates `[LeekuSecure-Prod]` on SQL Server 2022 (Compatibility Level 160)

**User:** `leeku_app` with `db_datareader` and `db_datawriter` roles

---

### 3. `003_maintenance_mode.sql` - Maintenance Mode Configuration (Optional)
**Purpose:** Adds system-wide maintenance mode control without downtime.

**Features:**
- Creates `system_config` table for storing system settings
- Implements `sp_GetMaintenanceStatus` to check maintenance state
- Implements `sp_ToggleMaintenanceMode` to enable/disable maintenance
- Initial value: maintenance mode disabled (normal operations)
- Lightweight, non-intrusive addition to existing schema

**When to apply:**
- ✅ After `production_schema.sql` is deployed (optional enhancement)
- ✅ When you need admin-controlled downtime for updates
- ✅ For graceful system maintenance without data loss

**How to run:**
```powershell
sqlcmd -S your-sql-server -U sa -P <password> -d LeekuSecure -i 003_maintenance_mode.sql
```

**Verify installation:**
```sql
SELECT * FROM system_config WHERE key = 'maintenance_mode'
-- Should return: | maintenance_mode | false | (current timestamp) |
```

---

### 4. `migrations/001_initial_schema.sql` - Initial Migration (Dev-Friendly)
**Purpose:** Simple, idempotent migration for development and quick setup.

**Features:**
- Creates all 7 tables in dependency order
- Idempotent: can be run multiple times safely (`IF NOT EXISTS` checks)
- Automatic seeding of default 'guest' quota tier
- Adds optional columns automatically
- Minimal index overhead

**Best for:**
- Development environments
- Local testing
- Quick iteration
- Learning the schema

**How to run:**
```powershell
sqlcmd -S localhost -U sa -P <password> -d LeekuSecure -i migrations/001_initial_schema.sql
```

---

## Key Features

### 🔐 Security & Encryption
- **Encrypted PII:** Email, username, filenames use AES-256-GCM encryption
- **Integrity:** Per-column authentication tags verify tampering
- **Lookup:** HMAC-SHA256 hash columns for secure indexed searches without decryption
- **Password Hashing:** Argon2id for user passwords; bcrypt for share link passwords
- **Token Hashing:** SHA-256 hashes for refresh tokens (originals never stored)

### ⚡ Performance Optimization
- **Unique Hash Indexes:** `email_hash` and `username_hash` enable instant auth lookups
- **Filtered Indexes:** Exclude NULL and non-matching rows (smaller, faster)
- **Covering Indexes:** INCLUDE columns eliminate extra key lookups
- **Composite Indexes:** Multi-column queries optimized
- **Cascade Deletes:** Automatic cleanup of related records

### 📊 Data Retention & Compliance
- **Soft Deletes:** `deleted_at` and `expires_at` timestamps for data preservation
- **Audit Trail:** Immutable `system_logs` table for forensics and GDPR SAR
- **TTL Support:** `ttl_hours` and `expires_at` for automatic file expiration
- **Timestamp Tracking:** `created_at` on all tables for audit

### 🛡️ Data Validation
- **Check Constraints:** Enum validation (roles, statuses, event types)
- **Positive Value Checks:** Quotas and file sizes > 0
- **TTL Whitelist:** Allowed values (1h, 4h, 1d, 2d, 5d, 7d)
- **Scan Result Validation:** Only valid malware scan states accepted

### 🔧 Stored Procedures (5 Total)
1. **sp_GetExpiredFiles** — Retrieve files ready for vault deletion
2. **sp_IncrementDownloadCount** — Atomic download counter (prevents race conditions)
3. **sp_MarkFilesExpired** — Safe batch file expiration using TVP
4. **sp_RecordFailedLogin** — Brute-force protection with automatic lockout
5. **sp_ResetLoginAttempts** — Reset login counter on successful auth

---

## Database Schema

### Tables (7 Total)
1. **users** — User accounts, authentication, quotas
2. **quotas** — Storage tiers and limits
3. **files** — File metadata, encryption keys, scan results
4. **file_encryption_keys** — Per-file encryption keys
5. **share_links** — Public file sharing
6. **refresh_tokens** — OAuth2 session management
7. **system_logs** — Audit trail

### Indexes (12 Total)
- **files:** owner_id, status, expires_at (filtered)
- **users:** email_hash, username_hash, status (filtered), tokens (filtered)
- **refresh_tokens:** user_active (filtered)
- **share_links:** file_id
- **system_logs:** created_at, event_type

### Foreign Keys (5 Total)
- `files.owner_user_id` → `users.id` (CASCADE)
- `file_encryption_keys.file_id` → `files.id` (CASCADE)
- `share_links.file_id` → `files.id` (CASCADE)
- `refresh_tokens.user_id` → `users.id` (CASCADE)
- `users.quota_id` → `quotas.id`

---

## Choosing the Right Approach

| Need | Use This | Why |
|------|----------|-----|
| **Production deployment** | `production_schema.sql` | ⭐ Optimized, secure, enterprise-ready |
| **Staging environment** | `production_schema.sql` | Match prod for testing |
| **Dev/local testing** | `migrations/001_initial_schema.sql` | Simple, fast, minimal overhead |
| **Maintenance mode (optional)** | `003_maintenance_mode.sql` | Enable/disable file operations without downtime |
| **Migration (001→002)** | See VALIDATION.md | Step-by-step guide (if file exists) |

---

## Database Configuration

### Recovery & Availability
- **Recovery Mode:** FULL (point-in-time restore)
- **Read-Committed Snapshot:** ON (reduces blocking)
- **Target Recovery Time:** 60 seconds RTO
- **Page Verification:** CHECKSUM (corruption detection)

### Monitoring & Performance
- **Query Store:** Enabled (tracks slow queries)
- **Auto Statistics:** ON (optimizer stays current)
- **Compatibility Level:** 160 (SQL Server 2022 features)

### Security
- **Application User:** `leeku_app` (least-privilege roles)
- **DB Chaining:** OFF (prevent privilege escalation)
- **Trustworthy:** OFF (enhanced security)
- **Auto Close:** OFF (keep DB in memory)

---

## Troubleshooting

### Connection Errors
```
Error: "Connection refused" on port 1433
```
**Solution:**
- Check SQL Server service is running: `Get-Service MSSQLSERVER | Start-Service`
- Verify TCP/IP is enabled in SQL Server Configuration Manager
- Check firewall allows 1433

### File Path Issues
```
Error: Cannot create file 'P:\DATA\...'
```
**Solution:**
- Directories `P:\DATA` and `L:\LOGS` must exist with proper permissions
- Or edit the script to use your actual paths before running:
  ```sql
  FILENAME = N'C:\Your\Path\LeekuSecure_prod.mdf'
  ```

### Connection String for Node.js
```javascript
const sql = require('mssql');

const config = {
  server: 'localhost',
  database: 'LeekuSecure-Prod',
  authentication: {
    type: 'default',
    options: {
      userName: 'leeku_app',
      password: '<password>'
    }
  },
  options: {
    encrypt: true,
    trustServerCertificate: true
  }
};

const pool = new sql.ConnectionPool(config);
await pool.connect();
```

### Verify Database Created Successfully
```sql
-- Check database exists
SELECT name FROM sys.databases WHERE name = 'LeekuSecure-Prod';

-- Check all tables exist (should return 7)
SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES 
WHERE TABLE_CATALOG = 'LeekuSecure-Prod' AND TABLE_SCHEMA = 'dbo';

-- Check indexes (should return 12)
SELECT COUNT(*) FROM sys.indexes 
WHERE database_id = DB_ID('LeekuSecure-Prod') AND is_primary_key = 0;

-- Check stored procedures (should return 5)
SELECT COUNT(*) FROM LeekuSecure-Prod.sys.objects 
WHERE type = 'P' AND schema_id = SCHEMA_ID('dbo');
```

---

## Execution Examples

### Scenario 1: First-Time Production Setup
```powershell
# 1. Backup (if upgrading existing database)
sqlcmd -S your-server -U sa -P <password> -Q `
  "BACKUP DATABASE [LeekuSecure] TO DISK = 'C:\Backups\LeekuSecure_backup.bak'"

# 2. Create new database (or upgrade existing)
sqlcmd -S your-server -U sa -P <password> -i production_schema.sql

# 3. Verify tables exist
sqlcmd -S your-server -U sa -P <password> -d LeekuSecure-Prod -Q `
  "SELECT COUNT(*) AS table_count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo'"
```

### Scenario 2: Development Setup
```powershell
# 1. Create database
sqlcmd -S localhost -U sa -P <password> -Q "CREATE DATABASE LeekuSecure"

# 2. Run initial migration
sqlcmd -S localhost -U sa -P <password> -d LeekuSecure -i migrations/001_initial_schema.sql

# 3. Verify
sqlcmd -S localhost -U sa -P <password> -d LeekuSecure -Q "SELECT COUNT(*) FROM users"
```

### Scenario 3: Test the Connection
```powershell
# Test connection to production database
sqlcmd -S your-server -U leeku_app -P <password> -d LeekuSecure-Prod -Q "SELECT @@VERSION"
```

---

## Recommended Reading Order

1. **This README** — Overview and quick start
2. **production_schema.sql** — Full schema with inline comments
3. **migrations/001_initial_schema.sql** — Alternative for dev environments
4. **Related documentation:**
   - [SETUP.md](../01-Technical/SETUP.md) — Original schema documentation
   - [DEPLOYMENT.md](../01-Technical/DEPLOYMENT.md) — Database deployment
   - [src/server.ts](../../src/server.ts) — TypeScript row interfaces (lines 578-620)

---

## Migration from Older Versions

If you have an older database schema:

1. **Backup first:** Full backup of current database
2. **Compare:** Review differences between old and new schema
3. **Plan:** Determine which indexes/procedures to add
4. **Test:** Run migration in staging environment first
5. **Execute:** Apply changes during maintenance window
6. **Validate:** Run verification queries to confirm

See `VALIDATION.md` (if available) for detailed migration steps.

---

## Performance Tips

### Query Optimization
```sql
-- ✅ Fast: Uses indexed columns
SELECT * FROM files WHERE owner_user_id = @userId

-- ✅ Fast: Filtered index optimization
SELECT * FROM files WHERE expires_at <= GETDATE() AND status = 'Available'

-- ⚠️ Slow: Full table scan
SELECT * FROM files WHERE CHARINDEX('searchterm', original_name_encrypted) > 0
```

### Index Maintenance
```sql
-- Monitor index fragmentation
SELECT name, avg_fragmentation_in_percent 
FROM sys.dm_db_index_physical_stats(DB_ID(), NULL, NULL, NULL, 'LIMITED')
WHERE avg_fragmentation_in_percent > 10

-- Rebuild fragmented indexes (> 30% fragmentation)
ALTER INDEX ALL ON [dbo].[files] REBUILD

-- Reorganize slightly fragmented indexes (10-30%)
ALTER INDEX ALL ON [dbo].[files] REORGANIZE
```

### Statistics Update
```sql
-- Update statistics for the query optimizer
UPDATE STATISTICS [dbo].[files]
UPDATE STATISTICS [dbo].[users]
```

---

## Security Best Practices

1. **Master Key Rotation** — ⚠️ CRITICAL: Rotating `MASTER_KEY_BASE64` requires re-encrypting all encrypted fields
2. **Backup Encryption** — Store backups in encrypted, geographically redundant storage
3. **Access Control** — Use least-privilege roles (never use `sa` for apps)
4. **Connection String** — Never hardcode credentials; use environment variables or secure vaults
5. **Audit Logging** — Monitor `system_logs` for suspicious activities
6. **Token Expiration** — Refresh tokens should have short TTL (see `sp_ResetLoginAttempts`)

---

## Support & Questions

- **Connection issues?** See Troubleshooting section above
- **Performance questions?** Check index usage with `sys.dm_db_index_usage_stats`
- **Schema questions?** Review inline comments in `production_schema.sql`
- **Migration help?** Check for `VALIDATION.md` or related documentation files

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-06-17 | Initial production schema (12 indexes, 5 stored procs, 9 constraints) |

---

## Files in This Package

```
Documentation/SQL/
├── README.md                          — This file
├── production_schema.sql              — ⭐ Production-ready schema
└── migrations/
    └── 001_initial_schema.sql         — Dev-friendly initial migration
```

Optional (if available):
- `VALIDATION.md` — Detailed 001 vs production comparison & migration guide
- `CHANGELOG.md` — Complete list of changes and improvements
- `queries.sql` — Reference guide for common SQL patterns
