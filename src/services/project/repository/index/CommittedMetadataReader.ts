import { iterateRevisionChanges } from '../persistence/revisionChanges';
import { REPOSITORY_LIMITS, RepositoryError, type CommitReference, type JsonValue, type MetadataPage, type RepositoryBackend, type RepositoryMetadataIndex, type RevisionMetadata, type RevisionPayload } from '../contracts';
import { readCommit, commitPath } from '../persistence/publication';
import { segmentRecords } from '../segments/recordSegment';
import { canonicalJson } from '../segments/canonical';
interface ScanEntry { sequence: number; reference: import('../contracts').RecordReference; record: import('../contracts').RepositoryRecord; }
interface QueryCursor { head: CommitReference | null; query: string; offset: number; }
/** Authoritative, bounded fallback. It never writes an index in a read-only session. */
export class CommittedMetadataReader {
  private readonly backend: RepositoryBackend;
  private readonly getHead: () => CommitReference | null;
  private readonly progress?: (records: number) => void;
  constructor(backend: RepositoryBackend, getHead: () => CommitReference | null, progress?: (records: number) => void) {
    this.backend = backend; this.getHead = getHead; this.progress = progress;}
  private async *entries(head = this.getHead(), signal?: AbortSignal): AsyncGenerator<ScanEntry> {
    let cursor = head; let expectedLast: number | null = null; let scanned = 0;
    while (cursor) {
      signal?.throwIfAborted();
      const { commit, reference } = await readCommit(this.backend, commitPath(cursor.commitId), signal);
      if (reference.hash !== cursor.hash || expectedLast !== null && commit.lastOperation !== expectedLast) throw new RepositoryError('corrupt', 'Metadata ancestry is damaged');
      for (const segment of commit.segments.toReversed()) {
        const entries = []; for await (const entry of segmentRecords(this.backend, segment, signal)) entries.push(entry);
        for (const entry of entries.toReversed()) {
          yield { sequence: commit.lastOperation, ...entry };
          if (++scanned % 128 === 0) { this.progress?.(scanned); await new Promise<void>(resolve => setTimeout(resolve, 0)); }
        }
      }
      expectedLast = commit.firstOperation - 1; cursor = commit.previous;
    }
  }
  private async revision(entry: ScanEntry, includeChanges = false): Promise<RevisionMetadata | null> {
    if (entry.record.kind !== 'revision') return null;
    const value = entry.record.payload as unknown as RevisionPayload;
    if (!value.revisionId || !Array.isArray(value.changes)) throw new RepositoryError('corrupt', 'Invalid revision metadata');
    const changedEntities: string[] = [];
    if (includeChanges) for await (const change of iterateRevisionChanges(this.backend, value)) changedEntities.push(change.entityKey);
    return { revisionId: value.revisionId, parentRevisionId: value.parentRevisionId, reference: entry.reference,
      label: value.label, source: value.source, createdAt: value.createdAt, operationSequence: entry.sequence,
      changedEntities };
  }
  async getRevision(id: string, signal?: AbortSignal): Promise<RevisionMetadata | null> {
    for await (const entry of this.entries(undefined, signal)) { const revision = await this.revision(entry); if (revision?.revisionId === id) return this.revision(entry, true); }
    return null;
  }
  private cursor(query: string, token?: string, offset = 0): QueryCursor {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new RepositoryError('budget', 'Invalid metadata offset');
    if (!token) return { query, offset, head: this.getHead() };
    try {
      const value = JSON.parse(token) as QueryCursor;
      if (value.query !== query || !Number.isSafeInteger(value.offset) || value.offset < 0
        || value.head && (!/^sha256:[a-f0-9]{64}$/.test(value.head.hash) || typeof value.head.commitId !== 'string')) throw new Error('query mismatch');
      return value;
    } catch { throw new RepositoryError('corrupt', 'Invalid authoritative query continuation'); }
  }
  async queryRevisions(options: Parameters<RepositoryMetadataIndex['queryRevisions']>[0], signal?: AbortSignal): Promise<MetadataPage<RevisionMetadata>> {
    const { cursor: token, offset: requestedOffset, limit: inputLimit, ...filters } = options;
    if (!Number.isSafeInteger(inputLimit) || inputLimit < 1) throw new RepositoryError('budget', 'Invalid revision page size');
    const limit = Math.min(inputLimit, REPOSITORY_LIMITS.readPageSize);
    const cursor = this.cursor(canonicalJson(filters), token, requestedOffset);
    const search = options.search?.toLocaleLowerCase();
    const matches = (item: RevisionMetadata) => (options.parentRevisionId === undefined || item.parentRevisionId === options.parentRevisionId)
      && (!search || item.label.toLocaleLowerCase().includes(search) || item.source.toLocaleLowerCase().includes(search));
    let totalCount = 0;
    for await (const entry of this.entries(cursor.head, signal)) { const item = await this.revision(entry); if (item && matches(item)) totalCount++; }
    const items: RevisionMetadata[] = []; let ordinal = 0;
    const descending = options.direction !== 'asc';
    for await (const entry of this.entries(cursor.head, signal)) {
      const item = await this.revision(entry); if (!item || !matches(item)) continue;
      const index = descending ? ordinal++ : totalCount - ++ordinal;
      if (index >= cursor.offset && index < cursor.offset + limit) items.push((await this.revision(entry, true))!);
      if (descending && items.length === limit) break;
    }
    if (!descending) items.reverse();
    const nextOffset = cursor.offset + items.length;
    return { items, totalCount, offset: cursor.offset,
      nextCursor: nextOffset < totalCount ? JSON.stringify({ ...cursor, offset: nextOffset }) : null };
  }
  private async aliases(entry: ScanEntry): Promise<Array<{ key: string; value: JsonValue }>> {
    const { record, reference } = entry;
    const value = record.payload;
    const result: Array<{ key: string; value: JsonValue }> = [];
    if (['metadata', 'journal', 'navigation', 'checkpoint'].includes(record.kind)) result.push({ key: `${record.kind}:${reference.hash}`, value });
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (record.kind === 'metadata' && typeof value.key === 'string' && value.value !== undefined) result.push({ key: value.key, value: value.value });
      if (record.kind === 'journal' && typeof value.id === 'string') result.push({ key: `journal-id:${value.id}`, value });
    }
    const revision = await this.revision(entry);
    if (revision) result.push({ key: `branch-head:${revision.revisionId}`, value: { revisionId: revision.revisionId,
      parentRevisionId: revision.parentRevisionId, label: revision.label, createdAt: revision.createdAt } });
    return result;
  }
  async getMetadata(key: string, signal?: AbortSignal, head = this.getHead()): Promise<JsonValue | null> {
    const branchId = key.startsWith('branch-head:') ? key.slice('branch-head:'.length) : null;
    for await (const entry of this.entries(head, signal)) {
      if (branchId && (await this.revision(entry))?.parentRevisionId === branchId) return null;
      const item = (await this.aliases(entry)).find(item => item.key === key); if (item) return item.value;
    }
    return null;
  }
  async queryMetadata(options: Parameters<RepositoryMetadataIndex['queryMetadata']>[0], signal?: AbortSignal): Promise<MetadataPage<{ key: string; value: JsonValue }>> {
    const { cursor: token, offset: requestedOffset, limit: inputLimit, ...filters } = options;
    if (!Number.isSafeInteger(inputLimit) || inputLimit < 1) throw new RepositoryError('budget', 'Invalid metadata page size');
    const limit = Math.min(inputLimit, REPOSITORY_LIMITS.readPageSize);
    const cursor = this.cursor(canonicalJson(filters), token, requestedOffset);
    // Lexical windows bound memory even for arbitrarily many journal/metadata records.
    const selected: Array<{ key: string; value: JsonValue }> = []; const descending = options.direction === 'desc';
    const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0) * (descending ? -1 : 1);
    let lastKey = ''; let skipped = 0;
    const findWindow = async (after?: string) => {
      const window: typeof selected = [];
      for await (const entry of this.entries(cursor.head, signal)) for (const item of await this.aliases(entry)) {
        if (!item.key.startsWith(options.prefix) || after !== undefined && order(item.key, after) <= 0 || window.some(row => row.key === item.key)) continue;
        if (window.length >= limit + 1 && order(item.key, window.at(-1)!.key) >= 0) continue;
        const latest = await this.getMetadata(item.key, signal, cursor.head);
        if (latest === null || canonicalJson(latest) !== canonicalJson(item.value)) continue;
        const position = window.findIndex(row => order(item.key, row.key) < 0);
        window.splice(position < 0 ? window.length : position, 0, item); if (window.length > limit + 1) window.pop();
      }
      return window;
    };
    let window = await findWindow();
    while (skipped < cursor.offset && window.length) {
      const take = Math.min(cursor.offset - skipped, window.length); lastKey = window[take - 1].key; skipped += take;
      if (take < window.length) { window = window.slice(take); break; }
      window = await findWindow(lastKey);
    }
    // Fill after partial offset window without retaining skipped metadata.
    if (window.length < limit + 1 && window.length) window = await findWindow(lastKey || undefined);
    selected.push(...window.slice(0, limit));
    return { items: selected, offset: cursor.offset, nextCursor: window.length > limit ? JSON.stringify({ ...cursor, offset: cursor.offset + selected.length }) : null };
  }
}
