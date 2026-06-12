# Leeku Operations

## Production startup requirements

Production startup fails unless the database, vault, encryption keys, secure
cookies, and Bitdefender CLI are configured. Load balancers should use:

- Liveness: `GET /api/health/live`
- Readiness: `GET /api/health/ready`

Readiness requires SQL Server and read/write vault access. In production it also
requires a discoverable Bitdefender CLI.

## Large uploads

Leeku receives uploads as a single multipart request and streams the file to
local disk before scanning and vault encryption. For large files, keep
`HTTP_REQUEST_TIMEOUT_MS=0` so Node.js does not close a valid long-running
request after its default five-minute deadline.

If a load balancer or reverse proxy sits in front of Node.js, configure its
request-body and idle timeouts to exceed the longest expected upload duration.
An upstream close still reaches multer as `Request aborted` even when Node's own
timeout is disabled.

## Encrypted backups

Create a SQL Server certificate named `LeekuBackupCertificate`, export that
certificate and its private key to separately protected storage, then schedule:

```powershell
powershell.exe -File scripts\backup.ps1 `
  -BackupRoot "\\backup-host\leeku" `
  -VaultPath "\\storage-host\leeku-vault" `
  -DatabaseServer "sql-host" `
  -DatabaseName "LeekuSecure"
```

Run it daily with Windows Task Scheduler under a dedicated backup identity.
Retain at least one offline copy. Test a full restore quarterly. A database
backup is unusable without the exported SQL backup certificate and private key.

## Master-key rotation

The master key protects wrapped file keys and encrypted user columns. Rotation
must therefore be performed as a controlled maintenance migration:

1. Take and verify an encrypted database and vault backup.
2. Stop all Leeku application instances.
3. Keep the old key available only for the migration window.
4. Decrypt and re-encrypt every encrypted user column with the new key.
5. Unwrap and re-wrap every `file_encryption_keys.encrypted_key` with the new key.
6. Replace `MASTER_KEY_BASE64`, start one instance, and verify representative
   account, preview, download, and public-share flows.
7. Start remaining instances, then securely retire the old key after the
   rollback window.

Never rotate by simply replacing `MASTER_KEY_BASE64`; doing so makes existing
accounts and files unreadable.
