import type {
  AudioAnalysisArtifact as ProjectAudioAnalysisArtifact,
  AudioAnalysisWarning as ProjectAudioAnalysisWarning,
  AudioDerivedAssetRef,
  AudioSignalArtifactRef,
  ClipAudioState,
  MasterAudioState,
  MediaFileAudioAnalysisRefs,
  ProjectAudioState,
} from '../../types/audio';
import type {
  AudioAnalysisArtifact as RuntimeAudioAnalysisArtifact,
  AudioAnalysisWarning as RuntimeAudioAnalysisWarning,
  AudioArtifactRef as RuntimeAudioArtifactRef,
} from './audioArtifactTypes';
import type { AudioArtifactStore } from './AudioArtifactStore';

type AudioRefsLike = MediaFileAudioAnalysisRefs | Record<string, unknown> | null | undefined;

interface ProjectAudioIndexClip {
  audioState?: ClipAudioState;
  nestedClips?: ProjectAudioIndexClip[];
}

interface ProjectAudioIndexComposition {
  id?: string;
  clips?: ProjectAudioIndexClip[];
  timelineData?: {
    clips?: ProjectAudioIndexClip[];
    masterAudioState?: MasterAudioState;
  };
  masterAudioState?: MasterAudioState;
}

interface ProjectAudioIndexMedia {
  audioAnalysisRefs?: MediaFileAudioAnalysisRefs;
}

export interface BuildProjectAudioStateIndexInput {
  media: ProjectAudioIndexMedia[];
  compositions: ProjectAudioIndexComposition[];
  activeCompositionId?: string | null;
  artifactStore?: Pick<AudioArtifactStore, 'getAnalysisArtifact'>;
  now?: () => string;
}

const LEGACY_REF_FIELDS = [
  'waveformPyramidId',
  'processedWaveformPyramidId',
  'spectrogramTileSetIds',
  'loudnessEnvelopeId',
  'beatGridId',
  'onsetMapId',
  'phaseCorrelationId',
  'transcriptTimingId',
  'frequencySummaryId',
] as const satisfies readonly (keyof MediaFileAudioAnalysisRefs)[];

const VERSIONED_REF_FIELDS = [
  'waveformPyramid',
  'processedWaveformPyramid',
  'spectrogramTileSets',
  'loudnessEnvelope',
  'beatGrid',
  'onsetMap',
  'phaseCorrelation',
  'transcriptTiming',
  'frequencySummary',
] as const;

function addArtifactId(ids: Set<string>, value: unknown): void {
  if (typeof value === 'string' && value.length > 0) {
    ids.add(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      addArtifactId(ids, item);
    }
    return;
  }

  if (value && typeof value === 'object') {
    const artifactId = (value as { artifactId?: unknown }).artifactId;
    if (typeof artifactId === 'string' && artifactId.length > 0) {
      ids.add(artifactId);
    }
  }
}

export function collectAudioAnalysisArtifactIdsFromRefs(refs: AudioRefsLike): string[] {
  if (!refs || typeof refs !== 'object') {
    return [];
  }

  const ids = new Set<string>();
  const refsRecord = refs as Record<string, unknown>;

  for (const field of LEGACY_REF_FIELDS) {
    addArtifactId(ids, refsRecord[field]);
  }

  for (const field of VERSIONED_REF_FIELDS) {
    addArtifactId(ids, refsRecord[field]);
  }

  return [...ids];
}

function collectClipAudioAnalysisRefIds(clip: ProjectAudioIndexClip, ids: Set<string>): void {
  for (const refId of collectAudioAnalysisArtifactIdsFromRefs(clip.audioState?.sourceAnalysisRefs)) {
    ids.add(refId);
  }
  for (const refId of collectAudioAnalysisArtifactIdsFromRefs(clip.audioState?.processedAnalysisRefs)) {
    ids.add(refId);
  }
  for (const nestedClip of clip.nestedClips ?? []) {
    collectClipAudioAnalysisRefIds(nestedClip, ids);
  }
}

export function collectProjectAudioAnalysisRefIds(input: Pick<BuildProjectAudioStateIndexInput, 'media' | 'compositions'>): string[] {
  const ids = new Set<string>();

  for (const item of input.media) {
    for (const refId of collectAudioAnalysisArtifactIdsFromRefs(item.audioAnalysisRefs)) {
      ids.add(refId);
    }
  }

  for (const composition of input.compositions) {
    for (const clip of composition.clips ?? composition.timelineData?.clips ?? []) {
      collectClipAudioAnalysisRefIds(clip, ids);
    }
  }

  return [...ids];
}

function collectDerivedAssetsFromClip(clip: ProjectAudioIndexClip, assetsById: Map<string, AudioDerivedAssetRef>): void {
  for (const asset of clip.audioState?.bakeHistory ?? []) {
    assetsById.set(asset.id, structuredClone(asset));
  }
  for (const nestedClip of clip.nestedClips ?? []) {
    collectDerivedAssetsFromClip(nestedClip, assetsById);
  }
}

function collectDerivedAssets(compositions: ProjectAudioIndexComposition[]): AudioDerivedAssetRef[] {
  const assetsById = new Map<string, AudioDerivedAssetRef>();
  for (const composition of compositions) {
    for (const clip of composition.clips ?? composition.timelineData?.clips ?? []) {
      collectDerivedAssetsFromClip(clip, assetsById);
    }
  }
  return [...assetsById.values()];
}

function getCompositionMasterAudioState(
  composition: ProjectAudioIndexComposition,
): MasterAudioState | undefined {
  return composition.masterAudioState ?? composition.timelineData?.masterAudioState;
}

function findProjectMasterAudioState(
  compositions: ProjectAudioIndexComposition[],
  activeCompositionId: string | null | undefined,
): MasterAudioState | undefined {
  const active = activeCompositionId
    ? compositions.find((composition) => composition.id === activeCompositionId)
    : undefined;
  const activeMaster = active ? getCompositionMasterAudioState(active) : undefined;
  if (activeMaster) {
    return structuredClone(activeMaster);
  }

  const firstMaster = compositions
    .map(getCompositionMasterAudioState)
    .find((state): state is MasterAudioState => Boolean(state));
  return firstMaster ? structuredClone(firstMaster) : undefined;
}

function cloneAudioArtifactRef(ref: RuntimeAudioArtifactRef): AudioSignalArtifactRef {
  const maybeByteRange = (ref as RuntimeAudioArtifactRef & { byteRange?: AudioSignalArtifactRef['byteRange'] }).byteRange;
  return {
    artifactId: ref.artifactId,
    hash: ref.hash,
    size: ref.size,
    mimeType: ref.mimeType,
    encoding: ref.encoding,
    storage: structuredClone(ref.storage),
    createdAt: ref.createdAt,
    ...(maybeByteRange ? { byteRange: structuredClone(maybeByteRange) } : {}),
    ...(ref.metadata ? { metadata: structuredClone(ref.metadata) } : {}),
  };
}

function cloneAudioWarning(warning: RuntimeAudioAnalysisWarning): ProjectAudioAnalysisWarning {
  return {
    code: warning.code,
    message: warning.message,
    severity: 'warning',
    ...(warning.details ? { details: structuredClone(warning.details) } : {}),
  };
}

function toProjectAudioAnalysisArtifact(
  artifact: RuntimeAudioAnalysisArtifact,
): ProjectAudioAnalysisArtifact {
  return {
    schemaVersion: artifact.schemaVersion,
    id: artifact.id,
    kind: artifact.kind,
    mediaFileId: artifact.mediaFileId,
    sourceFingerprint: artifact.sourceFingerprint,
    clipAudioStateHash: artifact.clipAudioStateHash,
    decoderId: artifact.decoderId,
    decoderVersion: artifact.decoderVersion,
    analyzerVersion: artifact.analyzerVersion,
    sampleRate: artifact.sampleRate,
    channelLayout: structuredClone(artifact.channelLayout),
    duration: artifact.duration,
    payloadRefs: artifact.payloadRefs.map(cloneAudioArtifactRef),
    manifestRef: cloneAudioArtifactRef(artifact.manifestRef),
    createdAt: artifact.createdAt,
    stale: artifact.stale,
    ...(artifact.warnings?.length ? { warnings: artifact.warnings.map(cloneAudioWarning) } : {}),
    ...(artifact.metadata ? { metadata: structuredClone(artifact.metadata) } : {}),
  };
}

async function resolveAudioAnalysisArtifacts(
  artifactIds: string[],
  artifactStore: Pick<AudioArtifactStore, 'getAnalysisArtifact'> | undefined,
): Promise<ProjectAudioAnalysisArtifact[]> {
  if (!artifactStore || artifactIds.length === 0) {
    return [];
  }

  const artifactsById = new Map<string, ProjectAudioAnalysisArtifact>();
  for (const artifactId of artifactIds) {
    try {
      const artifact = await artifactStore.getAnalysisArtifact(artifactId);
      if (artifact) {
        artifactsById.set(artifact.id, toProjectAudioAnalysisArtifact(artifact));
      }
    } catch {
      // Missing cache manifests are recoverable; the project still stores the ref ids.
    }
  }
  return [...artifactsById.values()];
}

export async function buildProjectAudioStateIndex(
  input: BuildProjectAudioStateIndexInput,
): Promise<ProjectAudioState | undefined> {
  const analysisArtifactIds = collectProjectAudioAnalysisRefIds(input);
  const analysisArtifacts = await resolveAudioAnalysisArtifacts(analysisArtifactIds, input.artifactStore);
  const derivedAssets = collectDerivedAssets(input.compositions);
  const masterAudioState = findProjectMasterAudioState(input.compositions, input.activeCompositionId);

  if (
    analysisArtifactIds.length === 0
    && analysisArtifacts.length === 0
    && derivedAssets.length === 0
    && !masterAudioState
  ) {
    return undefined;
  }

  return {
    schemaVersion: 1,
    ...(analysisArtifactIds.length > 0 ? { analysisArtifactIds } : {}),
    ...(analysisArtifacts.length > 0 ? { analysisArtifacts } : {}),
    ...(derivedAssets.length > 0 ? { derivedAssets } : {}),
    ...(masterAudioState ? { masterAudioState } : {}),
    updatedAt: input.now?.() ?? new Date().toISOString(),
  };
}
