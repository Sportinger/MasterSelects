import type { JsonValue, RepositoryBackend, RepositoryOwner } from '../contracts';
import { REPOSITORY_LIMITS, RepositoryError } from '../contracts';
import { canonicalEncode, hashBytes } from '../segments/canonical';

interface ViewSlot {
  format: 'masterselects-view'; schemaVersion: 1; repositoryId: string;
  workspaceId: string; viewKey: string; sequence: number; value: JsonValue; checksum: string;
}
interface ViewState { sequence: number; confirmed: number; slot: 'a' | 'b'; value: JsonValue; pending: boolean; }
async function* chunk(bytes: Uint8Array): AsyncIterable<Uint8Array> { yield bytes; }

/** Frequent views use two replaceable slots; they never extend the commit chain. */
export class WorkspaceViewStore {
  private states = new Map<string, ViewState>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private error: unknown = null;
  private stopped = false;
  private readonly backend: RepositoryBackend;
  private readonly owner: RepositoryOwner;
  readonly repositoryId: string;
  readonly workspaceId: string;
  constructor(backend: RepositoryBackend, owner: RepositoryOwner, repositoryId: string, workspaceId: string) {
    this.backend = backend; this.owner = owner; this.repositoryId = repositoryId; this.workspaceId = workspaceId;}
  private path(key: string, slot: 'a' | 'b'): string {
    if (!key || key.length > 256) throw new RepositoryError('corrupt', 'Invalid workspace view key');
    return `.masterselects/views/${encodeURIComponent(this.workspaceId)}/${encodeURIComponent(key)}/${slot}.json`;
  }
  /** Keys with a stored slot or a pending write: one directory listing instead of probing every candidate. */
  async keys(): Promise<string[]> {
    const prefix = `.masterselects/views/${encodeURIComponent(this.workspaceId)}/`;
    const keys = new Set<string>(this.states.keys()); let cursor: string | undefined;
    do {
      const page = await this.backend.list(prefix, cursor, 1024);
      for (const path of page.paths) {
        const [encoded, slot] = path.slice(prefix.length).split('/');
        if (encoded && (slot === 'a.json' || slot === 'b.json')) { try { keys.add(decodeURIComponent(encoded)); } catch { /* foreign name */ } }
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return [...keys];
  }
  async read(key: string, previous = false): Promise<JsonValue | null> {
    const candidates = await Promise.all((['a', 'b'] as const).map(async slot => {
      try {
        const path = this.path(key, slot);
        const stat = await this.backend.stat(path);
        if (!stat || stat.length > REPOSITORY_LIMITS.recordBytes) return null;
        const bytes = await this.backend.read(path, 0, stat.length);
        const record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as ViewSlot;
        if (record.format !== 'masterselects-view' || record.schemaVersion !== 1 || record.repositoryId !== this.repositoryId
          || record.workspaceId !== this.workspaceId || record.viewKey !== key || !Number.isSafeInteger(record.sequence) || record.sequence < 0) return null;
        const { checksum, ...body } = record;
        if (await hashBytes(canonicalEncode(body)) !== checksum) return null;
        return { record, slot };
      } catch (error) {
        if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) throw error;
        return null;
      }
    }));
    const valid = candidates.filter(item => item !== null).toSorted((a, b) => b.record.sequence - a.record.sequence);
    if (valid.length > 1 && valid[0]!.record.sequence === valid[1]!.record.sequence
      && valid[0]!.record.checksum !== valid[1]!.record.checksum) throw new RepositoryError('conflict', 'Workspace slots disagree at the same sequence');
    const latest = previous ? valid.find(item => item!.record.sequence < valid[0]!.record.sequence) : valid[0];
    if (!latest) return null;
    if (!previous) this.states.set(key, { sequence: latest.record.sequence, confirmed: latest.record.sequence,
      slot: latest.slot, value: latest.record.value, pending: false });
    return latest.record.value;
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
      for (const write of writes) {
        const current = this.states.get(write.key)!;
        if (current.confirmed >= write.sequence) continue;
        try {
          await this.owner.assertOwned();
          const slot = current.slot === 'a' ? 'b' : 'a';
          const body = { format: 'masterselects-view' as const, schemaVersion: 1 as const, repositoryId: this.repositoryId,
            workspaceId: this.workspaceId, viewKey: write.key, sequence: write.sequence, value: write.value };
          const record: ViewSlot = { ...body, checksum: await hashBytes(canonicalEncode(body)) };
          const encoded = canonicalEncode(record);
          await this.backend.replaceViewSlot(this.path(write.key, slot), chunk(encoded));
          const written = await this.backend.read(this.path(write.key, slot), 0, encoded.byteLength);
          if (await hashBytes(written) !== await hashBytes(encoded)) throw new RepositoryError('corrupt', 'Workspace slot verification failed');
          const latest = this.states.get(write.key)!;
          latest.slot = slot; latest.confirmed = Math.max(latest.confirmed, write.sequence);
          this.error = null;
        } catch (error) {
          this.states.get(write.key)!.pending = true; this.error = error;
          // Preserve the previous confirmed slot; a later explicit flush can retry.
          for (const remaining of writes) if (remaining.sequence > this.states.get(remaining.key)!.confirmed) this.states.get(remaining.key)!.pending = true;
          break;
        }
      }
    });
  }
  async flush(watermarks = this.watermarks()): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.queueWrites(); await this.chain;
    for (const [key, sequence] of Object.entries(watermarks)) {
      if ((this.states.get(key)?.confirmed ?? 0) < sequence) throw this.error ?? new RepositoryError('io', `Workspace ${key} has not been confirmed`);
    }
  }
  async stop(): Promise<void> { await this.flush(); this.stopped = true; }
}
