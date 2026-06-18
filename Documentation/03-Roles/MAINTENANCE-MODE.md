---
title: "Maintenance Mode — Admin Guide"
last_updated: 2026-06-17
---

# Maintenance Mode

## Overview

Maintenance mode is a system-wide feature that allows administrators to temporarily disable file operations on the platform while performing system updates, backups, or other maintenance tasks.

When enabled, maintenance mode:
- **Blocks all file uploads** — Users cannot upload new files
- **Blocks all file downloads** — Share links and direct downloads are unavailable
- **Blocks all file modifications** — Users cannot delete or modify files
- **Displays a prominent banner** — Users see a warning banner on the landing page and dashboard
- **Allows admin access** — Admins and other non-file operations continue normally

---

## Database Setup

### Prerequisites

Before using maintenance mode, you must apply the migration script to your database:

```sql
sqlcmd -S <server> -U sa -P <password> -d LeekuSecure -i Documentation/SQL/003_maintenance_mode.sql
```

This creates:
- **`system_config` table** — Stores system configuration keys/values
- **`sp_GetMaintenanceStatus` stored procedure** — Retrieves current status
- **`sp_ToggleMaintenanceMode` stored procedure** — Updates status

---

## Enabling Maintenance Mode (Admin)

### Via Admin Panel

1. **Log in** to your admin account
2. **Navigate** to the **Maintenance** tab in the admin workspace
3. **Click** "ENABLE Maintenance Mode"
4. **Confirm** the action — the status will update immediately

### Via API

Administrators can also toggle maintenance mode programmatically:

```bash
# Enable maintenance mode
curl -X POST http://leeks.miku.rip/api/admin/maintenance/toggle \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-jwt-token>" \
  -d '{ "enabled": true }'

# Disable maintenance mode
curl -X POST http://leeks.miku.rip/api/admin/maintenance/toggle \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-jwt-token>" \
  -d '{ "enabled": false }'
```

### Response

```json
{
  "success": true,
  "maintenance_mode": true,
  "message": "Maintenance mode enabled. File uploads, downloads, and modifications are blocked."
}
```

---

## Checking Maintenance Status

### Via API (Public)

Anyone can check the current maintenance status:

```bash
curl http://leeks.miku.rip/api/admin/maintenance-status
```

Response:
```json
{
  "maintenance_mode": false
}
```

This endpoint is **public** so that the client can display the banner without requiring authentication.

---

## User Experience During Maintenance

### Landing Page

When maintenance mode is enabled, users see a prominent red banner:

```
⚠️ System Under Maintenance

The system is currently under maintenance. File uploads, downloads, and modifications are temporarily disabled. Please try again later.
```

### Dashboard (Logged-In Users)

The same banner appears at the top of the dashboard, preventing file operations.

### Upload/Download Attempts

If a user tries to upload, download, or delete a file during maintenance, they receive:

```json
{
  "error": "System is under maintenance. Please try again later.",
  "maintenance_mode": true
}
```

HTTP Status: **503 Service Unavailable**

---

## Status Logging

Every time an admin enables or disables maintenance mode, a system log entry is created:

```
Event Type: Admin
Target Type: System
Message: "Maintenance mode ENABLED" or "Maintenance mode DISABLED"
```

You can view these in the **Security Events** or **Audit Logs** tab in the admin panel.

---

## Performance Notes

- **Status caching**: The maintenance status is cached for **5 seconds** to avoid database hits on every request
- **Cache invalidation**: When toggled, the cache is immediately invalidated
- **Zero performance impact**: When maintenance mode is disabled (normal operation), there is no overhead

---

## Best Practices

### Before Enabling

1. **Notify users** — Send an email or post a notice about the maintenance window
2. **Choose off-peak hours** — Perform maintenance when user activity is lowest
3. **Plan duration** — Let users know how long the system will be unavailable
4. **Document changes** — Record what updates or maintenance was performed

### During Maintenance

- Monitor system logs for any errors during the update process
- Verify database schema changes have applied correctly
- Test critical file operations (upload, download) before re-enabling
- Monitor system resource usage (CPU, memory, disk)

### After Maintenance

1. **Test operations** — Verify files can be uploaded and downloaded
2. **Disable maintenance mode** — This automatically logs the action
3. **Notify users** — Confirm the system is back online
4. **Monitor logs** — Check for any errors or issues after re-enabling

---

## Troubleshooting

### "Maintenance mode won't toggle"

**Possible causes:**
- Missing or corrupt `system_config` table
- Missing stored procedures
- Database connection issues

**Solution:**
- Re-run the migration script: `003_maintenance_mode.sql`
- Verify stored procedures exist:
  ```sql
  SELECT * FROM INFORMATION_SCHEMA.ROUTINES 
  WHERE ROUTINE_NAME LIKE 'sp_%Maintenance%'
  ```

### Banner doesn't appear for users

**Possible causes:**
- Browser cache not refreshed
- Status check endpoint returning wrong value
- Maintenance mode cache not updated

**Solution:**
- Ask users to clear browser cache (Ctrl+Shift+Del)
- Check API response: `curl /api/admin/maintenance-status`
- Verify the status in database: `SELECT * FROM system_config WHERE key='maintenance_mode'`

### Users still uploading during maintenance

**Possible causes:**
- Older client version cached endpoint behavior
- Maintenance mode disabled between request and upload
- Browser offline mode

**Solution:**
- Ask affected users to refresh the page (Ctrl+F5)
- Verify endpoint is returning `maintenance_mode: true`
- Check server logs for any errors

---

## Technical Details

### Database Schema

```sql
-- System configuration table
CREATE TABLE system_config (
    [key] NVARCHAR(100) PRIMARY KEY,
    [value] NVARCHAR(MAX) NOT NULL,
    [updated_at] DATETIMEOFFSET(7) NOT NULL DEFAULT SYSDATETIMEOFFSET()
)

-- Initial value
INSERT INTO system_config ([key], [value], [updated_at])
VALUES ('maintenance_mode', 'false', SYSDATETIMEOFFSET())
```

### Middleware Flow

1. Request arrives at endpoint (upload/download/delete)
2. Authentication middleware validates user
3. **Maintenance check** queries cached status
4. If enabled AND operation is restricted → return 503
5. Otherwise, operation proceeds normally

### Cache Strategy

- **TTL**: 5 seconds
- **Invalidation**: Immediate on toggle
- **Fallback**: If cache miss, queries database
- **Default**: False (operations allowed) if system_config not found

---

## Future Enhancements

Potential improvements to maintenance mode:

- [ ] Scheduled maintenance windows (e.g., "maintenance enabled 2026-06-20 at 02:00 UTC for 30 min")
- [ ] Maintenance mode notifications (email, webhook)
- [ ] Role-based maintenance (e.g., allow certain users to bypass)
- [ ] Partial maintenance (e.g., disable uploads only, allow downloads)
- [ ] Maintenance progress tracking (% complete)
- [ ] Automatic re-enabling after timeout (safety feature)

---

## FAQ

**Q: Can regular users still log in during maintenance?**
A: Yes, users can log in and browse their files. They just can't upload, download, or delete.

**Q: Will pending uploads be lost?**
A: Yes, uploads initiated during maintenance will fail. Users should retry after maintenance is complete.

**Q: Can I view system logs during maintenance?**
A: Yes, system logs and analytics are still available to admins.

**Q: Does maintenance mode affect email notifications?**
A: No, email functionality (password resets, deletions, etc.) continues normally.

**Q: How long should maintenance typically take?**
A: Database migrations usually take 1-5 minutes. Plan accordingly based on your changes.
