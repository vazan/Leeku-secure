import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  createPublicProfilePictureToken,
  getLatestProfilePictureFile,
  resolveProfilePictureUserIdFromToken,
} from '../src/server/utils/profile-picture.js';

test('returns the most recently updated profile picture for a user', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leeku-profile-pictures-'));
  const profilePictureRoot = path.join(tempRoot, 'profiles');
  const avatarDir = path.join(profilePictureRoot, 'user-1', 'avatars');
  fs.mkdirSync(avatarDir, { recursive: true });

  const olderPath = path.join(avatarDir, 'older.png');
  const newerPath = path.join(avatarDir, 'newer.png');
  fs.writeFileSync(olderPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(newerPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const newerStat = fs.statSync(newerPath);
  fs.utimesSync(newerPath, newerStat.atime, new Date(newerStat.mtime.getTime() + 60_000));

  assert.equal(getLatestProfilePictureFile(profilePictureRoot, 'user-1'), newerPath);
});

test('creates an opaque token and resolves it back to the same user', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leeku-profile-token-'));
  const profilePictureRoot = path.join(tempRoot, 'profiles');
  const avatarDir = path.join(profilePictureRoot, 'user-2', 'avatars');
  fs.mkdirSync(avatarDir, { recursive: true });
  fs.writeFileSync(path.join(avatarDir, 'avatar.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  process.env.PUBLIC_AVATAR_TOKEN_SECRET = 'test-secret';
  const token = createPublicProfilePictureToken('user-2');

  assert.equal(resolveProfilePictureUserIdFromToken(profilePictureRoot, token), 'user-2');
});
