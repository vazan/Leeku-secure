-- ============================================================
-- Leeku-Secure SQL Query Reference
-- Common SQL patterns for application development
-- ============================================================

# Common SQL Queries Reference

This document contains frequently used SQL queries extracted from the application, organized by feature area.

**NOTE:** All queries use `@paramName` placeholders for parameterized queries. Parameters prevent SQL injection.

---

## Authentication & Token Management

### 1. Insert a refresh token
```sql
INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at, revoked_at, ip_address, user_agent)
VALUES (NEWID(), @userId, @tokenHash, @expiresAt, SYSDATETIMEOFFSET(), NULL, @ipAddress, @userAgent);
```

### 2. Revoke a refresh token by hash (idempotent)
```sql
UPDATE refresh_tokens 
SET revoked_at = COALESCE(revoked_at, SYSDATETIMEOFFSET()) 
WHERE token_hash = @tokenHash;
```

### 3. Revoke all tokens for a user (logout all sessions)
```sql
UPDATE refresh_tokens 
SET revoked_at = COALESCE(revoked_at, SYSDATETIMEOFFSET())
WHERE user_id = @userId;
```

### 4. Clean up expired and revoked tokens
```sql
DELETE FROM refresh_tokens
WHERE expires_at < SYSDATETIMEOFFSET() OR revoked_at IS NOT NULL;
```

### 5. Find user by email hash
```sql
SELECT id, email_encrypted, email_iv, email_auth_tag,
       username_encrypted, username_iv, username_auth_tag,
       password_hash, role, quota_id, storage_used_bytes, status,
       failed_login_count, locked_until, last_login_at,
       email_verified, email_verification_token, email_verification_expires,
       deletion_token, deletion_token_expires, created_at
FROM users
WHERE email_hash = @emailHash;
```

### 6. Find user by username hash
```sql
SELECT id, email_encrypted, email_iv, email_auth_tag,
       username_encrypted, username_iv, username_auth_tag,
       password_hash, role, quota_id, storage_used_bytes, status,
       failed_login_count, locked_until, last_login_at,
       email_verified, email_verification_token, email_verification_expires,
       deletion_token, deletion_token_expires, created_at
FROM users
WHERE username_hash = @usernameHash;
```

---

## User Registration & Account Management

### 7. Check for duplicate email or username
```sql
SELECT 
    (SELECT COUNT(*) FROM users WHERE email_hash = @emailHash) AS emailExists,
    (SELECT COUNT(*) FROM users WHERE username_hash = @usernameHash) AS usernameExists;
```

### 8. Insert new user during registration
```sql
INSERT INTO users (
    id, email_encrypted, email_iv, email_auth_tag, email_hash,
    username_encrypted, username_iv, username_auth_tag, username_hash,
    password_hash, role, quota_id, storage_used_bytes, status,
    failed_login_count, locked_until, last_login_at,
    email_verified, email_verification_token, email_verification_expires,
    deletion_token, deletion_token_expires, created_at
)
OUTPUT INSERTED.*
VALUES (
    NEWID(), @emailEncrypted, @emailIv, @emailAuthTag, @emailHash,
    @usernameEncrypted, @usernameIv, @usernameAuthTag, @usernameHash,
    @passwordHash, 'User', 'guest', 0, 'Active',
    0, NULL, NULL,
    0, @verificationToken, @verificationExpires,
    NULL, NULL, SYSDATETIMEOFFSET()
);
```

### 9. Verify user email
```sql
UPDATE users 
SET email_verified = 1, email_verification_token = NULL, email_verification_expires = NULL 
WHERE id = @userId;
```

### 10. Update user profile (username/email/password)
```sql
UPDATE users 
SET username_encrypted = @un, username_iv = @uni, username_auth_tag = @unat,
    username_hash = @unh, email_encrypted = @em, email_iv = @emi, 
    email_auth_tag = @emat, email_hash = @emh, password_hash = @ph
WHERE id = @userId;
```

### 11. Request account deletion (set deletion token)
```sql
UPDATE users 
SET deletion_token = @token, deletion_token_expires = @expiresAt 
WHERE id = @userId;
```

### 12. Delete user account (cascades to files, shares, tokens)
```sql
DELETE FROM users 
WHERE id = @userId;
```

---

## File Management

### 13. List user's files (paginated)
```sql
SELECT id, owner_user_id,
       original_name_encrypted, original_name_iv, original_name_auth_tag,
       stored_path, mime_type, size_bytes, encrypted_size_bytes,
       status, checksum_sha256, is_encrypted, scan_result, scan_message, scanned_at,
       leeku_vibe, ttl_hours, expires_at, deleted_at, created_at
FROM files
WHERE owner_user_id = @userId AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > SYSDATETIMEOFFSET())
ORDER BY created_at DESC
OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
```

### 14. Get file metadata
```sql
SELECT id, owner_user_id,
       original_name_encrypted, original_name_iv, original_name_auth_tag,
       stored_path, mime_type, size_bytes, encrypted_size_bytes,
       status, checksum_sha256, is_encrypted, scan_result, scan_message, scanned_at,
       leeku_vibe, ttl_hours, expires_at, deleted_at, created_at
FROM files
WHERE id = @fileId;
```

### 15. Check file ownership (security)
```sql
SELECT COUNT(*) AS c
FROM files
WHERE id = @fileId AND owner_user_id = @userId;
```

### 16. Mark file as deleted (soft delete)
```sql
UPDATE files 
SET deleted_at = SYSDATETIMEOFFSET() 
WHERE id = @fileId AND owner_user_id = @userId;
```

### 17. Hard delete file (permanent removal)
```sql
DELETE FROM files 
WHERE id = @fileId AND owner_user_id = @userId;
```

### 18. Get per-file encryption key
```sql
SELECT file_id, encrypted_key, key_iv, key_auth_tag, file_iv, file_auth_tag, algorithm, created_at
FROM file_encryption_keys
WHERE file_id = @fileId;
```

### 19. Insert file encryption key
```sql
INSERT INTO file_encryption_keys (file_id, encrypted_key, key_iv, key_auth_tag, file_iv, file_auth_tag, algorithm, created_at)
VALUES (@fileId, @encryptedKey, @keyIv, @keyAuthTag, @fileIv, @fileAuthTag, 'AES-256-GCM', SYSDATETIMEOFFSET());
```

### 20. Update file scan result
```sql
UPDATE files 
SET scan_result = @scanResult, scan_message = @scanMessage, scanned_at = SYSDATETIMEOFFSET(),
    leeku_vibe = @leekuVibe, status = CASE WHEN @scanResult = 'Infected' THEN 'Blocked' ELSE status END
WHERE id = @fileId;
```

### 21. Update user storage used
```sql
UPDATE users 
SET storage_used_bytes = storage_used_bytes + @sizeBytes 
WHERE id = @userId;
```

### 22. Check daily upload limit
```sql
SELECT ISNULL(SUM(size_bytes), 0) AS totalUploaded
FROM files
WHERE owner_user_id = @userId AND CAST(created_at AS DATE) = CAST(GETDATE() AS DATE);
```

---

## Share Links

### 23. Create a share link
```sql
INSERT INTO share_links (id, file_id, public_token, password_hash, expires_at, max_downloads, download_count, is_active, allow_external_preview, created_at)
VALUES (NEWID(), @fileId, @publicToken, @passwordHash, @expiresAt, @maxDownloads, 0, 1, 0, SYSDATETIMEOFFSET());
```

### 24. Get share link by public token
```sql
SELECT id, file_id, public_token, password_hash, expires_at, max_downloads, download_count, is_active, allow_external_preview, created_at
FROM share_links
WHERE public_token = @publicToken;
```

### 25. Increment share link download count (atomic)
```sql
EXEC sp_IncrementDownloadCount @PublicToken = @token;
```

### 26. Check if share link is valid
```sql
SELECT is_active, expires_at, max_downloads, download_count
FROM share_links
WHERE id = @shareLinkId
  AND is_active = 1
  AND (expires_at IS NULL OR expires_at > SYSDATETIMEOFFSET())
  AND (max_downloads IS NULL OR download_count < max_downloads);
```

### 27. Disable a share link
```sql
UPDATE share_links 
SET is_active = 0 
WHERE id = @shareLinkId;
```

---

## System Logging & Audit

### 28. Insert system log entry
```sql
INSERT INTO system_logs (user_id, username_snapshot, event_type, target_type, target_id, ip_address, message, created_at)
VALUES (@userId, @usernameSnapshot, @eventType, @targetType, @targetId, @ipAddress, @message, SYSDATETIMEOFFSET());
```

### 29. Get recent logs for a user
```sql
SELECT id, user_id, username_snapshot, event_type, target_type, target_id, ip_address, message, created_at
FROM system_logs
WHERE user_id = @userId
ORDER BY created_at DESC
OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
```

### 30. Get logs for specific event type
```sql
SELECT id, user_id, username_snapshot, event_type, target_type, target_id, ip_address, message, created_at
FROM system_logs
WHERE event_type = @eventType
ORDER BY created_at DESC
OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
```

### 31. Find failed scan events (security monitoring)
```sql
SELECT id, user_id, username_snapshot, event_type, target_type, target_id, ip_address, message, created_at
FROM system_logs
WHERE event_type = 'Scan' AND message LIKE '%Infected%'
ORDER BY created_at DESC;
```

---

## Admin & Monitoring

### 32. Get platform statistics
```sql
SELECT
    (SELECT COUNT(*) FROM users WHERE status = 'Active') AS totalUsers,
    (SELECT COUNT(*) FROM files WHERE status = 'Available') AS totalFiles,
    (SELECT ISNULL(SUM(storage_used_bytes), 0) FROM users WHERE status = 'Active') AS storageUsedBytes,
    (SELECT COUNT(*) FROM files WHERE CAST(created_at AS DATE) = CAST(GETDATE() AS DATE)) AS uploadsToday,
    (SELECT COUNT(*) FROM files WHERE status = 'Blocked') AS blockedFiles;
```

### 33. Get user list (admin dashboard)
```sql
SELECT id, email_hash, username_hash, role, quota_id, storage_used_bytes, status,
       failed_login_count, locked_until, last_login_at, email_verified, created_at
FROM users
WHERE status = 'Active'
ORDER BY created_at DESC
OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
```

### 34. Suspend a user account
```sql
UPDATE users 
SET status = 'Suspended' 
WHERE id = @userId;
```

### 35. Get expired files for cleanup
```sql
EXEC sp_GetExpiredFiles;
```

---

## Maintenance & Cleanup

### 36. Delete expired share links
```sql
DELETE FROM share_links
WHERE expires_at < SYSDATETIMEOFFSET() AND is_active = 1;
```

### 37. Delete expired email verification tokens
```sql
UPDATE users
SET email_verification_token = NULL, email_verification_expires = NULL
WHERE email_verification_expires < SYSDATETIMEOFFSET() AND email_verified = 0;
```

### 38. List files approaching expiration (for reminders)
```sql
SELECT id, owner_user_id, stored_path, mime_type, size_bytes, ttl_hours, expires_at, created_at
FROM files
WHERE status = 'Available' AND expires_at IS NOT NULL
  AND expires_at < DATEADD(hour, 24, SYSDATETIMEOFFSET())
  AND expires_at > SYSDATETIMEOFFSET()
ORDER BY expires_at ASC;
```

### 39. Mark expired files as deleted (after physical deletion)
```sql
DECLARE @ids dbo.GuidList;
INSERT INTO @ids VALUES (id1), (id2), (id3), ...;
EXEC sp_MarkFilesExpired @ids;
```

### 40. Reset failed login count for locked accounts
```sql
UPDATE users
SET failed_login_count = 0, locked_until = NULL
WHERE locked_until < SYSDATETIMEOFFSET();
```

---

## Security & Compliance (GDPR)

### 41. GDPR Subject Access Request - All User Data
```sql
-- Personal info
SELECT 'users' AS table_name, * FROM users WHERE id = @userId;

-- User's files
SELECT 'files' AS table_name, * FROM files WHERE owner_user_id = @userId;

-- User's share links
SELECT 'share_links' AS table_name, sl.* FROM share_links sl
INNER JOIN files f ON sl.file_id = f.id
WHERE f.owner_user_id = @userId;

-- User's activity logs
SELECT 'system_logs' AS table_name, * FROM system_logs 
WHERE user_id = @userId
ORDER BY created_at DESC;
```

### 42. Audit trail - Files created in last 30 days
```sql
SELECT id, owner_user_id, original_name_encrypted, mime_type, size_bytes, status,
       scan_result, scanned_at, created_at
FROM files
WHERE created_at >= DATEADD(day, -30, SYSDATETIMEOFFSET())
ORDER BY created_at DESC;
```

### 43. Find suspicious activity (multiple failed logins)
```sql
SELECT id, email_hash, username_hash, failed_login_count, locked_until, last_login_at, created_at
FROM users
WHERE failed_login_count > 3 OR locked_until > SYSDATETIMEOFFSET()
ORDER BY failed_login_count DESC;
```

---

## Application Integration Notes

### Using Stored Procedures (Recommended)

Instead of inline SQL, use these stored procedures:

```javascript
// Example in Node.js
const sql = require('mssql');

// Increment download counter (atomic, prevents race conditions)
const req = new sql.Request(pool);
req.input('PublicToken', sql.Char(32), publicToken);
await req.execute('sp_IncrementDownloadCount');

// Get expired files for cleanup
const result = await req.execute('sp_GetExpiredFiles');
const expiredFiles = result.recordset;

// Mark files as expired (safe batch operation)
const ids = new sql.Table('GuidList');
ids.columns.add('id', sql.UniqueIdentifier);
fileIds.forEach(id => ids.rows.add(id));
req.input('FileIds', ids);
await req.execute('sp_MarkFilesExpired');

// Record failed login attempt
req.input('EmailHash', sql.Char(64), emailHash);
req.input('MaxAttempts', sql.Int, 5);
req.input('LockoutMinutes', sql.Int, 15);
await req.execute('sp_RecordFailedLogin');

// Reset login counter on success
req.input('UserId', sql.UniqueIdentifier, userId);
await req.execute('sp_ResetLoginAttempts');
```

### Parameterized Query Example

```javascript
// Always use parameters to prevent SQL injection
const req = new sql.Request(pool);
req.input('userId', sql.UniqueIdentifier, userId);
req.input('offset', sql.Int, 0);
req.input('pageSize', sql.Int, 20);

const result = await req.query(`
  SELECT * FROM files 
  WHERE owner_user_id = @userId
  ORDER BY created_at DESC
  OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
`);
```

### Performance Tips

```sql
-- ✅ FAST: Uses indexed columns
SELECT * FROM files WHERE owner_user_id = @userId AND status = 'Available'

-- ✅ FAST: Uses filtered index
SELECT * FROM files WHERE expires_at <= GETDATE() AND status = 'Available'

-- ⚠️ SLOW: Full table scan (LIKE on unindexed column)
SELECT * FROM system_logs WHERE message LIKE '%searchterm%'

-- ⚠️ SLOW: Implicit conversion (prevents index use)
SELECT * FROM files WHERE created_at > '2024-01-01'  -- STRING, not DATETIMEOFFSET
```

---

## References

- **All queries:** From [src/server.ts](../../src/server.ts)
- **TypeScript interfaces:** See server.ts lines 578-620
- **Stored procedures:** See production_schema.sql
- **Data types:** Consult VALIDATION.md or production_schema.sql

---

## Questions?

- See README.md for quick start
- See VALIDATION.md for validation queries
- See production_schema.sql for schema documentation
