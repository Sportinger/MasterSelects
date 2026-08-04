import type { useMediaStore } from '../../../stores/mediaStore';
import type { useTimelineStore } from '../../../stores/timeline';
import type { MediaFile } from '../../../stores/mediaStore/types';
import type {
  ClipAnalysis,
  SceneSegment,
  TranscriptWord,
} from '../../../types/clipMetadata';
import type { TimelineClip } from '../../../types/timeline';
import type {
  AgentTimelineChannel,
  AgentTimelineQueryScope,
  AgentTimelineQueryTimeDomain,
  AgentTimelineRange,
} from '../../../types/agentTimeline/manifest';
import type { AgentTimelineGranularity } from '../../../types/agentTimeline/query';
import type { SourceIdentity } from '../../../types/agentTimeline/sourceIdentity';
import type { AudioAnalysisArtifact } from '../../audio/audioArtifactTypes';
import {
  AGENT_TIMELINE_API_SCHEMA_VERSION,
  type ResolvedAgentTimelineReadSource,
  type AgentTimelineSelectedRangeRequest,
} from '../../../types/agentTimeline/api';
import { createAgentTimelineReadApi } from '../../agentTimeline/api/agentTimelineReadApi';
import { buildOccurrenceMappingIndex } from '../../agentTimeline/mapping/occurrenceMappingIndex';
import { planCanonicalSourceRanges } from '../../agentTimeline/query/rangeQueryPlanning';
import { materializeLegacyAgentTimelineReadSource } from '../../agentTimeline/runtime/legacyReadSource/materializeLegacyReadSource';
import {
  loadAudioIntelligencePayloads,
  type AudioIntelligencePayloads,
} from '../../agentTimeline/artifacts/audioIntelligencePayloadLoader';
import { sourceIdentityRuntimeCache } from '../../agentTimeline/runtime/sourceIdentityCache';
import { PersistentAgentTimelineShardReader } from '../../agentTimeline/runtime/persistence/persistentShardReader';
import {
  createProjectAgentTimelineArtifactStore,
  createProjectAgentTimelineStorage,
} from '../../agentTimeline/storage/projectAgentTimelineStorage';
import { createCurrentAudioArtifactStore } from '../../audio/timelineWaveformPyramidCache';
import { selectClipAndOpenTab } from '../aiFeedback';
import type { ToolResult } from '../types';
import { buildAgentTimelineAiSupplement } from './agentTimelineSupplement';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;
type MediaStore = ReturnType<typeof useMediaStore.getState>;

const CHANNELS: readonly AgentTimelineChannel[] = [
  'cuts', 'shots', 'scenes', 'speech', 'people', 'active-speaker',
  'camera-motion', 'audio', 'quality', 'text', 'duplicates',
];
const CHANNEL_SET = new Set<string>(CHANNELS);
const GRANULARITIES = new Set<AgentTimelineGranularity>(['summary', 'shot', 'event', 'sample']);
const TIME_DOMAINS = new Set<AgentTimelineQueryTimeDomain>(['source', 'clip-local', 'composition']);
const AGENT_TIMELINE_AI_TOOL_SCHEMA_VERSION = 'ai-tool-get-timeline-analysis/v1' as const;
const MAX_LEGACY_FALLBACK_DURATION_SECONDS = 5 * 60;
const MAX_LEGACY_FALLBACK_REQUEST_SECONDS = 60;
const MAX_LEGACY_FALLBACK_RECORDS = 10_000;

export interface AgentTimelineAiToolDependencies {
  getSourceIdentity(source: Blob): Promise<SourceIdentity>;
  listAudioArtifacts(mediaFileId: string): Promise<readonly AudioAnalysisArtifact[]>;
  showAnalysis(clipId: string): void;
}

const defaultDependencies: AgentTimelineAiToolDependencies = {
  getSourceIdentity: (source) => sourceIdentityRuntimeCache.get(source, {
    strategy: 'sampled-chunks',
  }),
  listAudioArtifacts: async (mediaFileId) => (
    createCurrentAudioArtifactStore().listAnalysisArtifacts(mediaFileId)
  ),
  showAnalysis: (clipId) => selectClipAndOpenTab(clipId, 'analysis'),
};

interface ResolvedTarget {
  clip?: TimelineClip;
  media?: MediaFile;
  mediaFileId: string;
  sourceFile: File;
  durationSeconds: number;
  sourceClips: TimelineClip[];
}

function failure(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): ToolResult {
  return {
    success: false,
    error: message,
    data: {
      ok: false,
      schemaVersion: AGENT_TIMELINE_AI_TOOL_SCHEMA_VERSION,
      apiSchemaVersion: AGENT_TIMELINE_API_SCHEMA_VERSION,
      error: { code, message, retryable: false, ...details },
    },
  };
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value.trim();
}
function validDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
function mediaFileIdFor(clip: TimelineClip): string | undefined {
  return clip.source?.mediaFileId ?? clip.mediaFileId;
}

function runtimeFileFor(clip: TimelineClip | undefined, media: MediaFile | undefined): File | undefined {
  return media?.file
    ?? clip?.source?.file
    ?? (clip?.needsReload === true ? undefined : clip?.file);
}

function durationFor(
  media: MediaFile | undefined,
  clip: TimelineClip | undefined,
  sourceClips: readonly TimelineClip[],
): number | undefined {
  const candidates = [
    media?.duration,
    media?.sceneCutAnalysis?.duration,
    clip?.source?.naturalDuration,
    ...sourceClips.map((item) => item.source?.naturalDuration),
    ...sourceClips.map((item) => item.outPoint),
  ].filter(validDuration);
  return candidates.length > 0 ? Math.max(...candidates) : undefined;
}

function selectedMedia(
  mediaStore: MediaStore,
): { media?: MediaFile; ambiguous: boolean } {
  const selected = mediaStore.files.filter((item) => mediaStore.selectedIds.includes(item.id));
  if (selected.length === 1) return { media: selected[0], ambiguous: false };
  return { ambiguous: selected.length > 1 };
}

function resolveTarget(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
  mediaStore: MediaStore,
): ResolvedTarget | ToolResult {
  let clipId: string | undefined;
  let requestedMediaFileId: string | undefined;
  try {
    clipId = optionalString(args.clipId, 'clipId');
    requestedMediaFileId = optionalString(args.mediaFileId, 'mediaFileId');
  } catch (error) {
    return failure('invalid-request', error instanceof Error ? error.message : 'Invalid target');
  }

  const selectedClipId = timelineStore.primarySelectedClipId
    ?? (timelineStore.selectedClipIds.size === 1
      ? [...timelineStore.selectedClipIds][0]
      : undefined);
  const clip = timelineStore.clips.find((item) => (
    item.id === (clipId ?? (requestedMediaFileId ? undefined : selectedClipId))
  ));
  if (clipId && !clip) return failure('scope-not-found', `Clip not found: ${clipId}`);

  const clipMediaFileId = clip ? mediaFileIdFor(clip) : undefined;
  if (requestedMediaFileId && clipMediaFileId && requestedMediaFileId !== clipMediaFileId) {
    return failure(
      'invalid-request',
      `Clip ${clip!.id} belongs to media ${clipMediaFileId}, not ${requestedMediaFileId}`,
    );
  }

  const mediaSelection = selectedMedia(mediaStore);
  if (!requestedMediaFileId && !clipMediaFileId && mediaSelection.ambiguous) {
    return failure(
      'ambiguous-scope',
      'Multiple media files are selected; pass mediaFileId or select one source',
    );
  }
  const mediaFileId = requestedMediaFileId ?? clipMediaFileId ?? mediaSelection.media?.id;
  if (!mediaFileId) {
    return failure(
      'scope-not-found',
      'Select a source-backed clip or one media file, or pass clipId/mediaFileId',
    );
  }

  const media = mediaStore.files.find((item) => item.id === mediaFileId);
  const sourceClips = timelineStore.clips.filter((item) => mediaFileIdFor(item) === mediaFileId);
  const sourceFile = runtimeFileFor(clip, media)
    ?? sourceClips.map((item) => runtimeFileFor(item, media)).find(Boolean);
  if (!sourceFile) {
    return failure(
      'source-runtime-unavailable',
      `Media ${mediaFileId} has no authorized runtime File; relink it before querying analysis`,
    );
  }
  const durationSeconds = durationFor(media, clip, sourceClips);
  if (!durationSeconds) {
    return failure(
      'source-duration-unavailable',
      `Media ${mediaFileId} has no trustworthy positive source duration`,
    );
  }
  return { clip, media, mediaFileId, sourceFile, durationSeconds, sourceClips };
}

function parseChannels(value: unknown): readonly AgentTimelineChannel[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('channels must contain at least one Agent Timeline channel');
  }
  const channels = value.map((item) => {
    if (typeof item !== 'string' || !CHANNEL_SET.has(item)) {
      throw new TypeError(`Unknown Agent Timeline channel: ${String(item)}`);
    }
    return item as AgentTimelineChannel;
  });
  return [...new Set(channels)].toSorted();
}

function parseCompositionPath(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.some((part) => (
    typeof part !== 'string' || part.trim().length === 0
  ))) {
    throw new TypeError('compositionPath must be a non-empty array of composition IDs');
  }
  return value.map((part) => (part as string).trim());
}

function parseRequest(
  args: Record<string, unknown>,
  target: ResolvedTarget,
  activeCompositionId: string | null,
): AgentTimelineSelectedRangeRequest {
  if ('includeFrames' in args || 'frames' in args || 'screenshots' in args) {
    throw new TypeError('Frames and screenshots are not supported by getTimelineAnalysis');
  }
  const start = args.start;
  const end = args.end;
  if (typeof start !== 'number' || typeof end !== 'number') {
    throw new TypeError('start and end are required numbers');
  }
  if (typeof args.timeDomain !== 'string' || !TIME_DOMAINS.has(
    args.timeDomain as AgentTimelineQueryTimeDomain,
  )) {
    throw new TypeError('timeDomain must be source, clip-local, or composition');
  }
  const granularity = args.granularity ?? 'event';
  if (typeof granularity !== 'string' || !GRANULARITIES.has(
    granularity as AgentTimelineGranularity,
  )) {
    throw new TypeError('granularity must be summary, shot, event, or sample');
  }
  const compositionId = optionalString(args.compositionId, 'compositionId');
  const compositionPath = parseCompositionPath(args.compositionPath);
  const scope: AgentTimelineQueryScope = {
    mediaFileId: target.mediaFileId,
    ...(target.clip ? { clipId: target.clip.id } : {}),
    ...(compositionId ? { compositionId } : {}),
    ...(compositionPath ? { compositionPath } : {}),
  };
  if (args.timeDomain === 'clip-local' && !target.clip) {
    throw new TypeError('clip-local time requires clipId or one selected source-backed clip');
  }
  if (args.timeDomain === 'composition' && !compositionId && !compositionPath) {
    if (!activeCompositionId) {
      throw new TypeError('Composition time requires compositionId or compositionPath');
    }
    scope.compositionId = activeCompositionId;
    scope.compositionPath = [activeCompositionId];
  }
  return {
    scope,
    start,
    end,
    timeDomain: args.timeDomain as AgentTimelineQueryTimeDomain,
    granularity: granularity as AgentTimelineGranularity,
    channels: parseChannels(args.channels),
    page: {
      ...(args.cursor !== undefined ? { cursor: optionalString(args.cursor, 'cursor') } : {}),
      ...(args.limit !== undefined ? { limit: Number(args.limit) } : {}),
      ...(args.maxBytes !== undefined ? { maxBytes: Number(args.maxBytes) } : {}),
    },
  };
}

function hasTextConsent(args: Record<string, unknown>): boolean {
  if (args.includeText === undefined) return false;
  if (args.includeText !== true) {
    throw new TypeError('includeText must be true when supplied');
  }
  if (args.externalDataConsent !== 'share-transcript-and-scene-descriptions') {
    throw new TypeError(
      'Text requires externalDataConsent: share-transcript-and-scene-descriptions',
    );
  }
  return true;
}

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

function mappingFor(
  timelineStore: TimelineStore,
  activeCompositionId: string | null,
) {
  if (!activeCompositionId) return undefined;
  const occurrenceState = timelineStore.clips.map((clip) => ({
    id: clip.id,
    mediaFileId: mediaFileIdFor(clip),
    compositionId: clip.compositionId,
    isComposition: clip.isComposition,
    startTime: clip.startTime,
    duration: clip.duration,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
    speed: clip.speed,
    followsLinkedVideoSpeed: clip.followsLinkedVideoSpeed,
    reversed: clip.reversed,
    speedKeyframes: (timelineStore.clipKeyframes.get(clip.id) ?? [])
      .filter((keyframe) => keyframe.property === 'speed')
      .map((keyframe) => ({
        time: keyframe.time,
        value: keyframe.value,
        easing: keyframe.easing,
      })),
  })).toSorted((left, right) => left.id.localeCompare(right.id));
  const occurrences = timelineStore.clips.flatMap((clip) => {
    const sourceId = mediaFileIdFor(clip);
    const speedKeyframes = (timelineStore.clipKeyframes.get(clip.id) ?? [])
      .filter((keyframe) => keyframe.property === 'speed');
    if (!sourceId || clip.isComposition || clip.compositionId || speedKeyframes.length > 0
      || !validDuration(clip.duration) || !Number.isFinite(clip.startTime)
      || !Number.isFinite(clip.inPoint) || !Number.isFinite(clip.outPoint)
      || clip.outPoint <= clip.inPoint) {
      return [];
    }
    const speed = Number.isFinite(clip.speed) ? clip.speed ?? 1 : 1;
    const reverse = clip.reversed === true !== (speed < 0);
    const absoluteSpeed = Math.abs(speed);
    return [{
      sourceId,
      clipId: clip.id,
      compositionPath: [activeCompositionId],
      sourceRange: { start: clip.inPoint, end: clip.outPoint },
      pieces: [{
        compositionStart: clip.startTime,
        compositionEnd: clip.startTime + clip.duration,
        sourceStart: reverse ? clip.outPoint : clip.inPoint,
        sourceRateStart: reverse ? -absoluteSpeed : absoluteSpeed,
      }],
    }];
  });
  return buildOccurrenceMappingIndex({
    stateHash: `current-timeline-${stableHash({
      activeCompositionId,
      occurrences: occurrenceState,
    })}`,
    occurrences,
  });
}

function hasRequestedMapping(
  request: AgentTimelineSelectedRangeRequest,
  target: ResolvedTarget,
  mapping: ReturnType<typeof mappingFor>,
): boolean {
  if (request.timeDomain === 'source') return true;
  if (!mapping) return false;
  return mapping.segments.some((segment) => {
    if (segment.sourceId !== target.mediaFileId) return false;
    if (request.scope.clipId && segment.clipId !== request.scope.clipId) return false;
    if (request.scope.compositionId
      && !segment.compositionPath.includes(request.scope.compositionId)) return false;
    if (request.scope.compositionPath) {
      const path = request.scope.compositionPath;
      if (path.length !== segment.compositionPath.length
        || !segment.compositionPath.every((part, index) => part === path[index])) return false;
    }
    return true;
  });
}

function preferredClip<T>(
  target: ResolvedTarget,
  select: (clip: TimelineClip) => T | undefined,
): T | undefined {
  if (target.clip) {
    const value = select(target.clip);
    if (value !== undefined) return value;
  }
  for (const clip of target.sourceClips.toSorted((left, right) => left.id.localeCompare(right.id))) {
    const value = select(clip);
    if (value !== undefined) return value;
  }
  return undefined;
}

function clipAnalysis(target: ResolvedTarget): ClipAnalysis | undefined {
  return preferredClip(target, (clip) => (
    clip.analysisStatus === 'ready' ? clip.analysis : undefined
  ));
}

function transcript(target: ResolvedTarget): readonly TranscriptWord[] | undefined {
  if (target.media?.transcriptStatus === 'ready' && target.media.transcript) {
    return target.media.transcript;
  }
  return preferredClip(target, (clip) => (
    clip.transcriptStatus === 'ready' ? clip.transcript : undefined
  ));
}

function sceneDescriptions(target: ResolvedTarget): readonly SceneSegment[] | undefined {
  return preferredClip(target, (clip) => (
    clip.sceneDescriptionStatus === 'ready' ? clip.sceneDescriptions : undefined
  ));
}

function waveform(target: ResolvedTarget): readonly number[] | undefined {
  return target.media?.waveform ?? preferredClip(target, (clip) => clip.waveform);
}

function validCoverage(
  ranges: readonly [number, number][] | undefined,
  durationSeconds: number,
) {
  const coverage = (ranges ?? [])
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end)
      && start >= 0 && end > start && end <= durationSeconds)
    .map(([start, end]) => ({ start, end }));
  return coverage.length > 0 ? coverage : undefined;
}

function stableGeneratedAt(
  target: ResolvedTarget,
  audioArtifacts: readonly AudioAnalysisArtifact[],
): string {
  const timestamps = [
    target.sourceFile.lastModified,
    target.media?.sceneCutAnalysis?.completedAt,
    ...audioArtifacts.map((artifact) => artifact.createdAt),
  ].filter((value): value is number => (
    typeof value === 'number' && Number.isFinite(value) && value >= 0
  ));
  return new Date(timestamps.length > 0 ? Math.max(...timestamps) : 0).toISOString();
}

function usableAudioArtifacts(
  artifacts: readonly AudioAnalysisArtifact[],
  mediaFileId: string,
  durationSeconds: number,
): readonly AudioAnalysisArtifact[] {
  return artifacts.filter((artifact) => (
    artifact.mediaFileId === mediaFileId
    && validDuration(artifact.duration)
    && artifact.duration <= durationSeconds + 1e-6
  ));
}
function overlapsAnyRange(
  start: number,
  end: number,
  ranges: readonly AgentTimelineRange[] | undefined,
): boolean {
  return !ranges || ranges.some((range) => start < range.end && end > range.start);
}
function boundedLegacyArtifacts(
  target: ResolvedTarget,
  ranges: readonly AgentTimelineRange[] | undefined,
) {
  const analysis = clipAnalysis(target);
  const words = transcript(target);
  const descriptions = sceneDescriptions(target);
  const sceneCuts = target.media?.sceneCutStatus === 'ready'
    ? target.media.sceneCutAnalysis
    : undefined;
  return {
    analysis: analysis && ranges ? {
      ...analysis,
      frames: analysis.frames.filter((frame) => ranges.some((range) => (
        frame.timestamp >= range.start && frame.timestamp < range.end
      ))),
    } : analysis,
    words: words?.filter((word) => overlapsAnyRange(word.start, word.end, ranges)),
    descriptions: descriptions?.filter((segment) => (
      overlapsAnyRange(segment.start, segment.end, ranges)
    )),
    sceneCuts: sceneCuts && ranges ? {
      ...sceneCuts,
      cuts: sceneCuts.cuts.filter((cut) => ranges.some((range) => (
        cut.timestamp >= range.start && cut.timestamp < range.end
      ))),
    } : sceneCuts,
  };
}
function legacyFallbackFailure(
  target: ResolvedTarget,
  request: AgentTimelineSelectedRangeRequest,
  artifacts: ReturnType<typeof boundedLegacyArtifacts>,
): ToolResult | undefined {
  const recordCount = (artifacts.analysis?.frames.length ?? 0)
    + (artifacts.words?.length ?? 0)
    + (artifacts.descriptions?.length ?? 0)
    + (artifacts.sceneCuts?.cuts.length ?? 0);
  if (target.durationSeconds <= MAX_LEGACY_FALLBACK_DURATION_SECONDS
    && request.end - request.start <= MAX_LEGACY_FALLBACK_REQUEST_SECONDS
    && recordCount <= MAX_LEGACY_FALLBACK_RECORDS) return undefined;
  return failure(
    'index-required',
    'This source needs a persisted Agent Timeline index before a bounded external read.',
    {
      legacyFallback: {
        maxSourceDurationSeconds: MAX_LEGACY_FALLBACK_DURATION_SECONDS,
        maxRequestedRangeSeconds: MAX_LEGACY_FALLBACK_REQUEST_SECONDS,
        maxRecords: MAX_LEGACY_FALLBACK_RECORDS,
        sourceDurationSeconds: target.durationSeconds,
        requestedRangeSeconds: request.end - request.start,
        recordCount,
      },
    },
  );
}
async function readPersistedSource(
  target: ResolvedTarget,
  sourceIdentity: SourceIdentity,
  occurrenceMapping: ReturnType<typeof mappingFor>,
): Promise<ResolvedAgentTimelineReadSource | undefined> {
  try {
    const loaded = await createProjectAgentTimelineStorage().read({
      mediaFileId: target.mediaFileId,
      sourceIdentity,
    });
    if (loaded.status !== 'ready') return undefined;
    return {
      manifest: loaded.analysis.manifest,
      shardIndex: loaded.analysis.shardIndex,
      shardReader: new PersistentAgentTimelineShardReader(createProjectAgentTimelineArtifactStore()),
      occurrenceMapping,
      mappingSourceId: target.mediaFileId,
    };
  } catch {
    return undefined;
  }
}
function redactTextPayload<T extends Record<string, unknown>>(result: T): T {
  const data = result.data;
  if (!data || typeof data !== 'object') return result;
  const resultData = data as { page?: { events?: Array<Record<string, unknown>> } };
  const events = resultData.page?.events;
  if (events) {
    resultData.page!.events = events.map((event) => {
      const eventData = event.data;
      if (!eventData || typeof eventData !== 'object') return event;
      const { text: _text, originalText: _originalText, label: _label, ...safeData } = eventData as Record<string, unknown>;
      return { ...event, data: safeData };
    });
  }
  return result;
}
export async function handleGetTimelineAnalysis(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
  mediaStore: MediaStore,
  dependencies: AgentTimelineAiToolDependencies = defaultDependencies,
): Promise<ToolResult> {
  const resolved = resolveTarget(args, timelineStore, mediaStore);
  if ('success' in resolved) return resolved;
  const target = resolved;
  const activeCompositionId = mediaStore.activeCompositionId;
  let request: AgentTimelineSelectedRangeRequest;
  let includeText: boolean;
  try {
    request = parseRequest(args, target, activeCompositionId);
    includeText = hasTextConsent(args);
  } catch (error) {
    return failure(
      'invalid-request',
      error instanceof Error ? error.message : 'Invalid Agent Timeline request',
    );
  }

  const occurrenceMapping = mappingFor(timelineStore, activeCompositionId);
  if (!hasRequestedMapping(request, target, occurrenceMapping)) {
    return failure(
      'mapping-unavailable',
      `No honest ${request.timeDomain} mapping exists for the requested source and scope`,
      {
        requestedTimeDomain: request.timeDomain,
        scope: request.scope,
        unsupportedReasons: [
          'nested compositions and speed-keyframed clips are not flattened by the live adapter',
        ],
      },
    );
  }

  let sourceIdentity: SourceIdentity;
  let audioArtifacts: readonly AudioAnalysisArtifact[] = [];
  let audioIntelligence: AudioIntelligencePayloads = {};
  try {
    const needsAudioIntelligence = request.channels.some((channel) =>
      channel === 'audio' || channel === 'quality' || channel === 'speech');
    const audioArtifactsPromise: Promise<readonly AudioAnalysisArtifact[]> = needsAudioIntelligence
      ? dependencies.listAudioArtifacts(target.mediaFileId).then((artifacts) => usableAudioArtifacts(
        artifacts,
        target.mediaFileId,
        target.durationSeconds,
      ))
      : Promise.resolve([]);
    [sourceIdentity, audioArtifacts, audioIntelligence] = await Promise.all([
      dependencies.getSourceIdentity(target.sourceFile),
      audioArtifactsPromise,
      audioArtifactsPromise.then((artifacts) => loadAudioIntelligencePayloads(
        artifacts,
        createCurrentAudioArtifactStore(),
      )),
    ]);
  } catch (error) {
    return failure(
      'read-failed',
      error instanceof Error ? error.message : 'Failed to identify the selected source',
      { retryable: true },
    );
  }

  try {
    const persistedSource = await readPersistedSource(target, sourceIdentity, occurrenceMapping);
    let source: ResolvedAgentTimelineReadSource;
    if (!persistedSource) {
      const requestedSourceRanges = request.timeDomain === 'source'
        ? [{ start: request.start, end: request.end }]
        : undefined;
      const legacyArtifacts = boundedLegacyArtifacts(target, requestedSourceRanges);
      const fallbackFailure = legacyFallbackFailure(target, request, legacyArtifacts);
      if (fallbackFailure) return fallbackFailure;
      source = materializeLegacyAgentTimelineReadSource({
        sourceIdentity,
        mediaFileId: target.mediaFileId,
        durationSeconds: target.durationSeconds,
        generatedAt: stableGeneratedAt(target, audioArtifacts),
        profile: 'balanced',
        ...(legacyArtifacts.analysis ? { clipAnalysis: { value: legacyArtifacts.analysis } } : {}),
        ...(legacyArtifacts.words ? {
          transcript: {
            value: legacyArtifacts.words,
            coverage: validCoverage(target.media?.transcribedRanges, target.durationSeconds),
          },
        } : {}),
        ...(legacyArtifacts.sceneCuts ? { sceneCuts: { value: legacyArtifacts.sceneCuts } } : {}),
        ...(legacyArtifacts.descriptions ? {
          sceneDescriptions: { value: legacyArtifacts.descriptions },
        } : {}),
        ...(audioArtifacts.length > 0 ? { audioArtifacts: { value: audioArtifacts } } : {}),
        ...(Object.keys(audioIntelligence).length > 0
          ? { audioIntelligence: { value: audioIntelligence } }
          : {}),
        occurrenceMapping,
        mappingSourceId: target.mediaFileId,
      });
    } else source = persistedSource;
    const canonicalSourceRanges = planCanonicalSourceRanges(source.manifest, {
      scope: request.scope,
      start: request.start,
      end: request.end,
      timeDomain: request.timeDomain,
      granularity: request.granularity ?? 'event',
      channels: request.channels,
      includeFrames: false,
      limit: request.page?.limit,
      cursor: request.page?.cursor,
    }, occurrenceMapping, target.mediaFileId);
    const boundedArtifacts = boundedLegacyArtifacts(target, canonicalSourceRanges);
    const supplement = buildAgentTimelineAiSupplement({
      sourceId: target.mediaFileId,
      durationSeconds: target.durationSeconds,
      request,
      canonicalSourceRanges,
      occurrenceMapping,
      clipAnalysis: boundedArtifacts.analysis,
      transcript: includeText ? boundedArtifacts.words : undefined,
      transcriptCoverage: validCoverage(
        target.media?.transcribedRanges,
        target.durationSeconds,
      ),
      sceneCuts: boundedArtifacts.sceneCuts,
      sceneDescriptions: includeText ? boundedArtifacts.descriptions : undefined,
      audioArtifacts,
      waveform: waveform(target),
    });
    const api = createAgentTimelineReadApi({
      resolve: async (scope) => (
        scope.mediaFileId && scope.mediaFileId !== target.mediaFileId ? null : source
      ),
    });
    const result = await api.getSelectedRange(request);
    if (target.clip) dependencies.showAnalysis(target.clip.id);
    const response = result.ok ? { success: true, data: { ...result, supplement } }
      : { success: false, error: result.error.message, data: result };
    return includeText ? response : redactTextPayload(response);
  } catch (error) {
    return failure(
      'read-failed',
      error instanceof Error ? error.message : 'Agent Timeline materialization failed',
      { retryable: true },
    );
  }
}
