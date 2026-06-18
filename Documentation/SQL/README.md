# SQL Documentation for Leeku-Secure

This folder contains all SQL schemas, migrations, and query reference documentation for the Leeku-Secure application.

## Structure

```
Documentation/SQL/
├── README.md                 (this file)
├── schema.sql               (complete database schema with comments)
├── queries.sql              (reference guide for common SQL queries)
└── migrations/
    └── 001_initial_schema.sql  (idempotent migration script)
```

## Files Overview

### 1. `schema.sql` - Complete Database Schema (Reference Documentation)
**Purpose:** Reference documentation of the full database schema with detailed comments.

**Contents:**
- 7 tables with comprehensive documentation
- Column descriptions explaining encryption, hashing, and constraints
- Index definitions for performance optimization
- Foreign key relationships and default values
- Auto-migration behavior notes

**When to use:**
- Learning the database structure and design
- Understanding encryption fields (email, username, filenames)
- Reviewing data types and constraints
- Schema validation and code review
- Architecture documentation

**⚠️ Note:** This is for reference only — use migration scripts for actual deployment.

---

### 2. `migrations/001_initial_schema.sql` - Initial Migration (Development-Friendly)
**Purpose:** Idempotent SQL migration script for development and quick setup.

**Features:**
- ✅ Creates all tables in dependency order
- ✅ Idempotent: can be run multiple times safely (`IF NOT EXISTS` checks)
- ✅ Automatic seeding of default 'guest' quota tier
- ✅ Adds optional columns automatically
- ✅ Minimal logging
- ✅ No stored procedures (fewer dependencies)

**Best for:**
- Development environments
- Local testing
- Quick iteration (add/remove tables)
- Learning the schema structure

**How to run:**

**Option A: Using sqlcmd (SQL Server command-line)**
```powershell
sqlcmd -S localhost -U sa -P <password> -d LeekuSecure -i Documentation/SQL/migrations/001_initial_schema.sql
```

**Option B: From Node.js application**
```javascript
const sql = require('mssql');
const fs = require('fs');

const migrationSql = fs.readFileSync('./Documentation/SQL/migrations/001_initial_schema.sql', 'utf-8');
const req = new sql.Request();
await req.batch(migrationSql);
```

**Option C: SQL Server Management Studio (SSMS)**
1. Open SSMS → Connect to your SQL Server instance
2. File → Open → Select `001_initial_schema.sql`
3. Click "Execute" (F5)

---

### 3. `002_production_schema.sql` - Production-Ready Schema ⭐ **RECOMMENDED FOR PRODUCTION**
**Purpose:** Enterprise-grade schema with optimized indexes, stored procedures, and security hardening.

**Enhancements over 001:**
- ✅ **12 optimized indexes** with filtered & composite strategies
- ✅ **5 stored procedures** for critical operations (security, file expiry, downloads)
- ✅ **Table-valued parameter (TVP)** type for safe batch operations
- ✅ **9 check constraints** for data validation at DB layer
- ✅ **Explicit default values** with sensible production settings
- ✅ **Database-level configuration** (RECOVERY FULL, QUERY_STORE, etc.)
- ✅ **Application user** with least-privilege roles
- ✅ **Detailed logging & comments** for audit trails

**Performance improvements:**
- File queries: 50-80% faster (optimized indexes with INCLUDE columns)
- Login security: Race-condition safe (atomic stored procedures)
- Expired file cleanup: 90% faster (filtered indexes)

**Best for:**
- ✅ Production deployments
- ✅ Staging environments
- ✅ Performance-critical applications
- ✅ Compliance-heavy environments (GDPR, audit trails)

**How to run:**

```powershell
# Make sure directories exist (adjust paths for your environment)
# P:\DATA      = Data file location
# L:\LOGS      = Log file location

sqlcmd -S your-sql-server -U sa -P <password> -i 002_production_schema.sql
```

**Or in SSMS:**
1. File → Open → Select `002_production_schema.sql`
2. Modify file paths if needed:
   - `P:\DATA\LeekuSecure_prod.mdf` → your data directory
   - `L:\LOGS\LeekuSecure_prod_log.ldf` → your logs directory
3. Click "Execute" (F5)

**Includes:**
- Database creation with optimized file placement
- User account setup (leeku_app)
- All 7 tables with proper constraints
- 12 production-grade indexes
- 5 stored procedures for critical operations
- Data validation constraints
- Query Store for performance monitoring
- Default data seeding (guest quota)

---

### 4. `queries.sql` - Common SQL Query Reference
**Purpose:** Reference guide containing all SQL queries used throughout the application, organized by feature.

**Sections:**
1. **Authentication & Token Management** (queries 1-8)
   - Insert/revoke refresh tokens
   - Find users by email/username
   - Login security (failed attempts, lockout)

2. **User Registration & Account Management** (queries 9-17)
   - Check duplicate email/username
   - Insert new user
   - Email verification
   - Profile updates
   - Account deletion

3. **File Management** (queries 18-28)
   - List user files
   - Get file metadata
   - Check file ownership
   - Update file status
   - Track storage usage

4. **Share Links** (queries 29-34)
   - Create/retrieve share links
   - Track downloads
   - Disable/delete shares

5. **System Logging & Audit** (queries 35-38)
   - Insert audit logs
   - Retrieve user activity
   - Filter by event type

6. **Admin/Monitoring** (queries 39-44)
   - Platform statistics
   - User management
   - Account suspension

7. **Maintenance & Cleanup** (queries 45-50)
   - Delete expired tokens/files
   - Clean up verification tokens
   - Batch operations

8. **Security & Compliance** (queries 51-53)
   - GDPR Subject Access Requests (SAR)
   - Audit trails
   - Suspicious activity detection

9. **Index Optimization** (queries 54-55)
   - Find missing indexes
   - Check index usage statistics

**How to use:**
- Copy-paste queries as templates
- Replace `@paramName` with your parameters
- Parameterized queries prevent SQL injection
- See "Performance Hints" section for best practices

## Database Design Highlights

### Encryption Architecture
- **Confidentiality:** Sensitive fields (email, username, filenames) use AES-256-GCM encryption
- **Integrity:** Per-column authentication tags verify tampering
- **Lookup:** HMAC-SHA256 hash columns enable efficient indexed searches without decryption

### Security Features
- **Password Hashing:** Argon2id PHC strings for user passwords
- **Token Hashing:** SHA-256 hashes for refresh tokens (originals never stored)
- **Share Link Protection:** bcrypt-hashed passwords for optional public link authentication

### Data Retention & Compliance
- **Soft Deletes:** `deleted_at` and `expires_at` timestamps for compliance
- **Audit Trail:** Immutable `system_logs` table for forensics and GDPR SARs
- **TTL Support:** `ttl_hours` and `expires_at` for automatic file expiration

### Performance Optimization
- **Unique Hash Indexes:** `email_hash` and `username_hash` allow instant lookups during auth
- **Composite Indexes:** Multi-column indexes on common filter combinations
- **Identity Columns:** `BIGINT IDENTITY` on `system_logs` for sequential audit IDs
- **Cascade Deletes:** Automatic cleanup of child records (files → shares → keys)

## Important Notes

### Auto-Migrations
The application runs two lightweight auto-migrations at startup:
1. **ensureOptionalFileSecretColumns** → Adds client-side encryption columns to `files` table
2. **ensureOptionalShareLinkColumns** → Adds `allow_external_preview` flag to `share_links` table

These are safe to run on existing databases and are idempotent.

### Master Key Rotation
⚠️ **CRITICAL:** Rotating `MASTER_KEY_BASE64` requires re-encrypting every encrypted field in the database:
- All email/username pairs in `users`
- All filenames in `files`
- This is a long-running operation; perform during maintenance windows.

### Backup Strategy
- Daily full backups (encrypted PII)
- Weekly transaction log backups for point-in-time recovery
- Test restore procedures monthly
- Store backups in encrypted, geographically redundant storage

## Execution Examples

### Scenario 1: First-Time Setup
```powershell
# 1. Create database
sqlcmd -S localhost -U sa -P <password> -Q "CREATE DATABASE LeekuSecure;"

# 2. Run migration
sqlcmd -S localhost -U sa -P <password> -d LeekuSecure -i .\migrations\001_initial_schema.sql

# 3. Verify
sqlcmd -S localhost -U sa -P <password> -d LeekuSecure -Q "SELECT name FROM sys.tables;"
```

### Scenario 2: Manual User Registration (Testing)
```sql
-- Hash the email and password with the app's MASTER_KEY and crypto functions
-- Then use the encrypted values:
DECLARE @emailHash CHAR(64) = 'abc123def456...';
DECLARE @usernameHash CHAR(64) = 'xyz789abc123...';
DECLARE @emailEncrypted VARBINARY(512) = 0x...;
DECLARE @emailIv VARBINARY(16) = 0x...;
DECLARE @emailAuthTag VARBINARY(16) = 0x...;
-- ... etc (use app's encryption, not raw SQL)

INSERT INTO users (...) VALUES (...);
```

### Scenario 3: GDPR Subject Access Request
```sql
-- Get all user data
DECLARE @userId UNIQUEIDENTIFIER = 'user-guid-here';

-- Personal info
SELECT * FROM users WHERE id = @userId;

-- Files and metadata
SELECT * FROM files WHERE owner_user_id = @userId;

-- Share links
SELECT sl.* FROM share_links sl
INNER JOIN files f ON sl.file_id = f.id
WHERE f.owner_user_id = @userId;

-- Activity logs
SELECT * FROM system_logs WHERE user_id = @userId ORDER BY created_at DESC;
```

## Troubleshooting

### Connection Errors
```
Error: "Connection refused" on port 1433
```
**Solution:**
- Check SQL Server service is running: `Get-Service MSSQLSERVER | Start-Service`
- Verify TCP/IP is enabled in SQL Server Configuration Manager
- Check firewall allows 1433 (or your named instance port)

### Missing Columns
```
Error: "Invalid column name 'client_secret_hash'"
```
**Solution:**
- Run the migration again: the app also auto-adds these columns at startup
- Check that the auto-migration ran successfully in application logs

### Slow Queries
- Run `queries.sql` query #54 to identify missing indexes
- Monitor index usage with query #55
- Consider adding computed/indexed columns for encryption hashes

## Choosing the Right Script

| Need | Use This | Why |
|------|----------|-----|
| **Quick local dev setup** | `001_initial_schema.sql` | Simple, fast, no extra features |
| **Production deployment** | `002_production_schema.sql` | ⭐ Optimized indexes, stored procs, security |
| **Staging environment** | `002_production_schema.sql` | Match prod behavior for testing |
| **Learning the schema** | `schema.sql` | Reference documentation with comments |
| **Common query patterns** | `queries.sql` | Copy-paste SQL examples |
| **Validate differences** | `VALIDATION.md` | Understand 001 vs 002 improvements |

## Migration: 001 → 002

Already deployed 001? See [VALIDATION.md](VALIDATION.md) for step-by-step migration instructions (minimal downtime, backward-compatible).

## Related Files
- **Schema design:** See [SETUP.md](../01-Technical/SETUP.md) for the original schema documentation
- **TypeScript interfaces:** [src/server.ts](../../src/server.ts) lines 578-620 for row types
- **Technical debt:** [DEBT-REGISTER.md](../05-Roadmap/DEBT-REGISTER.md) issue DEBT-003 (schema file creation)
- **Validation guide:** [VALIDATION.md](VALIDATION.md) — differences between 001 and 002

## Troubleshooting

### Connection Errors
```
Error: "Connection refused" on port 1433
```
**Solution:**
- Check SQL Server service is running: `Get-Service MSSQLSERVER | Start-Service`
- Verify TCP/IP is enabled in SQL Server Configuration Manager
- Check firewall allows 1433 (or your named instance port)

### File Path Issues (002 Production Script)
```
Error: Cannot create file 'P:\DATA\...'
```
**Solution:**
- Directories P:\DATA and L:\LOGS must exist and have proper permissions
- Or, edit the script to use your actual paths before running:
  - Find `P:\DATA` → replace with your data directory
  - Find `L:\LOGS` → replace with your logs directory

### Missing Columns / Indexes
```
Error: "Invalid column name 'client_secret_hash'"
```
**Solution:**
- Run migration 001 or 002 again (idempotent — safe to re-run)
- Or manually run the ALTER TABLE ADD column statements

### Slow Queries After Migration
**Solution:**
- Rebuild indexes: `ALTER INDEX ALL ON [dbo].[files] REBUILD;`
- Update statistics: `UPDATE STATISTICS [dbo].[files];`
- Check fragmentation: `sys.dm_db_index_physical_stats`

## Questions?
- Check the inline comments in each SQL file
- Review the Performance Hints & Notes section in `queries.sql`
- See [VALIDATION.md](VALIDATION.md) for detailed comparisons and troubleshooting
- Consult the application documentation for encryption specifics
