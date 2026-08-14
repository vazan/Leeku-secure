import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldServeLargeVideoHtmlFallback, DISCORD_INLINE_VIDEO_LIMIT_BYTES } from '../src/server/routes/public-sharing.js';

test('returns the HTML fallback for large Discord inline video previews', () => {
  assert.equal(
    shouldServeLargeVideoHtmlFallback({
      mimeType: 'video/mp4',
      sizeBytes: DISCORD_INLINE_VIDEO_LIMIT_BYTES + 1,
      userAgent: 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
      acceptHeader: 'text/html,application/xhtml+xml',
      fetchDest: 'document',
      rangeHeader: '',
      rawMode: false,
    }),
    true,
  );
});

test('keeps direct small-video streams and raw requests as media streams', () => {
  assert.equal(
    shouldServeLargeVideoHtmlFallback({
      mimeType: 'video/mp4',
      sizeBytes: DISCORD_INLINE_VIDEO_LIMIT_BYTES - 1,
      userAgent: 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
      acceptHeader: 'text/html,application/xhtml+xml',
      fetchDest: 'document',
      rangeHeader: '',
      rawMode: false,
    }),
    false,
  );

  assert.equal(
    shouldServeLargeVideoHtmlFallback({
      mimeType: 'video/mp4',
      sizeBytes: DISCORD_INLINE_VIDEO_LIMIT_BYTES + 1,
      userAgent: 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
      acceptHeader: 'text/html,application/xhtml+xml',
      fetchDest: 'document',
      rangeHeader: 'bytes=0-1023',
      rawMode: false,
    }),
    false,
  );

  assert.equal(
    shouldServeLargeVideoHtmlFallback({
      mimeType: 'video/mp4',
      sizeBytes: DISCORD_INLINE_VIDEO_LIMIT_BYTES + 1,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      acceptHeader: 'text/html,application/xhtml+xml',
      fetchDest: 'document',
      rangeHeader: '',
      rawMode: false,
    }),
    false,
  );
});
