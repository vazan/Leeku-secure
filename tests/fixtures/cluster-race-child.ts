// Child process for tests/cluster-shared-state.test.ts: plays one cluster
// worker racing its siblings. Waits until a shared start time so all children
// hit the critical section together, then prints "WIN" or "LOSE".
import { tryAcquireMergeLock } from '../../src/server/merge-chunks.ts';
import { SharedSessionStore } from '../../src/server/utils/shared-session-store.ts';

const [mode, arg, startAtRaw] = process.argv.slice(2);
const startAt = Number(startAtRaw);
while (Date.now() < startAt) { /* spin until the shared start */ }

let won = false;
if (mode === 'merge') {
  won = tryAcquireMergeLock(arg) !== null;
} else if (mode === 'claim') {
  const store = new SharedSessionStore<{ id: string; expiresAt: number }>({
    shared: () => true,
    dir: () => arg,
  });
  won = store.claim('session-1');
}
process.stdout.write(won ? 'WIN' : 'LOSE');
