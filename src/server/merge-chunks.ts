import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline as streamPipeline } from 'node:stream/promises';

// POURQUOI : these paths are resolved LAZILY (at call time) instead of at module
// scope. This module is imported by src/server.ts BEFORE dotenv.config() runs,
// so a module-scope `process.env.UPLOAD_TEMP_PATH` here would always be
// undefined and silently fall back to the OS temp dir, diverging from the
// `UPLOAD_TEMP`/`RESUMABLE_CHUNK_DIR` that server.ts resolves AFTER dotenv
// loads. That divergence made server.ts write chunks to the real temp path
// (e.g. "P:\\Leeku-Temp\\chunks") while this module looked for them in the OS
// temp dir -> "Missing chunk 1..N" on every resumable upload.
function uploadTemp(): string {
  return process.env.UPLOAD_TEMP_PATH || path.join(os.tmpdir(), 'leeku-uploads');
}

function resumableChunkDir(identifier: string): string {
  return path.join(uploadTemp(), 'chunks', identifier);
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
  const temp = uploadTemp();
  const dir = resumableChunkDir(identifier);
  const mergedPath = path.join(temp, `merged_${identifier}`);

  // The write stream is opened asynchronously, so an error (e.g. ENOENT when
  // a missing chunk aborts the loop before any pipeline attaches a handler)
  // can surface as an 'error' event AFTER the caller has already thrown. Attach
  // the handler up front so a failed merge can never crash the process with an
  // unhandled 'error' event; the merge error below is what the caller sees.
  const writeStream = fs.createWriteStream(mergedPath);
  let streamError: Error | null = null;
  writeStream.on('error', (err) => { streamError = err; });

  try {
    for (let i = 1; i <= totalChunks; i++) {
      if (streamError) throw streamError;
      const cp = path.join(dir, String(i));
      if (!fs.existsSync(cp)) {
        throw new Error(`Missing chunk ${i} of ${totalChunks} for identifier "${identifier}".`);
      }
      // end:false keeps the output stream open across chunks (bounded memory,
      // backpressure-aware). Each chunk is removed from disk after it is flushed.
      await streamPipeline(fs.createReadStream(cp), writeStream, { end: false });
      fs.unlinkSync(cp); // clean up chunk after appending
    }
    if (streamError) throw streamError;
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
