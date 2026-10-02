import type { ArtifactManifest } from '../../../../artifacts/types';
import { isArtifactManifest } from '../../../../artifacts/guards';
import { buildArtifactProjectRelativePath, buildVersionedArtifactId, getHashFromArtifactId, getManifestHashFromArtifactId, artifactManifestFileName } from '../../../../artifacts/ids';
import { hashArtifactManifest } from '../artifacts/manifestIdentity';
import { collectDomainArtifactDependencies } from '../domains/artifactDependencies';
import type { EntityDTO, JsonValue, RecordReference, RepositoryBackend, RepositoryOwner } from '../contracts';
import { RepositoryError } from '../contracts';
import { blobPath, storeBlob } from '../persistence/blobStorage';
import type { LegacySourceBundle } from './legacySource';
import type { RecordTransplant } from '../archive/recordTransplant';

export interface LegacyArtifactImportContext {
  /** Archived sidecar/journal values are evidence, not active runtime artifact requirements. */
  evidenceOnly: boolean;
  sourcePath: string;
}
type ImportedArtifact = { manifest: ArtifactManifest | null; reference: RecordReference };

/** Source-bound immutable manifest conversion; no origin-global mutable manifest lookup. */
export async function importLegacyArtifactDependencies(source: LegacySourceBundle, target: RepositoryBackend, owner: RepositoryOwner,
  transport: RecordTransplant, entities: Map<string, EntityDTO>, signal?: AbortSignal, context?: LegacyArtifactImportContext): Promise<void> {
  const converted = new Map<string, ImportedArtifact>();
  const active = new Set<string>();
  const unavailable = async (id: string, path: string, reason: 'manifest-missing' | 'bytes-missing' | 'identity-unsupported' | 'manifest-invalid' | 'version-unproven'): Promise<ImportedArtifact> => {
    if (!context?.evidenceOnly) {
      source.provenance.missingRequired.push(path);
      throw new RepositoryError('corrupt', `Required source-bound artifact ${reason === 'manifest-missing' ? 'manifest' : 'bytes'} missing: ${path}`);
    }
    const reference = await transport.add({ kind: 'metadata', schemaVersion: 1,
      payload: { type: 'legacy-unresolved-artifact', status: 'unresolved', classification: 'archived-evidence', artifactId: id,
        sourceId: source.sourceId, sourceVersion: source.sourceVersion, sourcePath: context.sourcePath, missingPath: path, reason }, references: [], blobs: [] });
    const result: ImportedArtifact = { manifest: null, reference }; converted.set(id, result);
    const warning = `Archived artifact unavailable (${reason}): ${context.sourcePath} -> ${id}`;
    if (source.provenance.conflicts.length < 128 && !source.provenance.conflicts.includes(warning)) source.provenance.conflicts.push(warning);
    return result;
  };
  async function ingest(id: string): Promise<ImportedArtifact> {
    const ready = converted.get(id); if (ready) return ready;
    if (active.has(id)) throw new RepositoryError('corrupt', 'Cyclic legacy artifact source dependency');
    active.add(id);
    try {
      const hash = getHashFromArtifactId(id);
      if (!hash) {
        if (context?.evidenceOnly) return unavailable(id, context.sourcePath, 'identity-unsupported');
        throw new RepositoryError('unsupported', `Legacy artifact identity is unsupported: ${id}`);
      }
      const expectedManifestHash = getManifestHashFromArtifactId(id);
      const expectedPath = buildArtifactProjectRelativePath(hash, artifactManifestFileName({ manifestHash: expectedManifestHash ?? undefined }));
      let path = expectedPath;
      if (!await source.stat(path)) {
        // A mutable filename is compatibility evidence only; its semantic identity must still match.
        const legacyPath = buildArtifactProjectRelativePath(hash, artifactManifestFileName({}));
        if (expectedManifestHash && await source.stat(legacyPath)) path = legacyPath;
        else return unavailable(id, expectedPath, 'manifest-missing');
      }
      const raw = await source.readJson<unknown>(path, 1024 * 1024);
      if (!isArtifactManifest(raw) || raw.hash !== hash) {
        if (context?.evidenceOnly) return unavailable(id, path, 'manifest-invalid');
        throw new RepositoryError('corrupt', 'Legacy artifact identity disagrees with manifest');
      }
      if (path !== expectedPath) {
        if (await hashArtifactManifest(raw) !== expectedManifestHash) {
          if (context?.evidenceOnly) return unavailable(id, path, 'version-unproven');
          throw new RepositoryError('corrupt', 'Mutable legacy manifest cannot prove requested artifact version');
        }
      } else if (raw.artifactId !== id) {
        if (context?.evidenceOnly) return unavailable(id, path, 'version-unproven');
        throw new RepositoryError('corrupt', 'Legacy artifact identity disagrees with manifest');
      }
      const references: RecordReference[] = []; const sourceRefs: string[] = [];
      for (const ref of raw.sourceRefs) {
        const refHash = getHashFromArtifactId(ref);
        const manifestPath = refHash ? buildArtifactProjectRelativePath(refHash, artifactManifestFileName({ manifestHash: getManifestHashFromArtifactId(ref) ?? undefined })) : null;
        if (getManifestHashFromArtifactId(ref) || manifestPath && await source.stat(manifestPath)) { const dependency = await ingest(ref); references.push(dependency.reference); sourceRefs.push(dependency.manifest?.artifactId ?? ref); }
        else sourceRefs.push(ref);
      }
      const binaryPath = buildArtifactProjectRelativePath(hash);
      if (!await source.stat(binaryPath)) return unavailable(id, binaryPath, 'bytes-missing');
      await storeBlob(target, owner, { hash: 'sha256:' + raw.hash, length: raw.size }, source.readChunks(binaryPath), signal);
      let manifest: ArtifactManifest = { ...raw, sourceRefs, blobId: 'sha256:' + raw.hash, retention: raw.retention ?? 'required',
        storage: { kind: 'project-cache', projectRelativePath: blobPath('sha256:' + raw.hash) } };
      const manifestHash = await hashArtifactManifest(manifest);
      manifest = { ...manifest, manifestHash, artifactId: buildVersionedArtifactId(raw.hash, manifestHash) };
      const reference = await transport.add({ kind: 'metadata', schemaVersion: 1,
        payload: { type: 'artifact-manifest', manifest } as unknown as JsonValue, references, blobs: [{ hash: 'sha256:' + raw.hash, length: raw.size }] });
      const result = { manifest, reference }; converted.set(id, result); return result;
    } finally { active.delete(id); }
  }
  const dependencies = collectDomainArtifactDependencies(entities);
  for (const dependency of dependencies) await ingest(dependency.artifactId);
  const rewrite = (value: JsonValue): JsonValue => {
    if (typeof value === 'string') return converted.get(value)?.manifest?.artifactId ?? value;
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(rewrite);
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewrite(child)]));
  };
  for (const [key, entity] of entities) {
    const owned = dependencies.filter(dependency => dependency.entityKey === key).map(dependency => converted.get(dependency.artifactId)!);
    entities.set(key, { ...entity, value: rewrite(entity.value), references: [...entity.references, ...owned.map(item => item.reference)],
      blobs: [...entity.blobs, ...owned.flatMap(item => item.manifest ? [{ hash: 'sha256:' + item.manifest.hash, length: item.manifest.size }] : [])] });
  }
}
