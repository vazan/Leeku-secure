import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { before, after } from 'node:test';

// mergeChunks resolves UPLOAD_TEMP_PATH LAZILY at call time (not at import
// time), matching how src/server.ts resolves it AFTER dotenv.config() has run.
// Point it at an isolated temp dir and import the module dynamically.
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

// Regression: the crash reported in production was a "Missing chunk 1..N"
// thrown while the asynchronously-opened merge output stream could not be
// opened (output dir missing) — with no 'error' handler, the late 'error'
// event crashed the Node process. A missing chunk must reject cleanly and must
// NOT leave an unhandled 'error' event behind, even when the output directory
// does not exist.
test('mergeChunks rejects cleanly without crashing when the output dir is missing', async () => {
  const id = 'h1-missing-outdir';
  const otherSandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'leeku-merge-chunks-missing-'));
  // Stage the chunks under a real dir, but point UPLOAD_TEMP_PATH at a
  // NON-EXISTENT output dir so createWriteStream's open fails (ENOENT).
  const realChunks = path.join(sandbox, 'chunks', id);
  fs.mkdirSync(realChunks, { recursive: true });
  fs.writeFileSync(path.join(realChunks, '1'), 'only-one-');
  fs.writeFileSync(path.join(realChunks, '2'), 'missing-rest-');

  const brokenOutput = path.join(otherSandbox, 'does-not-exist');
  const prev = process.env.UPLOAD_TEMP_PATH;
  process.env.UPLOAD_TEMP_PATH = brokenOutput;
  try {
    await assert.rejects(() => mergeChunks(id, 2));
  } finally {
    process.env.UPLOAD_TEMP_PATH = prev;
    fs.rmSync(otherSandbox, { recursive: true, force: true });
  }
});

// Regression: mergeChunks must resolve UPLOAD_TEMP_PATH at CALL time so it
// agrees with src/server.ts (which reads the env AFTER dotenv runs). If the
// env var is set AFTER this module was imported, a merge must still find the
// chunks in the newly-pointed directory rather than a fallback temp dir.
test('mergeChunks resolves UPLOAD_TEMP_PATH lazily (env set after import)', async () => {
  const id = 'h1-lazy';
  const lazySandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'leeku-merge-chunks-lazy-'));
  const lazyChunks = path.join(lazySandbox, 'chunks', id);
  fs.mkdirSync(lazyChunks, { recursive: true });
  fs.writeFileSync(path.join(lazyChunks, '1'), 'lazy-');
  fs.writeFileSync(path.join(lazyChunks, '2'), 'path');

  const prev = process.env.UPLOAD_TEMP_PATH;
  process.env.UPLOAD_TEMP_PATH = lazySandbox; // changed AFTER import
  try {
    const mergedPath = await mergeChunks(id, 2);
    assert.equal(fs.readFileSync(mergedPath, 'utf8'), 'lazy-path');
    // The merged output must live under the lazily-resolved dir, not the
    // pre-import fallback/sandbox.
    assert.equal(fs.existsSync(path.join(lazySandbox, `merged_${id}`)), true);
    assert.equal(fs.existsSync(path.join(sandbox, `merged_${id}`)), false);
  } finally {
    process.env.UPLOAD_TEMP_PATH = prev;
    fs.rmSync(lazySandbox, { recursive: true, force: true });
  }
});
