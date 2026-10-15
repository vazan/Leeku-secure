import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import type { FileMetadata } from '../../shared/types';

const require = createRequire(import.meta.url);

/**
 * Generate a thumbnail for an image file
 * @param inputPath - Path to the original image file
 * @param outputPath - Path where the thumbnail will be saved
 * @param maxSize - Maximum dimension (width or height) in pixels
 */
export async function generateImageThumbnail(
  inputPath: string,
  outputPath: string,
  maxSize: number = 128
): Promise<void> {
  // Use sharp for image processing if available
  try {
    const sharp = require('sharp');
    
    await sharp(inputPath)
      .resize({
        width: maxSize,
        height: maxSize,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({
        quality: 80,
        progressive: true,
        optimize: true,
      })
      .toFile(outputPath);
  } catch (err: any) {
    // Sharp not available or failed, fall back to direct file copy
    // This means the thumbnail will be the full-sized image
    // (the frontend will still scale it down with CSS)
    console.warn('[thumbnail] Sharp not available, using original image as thumbnail:', err.message);
    fs.copyFileSync(inputPath, outputPath);
  }
}

/**
 * Check if a file has a thumbnail generated
 */
export function hasThumbnail(file: FileMetadata): boolean {
  return !!file.thumbnail_generated;
}

/**
 * Get thumbnail file path for a file
 */
export function getThumbnailPath(fileId: string): string {
  // Use a subdirectory to avoid collisions
  return path.join(
    path.dirname(process.env.UPLOAD_TEMP || '/tmp'),
    `leeku-thumb-${fileId}.jpg`
  );
}

/**
 * Scan for files missing thumbnails and generate them
 * @param files - Array of files to check
 * @param generateThumbnail - Function to generate a thumbnail
 * @returns Promise that resolves when all missing thumbnails are generated
 */
export async function scanAndGenerateThumbnails(
  files: FileMetadata[],
  generateThumbnail: (inputPath: string, outputPath: string, maxSize: number) => Promise<void>
): Promise<void> {
  const filesNeedingThumbnail = files.filter(
    (file) =>
      file.mime_type?.startsWith('image/') &&
      !file.thumbnail_generated
  );

  if (filesNeedingThumbnail.length === 0) {
    console.log('[thumbnail-scan] No files need thumbnails.');
    return;
  }

  console.log(`[thumbnail-scan] Found ${filesNeedingThumbnail.length} files missing thumbnails.`);

  for (const file of filesNeedingThumbnail) {
    const vaultPath = path.join(process.env.FILE_VAULT || '/var/leeku/vault', file.stored_path);
    
    if (!fs.existsSync(vaultPath)) {
      console.warn(`[thumbnail-scan] Vault file not found for ${file.original_name}, skipping.`);
      continue;
    }

    const tempThumbnailPath = getThumbnailPath(file.id);

    try {
      await generateThumbnail(vaultPath, tempThumbnailPath, 128);
      console.log(`[thumbnail-scan] Generated thumbnail for ${file.original_name}`);
    } catch (err) {
      console.error(`[thumbnail-scan] Failed to generate thumbnail for ${file.original_name}:`, err);
    }
  }
}
