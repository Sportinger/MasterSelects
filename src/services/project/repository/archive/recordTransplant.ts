import { RepositoryError, type CommitManifest, type CommitReference, type JsonValue, type RecordReference, type RepositoryBackend, type RepositoryDescriptor, type RepositoryOwner, type RepositoryRecord } from '../contracts';
import { canonicalBytes, hashBytes, hashRecord } from '../segments/canonical';
import { SegmentBuilder, readRecord, segmentPath } from '../segments/recordSegment';
import { blobPath, verifyBlob } from '../persistence/blobStorage';
import { recoverRepository } from '../persistence/recovery';
import { commitPath, oneChunk } from '../persistence/publication';
import { copyImmutable, readJson, writeJson } from './streamIO';

interface Frame { reference: RecordReference; child: number; parent: string | null; }
export interface TransplantOptions { transportId?: string; signal?: AbortSignal; onRecord?: (record: RepositoryRecord) => Promise<void>; }

/**
 * DFS frames are disk-backed and one segment is buffered. Translations are persisted as one batch per
 * commit and indexed in memory (hash -> locator), so each record costs no separate file or lookup.
 */
export class RecordTransplant {
  private readonly source: RepositoryBackend;
  private readonly target: RepositoryBackend;
  private readonly descriptor: RepositoryDescriptor;
  private readonly owner: RepositoryOwner;
  private readonly options: TransplantOptions;
  private readonly prefix: string;
  private initialized = false;
  private readonly pendingMappings = new Map<string, { old: RecordReference; reference: RecordReference }>();
  private readonly visiting = new Set<string>();
  private readonly builder = new SegmentBuilder();
  private readonly cache = new Map<string, RecordReference>();
  private readonly durable = new Map<string, RecordReference>();
  private legacyMappingFiles = false;
  private previous: CommitReference | null = null;
  private sequence = 0;
  constructor(source: RepositoryBackend, target: RepositoryBackend, descriptor: RepositoryDescriptor, owner: RepositoryOwner, options: TransplantOptions = {}) {
    this.source = source; this.target = target; this.descriptor = descriptor; this.owner = owner; this.options = options;
    if (options.transportId && !/^[a-zA-Z0-9_-]+$/.test(options.transportId)) throw new RepositoryError('corrupt', 'Invalid transport identity');
    this.prefix = `.masterselects/transport/${options.transportId ?? crypto.randomUUID()}`;
  }
  private async initialize(): Promise<void> {
    if (this.initialized) return;
    const recovery = await recoverRepository(this.target, this.descriptor, this.options.signal);
    this.previous = recovery.head; this.sequence = recovery.operationSequence;
    // Resume: load committed translation batches once; older transports used one file per record.
    let cursor: string | undefined;
    do {
      const page = await this.target.list(`${this.prefix}/mappings/`, cursor, 1024, this.options.signal);
      for (const path of page.paths) {
        const batch = await readJson<Array<[string, RecordReference]>>(this.target, path, 32 * 1024 * 1024, this.options.signal);
        for (const [hash, reference] of batch) this.durable.set(hash, reference);
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    this.legacyMappingFiles = (await this.target.list(`${this.prefix}/references/`, undefined, 1, this.options.signal)).paths.length > 0;
    this.initialized = true;
  }
  private mappingPath(reference: RecordReference): string { return `${this.prefix}/references/${reference.hash.slice(7)}.json`; }
  private async mapped(reference: RecordReference): Promise<RecordReference | null> {
    const value = this.cache.get(reference.hash) ?? this.pendingMappings.get(reference.hash)?.reference ?? this.durable.get(reference.hash); if (value) return value;
    if (!this.legacyMappingFiles) return null;
    const path = this.mappingPath(reference);
    if (!await this.target.stat(path)) return null;
    return readJson<RecordReference>(this.target, path, 4096, this.options.signal);
  }
  private async remember(old: RecordReference, reference: RecordReference): Promise<void> {
    this.pendingMappings.set(old.hash, { old, reference });
    this.cache.set(old.hash, reference);
    if (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value!);
  }
  private async frame(value: Frame): Promise<string> {
    const path = `${this.prefix}/stack/${crypto.randomUUID()}.json`;
    await writeJson(this.target, path, value, this.options.signal); return path;
  }
  async copy(reference: RecordReference): Promise<RecordReference> {
    await this.initialize();
    const existing = await this.mapped(reference); if (existing) return existing;
    let current: string | null = await this.frame({ reference, child: 0, parent: null });
    while (current) {
      await this.owner.assertOwned();
      const frame: Frame = await readJson(this.target, current, 4096, this.options.signal);
      if (await this.mapped(frame.reference)) { current = frame.parent; continue; }
      const record = await readRecord(this.source, frame.reference, this.options.signal);
      if (frame.child < record.references.length) {
        const child = record.references[frame.child];
        const resumed = await this.frame({ ...frame, child: frame.child + 1 });
        if (await this.mapped(child)) current = resumed;
        else {
          if (this.visiting.has(child.hash)) throw new RepositoryError('corrupt', 'Cyclic archive dependency');
          this.visiting.add(child.hash);
          current = await this.frame({ reference: child, child: 0, parent: resumed });
        }
        continue;
      }
      const mappings = new Map<string, RecordReference>();
      for (const child of record.references) {
        const mapped = await this.mapped(child);
        if (!mapped) throw new RepositoryError('corrupt', 'Missing archive dependency translation');
        mappings.set(child.hash, mapped);
      }
      const rewrite = (value: JsonValue): JsonValue => {
        if (Array.isArray(value)) return value.map(rewrite);
        if (value && typeof value === 'object') {
          if (Object.keys(value).length === 4 && typeof value.hash === 'string' && typeof value.segmentId === 'string' && typeof value.offset === 'number' && typeof value.length === 'number') {
            const mapped = mappings.get(value.hash);
            if (!mapped) throw new RepositoryError('corrupt', 'Undeclared archive dependency');
            return mapped as unknown as JsonValue;
          }
          return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item)]));
        }
        return value;
      };
      for (const blob of record.blobs) {
        await verifyBlob(this.source, blob, this.options.signal);
        await copyImmutable(this.source, this.target, blobPath(blob.hash), blob, this.options.signal);
      }
      await this.options.onRecord?.(record);
      const rewritten: RepositoryRecord = { ...record, payload: rewrite(record.payload), references: record.references.map(child => mappings.get(child.hash)!) };
      if (await hashRecord(rewritten) !== frame.reference.hash) throw new RepositoryError('corrupt', 'Archive locator rewriting changed canonical identity');
      const output = await this.builder.add(rewritten);
      await this.remember(frame.reference, output);
      this.visiting.delete(frame.reference.hash);
      await this.flushSealed();
      current = frame.parent;
    }
    return (await this.mapped(reference))!;
  }
  async add(record: RepositoryRecord): Promise<RecordReference> {
    await this.initialize();
    const hash = await hashRecord(record);
    const prior = await this.mapped({ hash, segmentId: '', offset: 0, length: 0 });
    if (prior) return prior;
    const reference = await this.builder.add(record); await this.remember(reference, reference); await this.flushSealed(); return reference;
  }
  private async flushSealed(heads: Record<string, RecordReference> = {}, final = false, checkpoints: RecordReference[] = []): Promise<void> {
    const segments = this.builder.segments.splice(0);
    if (!segments.length && !final) return;
    await this.owner.assertOwned();
    for (const segment of segments) await this.target.writeNew(segmentPath(segment.descriptor.segmentId), oneChunk(segment.bytes), this.options.signal);
    const sequence = ++this.sequence;
    const commit: CommitManifest = {
      format: 'masterselects-commit', schemaVersion: 1, repositoryId: this.descriptor.repositoryId,
      commitId: crypto.randomUUID(), batchId: crypto.randomUUID(), previous: this.previous, writerEpoch: this.owner.writerEpoch,
      firstOperation: sequence, lastOperation: sequence, segments: segments.map(segment => segment.descriptor), heads, checkpoints,
    };
    const bytes = canonicalBytes(commit); const path = commitPath(commit.commitId);
    if (this.target.publishCommit) await this.target.publishCommit(path, bytes, this.previous, this.owner, this.options.signal);
    else await this.target.writeNew(path, oneChunk(bytes), this.options.signal);
    if (await hashBytes(await this.target.read(path, 0, bytes.length, this.options.signal)) !== await hashBytes(bytes)) throw new RepositoryError('corrupt', 'Transplant commit verification failed');
    this.previous = { commitId: commit.commitId, hash: await hashBytes(bytes) };
    const durableSegments = new Set(segments.map(segment => segment.descriptor.segmentId));
    const batch: Array<[string, RecordReference]> = [];
    for (const [hash, mapping] of this.pendingMappings) if (durableSegments.has(mapping.reference.segmentId)) batch.push([hash, mapping.reference]);
    if (batch.length) {
      await writeJson(this.target, `${this.prefix}/mappings/${String(sequence).padStart(10, '0')}-${commit.commitId}.json`, batch, this.options.signal);
      for (const [hash, reference] of batch) { this.durable.set(hash, reference); this.pendingMappings.delete(hash); }
    }
  }
  async finish(heads: Record<string, RecordReference>, checkpoints: RecordReference[] = []): Promise<CommitReference> {
    await this.builder.seal(); await this.flushSealed(heads, true, checkpoints); return this.previous!;
  }
}
