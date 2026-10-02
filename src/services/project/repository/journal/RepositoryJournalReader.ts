import { RepositoryError, type JsonValue, type RecordReference, type RepositoryRecord } from '../contracts';
import { frozenJson } from '../segments/canonical';
import { resolveAggregateJournalValue } from './aggregateJournal';
export interface RepositoryJournalEntry { reference: RecordReference; id: string; value: JsonValue; }
export interface JournalReaderOptions {
  getHead(): RecordReference | null | Promise<RecordReference | null>;
  readRecord(reference: RecordReference, signal?: AbortSignal): Promise<RepositoryRecord>;
  /** Shared per-session index: one chain pass per journal head instead of a full scan per lookup. */
  index?: JournalIndexCache;
}
/** Latest entry location per journal ID for one head; rebuilt when the head moves. */
export interface JournalIndexCache { head: string | null; entries: Promise<Map<string, RecordReference>> | null; }
export function createJournalIndexCache(): JournalIndexCache { return { head: null, entries: null }; }
function reference(value: unknown): value is RecordReference {
  const item = value as Partial<RecordReference> | null;
  return Boolean(item && /^sha256:[a-f0-9]{64}$/.test(item.hash ?? '') && typeof item.segmentId === 'string'
    && Number.isSafeInteger(item.offset) && Number.isSafeInteger(item.length) && item.length! > 0);
}
/** Journal does not move with content undo. Pages use authoritative previous links. */
export class RepositoryJournalReader {
  private readonly options: JournalReaderOptions;
  constructor(options: JournalReaderOptions) {
    this.options = options;}
  async page(cursor?: RecordReference | null, limit = 128, signal?: AbortSignal): Promise<{ entries: RepositoryJournalEntry[]; nextCursor: RecordReference | null }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256) throw new RepositoryError('budget', 'Invalid journal page size');
    let current = cursor === undefined ? await this.options.getHead() : cursor;
    const entries: RepositoryJournalEntry[] = [];
    const visited = new Set<string>();
    while (current && entries.length < limit) {
      signal?.throwIfAborted();
      if (visited.has(current.hash)) throw new RepositoryError('corrupt', 'Cyclic journal ancestry');
      visited.add(current.hash);
      const record = await this.options.readRecord(current, signal);
      const payload = record.payload;
      if (record.kind !== 'journal' || !payload || typeof payload !== 'object' || Array.isArray(payload)
        || typeof payload.id !== 'string' || payload.value === undefined) throw new RepositoryError('corrupt', 'Malformed repository journal entry');
      const previous = payload.previous;
      if (previous !== null && !reference(previous)) throw new RepositoryError('corrupt', 'Invalid previous journal reference');
      if (previous && !record.references.some(ref => ref.hash === previous.hash && ref.segmentId === previous.segmentId && ref.offset === previous.offset && ref.length === previous.length)) throw new RepositoryError('corrupt', 'Journal dependency is not declared');
      entries.push(frozenJson({ reference: current, id: payload.id, value: payload.value }));
      current = previous as RecordReference | null;
    }
    return { entries, nextCursor: current };
  }
  private indexed(head: RecordReference, cache: JournalIndexCache, signal?: AbortSignal): Promise<Map<string, RecordReference>> {
    if (cache.head === head.hash && cache.entries) return cache.entries;
    const build = (async () => {
      const entries = new Map<string, RecordReference>(); const visited = new Set<string>(); let current: RecordReference | null = head;
      while (current) {
        signal?.throwIfAborted();
        if (visited.has(current.hash)) throw new RepositoryError('corrupt', 'Cyclic journal ancestry');
        visited.add(current.hash);
        const record = await this.options.readRecord(current, signal); const payload = record.payload;
        if (record.kind !== 'journal' || !payload || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.id !== 'string') throw new RepositoryError('corrupt', 'Malformed repository journal entry');
        if (!entries.has(payload.id)) entries.set(payload.id, current);
        const previous = payload.previous;
        if (previous !== null && !reference(previous)) throw new RepositoryError('corrupt', 'Invalid previous journal reference');
        current = previous as RecordReference | null;
      }
      return entries;
    })();
    cache.head = head.hash; cache.entries = build;
    build.catch(() => { if (cache.entries === build) { cache.head = null; cache.entries = null; } });
    return build;
  }
  async latestEntry(id: string, signal?: AbortSignal): Promise<RepositoryJournalEntry | null> {
    if (this.options.index) {
      const head = await this.options.getHead(); if (!head) return null;
      const location = (await this.indexed(head, this.options.index, signal)).get(id);
      // The located record is re-read through the validating page path.
      return location ? (await this.page(location, 1, signal)).entries[0] ?? null : null;
    }
    let cursor: RecordReference | null | undefined;
    const seen = new Set<string>();
    do {
      const page = await this.page(cursor, 128, signal);
      for (const entry of page.entries) { if (entry.id === id) return entry; }
      cursor = page.nextCursor;
      if (cursor) { if (seen.has(cursor.hash)) throw new RepositoryError('corrupt', 'Cyclic journal page ancestry'); seen.add(cursor.hash); }
      // Bound memory, not history length: the reader can keep scanning arbitrarily old evidence.
      if (seen.size > 4096) { seen.clear(); await new Promise<void>(resolve => setTimeout(resolve, 0)); }
    } while (cursor);
    return null;
  }
  async latest(id: string, signal?: AbortSignal): Promise<JsonValue | null> {
    const entry = await this.latestEntry(id, signal);
    return entry ? resolveAggregateJournalValue(entry.value, reference => this.options.readRecord(reference, signal)) : null;
  }
}
