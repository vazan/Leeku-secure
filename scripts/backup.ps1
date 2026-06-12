param(
  [Parameter(Mandatory = $true)][string]$BackupRoot,
  [Parameter(Mandatory = $true)][string]$VaultPath,
  [Parameter(Mandatory = $true)][string]$DatabaseServer,
  [Parameter(Mandatory = $true)][string]$DatabaseName
)

$ErrorActionPreference = "Stop"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$destination = Join-Path $BackupRoot $stamp
New-Item -ItemType Directory -Force -Path $destination | Out-Null

# The SQL credential and backup certificate must be created by an administrator.
# SQL Server encrypts the database backup before it leaves the database host.
$databaseBackup = Join-Path $destination "$DatabaseName-$stamp.bak"
$query = @"
BACKUP DATABASE [$DatabaseName]
TO DISK = N'$databaseBackup'
WITH COPY_ONLY, COMPRESSION, CHECKSUM,
ENCRYPTION (ALGORITHM = AES_256, SERVER CERTIFICATE = LeekuBackupCertificate);
RESTORE VERIFYONLY FROM DISK = N'$databaseBackup' WITH CHECKSUM;
"@
sqlcmd -S $DatabaseServer -d master -E -Q $query

# Vault blobs are already AES-256-GCM encrypted. Robocopy preserves that ciphertext.
$vaultBackup = Join-Path $destination "vault"
robocopy $VaultPath $vaultBackup /MIR /COPY:DAT /DCOPY:DAT /R:2 /W:5 /ZB
if ($LASTEXITCODE -gt 7) { throw "Vault backup failed with robocopy exit code $LASTEXITCODE" }

Get-ChildItem $destination -Recurse -File |
  Get-FileHash -Algorithm SHA256 |
  Select-Object Path, Hash |
  Export-Csv -NoTypeInformation (Join-Path $destination "SHA256SUMS.csv")

Write-Host "Verified encrypted backup created at $destination"
