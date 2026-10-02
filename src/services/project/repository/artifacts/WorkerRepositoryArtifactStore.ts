import { ArtifactStore } from '../../../../artifacts/ArtifactStore';
import type { ArtifactManifest, ArtifactStorageAdapter, ArtifactStorageLocation } from '../../../../artifacts/types';
import { getManifestHashFromArtifactId } from '../../../../artifacts/ids';
import { isArtifactManifest } from '../../../../artifacts/guards';
import { RepositoryError, type JsonValue, type RecordReference, type RepositoryRecord } from '../contracts';
import type { RepositorySession } from '../RepositorySession';
import type { RepositoryJournalEntry } from '../journal/RepositoryJournalReader';
import { frozenJson } from '../segments/canonical';
import { hashArtifactManifest } from './manifestIdentity';
import { RepositoryArtifactPins } from './RepositoryArtifactPins';
const adapters = new WeakMap<ArtifactStore, WorkerRepositoryArtifactAdapter>();
const stores = new WeakMap<RepositorySession, ArtifactStore>();
function blobReference(manifest: ArtifactManifest) { return { hash: `sha256:${manifest.hash}`, length: manifest.size }; }
interface ManifestEvent { type: 'artifact-manifest'; manifest: ArtifactManifest; manifestReference: RecordReference; }
export class WorkerRepositoryArtifactAdapter implements ArtifactStorageAdapter {
  readonly pins = new RepositoryArtifactPins();
  private readonly cache = new Map<string, ManifestEvent>();
  private readonly session: RepositorySession;
  constructor(session: RepositorySession) {
    this.session = session;}
  createStorageLocation(hash: string): ArtifactStorageLocation {
    return { kind: 'project-cache', projectRelativePath: `.masterselects/artifacts/${hash}.blob` };
  }
  async writeArtifact(manifest: ArtifactManifest, blob: Blob, signal?: AbortSignal): Promise<void> {
    const release = this.pins.pin({ purpose: 'transaction', blobs: [blobReference(manifest)], manifests: [manifest.manifestHash!], records: [] });
    try { await this.session.client.storeBlob(blobReference(manifest), this.chunks(blob, signal), signal); await this.saveArtifactManifest(manifest, signal); }
    finally { release(); }
  }
  private async *chunks(blob: Blob, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
    for (let offset = 0; offset < blob.size; offset += 256 * 1024) { signal?.throwIfAborted(); yield new Uint8Array(await blob.slice(offset, offset + 256 * 1024).arrayBuffer()); }
  }
  async saveArtifactManifest(manifest: ArtifactManifest, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (!getManifestHashFromArtifactId(manifest.artifactId) || await hashArtifactManifest(manifest) !== manifest.manifestHash) throw new RepositoryError('corrupt', 'Invalid immutable manifest identity');
    await this.session.client.verifyBlob(blobReference(manifest), signal);
    const existing = await this.event(manifest.artifactId);
    if (existing) return;
    const references: RecordReference[] = [];
    for (const source of manifest.sourceRefs) if (getManifestHashFromArtifactId(source)) {
      const dependency = await this.manifestRecordReference(source);
      if (!dependency) throw new RepositoryError('corrupt', 'Artifact manifest dependency is missing');
      references.push(dependency);
    }
    const receipt = this.session.coordinator.appendJournal(`artifact-manifest:${manifest.artifactId}`,
      { type: 'artifact-manifest', manifest: frozenJson(manifest) } as unknown as JsonValue,
      { blobs: [blobReference(manifest)], references });
    await this.session.coordinator.flush(receipt);
    const confirmed = await this.event(manifest.artifactId);
    if (!confirmed) throw new RepositoryError('io', 'Artifact manifest publication was not confirmed');
  }
  private async validate(event: unknown, id: string): Promise<ManifestEvent> {
    const value = event as Partial<ManifestEvent> | null;
    if (value?.type !== 'artifact-manifest' || !isArtifactManifest(value.manifest) || !value.manifestReference)
      throw new RepositoryError('corrupt', 'Malformed immutable manifest journal binding');
    const record = await this.session.client.request<RepositoryRecord>({ type: 'record', reference: value.manifestReference });
    const payload = record.payload as unknown as { type?: string; manifest?: ArtifactManifest };
    if (record.kind !== 'metadata' || payload.type !== 'artifact-manifest' || !isArtifactManifest(payload.manifest)) throw new RepositoryError('corrupt', 'Manifest reference points to wrong record type');
    const manifest = payload.manifest;
    if (manifest.artifactId !== id || await hashArtifactManifest(manifest) !== getManifestHashFromArtifactId(id)
      || manifest.manifestHash !== getManifestHashFromArtifactId(id)
      || !record.blobs.some(blob => blob.hash === `sha256:${manifest.hash}` && blob.length === manifest.size))
      throw new RepositoryError('corrupt', 'Immutable manifest dependency or hash mismatch');
    return frozenJson({ type: 'artifact-manifest', manifest, manifestReference: value.manifestReference });
  }
  private async event(id: string): Promise<ManifestEvent | null> {
    const cached = this.cache.get(id); if (cached) return cached;
    const value = await this.session.client.readJournal(`artifact-manifest:${id}`);
    if (value === null) {
      // Current-only archives retain standalone manifest refs while deliberately omitting chat history.
      const checked = new Set<string>();
      for (const entity of this.session.coordinator.getProjection().entities.values()) {
        const pending = [...entity.references];
        while (pending.length) {
          if (pending.length > 4096 || checked.size > 4096) throw new RepositoryError('budget', 'Artifact dependency traversal exceeds reader budget');
          const reference = pending.pop()!;
          if (checked.has(reference.hash)) continue;
          checked.add(reference.hash);
          const record = await this.session.client.request<RepositoryRecord>({ type: 'record', reference });
          const payload = record.payload as unknown as { type?: string; manifest?: ArtifactManifest };
          if (record.kind !== 'metadata' || payload.type !== 'artifact-manifest') continue;
          if (payload.manifest?.artifactId === id) {
            const event = await this.validate({ type: 'artifact-manifest', manifest: payload.manifest, manifestReference: reference }, id);
            this.cache.set(id, event); if (this.cache.size > 256) this.cache.delete(this.cache.keys().next().value!);
            return event;
          }
          pending.push(...record.references);
        }
      }
      return null;
    }
    const event = await this.validate(value, id); this.cache.set(id, event);
    if (this.cache.size > 256) this.cache.delete(this.cache.keys().next().value!);
    return event;
  }
  async manifestRecordReference(id: string): Promise<RecordReference | null> { return (await this.event(id))?.manifestReference ?? null; }
  async getArtifactManifest(id: string): Promise<ArtifactManifest | null> {
    if (!getManifestHashFromArtifactId(id)) return null;
    return (await this.event(id))?.manifest ?? null;
  }
  async readArtifactBlob(manifest: ArtifactManifest): Promise<Blob | null> {
    const stored = await this.getArtifactManifest(manifest.artifactId); if (!stored) return null;
    return this.session.client.readBlob(blobReference(stored), stored.mimeType);
  }
  async *readArtifactStream(manifest: ArtifactManifest, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
    const stored = await this.getArtifactManifest(manifest.artifactId);
    if (!stored) throw new RepositoryError('corrupt', 'Required manifest is missing');
    yield* this.session.client.readBlobStream(blobReference(stored), signal);
  }
  async hasArtifactBlob(manifest: ArtifactManifest): Promise<boolean> {
    try { await this.session.client.verifyBlob(blobReference(manifest)); return true; }
    catch (error) { if (error instanceof RepositoryError && error.code === 'corrupt') return false; throw error; }
  }
  async listArtifactManifestsPage(cursor?: RecordReference | null, limit = 128): Promise<{ manifests: ArtifactManifest[]; nextCursor: RecordReference | null }> {
    const page = await this.session.client.request<{ entries: RepositoryJournalEntry[]; nextCursor: RecordReference | null }>({ type: 'journal-page', cursor, limit });
    const manifests: ArtifactManifest[] = [];
    for (const entry of page.entries) if (entry.id.startsWith('artifact-manifest:')) {
      manifests.push((await this.validate(entry.value, entry.id.slice('artifact-manifest:'.length))).manifest);
    }
    return { manifests, nextCursor: page.nextCursor };
  }
  async listArtifactManifests(): Promise<ArtifactManifest[]> { return this.scan(); }
  async listArtifactManifestsBySource(sourceRef: string): Promise<ArtifactManifest[]> { return this.scan(sourceRef); }
  private async scan(sourceRef?: string): Promise<ArtifactManifest[]> {
    let cursor: RecordReference | null | undefined;
    const found = new Map<string, ArtifactManifest>();
    do {
      const page = await this.listArtifactManifestsPage(cursor);
      for (const manifest of page.manifests) if (!sourceRef || manifest.sourceRefs.includes(sourceRef)) {
        found.set(manifest.artifactId, manifest);
        if (found.size > 512) throw new RepositoryError('budget', 'Use paginated artifact enumeration');
      }
      cursor = page.nextCursor;
    } while (cursor);
    return [...found.values()];
  }
  async deleteArtifactManifest(_id: string): Promise<void> { throw new RepositoryError('ownership', 'Historical artifacts can only be removed by reachability retention'); }
  async deleteArtifactBlob(_manifest: ArtifactManifest): Promise<boolean> { return false; }
}
export function createWorkerRepositoryArtifactStore(session: RepositorySession): ArtifactStore {
  const existing = stores.get(session); if (existing) return existing;
  const adapter = new WorkerRepositoryArtifactAdapter(session); const store = new ArtifactStore(adapter);
  adapters.set(store, adapter); stores.set(session, store); return store;
}
/** Selective exports use this direct standalone manifest dependency, never journal ancestry. */
export async function getWorkerArtifactManifestReference(store: ArtifactStore, id: string): Promise<RecordReference | null> {
  return adapters.get(store)?.manifestRecordReference(id) ?? null;
}
export function getWorkerArtifactPins(store: ArtifactStore): RepositoryArtifactPins | null { return adapters.get(store)?.pins ?? null; }
