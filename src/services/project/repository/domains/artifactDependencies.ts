import type { BlobReference, EntityDTO, JsonValue, RecordReference } from '../contracts';
export interface DomainArtifactDependency { artifactId: string; path: string; entityKey: string; }
export interface PinnedDomainArtifact { manifest: RecordReference; blobs: BlobReference[]; }
export type DomainArtifactResolver = (artifactId: string) => Promise<PinnedDomainArtifact | null>;

/** Legacy IDs are discovery evidence. Only the artifact owner supplies verified immutable refs. */
export function collectDomainArtifactDependencies(entities: ReadonlyMap<string, EntityDTO>): DomainArtifactDependency[] {
  const result: DomainArtifactDependency[] = [];
  const walk = (entityKey: string, value: JsonValue, path: string) => {
    if (typeof value === 'string' && /^artifact:sha256:[a-f0-9]{64}:manifest:[a-f0-9]{64}$/iu.test(value)) { result.push({ artifactId: value, path, entityKey }); return; }
    if (!value || typeof value !== 'object') return;
    for (const [field, child] of Object.entries(value)) {
      const childPath = `${path}/${field}`;
      if (typeof child === 'string' && child && /^(artifactId|manifestArtifactId|analysisArtifactId|originalArtifactId|waveformPyramidId|spectrogramId|loudnessEnvelopeId|voiceActivityId|beatGridId|onsetMapId|frequencySummaryId|phaseCorrelationId)$/u.test(field)) result.push({ artifactId: child, path: childPath, entityKey });
      walk(entityKey, child, childPath);
    }
  };
  for (const [key, entity] of entities) walk(key, entity.value, '');
  return result;
}
export async function pinDomainArtifactDependencies(entities: ReadonlyMap<string, EntityDTO>, resolve: DomainArtifactResolver): Promise<{ entities: Map<string, EntityDTO>; unresolved: DomainArtifactDependency[] }> {
  const pinned = new Map(entities), unresolved: DomainArtifactDependency[] = [];
  const resolutions = new Map<string, PinnedDomainArtifact | null>();
  for (const dependency of collectDomainArtifactDependencies(entities)) {
    if (!resolutions.has(dependency.artifactId)) resolutions.set(dependency.artifactId, await resolve(dependency.artifactId));
    const artifact = resolutions.get(dependency.artifactId);
    if (!artifact) { unresolved.push(dependency); continue; }
    if (!/^sha256:[a-f0-9]{64}$/u.test(artifact.manifest.hash) || artifact.blobs.some((blob) => !/^sha256:[a-f0-9]{64}$/u.test(blob.hash) || !Number.isSafeInteger(blob.length) || blob.length < 0)) throw new TypeError(`Invalid pinned artifact: ${dependency.artifactId}`);
    const entity = pinned.get(dependency.entityKey)!;
    const references = [...entity.references];
    if (!references.some((ref) => ref.hash === artifact.manifest.hash)) references.push(artifact.manifest);
    const blobs = [...entity.blobs];
    for (const blob of artifact.blobs) if (!blobs.some((ref) => ref.hash === blob.hash)) blobs.push(blob);
    pinned.set(dependency.entityKey, { ...entity, references, blobs });
  }
  return { entities: pinned, unresolved };
}
