import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Cluster mode is opt-in: only the literal string "true" enables it.
 *
 * POURQUOI : the previous check (`!== 'false'`) made cluster mode the default,
 * so a missing or misspelled CLUSTER_ENABLED line silently forked one worker
 * per CPU — and every in-process registry below silently stopped working.
 */
export function isClusterMode(): boolean {
  return String(process.env.CLUSTER_ENABLED ?? '').trim().toLowerCase() === 'true';
}

export interface SharedSession {
  id: string;
  expiresAt: number;
}

export interface SharedSessionStoreOptions {
  /** Whether state must be visible to sibling worker processes. Evaluated lazily. */
  shared: () => boolean;
  /** Directory holding one JSON file per session. Evaluated lazily (after dotenv). */
  dir: () => string;
  /** Minimum interval between throttled (progress) writes of one session. */
  progressWriteIntervalMs?: number;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SLEEP_CELL = new Int32Array(new SharedArrayBuffer(4));

function sleepSync(ms: number): void {
  Atomics.wait(SLEEP_CELL, 0, 0, ms);
}

/**
 * Session registry that works both in a single process and across cluster workers.
 *
 * POURQUOI : with CLUSTER_ENABLED=true, Node's cluster balancer round-robins
 * requests across workers, so a session created by `/prepare` on worker A was
 * invisible to the `/status` and `/file` polls that landed on worker B
 * ("Download session not found"). In shared mode every session is mirrored to
 * a small JSON file in a directory all workers can see, and readers always go
 * to that file (the source of truth). In single-process mode it is a plain Map
 * with no disk I/O at all, i.e. exactly the old behaviour.
 *
 * Ownership model: the process that created a session (the one running the
 * decrypt job) mutates its local object and calls `save()` to publish it.
 * Every other process only reads. Deleting is allowed from any process.
 */
export class SharedSessionStore<T extends SharedSession> {
  private readonly local = new Map<string, T>();
  private readonly lastWrite = new Map<string, number>();
  private readonly claimedLocal = new Set<string>();
  private readonly progressInterval: number;

  constructor(private readonly opts: SharedSessionStoreOptions) {
    this.progressInterval = opts.progressWriteIntervalMs ?? 500;
  }

  get isShared(): boolean {
    return this.opts.shared();
  }

  private filePath(id: string): string {
    return path.join(this.opts.dir(), `${id}.json`);
  }

  private claimPath(id: string): string {
    return path.join(this.opts.dir(), `${id}.claim`);
  }

  private writeFile(session: T): void {
    const dir = this.opts.dir();
    fs.mkdirSync(dir, { recursive: true });
    const target = this.filePath(session.id);
    const data = JSON.stringify(session);
    const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, data);
    try {
      fs.renameSync(tmp, target);
    } catch {
      // Windows can refuse to replace a file another worker has open for
      // reading (EPERM/EBUSY). Fall back to an in-place write; readers retry
      // on a torn read.
      try { fs.writeFileSync(target, data); } finally {
        try { fs.unlinkSync(tmp); } catch { /* best effort */ }
      }
    }
    this.lastWrite.set(session.id, Date.now());
  }

  private readFile(id: string): T | undefined {
    const file = this.filePath(id);
    for (let attempt = 0; attempt < 3; attempt++) {
      let raw: string;
      try {
        raw = fs.readFileSync(file, 'utf8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        sleepSync(10);
        continue;
      }
      try {
        return JSON.parse(raw) as T;
      } catch {
        sleepSync(10); // torn read during a fallback in-place write
      }
    }
    return undefined;
  }

  /** Registers a new session owned by this process. */
  create(session: T): void {
    this.local.set(session.id, session);
    if (this.isShared) this.writeFile(session);
  }

  /**
   * Read a session for answering a request. In shared mode this is the
   * on-disk copy (any worker may have created it); it returns undefined once
   * any worker has deleted the session.
   */
  get(id: string): T | undefined {
    if (!SAFE_ID.test(id)) return undefined;
    if (!this.isShared) return this.local.get(id);
    const found = this.readFile(id);
    if (!found) this.forgetLocal(id);
    return found;
  }

  /**
   * The mutable object for a session this process owns (the background job
   * updating progress). Returns undefined if the session was removed —
   * locally, or (detected on the last save) by another worker.
   */
  getOwned(id: string): T | undefined {
    return this.local.get(id);
  }

  /**
   * Publish the owner's latest state. `progress: true` throttles writes so
   * per-block decrypt callbacks don't hammer the disk. Returns false (and
   * drops the local copy) when another worker already deleted the session,
   * so a finished background job can never resurrect it.
   */
  save(session: T, options?: { progress?: boolean }): boolean {
    if (!this.local.has(session.id)) return false;
    if (!this.isShared) return true;
    if (options?.progress) {
      const last = this.lastWrite.get(session.id) ?? 0;
      if (Date.now() - last < this.progressInterval) return true;
    }
    if (!fs.existsSync(this.filePath(session.id))) {
      this.forgetLocal(session.id);
      return false;
    }
    try {
      this.writeFile(session);
    } catch (err) {
      console.warn(`[session-store] Failed to persist session ${session.id}:`, err);
    }
    return true;
  }

  /**
   * Atomically mark a session as consumed. Exactly one caller across all
   * workers gets `true`; use `releaseClaim` if serving then fails.
   */
  claim(id: string): boolean {
    if (!this.isShared) {
      if (this.claimedLocal.has(id)) return false;
      this.claimedLocal.add(id);
      return true;
    }
    try {
      fs.mkdirSync(this.opts.dir(), { recursive: true });
      fs.closeSync(fs.openSync(this.claimPath(id), 'wx'));
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw err;
    }
  }

  releaseClaim(id: string): void {
    this.claimedLocal.delete(id);
    if (this.isShared) {
      try { fs.unlinkSync(this.claimPath(id)); } catch { /* best effort */ }
    }
  }

  /** Remove a session from every worker's view. Returns what was removed. */
  delete(id: string): T | undefined {
    if (!SAFE_ID.test(id)) return undefined;
    let removed = this.local.get(id);
    this.forgetLocal(id);
    if (this.isShared) {
      removed = removed ?? this.readFile(id);
      try { fs.unlinkSync(this.filePath(id)); } catch { /* already gone */ }
      try { fs.unlinkSync(this.claimPath(id)); } catch { /* already gone */ }
    }
    return removed;
  }

  /** All live sessions visible to this process. */
  values(): T[] {
    if (!this.isShared) return [...this.local.values()];
    let entries: string[];
    try {
      entries = fs.readdirSync(this.opts.dir());
    } catch {
      return [...this.local.values()];
    }
    const out: T[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const session = this.readFile(entry.slice(0, -'.json'.length));
      if (session) out.push(session);
    }
    return out;
  }

  /**
   * Remove sessions past `expiresAt`, calling `onExpired` for each so the
   * caller can delete its temp file. Safe to run concurrently in every worker.
   */
  sweep(onExpired: (session: T) => void, now: number = Date.now()): void {
    for (const session of this.values()) {
      if (now > session.expiresAt) {
        this.delete(session.id);
        onExpired(session);
      }
    }
    // Owner copies whose shared file vanished (deleted by another worker).
    if (this.isShared) {
      for (const [id, session] of this.local) {
        if (now > session.expiresAt) this.forgetLocal(id);
      }
      this.sweepStrayFiles(now);
    }
  }

  /** Remove orphaned claim/tmp files left by a crashed worker. */
  private sweepStrayFiles(now: number): void {
    let entries: string[];
    try { entries = fs.readdirSync(this.opts.dir()); } catch { return; }
    const live = new Set(entries.filter((e) => e.endsWith('.json')).map((e) => e.slice(0, -5)));
    for (const entry of entries) {
      const full = path.join(this.opts.dir(), entry);
      const orphanClaim = entry.endsWith('.claim') && !live.has(entry.slice(0, -6));
      const staleTmp = entry.endsWith('.tmp');
      if (!orphanClaim && !staleTmp) continue;
      try {
        if (now - fs.statSync(full).mtimeMs > 60_000) fs.unlinkSync(full);
      } catch { /* best effort */ }
    }
  }

  private forgetLocal(id: string): void {
    this.local.delete(id);
    this.lastWrite.delete(id);
    this.claimedLocal.delete(id);
  }
}
