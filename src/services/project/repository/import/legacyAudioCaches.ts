import type { ProjectFile } from '../../types/project.types';
import type { MediaFileAudioAnalysisRefs } from '../../../../types/audio';
import { artifactManifestFileName, buildArtifactProjectRelativePath, getHashFromArtifactId, getManifestHashFromArtifactId } from '../../../../artifacts/ids';
import type { JsonValue, RecordReference } from '../contracts';
import type { RecordTransplant } from '../archive/recordTransplant';
import type { LegacySourceBundle } from './legacySource';

/** Waveform bindings are reproducible views of audio, never authored audio or bake dependencies. */
export async function normalizeLegacyAudioCaches(source: LegacySourceBundle, transport: RecordTransplant, signal?: AbortSignal):
Promise<{ project: ProjectFile; evidence: RecordReference | null }> {
  const missing = new Map<string, { reason: string; missingPath: string; bindings: string[] }>();
  const checked = new Set<string>();
  async function unavailable(id: string): Promise<boolean> {
    signal?.throwIfAborted();
    if (checked.has(id)) return missing.has(id);
    checked.add(id);
    const hash = getHashFromArtifactId(id);
    if (!hash) return false; // Unknown/authored identities remain subject to strict import.
    const version = getManifestHashFromArtifactId(id);
    const manifestPath = buildArtifactProjectRelativePath(hash, artifactManifestFileName({ manifestHash: version ?? undefined }));
    const legacyPath = buildArtifactProjectRelativePath(hash, artifactManifestFileName({}));
    const binaryPath = buildArtifactProjectRelativePath(hash);
    const hasManifest = await source.stat(manifestPath) || version && await source.stat(legacyPath);
    const missingPath = !hasManifest ? manifestPath : !await source.stat(binaryPath) ? binaryPath : null;
    if (missingPath) missing.set(id, { reason: hasManifest ? 'bytes-missing' : 'manifest-missing', missingPath, bindings: [] });
    return missingPath !== null;
  }
  async function clean(refs: MediaFileAudioAnalysisRefs | undefined, path: string): Promise<MediaFileAudioAnalysisRefs | undefined> {
    if (!refs) return refs;
    let result = refs;
    for (const field of ['waveformPyramidId', 'processedWaveformPyramidId'] as const) {
      const id = refs[field];
      if (id && await unavailable(id)) {
        if (result === refs) result = { ...refs };
        delete result[field]; missing.get(id)!.bindings.push(`${path}/${field}`);
      }
    }
    return result;
  }
  const project = source.project;
  const media = [] as ProjectFile['media'];
  for (let index = 0; index < project.media.length; index++) {
    const item = project.media[index];
    const refs = await clean(item.audioAnalysisRefs, `/media/${index}/audioAnalysisRefs`);
    media.push(refs === item.audioAnalysisRefs ? item : { ...item, audioAnalysisRefs: refs });
  }
  const compositions = [] as ProjectFile['compositions'];
  for (let i = 0; i < project.compositions.length; i++) {
    const composition = project.compositions[i]; const clips = [] as typeof composition.clips;
    for (let j = 0; j < composition.clips.length; j++) {
      const clip = composition.clips[j], state = clip.audioState;
      if (!state) { clips.push(clip); continue; }
      const base = `/compositions/${i}/clips/${j}/audioState`;
      const sourceAnalysisRefs = await clean(state.sourceAnalysisRefs, base + '/sourceAnalysisRefs');
      const processedAnalysisRefs = await clean(state.processedAnalysisRefs, base + '/processedAnalysisRefs');
      clips.push(sourceAnalysisRefs === state.sourceAnalysisRefs && processedAnalysisRefs === state.processedAnalysisRefs ? clip
        : { ...clip, audioState: { ...state, sourceAnalysisRefs, processedAnalysisRefs } });
    }
    compositions.push(clips.every((clip, index) => clip === composition.clips[index]) ? composition : { ...composition, clips });
  }
  if (!missing.size) return { project, evidence: null };
  const registry = project.audio?.analysisArtifactIds;
  const analysisArtifactIds = registry?.filter((id, index) => {
    const evidence = missing.get(id);
    if (evidence) evidence.bindings.push(`/audio/analysisArtifactIds/${index}`);
    return !evidence;
  });
  let evidence: RecordReference | null = null;
  for (const [artifactId, item] of missing) {
    evidence = await transport.add({ kind: 'metadata', schemaVersion: 1,
      payload: { type: 'legacy-unresolved-audio-cache', status: 'unresolved', classification: 'reproducible-waveform', artifactId,
        sourceId: source.sourceId, sourceVersion: source.sourceVersion, sourcePath: source.provenance.selectedProjectPath,
        ...item, previous: evidence } as unknown as JsonValue, references: evidence ? [evidence] : [], blobs: [] });
  }
  if (source.provenance.conflicts.length < 128) source.provenance.conflicts.push(`${missing.size} unavailable derived waveform caches retained as evidence; bindings cleared for regeneration`);
  return { project: { ...project, media, compositions, ...(project.audio ? { audio: { ...project.audio, analysisArtifactIds } } : {}) }, evidence };
}
