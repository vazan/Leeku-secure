import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export type ProfilePictureMime = 'image/jpeg' | 'image/png' | 'image/webp';

function getPublicAvatarTokenSecret(): string {
  return String(
    process.env.PUBLIC_AVATAR_TOKEN_SECRET ||
      process.env.JWT_SECRET ||
      process.env.COOKIE_SECRET_BASE64 ||
      process.env.SESSION_SECRET ||
      process.env.APP_SECRET ||
      ''
  ).trim();
}

export function detectProfilePictureMime(buffer: Buffer): ProfilePictureMime | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

export function getProfilePictureDirectory(profilePictureRoot: string, userId: string): string {
  return path.join(profilePictureRoot, userId, 'avatars');
}

export function getProfilePictureFiles(profilePictureRoot: string, userId: string): string[] {
  const directory = getProfilePictureDirectory(profilePictureRoot, userId);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .map((name) => path.join(directory, name))
    .filter((filePath) => fs.statSync(filePath).isFile())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

export function getLatestProfilePictureFile(profilePictureRoot: string, userId: string): string | null {
  const files = getProfilePictureFiles(profilePictureRoot, userId);
  return files[0] ?? null;
}

export function getProfilePictureExtension(mimeType: ProfilePictureMime): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  return 'webp';
}

export function createPublicProfilePictureToken(userId: string): string {
  if (!userId) return '';
  const secret = getPublicAvatarTokenSecret();
  const payload = secret ? `${secret}:${userId}` : `leeku-avatar:${userId}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export function resolveProfilePictureUserIdFromToken(profilePictureRoot: string, token: string): string | null {
  if (!token || !fs.existsSync(profilePictureRoot)) return null;
  const entries = fs.readdirSync(profilePictureRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidateUserId = entry.name;
    if (createPublicProfilePictureToken(candidateUserId) === token) {
      return getLatestProfilePictureFile(profilePictureRoot, candidateUserId) ? candidateUserId : null;
    }
  }
  return null;
}

export function getPublicProfilePictureUrl(baseUrl: string, profilePictureRoot: string, userId: string): string | null {
  if (!userId) return null;
  const avatarPath = getLatestProfilePictureFile(profilePictureRoot, userId);
  if (!avatarPath) return null;
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
  const token = createPublicProfilePictureToken(userId);
  return `${normalizedBaseUrl}/api/public/users/${encodeURIComponent(token)}/avatar`;
}
