# Generation Summary — GAP: File Version History (Feasibility)

Date: 2026-10-31
Request by: user (via doc-hub orchestrator)

## Request
From `COMPETITIVE-COMPARISON-GOOGLE-DRIVE-MEGA.md` (§2.1, §3.2 gap #6, P2):
assess whether **File Version History** can be implemented in Leeku Secure —
same filename + same folder uploads should become new versions so a user can
roll back / download a previous version.

Specific user concern flagged up front:
> "old keys will need to be stored as multiple versions can exist of the same
> file and potentially other things I'm forgetting about."

## Scope
- MSSQL branch (this repo: Leeku-secure-mssql).
- Feasibility + implementation assessment only (no code implementation in this pass).

## Key evidence gathered (Discovery)
- Encryption stack: `src/server/utils/encryption.ts`
  - Per-file random AES-256-GCM key + IV + authTag; key wrapped by deterministic
    HKDF sub-key `leeku-file-key-wrapping-v1` (`wrapKey`/`unwrapKey`).
  - Because wrapping is deterministic, OLD per-version keys stay decodable with
    the same `MASTER_KEY_BASE64` — no key rotation, no migration of old ciphertext.
  - Each encryption call yields a fresh key (EncryptFileResult / EncryptFileStreamResult).
- Schema: `Documentation/SQL/production_schema.sql`
  - `files` (line 251): `stored_path` = random `.vault` token per upload (server.ts:3081),
    `original_name_encrypted`, `checksum_sha256`, `size_bytes`, `encrypted_size_bytes`, `status`, `deleted_at`.
  - `file_encryption_keys` (line 298): 1:1 to `files` via PK `file_id`; holds wrapped
    key, key_iv, key_auth_tag, file_iv, file_auth_tag.
  - NO unique constraint on `original_name`; vault name is random ⇒ multiple same-name
    files can already coexist in same folder today.
- Upload pipeline: `src/server.ts` (§~2739–3218) — single INSERT into `files` +
  `file_encryption_keys`; no replace/update/version concept exists.
- No `PUT`/replace-of-existing-file route exists today (only upload, move folder,
  delete, download, preview).

## Conclusion (feasibility)
FEASIBLE. The zero-knowledge design supports it cleanly: give each version its own
encrypted blob + its own `file_encryption_keys` row (or a version-scoped key row),
and it is already compatible with the user's "old keys" concern. Details in
`Documentation/01-Technical/FILE-VERSION-HISTORY-FEASIBILITY.md`.

## Artifact produced
- `Documentation/01-Technical/FILE-VERSION-HISTORY-FEASIBILITY.md`
- Update note in `Documentation/05-Roadmap/` / competitive comparison tracked separately.

## Orchestration status
- Discovery: DONE (code + schema evidence above).
- Feasibility assessment: produced by orchestrator (focused single-gap request;
  full specialist dispatch not warranted for a feasibility read).
