# Completion Summary — GAP: File Version History (Feasibility)

Date: 2026-10-31
Orchestrator: doc-hub

## Request
Assess feasibility of the **File Version History** gap
(`COMPETITIVE-COMPARISON-GOOGLE-DRIVE-MEGA.md` gap #6, P2) with focus on the
user's concern about persisting old encryption keys across versions.

## Verdict
✅ **FEASIBLE** — additive, zero-knowledge-safe.

## Direct answer to the key concern
Old per-file keys **can and should** be stored. The HKDF key-wrapping sub-key
(`leeku-file-key-wrapping-v1`) is deterministic from `MASTER_KEY_BASE64`, so a
stored wrapped key from any version remains decodable indefinitely — no
re-keying or migration of old ciphertext is ever needed. Each version simply
gets its own row in a version-scoped key table (1:1, mirroring today's
`file_encryption_keys`).

## Other items raised (the "other things")
Quota double-counting, share-link/preview stability via a head-file model,
per-version client secrets, per-version checksum/scan, retention cap/eviction,
PostgreSQL parity, thumbnail invalidation, backward compatibility.

## Artifacts
- `Documentation/01-Technical/FILE-VERSION-HISTORY-FEASIBILITY.md` (new; deliverable)
- `Documentation/02-Non-Technical/COMPETITIVE-COMPARISON-GOOGLE-DRIVE-MEGA.md` (updated: gap #6 + roadmap §5)
- `memories/session/generation-summary.md` (session context)

## Owner decisions added (2026-10-31, second pass)
1. **Quota double-counting is by design** — each version counts against quota; UI surfaces sizes/total.
2. **Sharing is per-version** — user picks the specific version to share (`share_links.version_id`);
   folder shares expose all versions.
3. **"All Files" shows only current version**; older versions behind a reveal option (download/preview/…).
4. **Scope is MSSQL only** for now; PostgreSQL parity deferred.

These are reflected in §1.5, §3.1/§3.1b, §3.3, §3.4, §4, §5, §6 of the feasibility doc.

## Deliberately NOT done in this pass
- No code/schema implementation (feasibility read only).
- No full specialist dispatch (DocArchitect/DocEngineer/DocOps/DocQA) — single-gap
  feasibility request did not warrant a full suite; evidence anchors cited directly.

## Evidence confidence
High for the crypto + schema claims (cited `encryption.ts`, `production_schema.sql`,
`server.ts` lines). Roadmap effort estimate is an estimate (not measured).
