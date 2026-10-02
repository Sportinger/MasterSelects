import type { ArtifactManifest, ArtifactStorageAdapter, ArtifactStorageLocation } from '../../../../artifacts/types';
import { getManifestHashFromArtifactId, buildArtifactId, buildVersionedArtifactId } from '../../../../artifacts/ids';
import { isArtifactManifest } from '../../../../artifacts/guards';
import { RepositoryError, type BlobReference, type RecordReference, type RepositoryRecord } from '../contracts';
import { RepositoryPersistence } from '../persistence/RepositoryPersistence';
import { blobPath, verifyBlob } from '../persistence/blobStorage';
import { canonicalBytes, frozenJson, parseJson } from '../segments/canonical';
import { RepositoryArtifactPins } from './RepositoryArtifactPins';
import { hashArtifactManifest } from './manifestIdentity';
export function repositoryManifestPath(hash: string): string {
  if (!/^sha256:[a-f0-9]{64}$/.test(hash)) throw new RepositoryError('corrupt', 'Invalid artifact manifest identity');
  return `.masterselects/artifact-manifests/manifest.${hash.slice(7)}.json`;
}
export interface RepositoryArtifactOptions {
  pins: RepositoryArtifactPins;
  /** The session coordinator allocates the operation; adapters never invent sequence numbers. */
  publishManifest(id: string, record: RepositoryRecord, signal?: AbortSignal): Promise<RecordReference>;
  resolveManifestRecord(id: string): Promise<RecordReference | null>;
  /** Explicit source-bound import alias; never choose a newer variant by blob hash. */
  resolveLegacyManifestId?(id: string): Promise<string | null>;
  /** Native/FSA may provide a file-backed Blob without collecting its ranges in JS. */
  readBlob?(path: string, mimeType: string): Promise<Blob | null>;
}
export class RepositoryArtifactStorageAdapter implements ArtifactStorageAdapter {
  private readonly cache = new Map<string, ArtifactManifest>();
  readonly persistence: RepositoryPersistence;
  private readonly options: RepositoryArtifactOptions;
  constructor(persistence: RepositoryPersistence, options: RepositoryArtifactOptions) {
    this.persistence = persistence; this.options = options;}
  private key(id: string) { return `${this.persistence.descriptor.repositoryId}:${this.persistence.backend.locationId}:${id}`; }
  private remember(manifest: ArtifactManifest) {
    this.cache.set(this.key(manifest.artifactId), frozenJson(manifest));
    if (this.cache.size > 256) this.cache.delete(this.cache.keys().next().value!);
  }
  createStorageLocation(hash: string): ArtifactStorageLocation {
    return { kind: 'project-cache', projectRelativePath: blobPath(`sha256:${hash}`), manifestProjectRelativePath: '.masterselects/artifact-manifests/manifest.json' };
  }
  async writeArtifact(manifest: ArtifactManifest, blob: Blob, signal?: AbortSignal): Promise<void> {
    const release = this.options.pins.pin({ purpose: 'transaction', blobs: [{ hash: `sha256:${manifest.hash}`, length: manifest.size }], manifests: manifest.manifestHash ? [manifest.manifestHash] : [], records: [] });
    try {
      await this.persistence.storeBlob({ hash: `sha256:${manifest.hash}`, length: manifest.size }, this.blobChunks(blob, signal), signal);
      await this.saveArtifactManifest(manifest, signal);
    } finally { release(); }
  }
  private async *blobChunks(blob: Blob, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
    for (let offset = 0; offset < blob.size; offset += 256 * 1024) { signal?.throwIfAborted(); yield new Uint8Array(await blob.slice(offset, offset + 256 * 1024).arrayBuffer()); }
  }
  async saveArtifactManifest(manifest: ArtifactManifest, signal?: AbortSignal): Promise<void> {
    const release = this.options.pins.pin({ purpose: 'transaction', blobs: [{ hash: `sha256:${manifest.hash}`, length: manifest.size }], manifests: manifest.manifestHash ? [manifest.manifestHash] : [], records: [] });
    try { await this.savePinnedManifest(manifest, signal); } finally { release(); }
  }
  private async savePinnedManifest(manifest: ArtifactManifest, signal?: AbortSignal): Promise<void> {
    if (!manifest.manifestHash || getManifestHashFromArtifactId(manifest.artifactId) !== manifest.manifestHash || await hashArtifactManifest(manifest) !== manifest.manifestHash) throw new RepositoryError('corrupt', 'Unversioned or mismatched artifact manifest');
    const reference: BlobReference = { hash: `sha256:${manifest.hash}`, length: manifest.size };
    await verifyBlob(this.persistence.backend, reference, signal);
    const path = repositoryManifestPath(manifest.manifestHash); const bytes = canonicalBytes(manifest);
    if (bytes.length > 1024 * 1024) throw new RepositoryError('budget', 'Artifact manifest must be split at domain boundaries');
    const existing = await this.persistence.backend.stat(path);
    if (existing) {
      const previous = parseJson<ArtifactManifest>(await this.persistence.backend.read(path, 0, undefined, signal));
      if (await hashArtifactManifest(previous) !== manifest.manifestHash) throw new RepositoryError('corrupt', 'Immutable artifact manifest collision');
    } else await this.persistence.backend.writeNew(path, (async function* () { yield bytes; })(), signal);
    await this.options.publishManifest(manifest.artifactId, { kind: 'metadata', schemaVersion: 1, payload: JSON.parse(new TextDecoder().decode(canonicalBytes({ type: 'artifact-manifest', manifest }))), references: [], blobs: [reference] }, signal);
    this.remember(manifest);
  }
  async importLegacyManifest(legacy: ArtifactManifest, blob: Blob, signal?: AbortSignal): Promise<ArtifactManifest> {
    let manifest: ArtifactManifest = { ...legacy, blobId: buildArtifactId(legacy.hash), retention: legacy.retention ?? 'required', storage: this.createStorageLocation(legacy.hash) };
    const manifestHash = await hashArtifactManifest(manifest);
    manifest = frozenJson({ ...manifest, manifestHash, artifactId: buildVersionedArtifactId(legacy.hash, manifestHash), storage: { ...manifest.storage, manifestProjectRelativePath: repositoryManifestPath(manifestHash) } });
    await this.writeArtifact(manifest, blob, signal); return manifest;
  }
  async getArtifactManifest(id: string): Promise<ArtifactManifest | null> {
    if (!getManifestHashFromArtifactId(id) && this.options.resolveLegacyManifestId) {
      const version = await this.options.resolveLegacyManifestId(id); if (!version || version === id) return null; id = version;
    }
    const manifestHash = getManifestHashFromArtifactId(id); if (!manifestHash) return null;
    const reference = await this.options.resolveManifestRecord(id); if (!reference) return null;
    const cached = this.cache.get(this.key(id)); if (cached) return cached;
    const record = await this.persistence.readRecord(reference);
    const payload = record.payload as unknown as { type: string; manifest: unknown };
    if (record.kind !== 'metadata' || payload.type !== 'artifact-manifest' || !isArtifactManifest(payload.manifest)) throw new RepositoryError('corrupt', 'Artifact record has wrong type');
    const manifest = payload.manifest;
    if (manifest.artifactId !== id || manifest.manifestHash !== manifestHash || await hashArtifactManifest(manifest) !== manifestHash) throw new RepositoryError('corrupt', 'Artifact manifest hash mismatch');
    if (!record.blobs.some(blob => blob.hash === `sha256:${manifest.hash}` && blob.length === manifest.size)) throw new RepositoryError('corrupt', 'Artifact blob missing from transitive references');
    this.remember(manifest); return this.cache.get(this.key(id))!;
  }
  async *readArtifactStream(manifest: ArtifactManifest, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
    const stored = await this.getArtifactManifest(manifest.artifactId); if (!stored) throw new RepositoryError('corrupt', 'Artifact manifest is not confirmed');
    await verifyBlob(this.persistence.backend, { hash: `sha256:${stored.hash}`, length: stored.size }, signal);
    for (let offset = 0; offset < stored.size; offset += 256 * 1024) yield await this.persistence.backend.read(blobPath(`sha256:${stored.hash}`), offset, Math.min(256 * 1024, stored.size - offset), signal);
  }
  async readArtifactBlob(manifest: ArtifactManifest): Promise<Blob | null> {
    const stored = await this.getArtifactManifest(manifest.artifactId); if (!stored) return null;
    const readBlob = this.options.readBlob ?? (this.persistence.backend.readBlob ? (path: string, _mime: string) => this.persistence.backend.readBlob!(path) : undefined);
    if (readBlob) {
      await verifyBlob(this.persistence.backend, { hash: `sha256:${stored.hash}`, length: stored.size });
      return (await readBlob(blobPath(`sha256:${stored.hash}`), stored.mimeType))?.slice(0, stored.size, stored.mimeType) ?? null;
    }
    if (stored.size > 32 * 1024 * 1024) throw new RepositoryError('budget', 'Large artifact requires file-backed Blob access or readArtifactStream');
    const parts: BlobPart[] = []; for await (const chunk of this.readArtifactStream(stored)) parts.push(chunk.slice().buffer as ArrayBuffer);
    return new Blob(parts, { type: stored.mimeType });
  }
  async hasArtifactBlob(manifest: ArtifactManifest): Promise<boolean> { try { await verifyBlob(this.persistence.backend, { hash: `sha256:${manifest.hash}`, length: manifest.size }); return true; } catch { return false; } }
  async listArtifactManifestsPage(cursor?: string, limit = 128) {
    const page = await this.persistence.backend.list('.masterselects/artifact-manifests/', cursor, limit);
    const manifests: ArtifactManifest[] = [];
    for (const path of page.paths) {
      const data = parseJson<ArtifactManifest>(await this.persistence.backend.read(path));
      if (!isArtifactManifest(data)) throw new RepositoryError('corrupt', 'Malformed artifact manifest');
      const confirmed = await this.getArtifactManifest(data.artifactId); if (confirmed) manifests.push(confirmed);
    }
    return { manifests, nextCursor: page.nextCursor };
  }
  async listArtifactManifests(): Promise<ArtifactManifest[]> {
    const first = await this.listArtifactManifestsPage(undefined, 256);
    if (first.nextCursor) throw new RepositoryError('budget', 'Use paginated repository artifact listing');
    return first.manifests;
  }
  async listArtifactManifestsBySource(sourceRef: string): Promise<ArtifactManifest[]> { return (await this.listArtifactManifests()).filter(manifest => manifest.sourceRefs.includes(sourceRef)); }
  async deleteArtifactManifest(_id: string): Promise<void> { throw new RepositoryError('ownership', 'Artifact retention requires a repository reachability sweep'); }
  async deleteArtifactBlob(_manifest: ArtifactManifest): Promise<boolean> { return false; }
}
