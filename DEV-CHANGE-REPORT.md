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

Follow-up (same session): user confirmed Range works (seeking ok) but start on a
3.1GB MP4 still took 1–2 min — diagnosed as non-faststart MP4 (moov atom at tail).
Added an MP4 faststart remux (`ffmpeg -movflags +faststart -c copy`, lossless) to
the prepare step, with a new `optimizing` phase + progress label. Verified with a
real ffmpeg round-trip (moov moved to front). Falls back to decrypted file if
ffmpeg unavailable/fails.

Follow-up 2 (same session): on the prod Windows host two issues surfaced:
- `GET /api/files/:id/thumbnail` crashed on videos > 2 GiB
  (`ERR_FS_FILE_TOO_LARGE`) because the on-demand fallback read the whole decrypted
  video into memory and served it as image/jpeg. Fixed: videos with no stored
  thumbnail now return 204 so the client shows its fallback icon instead of
  erroring (and no longer wastes a full decrypt + RAM read).
- `spawn ffmpeg ENOENT` on prod (ffmpeg not on PATH). The faststart remux now
  detects ENOENT specifically and skips quietly (info log, still serves the
  decrypted file). Faststart benefit on prod requires ffmpeg installed or
  `FFMPEG_PATH` set — a deployment action, documented in Handoff.

Follow-up 3 (same session): after `FFMPEG_PATH` was set on the prod host, the remux
started invoking ffmpeg but failed with "Unable to choose an output format for
'...tmp'" — because the temp file ends in `.tmp` and ffmpeg can't infer the
container from that extension. Fixed by adding `-f mp4` to the remux command
(temp-file naming unchanged; verified end-to-end: bug repro'd without the flag,
moov lands at front with it).

## Fichiers
| Fichier | Raison |
|---|---|
| src/server.ts | Added `MediaPreviewSession` map + sweep; added `POST /api/files/:id/preview/prepare`, `GET .../status`, `GET .../file` (Range-capable). Added faststart remux (`remuxVideoToFaststart`, `isFaststartCandidate`, `FFMPEG_BIN` env) + `optimizing` phase in prepare. Follow-ups: video thumbnail 204 guard; ENOENT-aware faststart skip; `-f mp4` explicit muxer for `.tmp` outputs |
| src/app/features/files/pages/user-dashboard.tsx | Rewrote `VideoPlayer` to warm up, poll progress, show overlay + %; mount video at ready URL. Added `optimizing` phase + phase-aware label |

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
- NEW faststart: for `video/mp4`/`video/quicktime`, after verify the served file is
  remuxed (`optimizing` phase). Confirm the served file's moov atom is at the front
  (e.g., hexdump first 4KB for 'moov'), that it still plays, and that `sizeBytes`/
  ranges reflect the remuxed size. Confirm graceful fallback when ffmpeg missing/fails
  (ENOENT → info log, decrypted file served; other ffmpeg error → warn + fallback).
- NEW thumbnail guard: `GET /api/files/:id/thumbnail` for a video with no stored
  thumbnail returns 204 (no full-file decrypt, no 2 GiB crash); with a stored
  thumbnail serves it; images still generate on-demand.
Cas limites : empty file, exactly-1-byte range, end>total, start=end, suffix range
(`bytes=-N`), multiple concurrent ranged requests against one session.
Risques non couverts : real network/proxy behavior behind reverse proxy.

## Handoff QaEngineer
Validation : `npm run build` passes (vite + esbuild). Report : DEV-CHANGE-REPORT.md.
Trail approbation : feature branch `feat/files/video-preview-range-streaming`; commit
awaits QA sign-off. No CRITICAL approval required.
