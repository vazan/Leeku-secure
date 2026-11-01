/**
 * @license SPDX-License-Identifier: Apache-2.0
 *
 * Leeku Secure — Trash Purge Regression Tests (G-27)
 *
 * Covers the soft-deletion purge feature ported in the MSSQL → PostgreSQL migration:
 *   - runTrashPurgeCycle() with injected (mocked) data-layer callbacks
 *   - TRASH_RETENTION_DAYS default and env override
 *   - startTrashPurge / stopTrashPurge lifecycle
 *   - per-file failure isolation (a failing purge must not abort the cycle)
 *
 * The callbacks keep the module data-layer agnostic (see src/server/utils/trash-purge.ts),
 * so the cycle logic is tested with pure functions — no live database required.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const {
  TRASH_RETENTION_DAYS,
  startTrashPurge,
  stopTrashPurge,
  runTrashPurgeCycle,
} = await import('../src/server/utils/trash-purge.js');

function makeFile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'file-1',
    storedPath: '/vault/a.bin',
    ownerId: 'user-1',
    originalName: 'a.txt',
    deletedAt: new Date('2026-01-01T00:00:00Z'),
    sizeBytes: 1024,
    ...overrides,
  };
}

test('regression: runTrashPurgeCycle purges eligible files and returns counts', async () => {
  const files = [makeFile({ id: 'f1' }), makeFile({ id: 'f2' })];
  const purged: string[] = [];
  const getTrashed = async () => files;
  const purgeFile = async (f: any) => { purged.push(f.id); };

  const result = await runTrashPurgeCycle(getTrashed, purgeFile);

  assert.strictEqual(result.purged, 2);
  assert.strictEqual(result.failed, 0);
  assert.deepStrictEqual(purged, ['f1', 'f2']);
});

test('regression: empty trash -> 0 purged, 0 failed (no-op)', async () => {
  const result = await runTrashPurgeCycle(async () => [], async () => {});
  assert.strictEqual(result.purged, 0);
  assert.strictEqual(result.failed, 0);
});

test('regression: a failing purgeFile does not abort the cycle and is counted as failed', async () => {
  const files = [makeFile({ id: 'ok' }), makeFile({ id: 'bad' }), makeFile({ id: 'ok2' })];
  const getTrashed = async () => files;
  const purgeFile = async (f: any) => {
    if (f.id === 'bad') throw new Error('boom');
  };

  const result = await runTrashPurgeCycle(getTrashed, purgeFile);

  assert.strictEqual(result.purged, 2, 'surviving files still purged');
  assert.strictEqual(result.failed, 1, 'failing file counted as failed');
});

test('regression: getTrashedFiles error is contained -> 0 purged, 0 failed (no throw)', async () => {
  const result = await runTrashPurgeCycle(async () => { throw new Error('query failed'); }, async () => {
    throw new Error('should not be called');
  });
  assert.strictEqual(result.purged, 0);
  assert.strictEqual(result.failed, 0);
});

test('TRASH_RETENTION_DAYS defaults to 90', () => {
  assert.strictEqual(TRASH_RETENTION_DAYS, 90);
});

test('TRASH_RETENTION_DAYS honours env override (fresh process)', { timeout: 60000 }, async () => {
  // TRASH_RETENTION_DAYS is read once at module load, so verify the wiring against
  // the real module in a fresh tsx process with the env var set.
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileP = promisify(execFile);

  const script =
    "import('./src/server/utils/trash-purge.js').then(m => console.log(m.TRASH_RETENTION_DAYS))";
  const { stdout } = await execFileP(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', '--input-type=module', '-e', script],
    { env: { ...process.env, TRASH_RETENTION_DAYS: '45' } }
  );
  assert.strictEqual(stdout.trim(), '45');
});

test('startTrashPurge / stopTrashPurge lifecycle', { timeout: 20000 }, async () => {
  stopTrashPurge(); // ensure clean state
  let cycles = 0;
  startTrashPurge(
    async () => { cycles += 1; return []; },
    async () => {},
    5 // ms — short interval for a fast test
  );

  // Wait briefly for at least one cycle to fire.
  await new Promise((r) => setTimeout(r, 30));
  stopTrashPurge();
  assert.ok(cycles >= 1, 'purge interval fired at least once');
  stopTrashPurge(); // idempotent stop
});
