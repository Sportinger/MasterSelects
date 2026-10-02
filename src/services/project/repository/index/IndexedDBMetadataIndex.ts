import type { JsonValue, MetadataPage, RepositoryMetadataIndex, RevisionMetadata } from '../contracts';
import { REPOSITORY_LIMITS, RepositoryError } from '../contracts';

const ROOT_PARENT = '\u0000root';
interface IndexedRevision extends RevisionMetadata { parentKey: string; }
function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
}
function completion(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Metadata index transaction aborted'));
  });
}

/** Derived, repository/location scoped metadata. No project bytes live here. */
export class IndexedDBMetadataIndex implements RepositoryMetadataIndex {
  private readonly db: IDBDatabase;
  private constructor(db: IDBDatabase) {
    this.db = db;}
  static async open(repositoryId: string, locationId: string): Promise<IndexedDBMetadataIndex> {
    const opening = indexedDB.open(`masterselects-repository-index-v1:${encodeURIComponent(repositoryId)}:${encodeURIComponent(locationId)}`, 1);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      const revisions = db.createObjectStore('revisions', { keyPath: 'revisionId' });
      revisions.createIndex('sequence', ['operationSequence', 'revisionId'], { unique: true });
      revisions.createIndex('parent', ['parentKey', 'operationSequence', 'revisionId']);
      db.createObjectStore('metadata');
    };
    const db = await request(opening);
    db.onversionchange = () => db.close();
    return new IndexedDBMetadataIndex(db);
  }
  async putRevision(revision: RevisionMetadata): Promise<void> {
    const tx = this.db.transaction('revisions', 'readwrite');
    const done = completion(tx);
    tx.objectStore('revisions').put({ ...revision, parentKey: revision.parentRevisionId ?? ROOT_PARENT } satisfies IndexedRevision);
    await done;
  }
  async getRevision(revisionId: string): Promise<RevisionMetadata | null> {
    const row = await request(this.db.transaction('revisions').objectStore('revisions').get(revisionId)) as IndexedRevision | undefined;
    if (!row) return null;
    const { parentKey: _, ...revision } = row;
    return revision;
  }
  async queryRevisions(options: Parameters<RepositoryMetadataIndex['queryRevisions']>[0]): Promise<MetadataPage<RevisionMetadata>> {
    if (!Number.isFinite(options.limit) || (options.offset !== undefined && (!Number.isSafeInteger(options.offset) || options.offset < 0))) throw new RepositoryError('budget', 'Invalid history page bounds');
    if (options.search && options.offset) throw new RepositoryError('unsupported', 'Search uses bounded continuation pages rather than ordinal skipping');
    const limit = Math.min(REPOSITORY_LIMITS.readPageSize, Math.max(1, Math.trunc(options.limit)));
    const parent = options.parentRevisionId === undefined ? undefined : options.parentRevisionId ?? ROOT_PARENT;
    const descending = options.direction !== 'asc';
    let cursorKey: IDBValidKey | undefined;
    if (options.cursor) {
      try {
        const parsed = JSON.parse(options.cursor);
        if (!Array.isArray(parsed) || parsed[0] !== (parent ?? null) || parsed[1] !== descending || !Array.isArray(parsed[2])) throw new Error('query mismatch');
        cursorKey = parsed[2];
      } catch { throw new RepositoryError('corrupt', 'Invalid history query cursor'); }
    }
    const lower: IDBValidKey = parent === undefined ? [0, ''] : [parent, 0, ''];
    const upper: IDBValidKey = parent === undefined ? [Number.MAX_SAFE_INTEGER, '\uffff'] : [parent, Number.MAX_SAFE_INTEGER, '\uffff'];
    const range = descending
      ? IDBKeyRange.bound(lower, cursorKey ?? upper, false, cursorKey !== undefined)
      : IDBKeyRange.bound(cursorKey ?? lower, upper, cursorKey !== undefined, false);
    const indexName = parent === undefined ? 'sequence' : 'parent';
    const search = options.search?.toLocaleLowerCase();
    const totalCount = search ? undefined : await request(this.db.transaction('revisions').objectStore('revisions').index(indexName).count(IDBKeyRange.bound(lower, upper)));
    const index = this.db.transaction('revisions').objectStore('revisions').index(indexName);
    return new Promise((resolve, reject) => {
      const items: RevisionMetadata[] = [];
      let scanned = 0;
      let skip = options.cursor ? 0 : options.offset ?? 0;
      const query = index.openCursor(range, descending ? 'prev' : 'next');
      query.onerror = () => reject(query.error);
      query.onsuccess = () => {
        const cursor = query.result;
        if (!cursor) { resolve({ items, nextCursor: null, offset: options.offset ?? 0, totalCount }); return; }
        if (skip) { const count = skip; skip = 0; cursor.advance(count); return; }
        const { parentKey: _, ...revision } = cursor.value as IndexedRevision;
        if (!search || revision.label.toLocaleLowerCase().includes(search) || revision.source.toLocaleLowerCase().includes(search)) items.push(revision);
        scanned++;
        if (items.length >= limit || scanned >= REPOSITORY_LIMITS.readPageSize * 4) {
          resolve({ items, nextCursor: JSON.stringify([parent ?? null, descending, cursor.key]), offset: options.offset ?? 0, totalCount });
          return;
        }
        cursor.continue();
      };
    });
  }
  async queryMetadata(options: Parameters<RepositoryMetadataIndex['queryMetadata']>[0]): Promise<MetadataPage<{ key: string; value: JsonValue }>> {
    if (!Number.isFinite(options.limit) || (options.offset !== undefined && (!Number.isSafeInteger(options.offset) || options.offset < 0))) throw new RepositoryError('budget', 'Invalid metadata page bounds');
    const limit = Math.max(1, Math.min(REPOSITORY_LIMITS.readPageSize, Math.trunc(options.limit)));
    const descending = options.direction === 'desc';
    let key: string | undefined;
    if (options.cursor) {
      try {
        const cursor = JSON.parse(options.cursor);
        if (!Array.isArray(cursor) || cursor[0] !== options.prefix || cursor[1] !== descending || typeof cursor[2] !== 'string' || !cursor[2].startsWith(options.prefix)) throw new Error('query mismatch');
        key = cursor[2];
      } catch { throw new RepositoryError('corrupt', 'Invalid metadata continuation'); }
    }
    const lower = options.prefix;
    const upper = `${options.prefix}\uffff`;
    const totalCount = await request(this.db.transaction('metadata').objectStore('metadata').count(IDBKeyRange.bound(lower, upper)));
    const range = descending ? IDBKeyRange.bound(lower, key ?? upper, false, key !== undefined)
      : IDBKeyRange.bound(key ?? lower, upper, key !== undefined, false);
    return new Promise((resolve, reject) => {
      const items: { key: string; value: JsonValue }[] = [];
      let skip = options.cursor ? 0 : options.offset ?? 0;
      const query = this.db.transaction('metadata').objectStore('metadata').openCursor(range, descending ? 'prev' : 'next');
      query.onerror = () => reject(query.error);
      query.onsuccess = () => {
        const cursor = query.result;
        if (!cursor) { resolve({ items, nextCursor: null, offset: options.offset ?? 0, totalCount }); return; }
        if (skip) { const count = skip; skip = 0; cursor.advance(count); return; }
        items.push({ key: String(cursor.key), value: cursor.value as JsonValue });
        if (items.length >= limit) {
          resolve({ items, nextCursor: JSON.stringify([options.prefix, descending, cursor.key]), offset: options.offset ?? 0, totalCount }); return;
        }
        cursor.continue();
      };
    });
  }
  async putMetadata(key: string, value: JsonValue): Promise<void> {
    const tx = this.db.transaction('metadata', 'readwrite');
    const done = completion(tx);
    tx.objectStore('metadata').put(value, key);
    await done;
  }
  async getMetadata(key: string): Promise<JsonValue | null> {
    return await request(this.db.transaction('metadata').objectStore('metadata').get(key)) as JsonValue | undefined ?? null;
  }
  async removeMetadata(key: string): Promise<void> {
    const tx = this.db.transaction('metadata', 'readwrite');
    const done = completion(tx); tx.objectStore('metadata').delete(key); await done;
  }
  async clear(): Promise<void> {
    const tx = this.db.transaction(['revisions', 'metadata'], 'readwrite');
    const done = completion(tx);
    tx.objectStore('revisions').clear();
    tx.objectStore('metadata').clear();
    await done;
  }
  close(): void { this.db.close(); }
}
