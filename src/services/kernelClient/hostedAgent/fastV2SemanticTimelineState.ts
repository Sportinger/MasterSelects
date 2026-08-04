import type { StoryboardProjectState } from '../../storyboard/contracts';
import type {
  CompositionTimelineData,
  TimelineClip,
} from '../../../types/timeline';
import type { MediaSourceArtifactProjection } from '../../mediaArtifacts/mediaSourceArtifacts';
import type {
  HostedAgentFastV2MediaOrientation,
  HostedAgentFastV2ProjectContextV2,
} from './fastV2ProjectContext';

const OMITTED_BINARY_FIELDS = new Set([
  'thumbnails',
  'waveform',
  'waveformChannels',
]);

export interface HostedAgentFastV2ActiveCompositionState {
  aspectLabel: string;
  aspectRatio: number;
  backgroundColor: string;
  camera?: unknown;
  captionComp?: unknown;
  duration: number;
  frameRate: number;
  height: number;
  id: string;
  name: string;
  orientation: HostedAgentFastV2MediaOrientation;
  transitionComp?: unknown;
  width: number;
}

export interface HostedAgentFastV2SemanticTimelineStateInput {
  activeComposition: HostedAgentFastV2ActiveCompositionState | null;
  activeMaskId: string | null;
  layers: readonly unknown[];
  primarySelectedClipId: string | null;
  projectContext: HostedAgentFastV2ProjectContextV2;
  propertiesSelection: unknown;
  runtimeClips: readonly TimelineClip[];
  selectedClipIds: readonly string[];
  selectedKeyframeIds: readonly string[];
  selectedLayerId: string | null;
  selectedVertexIds: readonly string[];
  serializedTimeline: CompositionTimelineData;
  sourceArtifactsByMediaFileId?: ReadonlyMap<string, MediaSourceArtifactProjection>;
  storyboard: StoryboardProjectState;
  timelineRangeSelection: unknown;
  timelineRevision: number;
  transcriptsByClipId: ReadonlyMap<string, TimelineClip['transcript']>;
}

type MutableSourceArtifacts = MediaSourceArtifactProjection & {
  transcriptProgress?: number;
};

interface SourceIntelligenceAccumulator {
  artifacts: MutableSourceArtifacts;
  clipIds: Set<string>;
  id: string;
  kind: 'clip' | 'media';
  mediaFileId?: string;
}

function mediaFileIdForClip(
  serializedClip: CompositionTimelineData['clips'][number],
  runtimeClip: TimelineClip | undefined,
): string | undefined {
  const id = serializedClip.mediaFileId
    || runtimeClip?.source?.mediaFileId
    || runtimeClip?.mediaFileId;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

function hasSourceArtifacts(artifacts: MutableSourceArtifacts): boolean {
  return Object.values(artifacts).some((value) => value !== undefined);
}

function mergeSourceArtifacts(
  target: MutableSourceArtifacts,
  candidate: MutableSourceArtifacts,
  options: { authoritative?: boolean } = {},
): void {
  for (const [key, value] of Object.entries(candidate) as Array<
    [keyof MutableSourceArtifacts, MutableSourceArtifacts[keyof MutableSourceArtifacts]]
  >) {
    if (value === undefined) continue;
    const current = target[key];
    const useCandidate = options.authoritative
      || current === undefined
      || (Array.isArray(value) && (!Array.isArray(current) || value.length > current.length))
      || (key === 'analysis'
        && typeof value === 'object'
        && value !== null
        && 'frames' in value
        && Array.isArray(value.frames)
        && (
          typeof current !== 'object'
          || current === null
          || !('frames' in current)
          || !Array.isArray(current.frames)
          || value.frames.length > current.frames.length
        ));
    if (useCandidate) {
      Object.assign(target, { [key]: value });
    }
  }
}

function sourceArtifactsFromClip(
  clip: TimelineClip,
  transcript: TimelineClip['transcript'],
): MutableSourceArtifacts {
  return {
    analysis: clip.analysis,
    analysisProgress: clip.analysisProgress,
    analysisStatus: clip.analysisStatus,
    faceAnalysisMessage: clip.faceAnalysisMessage,
    faceAnalysisProgress: clip.faceAnalysisProgress,
    faceAnalysisStatus: clip.faceAnalysisStatus,
    sceneDescriptionMessage: clip.sceneDescriptionMessage,
    sceneDescriptionProgress: clip.sceneDescriptionProgress,
    sceneDescriptions: clip.sceneDescriptions,
    sceneDescriptionStatus: clip.sceneDescriptionStatus,
    transcript,
    transcriptProgress: clip.transcriptProgress,
    transcriptStatus: clip.transcriptStatus,
  };
}

function buildSourceIntelligence(
  input: HostedAgentFastV2SemanticTimelineStateInput,
  runtimeClipsById: ReadonlyMap<string, TimelineClip>,
): {
  clipSourceIdByClipId: ReadonlyMap<string, string>;
  sources: Record<string, unknown>[];
} {
  const accumulators = new Map<string, SourceIntelligenceAccumulator>();
  const clipSourceIdByClipId = new Map<string, string>();

  for (const serializedClip of input.serializedTimeline.clips) {
    const runtimeClip = runtimeClipsById.get(serializedClip.id);
    if (!runtimeClip) continue;
    const mediaFileId = mediaFileIdForClip(serializedClip, runtimeClip);
    const runtimeArtifacts = sourceArtifactsFromClip(
      runtimeClip,
      input.transcriptsByClipId.get(serializedClip.id) ?? runtimeClip.transcript,
    );
    if (!mediaFileId && !hasSourceArtifacts(runtimeArtifacts)) continue;

    const sourceId = mediaFileId ? `media:${mediaFileId}` : `clip:${serializedClip.id}`;
    const accumulator = accumulators.get(sourceId) ?? {
      artifacts: {},
      clipIds: new Set<string>(),
      id: sourceId,
      kind: mediaFileId ? 'media' : 'clip',
      ...(mediaFileId === undefined ? {} : { mediaFileId }),
    };
    accumulator.clipIds.add(serializedClip.id);
    mergeSourceArtifacts(accumulator.artifacts, runtimeArtifacts);
    accumulators.set(sourceId, accumulator);
    clipSourceIdByClipId.set(serializedClip.id, sourceId);
  }

  for (const accumulator of accumulators.values()) {
    if (!accumulator.mediaFileId) continue;
    const authoritative = input.sourceArtifactsByMediaFileId?.get(accumulator.mediaFileId);
    if (authoritative) {
      mergeSourceArtifacts(accumulator.artifacts, authoritative, { authoritative: true });
    }
  }

  return {
    clipSourceIdByClipId,
    sources: [...accumulators.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((source) => ({
        artifacts: source.artifacts,
        clipIds: [...source.clipIds].sort(),
        id: source.id,
        kind: source.kind,
        ...(source.mediaFileId === undefined ? {} : { mediaFileId: source.mediaFileId }),
      })),
  };
}

/**
 * Produces plain JSON without runtime media payloads. The snapshot remains
 * semantically complete for editing while thumbnails, waveform sample arrays,
 * and embedded data URLs stay on the browser side.
 */
export function sanitizeHostedAgentFastV2SemanticJson(value: unknown): Record<string, unknown> {
  const serialized = JSON.stringify(value, (key, entry: unknown) => {
    if (OMITTED_BINARY_FIELDS.has(key)) return undefined;
    if (typeof entry === 'string' && /^\s*data:/i.test(entry)) {
      return '[omitted-binary-data-url]';
    }
    if (entry instanceof Map) return Object.fromEntries(entry);
    if (entry instanceof Set) return [...entry];
    return entry;
  });
  if (serialized === undefined) {
    throw new Error('The complete semantic timeline state is not serializable.');
  }
  const parsed = JSON.parse(serialized) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('The complete semantic timeline state must serialize to an object.');
  }
  return parsed as Record<string, unknown>;
}

export function buildHostedAgentFastV2SemanticTimelineState(
  input: HostedAgentFastV2SemanticTimelineStateInput,
): Record<string, unknown> {
  const runtimeClipsById = new Map(input.runtimeClips.map((clip) => [clip.id, clip]));
  const sourceIntelligence = buildSourceIntelligence(input, runtimeClipsById);
  const clips = input.serializedTimeline.clips.map((serializedClip) => {
    return {
      ...serializedClip,
      ...(sourceIntelligence.clipSourceIdByClipId.has(serializedClip.id)
        ? { sourceIntelligenceId: sourceIntelligence.clipSourceIdByClipId.get(serializedClip.id)! }
        : {}),
    };
  });

  return sanitizeHostedAgentFastV2SemanticJson({
    schemaVersion: 3,
    activeComposition: input.activeComposition,
    projectContext: input.projectContext,
    sourceIntelligence: {
      schemaVersion: 1,
      sources: sourceIntelligence.sources,
    },
    timeline: {
      ...input.serializedTimeline,
      clips,
      layers: input.layers,
      timelineRevision: input.timelineRevision,
    },
    selection: {
      activeMaskId: input.activeMaskId,
      primarySelectedClipId: input.primarySelectedClipId,
      propertiesSelection: input.propertiesSelection,
      selectedClipIds: input.selectedClipIds,
      selectedKeyframeIds: input.selectedKeyframeIds,
      selectedLayerId: input.selectedLayerId,
      selectedVertexIds: input.selectedVertexIds,
      timelineRangeSelection: input.timelineRangeSelection,
    },
    storyboard: input.storyboard,
  });
}
