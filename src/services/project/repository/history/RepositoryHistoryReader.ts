import type { JsonValue, MetadataPage, RevisionMetadata } from '../contracts';
import type { RepositorySession } from '../RepositorySession';
export type HistoryCollection = 'revisions' | 'branches' | 'versions' | 'roots' | 'legacy';
export interface HistoryRow { id: string; revisionId: string | null; parentRevisionId: string | null; label: string; source: string; createdAt: number; detail?: string; }
export interface HistoryPage { items: HistoryRow[]; offset: number; totalCount?: number; nextCursor: string | null; }
export const HISTORY_PAGE_SIZE = 64;
const prefixes = { branches: 'branch-head:', versions: 'named-version:', legacy: 'legacy-history:' };
const object = (value: JsonValue): Record<string, JsonValue> => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
function metadataRow(key: string, value: JsonValue): HistoryRow {
  const data = object(value);
  return { id: key, revisionId: typeof data.revisionId === 'string' && data.navigation !== 'invalid' && data.navigation !== 'ambiguous' ? data.revisionId : null,
    parentRevisionId: typeof data.parentRevisionId === 'string' ? data.parentRevisionId : null,
    label: typeof data.name === 'string' ? data.name : typeof data.label === 'string' ? data.label : key,
    source: typeof data.source === 'string' ? data.source : 'Retained version',
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : typeof data.timestamp === 'number' ? data.timestamp : 0,
    detail: typeof data.detail === 'string' ? data.detail : undefined };
}
/** A session-scoped bounded page cache; no snapshot graph is retained by the panel. */
export class RepositoryHistoryReader {
  private cache = new Map<string, HistoryPage>();
  private generation = 0;
  readonly session: RepositorySession;
  constructor(session: RepositorySession) {
    this.session = session;}
  clear(): void { this.generation++; this.cache.clear(); }
  async query(collection: HistoryCollection, offset: number, search: string, signal: AbortSignal, cursor?: string): Promise<HistoryPage> {
    signal.throwIfAborted(); const generation = this.generation;
    const key = JSON.stringify([collection, offset, search, cursor]);
    const cached = this.cache.get(key);
    if (cached) { this.cache.delete(key); this.cache.set(key, cached); return cached; }
    let page: HistoryPage;
    if (collection === 'revisions' || collection === 'roots') {
      const items: HistoryRow[] = []; let next = cursor; let totalCount: number | undefined;
      do {
        const response = await this.session.client.request<MetadataPage<RevisionMetadata>>({ type: 'query', options: {
          offset: next ? undefined : offset + items.length, cursor: next, limit: HISTORY_PAGE_SIZE - items.length,
          direction: 'desc', search: search || undefined, ...(collection === 'roots' ? { parentRevisionId: null } : {}) } }, signal);
        items.push(...response.items.map(row => ({ id: row.revisionId, revisionId: row.revisionId,
          parentRevisionId: row.parentRevisionId, label: row.label, source: row.source, createdAt: row.createdAt })));
        totalCount = response.totalCount ?? totalCount; next = response.nextCursor ?? undefined;
        signal.throwIfAborted();
      } while (next && items.length < HISTORY_PAGE_SIZE);
      page = { items, offset, totalCount, nextCursor: next ?? null };
    } else if (!search) {
      const items: HistoryRow[] = []; let next = cursor; let totalCount: number | undefined;
      do {
        const response = await this.session.client.request<MetadataPage<{ key: string; value: JsonValue }>>({ type: 'metadata-query', options: {
          prefix: prefixes[collection], offset: next ? undefined : offset + items.length, cursor: next,
          limit: HISTORY_PAGE_SIZE - items.length, direction: 'desc' } }, signal);
        items.push(...response.items.map(row => metadataRow(row.key, row.value)));
        totalCount = response.totalCount ?? totalCount; next = response.nextCursor ?? undefined;
        signal.throwIfAborted();
      } while (next && items.length < HISTORY_PAGE_SIZE);
      page = { items, offset, totalCount, nextCursor: next ?? null };
    } else {
      // Search metadata in bounded windows, preserving logical offsets across filtered rows.
      const items: HistoryRow[] = []; let totalCount = 0; let next: string | undefined;
      do {
        const response = await this.session.client.request<MetadataPage<{ key: string; value: JsonValue }>>({ type: 'metadata-query', options: {
          prefix: prefixes[collection], cursor: next, limit: HISTORY_PAGE_SIZE, direction: 'desc' } }, signal);
        for (const entry of response.items) {
          const row = metadataRow(entry.key, entry.value);
          if (!`${row.label} ${row.source}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) continue;
          if (totalCount >= offset && items.length < HISTORY_PAGE_SIZE) items.push(row);
          totalCount++;
        }
        next = response.nextCursor ?? undefined;
        signal.throwIfAborted();
      } while (next);
      page = { items, offset, totalCount, nextCursor: offset + items.length < totalCount ? 'filtered' : null };
    }
    signal.throwIfAborted();
    if (generation !== this.generation) throw new Error('History changed during the query');
    this.cache.set(key, page);
    while (this.cache.size > 6) this.cache.delete(this.cache.keys().next().value!);
    return page;
  }
  async lastIndex(collection: HistoryCollection, search: string, signal: AbortSignal): Promise<number> {
    let offset = 0; let cursor: string | undefined; let page: HistoryPage;
    do {
      page = await this.query(collection, offset, search, signal, search ? undefined : cursor);
      if (page.totalCount !== undefined) return Math.max(0, page.totalCount - 1);
      offset = page.offset + page.items.length;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return Math.max(0, offset - 1);
  }
}
