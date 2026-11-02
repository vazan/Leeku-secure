import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
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

// Bounded block size (1 MiB) used to stream each chunk file into the merge. A
// single block is in flight at a time thanks to Readable.from's backpressure,
// so memory stays flat regardless of chunk/account size. Fresh buffers per read
// avoid aliasing a reused buffer into multiple yielded values.
const BLOCK_SIZE = 1024 * 1024;

/**
 * Yield each chunk file (named 1..N) as a sequence of buffers, in order,
 * removing each chunk from disk once it has been fully read. Throws a
 * descriptive "Missing chunk X of N" if a numbered chunk file does not exist.
 */
async function* mergeChunkBlocks(
  dir: string,
  totalChunks: number,
  identifier: string,
): AsyncGenerator<Buffer> {
  for (let i = 1; i <= totalChunks; i++) {
    const cp = path.join(dir, String(i));
    if (!fs.existsSync(cp)) {
      throw new Error(`Missing chunk ${i} of ${totalChunks} for identifier "${identifier}".`);
    }
    let fh: fs.promises.FileHandle | null = null;
    try {
      fh = await fs.promises.open(cp, 'r');
      for (;;) {
        const buf = Buffer.allocUnsafe(BLOCK_SIZE);
        const { bytesRead } = await fh.read(buf, 0, BLOCK_SIZE, null);
        if (bytesRead <= 0) break;
        yield bytesRead === buf.length ? buf : buf.subarray(0, bytesRead);
      }
    } finally {
      await fh?.close();
      // Clean up the chunk after it has been fully read.
      try { fs.unlinkSync(cp); } catch { /* best effort */ }
    }
  }
}

/**
 * Streaming merge of a Resumable.js upload's chunk files (named 1..N) into a
 * single temporary file. All chunks flow through ONE `streamPipeline`, so a
 * single set of listeners is attached to the output stream (no per-chunk
 * listener accumulation) while backpressure keeps memory bounded. Every chunk
 * is removed from disk once read; on failure the partial merged output is
 * removed as well.
 *
 * @returns the absolute path of the merged temporary file.
 */
export async function mergeChunks(identifier: string, totalChunks: number): Promise<string> {
  const temp = uploadTemp();
  const dir = resumableChunkDir(identifier);
  const mergedPath = path.join(temp, `merged_${identifier}`);

  // The write stream is opened asynchronously, so an error (e.g. ENOENT when
  // the output directory does not exist) can surface as an 'error' event
  // asynchronously. Attach a handler up front so a failed merge can never crash
  // the process with an unhandled 'error' event; the merge error below is what
  // the caller sees.
  const writeStream = fs.createWriteStream(mergedPath);
  let streamError: Error | null = null;
  writeStream.on('error', (err) => { streamError = err; });

  try {
    const source = Readable.from(mergeChunkBlocks(dir, totalChunks, identifier));
    // Stream every chunk through a SINGLE pipeline (no { end:false } loop, so
    // listeners are attached once and cleaned up when the stream finishes).
    // pipeline() ends + flushes the destination once the source completes.
    await streamPipeline(source, writeStream);
    // Surface any write-stream error that occurred but did not reject pipeline.
    if (streamError) throw streamError;
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
