import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { before, after } from 'node:test';

// mergeChunks lives in the big server module, which reads UPLOAD_TEMP_PATH at
// import time. Point it at an isolated temp dir and THEN import the module
// (dynamic import) so the constants resolve to our sandbox.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'leeku-merge-chunks-'));
process.env.UPLOAD_TEMP_PATH = sandbox;

let mergeChunks: (
  identifier: string,
  totalChunks: number,
) => Promise<string>;

before(async () => {
  ({ mergeChunks } = await import('../src/server/merge-chunks.ts'));
});

after(() => {
  try {
    fs.rmSync(sandbox, { recursive: true, force: true });
  } catch {
    /* best effort cleanup */
  }
});

function chunkDir(identifier: string): string {
  return path.join(sandbox, 'chunks', identifier);
}

function writeChunk(identifier: string, index: number, content: string) {
  const dir = chunkDir(identifier);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, String(index)), content);
}

test('mergeChunks streams all chunks into one file and cleans them up', async () => {
  const id = 'h1-ok';
  // Several chunk files, each with distinct content, so a correct merge must
  // append them in order (1..N) into a single output.
  writeChunk(id, 1, 'alpha-');
  writeChunk(id, 2, 'beta-');
  writeChunk(id, 3, 'gamma');

  const mergedPath = await mergeChunks(id, 3);

  assert.equal(fs.readFileSync(mergedPath, 'utf8'), 'alpha-beta-gamma');

  // Chunks should be deleted from disk as they are flushed, and the emptied
  // chunk directory removed once the merge finishes.
  assert.equal(fs.existsSync(chunkDir(id)), false);

  fs.rmSync(mergedPath, { force: true });
});

test('mergeChunks rejects when a chunk is missing and removes the partial output', async () => {
  const id = 'h1-missing';
  // Chunks 1 and 2 exist but chunk 3 does not.
  writeChunk(id, 1, 'first-');
  writeChunk(id, 2, 'second-');

  await assert.rejects(() => mergeChunks(id, 3), /Missing chunk 3/);

  // The partially written merged file must not be left behind.
  assert.equal(fs.existsSync(path.join(sandbox, `merged_${id}`)), false);
});
