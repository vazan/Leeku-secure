---
agent: DevEngineer | date: 2026-11-07 | model: (dev)
plan: /memories/session/dev-plan.md
---

## Intention
Fix the poor large-video playback preview under "All Files": previously the native
`<video>` pointed at `GET /api/files/:id/preview`, which streams the whole
AES-256-GCM-decrypted file as a single sequential response with no HTTP Range
support. Because the browser cannot seek or parse the container until the whole
file transfers, large videos showed a gray screen for the entire transfer/decoding
period with no progress. This change (Option B) decrypts the video to a temp file
once (with progress reporting), then serves it with Range support so the player
starts and seeks immediately, and shows a buffering overlay + transfer % during
preparation.

## Changement
Classe : STANDARD — new video-only media-preview warm-up endpoints modelled on the
existing two-phase private-download session flow, plus a frontend `VideoPlayer`
rewrite. No change to the storage format or the public `GET /api/files/:id/preview`
contract (still used by audio/image/text and video fallback).

## Fichiers
| Fichier | Raison |
|---|---|
| src/server.ts | Added `MediaPreviewSession` map + sweep; added `POST /api/files/:id/preview/prepare`, `GET .../status`, `GET .../file` (Range-capable) |
| src/app/features/files/pages/user-dashboard.tsx | Rewrote `VideoPlayer` to warm up, poll progress, show overlay + %; mount video at ready URL |

## Contrats publics impactés
NON (breaking). Additive endpoints only, admin/user auth-gated identically to the
existing preview flow. `GET /api/files/:id/preview` is unchanged and still serves
non-video media (audio/image) as before.

## Risques
Perf/Sécu/Régression/Compat :
- Perf : one-time full decrypt per preview session (bounded by 10-min TTL);
  progress UI mitigates perceived latency; Range serving is efficient afterwards.
- Sécu : same auth checks as existing preview (owner/Admin, blocked, desktop-update,
  secret-key rejection); temp files live in UPLOAD_TEMP with sweep cleanup.
- Régression : video player now requires prepare→ready before playback; errors are
  surfaced instead of a silent gray frame; audio/image/text previews untouched.
- Compat : relies on native HTTP Range in `<video>` (widely supported).

## Dette observée
MINOR — the new preview session infra duplicates the private-download session
pattern (map + sweep + endpoints). Could be unified later into one generic
"device-backed media session" helper)Skip. Not blocking.

## Validation
Build: ✅  Lint: ⚠ (tsc --noEmit has pre-existing implicit-any errors repo-wide;
           no new errors from this change)  Type-check: ✅ (esbuild server bundle)
Smoke: ⚠SKIPPED (requires live DB + running server; handed to QA)

## Approbation CRITICAL
N/A

## Handoff TestEngineer
Surfaces à tester :
- POST prepare accepts owner/Admin, rejects others/Blocked/secret-key.
- status polling returns phases decrypting→verifying→ready and % progress.
- file endpoint honors Range (206, Content-Range, 416 on bad range), full file when
  no Range, and 409 while still preparing / 500 on error.
- Session TTL sweep (`leeku-dl-*.tmp` cleaned, 10-min expiry) and no leak.
Cas limites : empty file, exactly-1-byte range, end>total, start=end, suffix range
(`bytes=-N`), multiple concurrent ranged requests against one session.
Risques non couverts : real network/proxy behavior behind reverse proxy.

## Handoff QaEngineer
Validation : `npm run build` passes (vite + esbuild). Report : DEV-CHANGE-REPORT.md.
Trail approbation : feature branch `feat/files/video-preview-range-streaming`; commit
awaits QA sign-off. No CRITICAL approval required.
