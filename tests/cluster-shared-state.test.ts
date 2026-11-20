import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';

// Regression tests for CLUSTER_ENABLED=true: state created by one worker must
// be visible to the others, and "exactly once" operations (final-chunk merge,
// download claim) must stay exactly-once across processes.

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'leeku-cluster-state-'));
process.env.UPLOAD_TEMP_PATH = sandbox;
const here = path.dirname(fileURLToPath(import.meta.url));

type Session = { id: string; expiresAt: number; loaded: number; status: string };
let SharedSessionStore: typeof import('../src/server/utils/shared-session-store.ts').SharedSessionStore;
let isClusterMode: typeof import('../src/server/utils/shared-session-store.ts').isClusterMode;
let tryAcquireMergeLock: typeof import('../src/server/merge-chunks.ts').tryAcquireMergeLock;

before(async () => {
  ({ SharedSessionStore, isClusterMode } = await import('../src/server/utils/shared-session-store.ts'));
  ({ tryAcquireMergeLock } = await import('../src/server/merge-chunks.ts'));
});

after(() => {
  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* best effort */ }
});

function makeStores(name: string) {
  const dir = path.join(sandbox, 'sessions', name);
  const opts = { shared: () => true, dir: () => dir, progressWriteIntervalMs: 50 };
  // Two instances over one directory == two cluster workers.
  return { dir, workerA: new SharedSessionStore<Session>(opts), workerB: new SharedSessionStore<Session>(opts) };
}

function session(id: string, ttlMs = 60_000): Session {
  return { id, expiresAt: Date.now() + ttlMs, loaded: 0, status: 'preparing' };
}

test('cluster mode is opt-in: only CLUSTER_ENABLED=true enables it', () => {
  const prev = process.env.CLUSTER_ENABLED;
  try {
    for (const [value, expected] of [[undefined, false], ['', false], ['false', false], ['1', false], ['yes', false], ['true', true], [' TRUE ', true]] as const) {
      if (value === undefined) delete process.env.CLUSTER_ENABLED; else process.env.CLUSTER_ENABLED = value;
      assert.equal(isClusterMode(), expected, `CLUSTER_ENABLED=${JSON.stringify(value)}`);
    }
  } finally {
    if (prev === undefined) delete process.env.CLUSTER_ENABLED; else process.env.CLUSTER_ENABLED = prev;
  }
});

test('a session created on one worker is readable, and its progress visible, on another', async () => {
  const { workerA, workerB } = makeStores('visibility');
  workerA.create(session('dl-1'));
  assert.equal(workerB.get('dl-1')?.status, 'preparing', 'status poll on another worker finds it');

  const owned = workerA.getOwned('dl-1')!;
  owned.loaded = 10;
  workerA.save(owned, { progress: true }); // throttled: within 50ms of create
  owned.loaded = 20;
  await new Promise((r) => setTimeout(r, 60));
  workerA.save(owned, { progress: true });
  assert.equal(workerB.get('dl-1')?.loaded, 20);

  owned.status = 'ready';
  assert.equal(workerA.save(owned), true);
  assert.equal(workerB.get('dl-1')?.status, 'ready');
  assert.equal(workerB.getOwned('dl-1'), undefined, 'non-owners never get a mutable copy');
});

test('a download can be claimed only once across workers, and a failed serve releases it', () => {
  const { workerA, workerB } = makeStores('claim');
  workerA.create(session('dl-2'));
  assert.equal(workerB.claim('dl-2'), true);
  assert.equal(workerA.claim('dl-2'), false);
  assert.equal(workerB.claim('dl-2'), false);
  workerB.releaseClaim('dl-2');
  assert.equal(workerA.claim('dl-2'), true);
});

test('deleting on one worker hides the session everywhere and the owner cannot resurrect it', () => {
  const { workerA, workerB } = makeStores('delete');
  workerA.create(session('dl-3'));
  const owned = workerA.getOwned('dl-3')!;
  assert.equal(workerB.delete('dl-3')?.id, 'dl-3');
  assert.equal(workerA.get('dl-3'), undefined);
  owned.status = 'ready';
  assert.equal(workerA.save(owned), false, 'owner learns it was removed');
  assert.equal(workerB.get('dl-3'), undefined, 'and does not write it back');
  assert.equal(workerA.getOwned('dl-3'), undefined);
});

test('sweep removes expired sessions from any worker and reports them for temp cleanup', () => {
  const { workerA, workerB } = makeStores('sweep');
  workerA.create(session('old', -1));
  workerA.create(session('fresh'));
  const expired: string[] = [];
  workerB.sweep((s) => expired.push(s.id));
  assert.deepEqual(expired, ['old']);
  assert.equal(workerA.get('old'), undefined);
  assert.equal(workerA.get('fresh')?.id, 'fresh');
});

test('rejects unsafe session ids instead of touching paths outside the store', () => {
  const { workerA } = makeStores('unsafe');
  assert.equal(workerA.get('../../etc/passwd'), undefined);
  assert.equal(workerA.delete('..'), undefined);
});

test('single-process mode keeps the old in-memory behaviour with no disk I/O', () => {
  const dir = path.join(sandbox, 'sessions', 'local');
  const store = new SharedSessionStore<Session>({ shared: () => false, dir: () => dir });
  store.create(session('l-1'));
  assert.equal(store.get('l-1')?.status, 'preparing');
  assert.equal(store.claim('l-1'), true);
  assert.equal(store.claim('l-1'), false);
  assert.equal(fs.existsSync(dir), false);
  store.delete('l-1');
  assert.equal(store.get('l-1'), undefined);
});

test('merge lock: one holder at a time; released lock can be re-acquired', () => {
  const id = 'merge-basic';
  fs.mkdirSync(path.join(sandbox, 'chunks', id), { recursive: true });
  const release = tryAcquireMergeLock(id);
  assert.ok(release);
  assert.equal(tryAcquireMergeLock(id), null, 'second final-chunk request must not merge');
  release!();
  assert.equal(fs.existsSync(path.join(sandbox, 'chunks', id)), false, 'empty chunk dir removed on release');
  fs.mkdirSync(path.join(sandbox, 'chunks', id), { recursive: true });
  const again = tryAcquireMergeLock(id);
  assert.ok(again);
  again!();
});

test('merge lock: a stale lock from a crashed worker is taken over', () => {
  const id = 'merge-stale';
  const dir = path.join(sandbox, 'chunks', id);
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, '.merging');
  fs.writeFileSync(lock, '');
  const twoHoursAgo = (Date.now() - 2 * 60 * 60_000) / 1000;
  fs.utimesSync(lock, twoHoursAgo, twoHoursAgo);
  const release = tryAcquireMergeLock(id);
  assert.ok(release, 'stale lock should not block forever');
  release!();
});

async function race(mode: 'merge' | 'claim', arg: string, processes = 8): Promise<string[]> {
  const child = path.join(here, 'fixtures', 'cluster-race-child.ts');
  const startAt = Date.now() + 1500; // give every child time to boot first
  return Promise.all(Array.from({ length: processes }, () => new Promise<string>((resolve, reject) => {
    const proc = spawn(process.execPath, ['--import', 'tsx', child, mode, arg, String(startAt)], {
      env: { ...process.env, UPLOAD_TEMP_PATH: sandbox },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let out = '';
    proc.stdout.on('data', (d) => { out += d; });
    proc.on('error', reject);
    proc.on('exit', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(`child exited ${code}`))));
  })));
}

test('merge lock is exactly-once across real concurrent processes', { timeout: 30_000 }, async () => {
  const id = 'merge-race';
  fs.mkdirSync(path.join(sandbox, 'chunks', id), { recursive: true });
  const results = await race('merge', id);
  assert.equal(results.filter((r) => r === 'WIN').length, 1, `results: ${results.join(',')}`);
});

test('download claim is exactly-once across real concurrent processes', { timeout: 30_000 }, async () => {
  const dir = path.join(sandbox, 'sessions', 'claim-race');
  fs.mkdirSync(dir, { recursive: true });
  const results = await race('claim', dir);
  assert.equal(results.filter((r) => r === 'WIN').length, 1, `results: ${results.join(',')}`);
});
