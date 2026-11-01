import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline as streamPipeline } from 'node:stream/promises';

// Upload temp dir and the resumable-upload chunk directory. These mirror the
// values used by the main server module (src/server.ts), so `mergeChunks`
// assembled here is consistent with the chunk paths the upload handler writes.
const UPLOAD_TEMP = process.env.UPLOAD_TEMP_PATH || path.join(os.tmpdir(), 'leeku-uploads');
export const RESUMABLE_CHUNK_DIR = path.join(UPLOAD_TEMP, 'chunks');

function chunkDir(identifier: string): string {
  return path.join(RESUMABLE_CHUNK_DIR, identifier);
}

/**
 * Streaming merge of a Resumable.js upload's chunk files (named 1..N) into a
 * single temporary file. Each chunk is streamed through a pipeline that
 * respects backpressure (`pipeline` from 'node:stream/promises' with
 * `end: false` keeps the output stream open across chunks), so memory usage is
 * bounded regardless of chunk/account size. Every chunk is removed from disk
 * once flushed; on failure the partial merged output is removed as well.
 *
 * @returns the absolute path of the merged temporary file.
 */
export async function mergeChunks(identifier: string, totalChunks: number): Promise<string> {
  const dir = chunkDir(identifier);
  const mergedPath = path.join(UPLOAD_TEMP, `merged_${identifier}`);

  const writeStream = fs.createWriteStream(mergedPath);
  try {
    for (let i = 1; i <= totalChunks; i++) {
      const cp = path.join(dir, String(i));
      if (!fs.existsSync(cp)) {
        throw new Error(`Missing chunk ${i} of ${totalChunks} for identifier "${identifier}".`);
      }
      // end:false keeps the output stream open across chunks (bounded memory,
      // backpressure-aware). Each chunk is removed from disk after it is flushed.
      await streamPipeline(fs.createReadStream(cp), writeStream, { end: false });
      fs.unlinkSync(cp); // clean up chunk after appending
    }
    // Flush and close the output stream once every chunk has been appended.
    await new Promise<void>((resolve, reject) => {
      writeStream.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    try { writeStream.destroy(); } catch { /* best effort */ }
    // Remove the partially merged output so a failed merge never leaves a
    // truncated file behind for the caller to pick up.
    try { fs.unlinkSync(mergedPath); } catch { /* best effort */ }
    throw err;
  }

  // Remove empty chunk directory
  try { fs.rmdirSync(dir); } catch { /* best effort */ }

  return mergedPath;
}
