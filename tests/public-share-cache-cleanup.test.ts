import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { cleanupPublicShareDecryptedPreviewFiles } from '../src/server/routes/public-sharing.js';

test('removes only the decrypted external preview cache files for a deleted share', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leeku-share-cleanup-'));
  const token = 'share-token-123';
  const fileId = 'file-456';
  const hash = crypto.createHash('sha256').update(`${token}:${fileId}`).digest('hex').slice(0, 24);
  const matchingFile = path.join(dir, `leeku-external-decrypted-${hash}.mp4`);
  const otherFile = path.join(dir, `leeku-external-decrypted-${hash}-other.mp4`);
  const unrelatedFile = path.join(dir, 'keep-me.bin');

  fs.writeFileSync(matchingFile, 'preview');
  fs.writeFileSync(otherFile, 'preview-2');
  fs.writeFileSync(unrelatedFile, 'not-a-share-preview');

  const removed = cleanupPublicShareDecryptedPreviewFiles(dir, token, fileId);

  assert.equal(removed, 2);
  assert.equal(fs.existsSync(matchingFile), false);
  assert.equal(fs.existsSync(otherFile), false);
  assert.equal(fs.existsSync(unrelatedFile), true);

  fs.rmSync(dir, { recursive: true, force: true });
});
