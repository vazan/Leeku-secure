-- ============================================================
-- Leeku-Secure Common SQL Queries
-- Reference for application data access patterns
-- ============================================================
-- This document contains the most frequently used SQL queries
-- in the Leeku-Secure application, sourced from src/server.ts
-- and organized by feature area.
--
-- NOTE: Parameterized queries use @paramName syntax.
-- In TypeScript/mssql, parameters are added via request.input()
-- ============================================================

-- ============================================================
-- AUTHENTICATION & TOKEN MANAGEMENT
-- ============================================================

-- 1. Insert a new refresh token
INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at, revoked_at, ip_address, user_agent)
VALUES (NEWID(), @userId, @tokenHash, @expiresAt, SYSDATETIMEOFFSET(), NULL, @ipAddress, @userAgent);

-- 2. Revoke a refresh token by hash (idempotent - use COALESCE to prevent re-update)
UPDATE refresh_tokens 
SET revoked_at = COALESCE(revoked_at, SYSDATETIMEOFFSET()) 
WHERE token_hash = @tokenHash;

-- 3. Revoke all tokens for a user (logout all sessions)
UPDATE refresh_tokens 
SET revoked_at = COALESCE(revoked_at, SYSDATETIMEOFFSET())
WHERE user_id = @userId;

-- 4. Clean up expired and revoked tokens (periodic maintenance)
DELETE FROM refresh_tokens
WHERE expires_at < SYSDATETIMEOFFSET() OR revoked_at IS NOT NULL;

-- 5. Find user by email hash (fast lookup using HMAC index)
SELECT 
    id, email_encrypted, email_iv, email_auth_tag,
    username_encrypted, username_iv, username_auth_tag,
    password_hash, role, quota_id, storage_used_bytes, status,
    failed_login_count, locked_until, last_login_at,
    email_verified, email_verification_token, email_verification_expires,
    deletion_token, deletion_token_expires, created_at
FROM users
WHERE email_hash = @emailHash;

-- 6. Find user by username hash (fast lookup)
SELECT id, email_encrypted, email_iv, email_auth_tag,
       username_encrypted, username_iv, username_auth_tag,
       password_hash, role, quota_id, storage_used_bytes, status,
       failed_login_count, locked_until, last_login_at,
       email_verified, email_verification_token, email_verification_expires,
       deletion_token, deletion_token_expires, created_at
FROM users
WHERE username_hash = @usernameHash;

-- 7. Update failed login count and account lockout
UPDATE users 
SET failed_login_count = @count, locked_until = @lockedUntil 
WHERE id = @userId;

-- 8. Reset failed login count after successful authentication
UPDATE users 
SET failed_login_count = 0, locked_until = NULL, last_login_at = SYSDATETIMEOFFSET() 
WHERE id = @userId;

-- ============================================================
-- USER REGISTRATION & ACCOUNT MANAGEMENT
-- ============================================================

-- 9. Check for duplicate email or username during registration
SELECT 
    (SELECT COUNT(*) FROM users WHERE email_hash = @emailHash) AS emailExists,
    (SELECT COUNT(*) FROM users WHERE username_hash = @usernameHash) AS usernameExists;

-- 10. Insert new user during registration
INSERT INTO users (
    id, email_encrypted, email_iv, email_auth_tag, email_hash,
    username_encrypted, username_iv, username_auth_tag, username_hash,
    password_hash, role, quota_id, storage_used_bytes, status,
    failed_login_count, locked_until, last_login_at,
    email_verified, email_verification_token, email_verification_expires,
    deletion_token, deletion_token_expires, created_at
)
OUTPUT INSERTED.id, INSERTED.email_encrypted, INSERTED.email_iv, INSERTED.email_auth_tag,
       INSERTED.username_encrypted, INSERTED.username_iv, INSERTED.username_auth_tag,
       INSERTED.role, INSERTED.quota_id, INSERTED.status, INSERTED.created_at
VALUES (
    NEWID(), @emailEncrypted, @emailIv, @emailAuthTag, @emailHash,
    @usernameEncrypted, @usernameIv, @usernameAuthTag, @usernameHash,
    @passwordHash, 'User', 'guest', 0, 'Active',
    0, NULL, NULL,
    0, @verificationToken, @verificationExpires,
    NULL, NULL, SYSDATETIMEOFFSET()
);

-- 11. Verify user email
SELECT id, email_verified, email_verification_expires
FROM users
WHERE id = @userId;

UPDATE users 
SET email_verified = 1, email_verification_token = NULL, email_verification_expires = NULL 
WHERE id = @userId;

-- 12. Check for duplicate username when updating profile
SELECT COUNT(*) AS count 
FROM users 
WHERE username_hash = @usernameHash AND id != @userId;

-- 13. Check for duplicate email when updating profile
SELECT COUNT(*) AS c 
FROM users 
WHERE email_hash = @emailHash AND id != @userId;

-- 14. Update user profile (username, email, password)
UPDATE users 
SET username_encrypted = @un, username_iv = @uni, username_auth_tag = @unat,
    username_hash = @unh, email_encrypted = @em, email_iv = @emi, 
    email_auth_tag = @emat, email_hash = @emh, password_hash = @ph
WHERE id = @id
OUTPUT INSERTED.*;

-- 15. Request account deletion (set deletion token)
SELECT id, email_encrypted, email_iv, email_auth_tag,
       username_encrypted, username_iv, username_auth_tag,
       password_hash, role, quota_id, storage_used_bytes, status,
       deletion_token, deletion_token_expires, created_at
FROM users
WHERE id = @userId;

UPDATE users 
SET deletion_token = @token, deletion_token_expires = @expiresAt 
WHERE id = @userId;

-- 16. Cancel account deletion
UPDATE users 
SET deletion_token = NULL, deletion_token_expires = NULL 
WHERE id = @userId;

-- 17. Delete user account (cascade deletes files, shares, tokens)
DELETE FROM users 
WHERE id = @userId;

-- ============================================================
-- FILE MANAGEMENT
-- ============================================================

-- 18. List files for a user (paginated example)
SELECT id, owner_user_id,
       original_name_encrypted, original_name_iv, original_name_auth_tag,
       stored_path, mime_type, size_bytes, encrypted_size_bytes,
       status, checksum_sha256, is_encrypted, scan_result, scan_message, scanned_at,
       leeku_vibe, ttl_hours, expires_at, deleted_at, created_at
FROM files
WHERE owner_user_id = @userId AND deleted_at IS NULL AND expires_at > SYSDATETIMEOFFSET()
ORDER BY created_at DESC
OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;

-- 19. Get file metadata
SELECT id, owner_user_id,
       original_name_encrypted, original_name_iv, original_name_auth_tag,
       stored_path, mime_type, size_bytes, encrypted_size_bytes,
       status, checksum_sha256, is_encrypted, scan_result, scan_message, scanned_at,
       leeku_vibe, ttl_hours, expires_at, deleted_at, created_at
FROM files
WHERE id = @fileId;

-- 20. Check file ownership (security)
SELECT COUNT(*) AS c
FROM files
WHERE id = @fileId AND owner_user_id = @userId;

-- 21. Mark file as deleted (soft delete)
UPDATE files 
SET deleted_at = SYSDATETIMEOFFSET() 
WHERE id = @fileId AND owner_user_id = @userId;

-- 22. Hard delete file (permanent removal)
DELETE FROM files 
WHERE id = @fileId AND owner_user_id = @userId;

-- 23. Get per-file encryption key
SELECT file_id, encrypted_key, key_iv, key_auth_tag, file_iv, file_auth_tag
FROM file_encryption_keys
WHERE file_id = @fileId;

-- 24. Insert file encryption key
INSERT INTO file_encryption_keys (file_id, encrypted_key, key_iv, key_auth_tag, file_iv, file_auth_tag)
VALUES (@fileId, @encryptedKey, @keyIv, @keyAuthTag, @fileIv, @fileAuthTag);

-- 25. Update file scan result
UPDATE files 
SET scan_result = @scanResult, scan_message = @scanMessage, scanned_at = SYSDATETIMEOFFSET(),
    leeku_vibe = @leekuVibe, status = CASE WHEN @scanResult = 'Infected' THEN 'Blocked' ELSE status END
WHERE id = @fileId;

-- 26. Get user storage quota info
SELECT id, name, storage_limit_bytes, max_file_size_bytes, max_files, daily_upload_limit_bytes 
FROM quotas 
WHERE id = @quotaId;

-- 27. Update user storage used
UPDATE users 
SET storage_used_bytes = storage_used_bytes + @sizeBytes 
WHERE id = @userId;

-- 28. Check daily upload limit
SELECT ISNULL(SUM(size_bytes), 0) AS totalUploaded
FROM files
WHERE owner_user_id = @userId AND CAST(created_at AS DATE) = CAST(GETDATE() AS DATE);

-- ============================================================
-- SHARE LINKS
-- ============================================================

-- 29. Create a share link
INSERT INTO share_links (id, file_id, public_token, password_hash, expires_at, max_downloads, download_count, is_active, created_at)
VALUES (NEWID(), @fileId, @publicToken, @passwordHash, @expiresAt, @maxDownloads, 0, 1, SYSDATETIMEOFFSET());

-- 30. Get share link by public token
SELECT id, file_id, public_token, password_hash, expires_at, max_downloads, download_count, is_active, created_at
FROM share_links
WHERE public_token = @publicToken;

-- 31. Increment share link download count (atomic)
UPDATE share_links 
SET download_count = download_count + 1 
WHERE id = @shareLinkId;

-- 32. Check if share link is active and not expired
SELECT is_active, expires_at, max_downloads, download_count
FROM share_links
WHERE id = @shareLinkId;

-- 33. Disable a share link
UPDATE share_links 
SET is_active = 0 
WHERE id = @shareLinkId;

-- 34. Delete a share link
DELETE FROM share_links 
WHERE id = @shareLinkId AND file_id IN (
    SELECT id FROM files WHERE owner_user_id = @userId
);

-- ============================================================
-- SYSTEM LOGGING & AUDIT
-- ============================================================

-- 35. Insert system log entry (audit trail)
INSERT INTO system_logs (user_id, username_snapshot, event_type, target_type, target_id, ip_address, message)
VALUES (@userId, @usernameSnapshot, @eventType, @targetType, @targetId, @ipAddress, @message);

-- 36. Get recent logs for a user
SELECT id, user_id, username_snapshot, event_type, target_type, target_id, ip_address, message, created_at
FROM system_logs
WHERE user_id = @userId
ORDER BY created_at DESC
OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;

-- 37. Get logs for a specific event type
SELECT id, user_id, username_snapshot, event_type, target_type, target_id, ip_address, message, created_at
FROM system_logs
WHERE event_type = @eventType
ORDER BY created_at DESC
OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;

-- 38. Find failed scan events (security monitoring)
SELECT id, user_id, username_snapshot, event_type, target_type, target_id, ip_address, message, created_at
FROM system_logs
WHERE event_type = 'Scan' AND message LIKE '%Blocked%'
ORDER BY created_at DESC;

-- ============================================================
-- ADMIN / MONITORING QUERIES
-- ============================================================

-- 39. Get platform statistics
SELECT
    (SELECT COUNT(*) FROM users WHERE status = 'Active') AS totalUsers,
    (SELECT COUNT(*) FROM files WHERE status = 'Available') AS totalFiles,
    (SELECT ISNULL(SUM(storage_used_bytes), 0) FROM users WHERE status = 'Active') AS storageUsedBytes,
    (SELECT COUNT(*) FROM files WHERE CAST(created_at AS DATE) = CAST(GETDATE() AS DATE)) AS uploadsToday,
    (SELECT COUNT(*) FROM files WHERE status = 'Blocked') AS blockedFiles;

-- 40. Count failed scans (malware)
SELECT COUNT(*) AS failedScans 
FROM system_logs 
WHERE event_type = 'Scan' AND message LIKE '%Blocked%';

-- 41. Get all quotas
SELECT id, name, storage_limit_bytes, max_file_size_bytes, max_files, daily_upload_limit_bytes 
FROM quotas 
ORDER BY storage_limit_bytes;

-- 42. Get user list (admin dashboard)
SELECT id, email_hash, username_hash, role, quota_id, storage_used_bytes, status,
       failed_login_count, locked_until, last_login_at, email_verified, created_at
FROM users
WHERE status = 'Active'
ORDER BY created_at DESC
OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;

-- 43. Suspend a user account (admin action)
UPDATE users 
SET status = 'Suspended' 
WHERE id = @userId;

-- 44. Unsuspend a user account (admin action)
UPDATE users 
SET status = 'Active' 
WHERE id = @userId;

-- ============================================================
-- MAINTENANCE & CLEANUP QUERIES
-- ============================================================

-- 45. Delete expired share links
DELETE FROM share_links
WHERE expires_at < SYSDATETIMEOFFSET() AND is_active = 1;

-- 46. Delete expired files (soft-deleted only, archived)
DELETE FROM files
WHERE deleted_at IS NOT NULL AND deleted_at < DATEADD(day, -90, SYSDATETIMEOFFSET());

-- 47. Delete expired email verification tokens
UPDATE users
SET email_verification_token = NULL, email_verification_expires = NULL
WHERE email_verification_expires < SYSDATETIMEOFFSET() AND email_verified = 0;

-- 48. List files approaching expiration (for reminders)
SELECT id, owner_user_id, stored_path, mime_type, size_bytes, ttl_hours, expires_at, created_at
FROM files
WHERE status = 'Available' AND expires_at IS NOT NULL
  AND expires_at < DATEADD(hour, 24, SYSDATETIMEOFFSET())
  AND expires_at > SYSDATETIMEOFFSET()
ORDER BY expires_at ASC;

-- 49. Hard delete expired files (PERMANENT - use with caution!)
DELETE FROM files
WHERE status = 'Available' AND expires_at < SYSDATETIMEOFFSET();

-- 50. Reset failed login count for locked accounts (admin batch operation)
UPDATE users
SET failed_login_count = 0, locked_until = NULL
WHERE locked_until < SYSDATETIMEOFFSET();

-- ============================================================
-- SECURITY & COMPLIANCE QUERIES
-- ============================================================

-- 51. GDPR Subject Access Request: Get all data for a user
-- Personal info
SELECT 'users' AS table_name, id, email_hash, username_hash, role, quota_id, 
       storage_used_bytes, status, created_at
FROM users
WHERE id = @userId;

-- User's files
SELECT 'files' AS table_name, id, original_name_encrypted, mime_type, size_bytes, 
       status, checksum_sha256, scan_result, created_at
FROM files
WHERE owner_user_id = @userId;

-- User's share links
SELECT 'share_links' AS table_name, id, public_token, is_active, download_count, created_at
FROM share_links
WHERE file_id IN (SELECT id FROM files WHERE owner_user_id = @userId);

-- User's activity logs
SELECT 'system_logs' AS table_name, id, event_type, target_type, target_id, 
       ip_address, message, created_at
FROM system_logs
WHERE user_id = @userId
ORDER BY created_at DESC;

-- 52. Audit: Files modified in last 30 days
SELECT id, owner_user_id, original_name_encrypted, mime_type, size_bytes, status,
       scan_result, scanned_at, created_at
FROM files
WHERE created_at >= DATEADD(day, -30, SYSDATETIMEOFFSET())
ORDER BY created_at DESC;

-- 53. Security: Find suspicious activity (multiple failed logins)
SELECT id, email_hash, username_hash, failed_login_count, locked_until, last_login_at, created_at
FROM users
WHERE failed_login_count > 3 OR locked_until > SYSDATETIMEOFFSET();

-- ============================================================
-- INDEX OPTIMIZATION QUERIES
-- ============================================================

-- 54. Find missing indexes (SQL Server DMV query)
SELECT 
    d.equality_columns,
    d.inequality_columns,
    s.avg_total_user_cost,
    s.avg_user_impact,
    s.user_seeks,
    s.user_scans,
    s.user_lookups
FROM sys.dm_db_missing_index_details d
INNER JOIN sys.dm_db_missing_index_groups g ON d.index_handle = g.index_handle
INNER JOIN sys.dm_db_missing_index_groups_stats s ON g.index_group_id = s.group_id
WHERE database_id = DB_ID()
ORDER BY s.avg_user_impact DESC;

-- 55. Check index usage statistics
SELECT 
    OBJECT_NAME(ius.object_id) AS table_name,
    i.name AS index_name,
    ius.user_seeks,
    ius.user_scans,
    ius.user_lookups,
    ius.user_updates
FROM sys.dm_db_index_usage_stats ius
INNER JOIN sys.indexes i ON ius.object_id = i.object_id AND ius.index_id = i.index_id
WHERE database_id = DB_ID()
ORDER BY ius.user_seeks + ius.user_scans + ius.user_lookups DESC;

-- ============================================================
-- PERFORMANCE HINTS & NOTES
-- ============================================================
/*
PARAMETERIZED QUERIES:
- All queries above use @paramName placeholders.
- In TypeScript with mssql package:
  const req = new sql.Request();
  req.input('userId', sql.UniqueIdentifier, userIdGuid);
  req.input('tokenHash', sql.Char(64), hashedToken);
  const result = await req.query(sqlString);

INDEXES:
- email_hash and username_hash are UNIQUE for fast lookups during auth.
- owner_user_id on files enables quick retrieval of user's files.
- created_at indexes on files and system_logs optimize date-range queries.
- Composite indexes (user_id, event_type, created_at) optimize audit queries.

SOFT DELETES:
- Files use deleted_at for logical deletion (data preservation).
- Share links use is_active flag for deactivation without deletion.
- Physical deletion is deferred 90+ days for compliance.

ENCRYPTION:
- email_encrypted, username_encrypted, original_name_encrypted are ciphertext (VARBINARY).
- _iv and _auth_tag columns store GCM cryptographic artifacts.
- email_hash, username_hash, checksum_sha256 are unencrypted hashes for lookups/integrity.

IDENTITY & AUTO-INCREMENT:
- system_logs.id is BIGINT IDENTITY (auto-incrementing) for sequential log IDs.
- Prevents race conditions in audit logging.

PERFORMANCE GOTCHAS:
- Avoid SELECT * on encrypted columns without filtering by indexed _hash columns first.
- LIKE queries on NVARCHAR(MAX) columns (message, scan_message) may be slow; consider full-text search for large datasets.
- Deletion cascades (users → files → share_links) can be slow on large datasets; batch deletes if needed.
*/
