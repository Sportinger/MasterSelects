import { RepositoryError, type RepositoryRecord, type RecordReference } from '../contracts';
import { RepositoryPersistence } from '../persistence/RepositoryPersistence';
import { recoverRepository } from '../persistence/recovery';
import { readRecord, segmentRecords } from '../segments/recordSegment';
import { getHashFromArtifactId, getManifestHashFromArtifactId } from '../../../../artifacts/ids';
import { RepositoryArtifactPins } from '../artifacts/RepositoryArtifactPins';
/** Fixed memory conservative membership: collisions retain extra files, never delete live ones. */
class RetainedHashes {
  private readonly bytes = new Uint8Array(512 * 1024);
  private positions(value: string): number[] {
    let a = 2166136261, b = 5381;
    for (let i = 0; i < value.length; i++) { a = Math.imul(a ^ value.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ value.charCodeAt(i); }
    return [a >>> 0, b >>> 0, (a ^ Math.imul(b, 17)) >>> 0].map(hash => hash % (this.bytes.length * 8));
  }
  add(value: string) { for (const bit of this.positions(value)) this.bytes[bit >>> 3] |= 1 << (bit & 7); }
  has(value: string) { return this.positions(value).every(bit => Boolean(this.bytes[bit >>> 3] & (1 << (bit & 7)))); }
}
export interface ArtifactRetentionOptions {
  pins: RepositoryArtifactPins;
  /** Domain registry must conservatively reject unknown extensions/references. */
  canInterpret(record: RepositoryRecord): boolean;
  /** Held mutation/publication barrier, including workspace/job updates. */
  assertStable(): void | Promise<void>;
  workspaceRoots?: readonly RecordReference[];
  signal?: AbortSignal;
}
/** Published segments are never rewritten or removed. Every historical/journal record remains a root. */
export async function collectUnpublishedArtifacts(persistence: RepositoryPersistence, options: ArtifactRetentionOptions): Promise<{ examined: number; removed: number }> {
  const { backend, descriptor, owner } = persistence; const retained = new RetainedHashes();
  const snapshot = options.pins.snapshot(); let examined = 0, removed = 0;
  async function stable() { options.signal?.throwIfAborted(); options.pins.assertGeneration(snapshot.generation); await owner.assertOwned(); await options.assertStable(); }
  function markRecord(record: RepositoryRecord) {
    if (!options.canInterpret(record)) throw new RepositoryError('unsupported', 'Unknown extension blocks artifact deletion');
    for (const blob of record.blobs) retained.add(blob.hash);
    const stack: unknown[] = [record.payload];
    while (stack.length) {
      const value = stack.pop();
      if (typeof value === 'string') {
        const manifest = getManifestHashFromArtifactId(value); if (manifest) { retained.add(manifest); const blob = getHashFromArtifactId(value); if (blob) retained.add(`sha256:${blob}`); }
      } else if (Array.isArray(value)) { for (const item of value) stack.push(item); }
      else if (value && typeof value === 'object') { const object = value as Record<string, unknown>; if (typeof object.manifestHash === 'string') retained.add(object.manifestHash); for (const item of Object.values(object)) stack.push(item); }
    }
  }
  await stable();
  const recovered = await recoverRepository(backend, descriptor, options.signal, async commit => {
    for (const segment of commit.segments) for await (const entry of segmentRecords(backend, segment, options.signal)) markRecord(entry.record);
  });
  if (recovered.warnings.length) throw new RepositoryError('corrupt', 'Incomplete or damaged publications block artifact cleanup');
  const roots = [...(options.workspaceRoots ?? [])];
  for (const pin of snapshot.pins) { pin.blobs.forEach(blob => retained.add(blob.hash)); pin.manifests.forEach(hash => retained.add(hash)); roots.push(...pin.records); }
  // Unpublished pins may have transitive dependencies absent from confirmed segments.
  for (const root of roots) {
    const stack: Array<{ reference: RecordReference; depth: number }> = [{ reference: root, depth: 0 }]; let visited = 0;
    while (stack.length) {
      const item = stack.pop()!;
      if (item.depth > 128 || stack.length > 4096 || ++visited > 100000) throw new RepositoryError('budget', 'Pinned dependency traversal exceeds safe retention budget');
      const record = await readRecord(backend, item.reference, options.signal); markRecord(record);
      for (const reference of record.references) stack.push({ reference, depth: item.depth + 1 });
    }
  }
  for (const prefix of ['.masterselects/artifacts/', '.masterselects/artifact-manifests/']) {
    let cursor: string | undefined;
    do {
      const page = await backend.list(prefix, cursor, 128, options.signal);
      for (const path of page.paths) {
        examined++;
        const match = /(?:manifest\.)?([a-f0-9]{64})\.(?:blob|json)$/.exec(path); if (!match || retained.has(`sha256:${match[1]}`)) continue;
        await stable(); await backend.removeUnpublished(path); removed++;
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
  return { examined, removed };
}
