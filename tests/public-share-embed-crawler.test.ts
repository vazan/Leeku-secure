import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldServeLargeVideoHtmlFallback, DISCORD_INLINE_VIDEO_LIMIT_BYTES } from '../src/server/routes/public-sharing.js';

test('Discord crawler gets HTML fallback for large inline videos', () => {
  const result = shouldServeLargeVideoHtmlFallback({
    mimeType: 'video/mp4',
    sizeBytes: DISCORD_INLINE_VIDEO_LIMIT_BYTES + 1,
    userAgent: 'DiscordBot/2.0',
    acceptHeader: 'text/html',
    fetchDest: 'document',
    rangeHeader: '',
    rawMode: false,
  });

  assert.equal(result, true);
});

test('Browser navigation keeps direct video streaming for large files', () => {
  const result = shouldServeLargeVideoHtmlFallback({
    mimeType: 'video/mp4',
    sizeBytes: DISCORD_INLINE_VIDEO_LIMIT_BYTES + 1,
    userAgent: 'Mozilla/5.0 (Linux; Android 10)',
    acceptHeader: 'text/html',
    fetchDest: 'document',
    rangeHeader: '',
    rawMode: false,
  });

  assert.equal(result, false);
});

test('Small videos are not forced into HTML fallback', () => {
  const result = shouldServeLargeVideoHtmlFallback({
    mimeType: 'video/mp4',
    sizeBytes: DISCORD_INLINE_VIDEO_LIMIT_BYTES - 1,
    userAgent: 'DiscordBot/2.0',
    acceptHeader: 'text/html',
    fetchDest: 'document',
    rangeHeader: '',
    rawMode: false,
  });

  assert.equal(result, false);
});
