import crypto from 'crypto';
import sharp from 'sharp';
import { decryptFile } from './encryption.js';

export const MAX_THUMBNAIL_SOURCE_BYTES = 50 * 1024 * 1024;

function thumbnailKey(fileKey: Buffer, fileId: string): Buffer {
  return Buffer.from(crypto.hkdfSync(
    'sha256', fileKey, Buffer.from(fileId), Buffer.from('leeku-thumbnail-v1'), 32,
  ));
}

export async function generateEncryptedThumbnail(inputPath: string, fileKey: Buffer, fileId: string): Promise<Buffer> {
  const image = await sharp(inputPath, { limitInputPixels: 40_000_000, sequentialRead: true })
    .rotate()
    .resize({ width: 128, height: 128, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 80, progressive: true })
    .toBuffer();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', thumbnailKey(fileKey, fileId), iv, { authTagLength: 16 });
  const ciphertext = Buffer.concat([cipher.update(image), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptThumbnail(payload: Buffer, fileKey: Buffer, fileId: string): Buffer {
  if (payload.length <= 28) throw new Error('Invalid encrypted thumbnail.');
  return decryptFile(payload.subarray(28), thumbnailKey(fileKey, fileId), payload.subarray(0, 12), payload.subarray(12, 28));
}