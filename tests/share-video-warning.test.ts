import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldShowVideoEmbedWarning } from '../src/app/shared/utils/video-embed-warning.js';

test('warns when a non-mp4 video uses both external preview options', () => {
  assert.equal(
    shouldShowVideoEmbedWarning({
      mime_type: 'video/webm',
      size: 50 * 1024 * 1024,
      allowExternalPreview: true,
      allowDecryptedExternalPreview: true,
    }),
    true,
  );
});

test('does not warn for mp4 videos, smaller files, or when preview options are not both enabled', () => {
  assert.equal(
    shouldShowVideoEmbedWarning({
      mime_type: 'video/mp4',
      size: 50 * 1024 * 1024,
      allowExternalPreview: true,
      allowDecryptedExternalPreview: true,
    }),
    false,
  );

  assert.equal(
    shouldShowVideoEmbedWarning({
      mime_type: 'video/webm',
      size: 49 * 1024 * 1024,
      allowExternalPreview: true,
      allowDecryptedExternalPreview: true,
    }),
    false,
  );

  assert.equal(
    shouldShowVideoEmbedWarning({
      mime_type: 'video/webm',
      size: 50 * 1024 * 1024,
      allowExternalPreview: true,
      allowDecryptedExternalPreview: false,
    }),
    false,
  );
});
