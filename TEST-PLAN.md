# Folder Sharing Test Plan

## Automated checks

- Type-check all server and client changes.
- Verify the MSSQL migration and canonical schema define the same table, constraints, defaults, and index.
- Verify public route URLs returned by the server match the client polling contract.

## MSSQL-backed integration scenarios

1. Create a share for a folder containing files and nested folders; confirm one share row is created.
2. Open an unprotected link; confirm only the selected folder subtree is visible.
3. Open a protected link with no, wrong, and correct passwords; confirm names are disclosed only after success.
4. Set an expiration date in the past; confirm metadata, manifest, and download return `410`.
5. Download a normal file; confirm decryption, checksum verification, one-time claim, and audit logging.
6. Download a secret-key file with no, wrong, and correct keys.
7. Confirm blocked, expired, and missing-vault files are absent from summary and manifest.
8. Move a file outside the shared subtree after loading a manifest; confirm its download returns `404`.
9. Revoke a link while a download prepares; confirm final claim returns `410`.
10. Delete the shared folder; confirm the share row cascades and the public link returns `404`.
11. Confirm desktop-update folders cannot be shared.
12. Confirm a user cannot create or revoke another user's folder share.

## Browser scenarios

- Verify desktop and mobile layouts for empty, flat, and nested folders.
- Verify breadcrumb navigation and long file/folder names.
- Verify each file exposes only the Download action.
- Verify password errors, secret-key prompts, preparation state, and browser download startup.