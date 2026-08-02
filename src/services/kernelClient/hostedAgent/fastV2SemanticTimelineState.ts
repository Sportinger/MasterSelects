import type { StoryboardProjectState } from '../../storyboard/contracts';
import type {
  CompositionTimelineData,
  TimelineClip,
} from '../../../types/timeline';

const OMITTED_BINARY_FIELDS = new Set([
  'thumbnails',
  'waveform',
  'waveformChannels',
]);

export interface HostedAgentFastV2ActiveCompositionState {
  backgroundColor: string;
  camera?: unknown;
  captionComp?: unknown;
  duration: number;
  frameRate: number;
  height: number;
  id: string;
  name: string;
  transitionComp?: unknown;
  width: number;
}

export interface HostedAgentFastV2SemanticTimelineStateInput {
  activeComposition: HostedAgentFastV2ActiveCompositionState | null;
  activeMaskId: string | null;
  layers: readonly unknown[];
  primarySelectedClipId: string | null;
  propertiesSelection: unknown;
  runtimeClips: readonly TimelineClip[];
  selectedClipIds: readonly string[];
  selectedKeyframeIds: readonly string[];
  selectedLayerId: string | null;
  selectedVertexIds: readonly string[];
  serializedTimeline: CompositionTimelineData;
  storyboard: StoryboardProjectState;
  timelineRangeSelection: unknown;
  timelineRevision: number;
  transcriptsByClipId: ReadonlyMap<string, TimelineClip['transcript']>;
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
  const clips = input.serializedTimeline.clips.map((serializedClip) => {
    const runtimeClip = runtimeClipsById.get(serializedClip.id);
    const transcript = input.transcriptsByClipId.get(serializedClip.id);
    return {
      ...serializedClip,
      ...(transcript === undefined ? {} : { transcript }),
      ...(runtimeClip?.transcriptStatus === undefined
        ? {}
        : { transcriptStatus: runtimeClip.transcriptStatus }),
      ...(runtimeClip?.analysis === undefined ? {} : { analysis: runtimeClip.analysis }),
      ...(runtimeClip?.analysisStatus === undefined
        ? {}
        : { analysisStatus: runtimeClip.analysisStatus }),
      ...(runtimeClip?.faceAnalysisStatus === undefined
        ? {}
        : { faceAnalysisStatus: runtimeClip.faceAnalysisStatus }),
      ...(runtimeClip?.faceAnalysisMessage === undefined
        ? {}
        : { faceAnalysisMessage: runtimeClip.faceAnalysisMessage }),
      ...(runtimeClip?.sceneDescriptions === undefined
        ? {}
        : { sceneDescriptions: runtimeClip.sceneDescriptions }),
      ...(runtimeClip?.sceneDescriptionStatus === undefined
        ? {}
        : { sceneDescriptionStatus: runtimeClip.sceneDescriptionStatus }),
    };
  });

  return sanitizeHostedAgentFastV2SemanticJson({
    schemaVersion: 1,
    activeComposition: input.activeComposition,
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
