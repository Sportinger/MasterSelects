import type { JsonValue, RepositoryBackend, RepositoryOwner } from '../contracts';
import { REPOSITORY_LIMITS, RepositoryError } from '../contracts';
import { canonicalEncode, hashBytes } from '../segments/canonical';

interface ViewSlot {
  format: 'masterselects-view'; schemaVersion: 1; repositoryId: string;
  workspaceId: string; viewKey: string; sequence: number; value: JsonValue; checksum: string;
  /** Wall-clock write time in ms, stored in the record because some backends (Native Helper) report no file times. */
  updatedAt?: number;
}
interface ViewState { sequence: number; confirmed: number; slot: 'a' | 'b'; value: JsonValue; pending: boolean; }
const VIEWS_PREFIX = '.masterselects/views/';
async function* chunk(bytes: Uint8Array): AsyncIterable<Uint8Array> { yield bytes; }
/** Newest first by write time; equal or unknown times fall back to the workspace id so every reader picks the same one. */
function newerHolder(a: { workspaceId: string; updatedAt: number }, b: { workspaceId: string; updatedAt: number }): boolean {
  return a.updatedAt !== b.updatedAt ? a.updatedAt > b.updatedAt : a.workspaceId < b.workspaceId;
}

/** Frequent views use two replaceable slots; they never extend the commit chain. */
export class WorkspaceViewStore {
  private states = new Map<string, ViewState>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private error: unknown = null;
  private stopped = false;
  private listed: Promise<{ own: Set<string>; others: Map<string, string[]> }> | null = null;
  /** The current listing was started by prefetch() and has not been handed to keys() yet. */
  private prefetched = false;
  /** Keys read from another workspace, by source workspace, until this workspace writes them itself. */
  private inherited = new Map<string, string>();
  private lastStamp = 0;
  private readonly backend: RepositoryBackend;
  private readonly owner: RepositoryOwner;
  readonly repositoryId: string;
  readonly workspaceId: string;
  constructor(backend: RepositoryBackend, owner: RepositoryOwner, repositoryId: string, workspaceId: string) {
    this.backend = backend; this.owner = owner; this.repositoryId = repositoryId; this.workspaceId = workspaceId;}
  private path(key: string, slot: 'a' | 'b', workspaceId = this.workspaceId): string {
    if (!key || key.length > 256) throw new RepositoryError('corrupt', 'Invalid workspace view key');
    return `${VIEWS_PREFIX}${encodeURIComponent(workspaceId)}/${encodeURIComponent(key)}/${slot}.json`;
  }
  /**
   * One listing of every workspace of this repository. Other workspaces (an earlier tab, browser or
   * machine) only fill keys this workspace has never stored, e.g. saved media locations after a reopen.
   */
  private listing(): Promise<{ own: Set<string>; others: Map<string, string[]> }> {
    return this.listed ??= (async () => {
      const own = new Set<string>(), others = new Map<string, string[]>(); let cursor: string | undefined;
      do {
        const page = await this.backend.list(VIEWS_PREFIX, cursor, 1024);
        for (const path of page.paths) {
          const [workspace, encoded, slot] = path.slice(VIEWS_PREFIX.length).split('/');
          if (!workspace || !encoded || (slot !== 'a.json' && slot !== 'b.json')) continue;
          try {
            const workspaceId = decodeURIComponent(workspace), key = decodeURIComponent(encoded);
            if (workspaceId === this.workspaceId) { own.add(key); continue; }
            const holders = others.get(key) ?? [];
            if (!holders.includes(workspaceId)) others.set(key, [...holders, workspaceId]);
          } catch { /* foreign name */ }
        }
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return { own, others };
    })().catch(error => { this.listed = null; throw error; });
  }
  /**
   * Starts the one listing while the repository is still opening (the owner calls this right after it
   * acquired the writer locks), so activation does not wait for a folder walk afterwards; the walk also
   * leaves every slot handle with the backend. The first keys() uses it instead of listing again. That is
   * exact: while this writer holds the locks no other same-origin workspace can write view slots, and this
   * store's own writes are in `states`, which keys() merges anyway.
   */
  prefetch(): void {
    if (this.listed) return;
    this.prefetched = true;
    void this.listing().catch(() => { this.prefetched = false; });
  }
  /** Keys with a stored slot (here or inherited) or a pending write: one listing instead of probing every candidate. */
  async keys(): Promise<string[]> {
    if (!this.prefetched) this.listed = null;
    this.prefetched = false;
    const { own, others } = await this.listing();
    return [...new Set([...this.states.keys(), ...own, ...others.keys()])];
  }
  private async slots(key: string, workspaceId: string): Promise<Array<{ record: ViewSlot; slot: 'a' | 'b'; updatedAt: number }>> {
    const candidates = await Promise.all((['a', 'b'] as const).map(async slot => {
      try {
        const path = this.path(key, slot, workspaceId);
        // One whole-file read instead of a stat and then a read (two provider round trips on phones). A
        // missing slot fails the read and counts as absent, exactly like a missing stat did before.
        const bytes = await this.backend.read(path);
        if (!bytes.length || bytes.length > REPOSITORY_LIMITS.recordBytes) return null;
        const record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as ViewSlot;
        if (record.format !== 'masterselects-view' || record.schemaVersion !== 1 || record.repositoryId !== this.repositoryId
          || record.workspaceId !== workspaceId || record.viewKey !== key || !Number.isSafeInteger(record.sequence) || record.sequence < 0) return null;
        const { checksum, ...body } = record;
        if (await hashBytes(canonicalEncode(body)) !== checksum) return null;
        // Records written before updatedAt existed fall back to the file time (0 where the backend has none).
        const updatedAt = Number.isSafeInteger(record.updatedAt) && record.updatedAt! > 0 ? record.updatedAt! : (await this.backend.stat(path))?.modifiedTime ?? 0;
        return { record, slot, updatedAt };
      } catch (error) {
        if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) throw error;
        return null;
      }
    }));
    const valid = candidates.filter(item => item !== null).toSorted((a, b) => b.record.sequence - a.record.sequence);
    if (valid.length > 1 && valid[0]!.record.sequence === valid[1]!.record.sequence
      && valid[0]!.record.checksum !== valid[1]!.record.checksum) throw new RepositoryError('conflict', 'Workspace slots disagree at the same sequence');
    return valid;
  }
  async read(key: string, previous = false): Promise<JsonValue | null> {
    const inheritedFrom = this.inherited.get(key);
    if (inheritedFrom) return this.readInherited(key, inheritedFrom, previous);
    const valid = await this.slots(key, this.workspaceId);
    if (!valid.length && !previous) return this.inherit(key);
    const latest = previous ? valid.find(item => item.record.sequence < valid[0]!.record.sequence) : valid[0];
    if (!latest) return null;
    if (!previous) this.states.set(key, { sequence: latest.record.sequence, confirmed: latest.record.sequence,
      slot: latest.slot, value: latest.record.value, pending: false });
    return latest.record.value;
  }
  /** The newest value another workspace stored for a key this workspace lacks; written here only on its next update. */
  private async inherit(key: string): Promise<JsonValue | null> {
    if (this.states.has(key)) return null;
    const { own, others } = await this.listing();
    if (own.has(key)) return null;
    // A project shape and its parts must come from one workspace; an own shape never mixes in foreign parts.
    const part = key.startsWith('project/part/');
    const shapeSource = this.inherited.get('project');
    const holders = !part ? others.get(key) ?? [] : shapeSource && others.get(key)?.includes(shapeSource) ? [shapeSource] : [];
    let newest: { workspaceId: string; updatedAt: number; value: JsonValue } | null = null;
    for (const workspaceId of holders) {
      try {
        const [latest] = await this.slots(key, workspaceId);
        const candidate = latest && { workspaceId, updatedAt: latest.updatedAt, value: latest.record.value };
        if (candidate && (!newest || newerHolder(candidate, newest))) newest = candidate;
      } catch (error) {
        if (!(error instanceof RepositoryError)) throw error;
      }
    }
    if (!newest) return null;
    this.inherited.set(key, newest.workspaceId);
    return newest.value;
  }
  private async readInherited(key: string, workspaceId: string, previous: boolean): Promise<JsonValue | null> {
    const valid = await this.slots(key, workspaceId).catch(() => []);
    const latest = previous ? valid.find(item => item.record.sequence < valid[0]!.record.sequence) : valid[0];
    return latest?.record.value ?? null;
  }
  update(key: string, value: JsonValue): number {
    if (this.stopped) throw new RepositoryError('ownership', 'Workspace view writer has stopped');
    this.path(key, 'a');
    const frozen = structuredClone(value);
    const bytes = canonicalEncode(frozen);
    if (bytes.byteLength > REPOSITORY_LIMITS.recordBytes - 2048) throw new RepositoryError('budget', 'Split large workspace views by composition or UI area');
    const previous = this.states.get(key);
    if (previous && new TextDecoder().decode(canonicalEncode(previous.value)) === new TextDecoder().decode(bytes)) return previous.sequence;
    const sequence = (previous?.sequence ?? 0) + 1;
    this.states.set(key, { sequence, confirmed: previous?.confirmed ?? 0, slot: previous?.slot ?? 'b', value: frozen, pending: true });
    this.inherited.delete(key);
    if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.queueWrites(); }, 1000);
    return sequence;
  }
  watermarks(): Record<string, number> { return Object.fromEntries([...this.states].map(([key, value]) => [key, value.sequence])); }
  private queueWrites(): void {
    // The project shape publishes its part references: write it after every pending part,
    // including when the root already existed before newly split parts were queued.
    const writes = [...this.states].filter(([, state]) => state.pending)
      .map(([key, state]) => ({ key, sequence: state.sequence, value: state.value }))
      .toSorted((a, b) => Number(a.key === 'project') - Number(b.key === 'project'));
    for (const write of writes) this.states.get(write.key)!.pending = false;
    this.chain = this.chain.then(async () => {
      // Folders of new keys are created together up front (one round instead of one per key); known ones
      // are already resolved. Only a hint: a failure resurfaces at the slot write that needs the folder.
      if (writes.length) await this.backend.prepareDirectories?.(writes.map(write => this.path(write.key, 'a').slice(0, -'a.json'.length)), true).catch(() => {});
      const writeOne = async (write: typeof writes[number]): Promise<boolean> => {
        const current = this.states.get(write.key)!;
        if (current.confirmed >= write.sequence) return true;
        try {
          await this.owner.assertOwned();
          const slot = current.slot === 'a' ? 'b' : 'a';
          const body = { format: 'masterselects-view' as const, schemaVersion: 1 as const, repositoryId: this.repositoryId,
            workspaceId: this.workspaceId, viewKey: write.key, sequence: write.sequence, value: write.value, updatedAt: this.stamp() };
          const record: ViewSlot = { ...body, checksum: await hashBytes(canonicalEncode(body)) };
          const encoded = canonicalEncode(record);
          await this.backend.replaceViewSlot(this.path(write.key, slot), chunk(encoded));
          const written = await this.backend.read(this.path(write.key, slot), 0, encoded.byteLength);
          if (await hashBytes(written) !== await hashBytes(encoded)) throw new RepositoryError('corrupt', 'Workspace slot verification failed');
          const latest = this.states.get(write.key)!;
          latest.slot = slot; latest.confirmed = Math.max(latest.confirmed, write.sequence);
          return true;
        } catch (error) {
          this.states.get(write.key)!.pending = true; this.error = error;
          return false;
        }
      };
      // Every key except the project shape is independent: write those concurrently (a few at a time, each
      // is several provider round trips on phones). The shape publishes its part references, so it is only
      // written after every part succeeded, as before; a failed part keeps it and the rest pending.
      const parts = writes.filter(write => write.key !== 'project');
      const shape = writes.filter(write => write.key === 'project');
      let next = 0; let failed = false;
      await Promise.all(Array.from({ length: Math.min(4, parts.length) }, async () => {
        while (next < parts.length && !failed) { if (!await writeOne(parts[next++]!)) failed = true; }
      }));
      if (!failed) for (const write of shape) if (!await writeOne(write)) failed = true;
      if (!failed) { this.error = null; return; }
      // Preserve the previous confirmed slot; a later explicit flush can retry.
      for (const remaining of writes) if (remaining.sequence > this.states.get(remaining.key)!.confirmed) this.states.get(remaining.key)!.pending = true;
    });
  }
  /** Non-decreasing per store, so a backwards clock step never makes a later write look older than this workspace's earlier one. */
  private stamp(): number { this.lastStamp = Math.max(Date.now(), this.lastStamp + 1); return this.lastStamp; }
  async flush(watermarks = this.watermarks()): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.queueWrites(); await this.chain;
    for (const [key, sequence] of Object.entries(watermarks)) {
      if ((this.states.get(key)?.confirmed ?? 0) < sequence) throw this.error ?? new RepositoryError('io', `Workspace ${key} has not been confirmed`);
    }
  }
  async stop(): Promise<void> { await this.flush(); this.stopped = true; }
}
