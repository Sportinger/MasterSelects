import type { TimelineClip, TimelineTrack } from '../../../types/timeline';
import { resolveEditableHookLayerMetadata } from '../../aiTools/editableHookIdentity';
import { effectiveWordTiming } from '../../transcription/effectiveWordTiming';
import { APP_VERSION } from '../../../version';
import { sanitizeHostedAgentFastV2SemanticJson } from './fastV2SemanticTimelineState';
import { buildHostedAgentFastV2EditorToolCatalog } from './fastV2EditorToolCatalog';
import {
  fingerprintPublicTimelineStateV1,
} from '../wp1Spike/publicOperationContracts';
import {
  HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_DIGEST,
  HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_VERSION,
  HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION,
  parseHostedAgentFastV2StartRequest,
  type HostedAgentFastV2ExecutionProfile,
  type HostedAgentFastV2RequestedExecutionMode,
  type HostedAgentFastV2RequestedModelClass,
  type HostedAgentFastV2RunSource,
  type HostedAgentFastV2StartRequest,
  type HostedAgentFastV2VisualReference,
} from './fastV2StartContract';

const MAX_LABEL_CHARACTERS = 500;
const MAX_TRANSCRIPT_TEXT_CHARACTERS = 500;
const MAX_TRANSCRIPT_WORDS_PER_CLIP = 3_000;
const MAX_TRANSCRIPT_WORDS_PER_SNAPSHOT = 3_500;

export interface HostedAgentFastV2TimelineSnapshotInput {
  clips: readonly TimelineClip[];
  duration: number;
  inPoint: number | null;
  outPoint: number | null;
  playheadPosition: number;
  selectedClipIds: ReadonlySet<string>;
  semanticTimelineState: Record<string, unknown>;
  timelineRevision: number;
  tracks: readonly TimelineTrack[];
}

export interface BuildHostedAgentFastV2BrowserRequestInput {
  clientInstanceId: string;
  conversationRef?: string;
  executionProfile?: HostedAgentFastV2ExecutionProfile;
  request: string;
  requestedExecutionMode?: HostedAgentFastV2RequestedExecutionMode;
  requestedModelClass?: HostedAgentFastV2RequestedModelClass;
  runSource: HostedAgentFastV2RunSource;
  snapshot: HostedAgentFastV2TimelineSnapshotInput;
  turnId: string;
  visualReferences?: readonly HostedAgentFastV2VisualReference[];
}

function finiteOrNull(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null;
}

function boundedLabel(value: string): string {
  if (/^\s*data:/i.test(value)) return '[redacted-data-label]';
  return value.slice(0, MAX_LABEL_CHARACTERS);
}

function boundedTranscriptText(value: string): string {
  if (/^\s*data:/i.test(value)) return '[redacted-data-transcript-word]';
  return value.slice(0, MAX_TRANSCRIPT_TEXT_CHARACTERS);
}

function roundedTimelineTime(value: number): number {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function sourceTimeToTimelineTime(clip: TimelineClip, sourceTime: number): number {
  const sourceSpan = Math.max(0.000001, clip.outPoint - clip.inPoint);
  const sourceRatio = Math.min(1, Math.max(0, (sourceTime - clip.inPoint) / sourceSpan));
  const reversed = clip.reversed === true || (clip.speed ?? 1) < 0;
  const timelineRatio = reversed ? 1 - sourceRatio : sourceRatio;
  return roundedTimelineTime(clip.startTime + timelineRatio * clip.duration);
}

function compactEditableHook(
  clip: TimelineClip,
  identity: TimelineClip['editableHook'],
  compositionSize: { height: number; width: number } | undefined,
): Record<string, unknown> | undefined {
  if (!identity) return undefined;
  if (identity.role === 'text' && clip.textProperties) {
    const text = clip.textProperties;
    const box = {
      ...(text.boxX === undefined ? {} : { x: text.boxX }),
      ...(text.boxY === undefined ? {} : { y: text.boxY }),
      ...(text.boxWidth === undefined ? {} : { width: text.boxWidth }),
      ...(text.boxHeight === undefined ? {} : { height: text.boxHeight }),
    };
    return {
      hookId: identity.id,
      geometryUnits: 'composition-pixels',
      role: 'text',
      rowIndex: identity.rowIndex,
      text: boundedLabel(text.text),
      ...(text.fontFamily === undefined ? {} : { fontFamily: text.fontFamily }),
      ...(text.fontSize === undefined ? {} : { fontSize: text.fontSize }),
      ...(text.fontWeight === undefined ? {} : { fontWeight: text.fontWeight }),
      ...(text.color === undefined ? {} : { textColor: text.color }),
      ...(text.textAlign === undefined ? {} : { textAlign: text.textAlign }),
      ...(Object.keys(box).length === 0 ? {} : { box }),
    };
  }
  if (identity.role === 'background' && clip.motion?.shape?.primitive === 'rectangle') {
    const fill = clip.motion.appearance?.items.find((item) => item.kind === 'color-fill');
    return {
      hookId: identity.id,
      geometryUnits: 'composition-pixels',
      role: 'background',
      rowIndex: identity.rowIndex,
      ...(compositionSize === undefined
        ? {}
        : {
            center: {
              x: compositionSize.width / 2 + (clip.transform?.position.x ?? 0),
              y: compositionSize.height / 2 + (clip.transform?.position.y ?? 0),
            },
          }),
      shape: {
        width: clip.motion.shape.size.w,
        height: clip.motion.shape.size.h,
        ...(clip.motion.shape.cornerRadius === undefined
          ? {}
          : { cornerRadius: clip.motion.shape.cornerRadius }),
      },
      ...(fill && 'color' in fill
        ? {
            fill: {
              color: fill.color,
              ...(fill.opacity === undefined ? {} : { opacity: fill.opacity }),
            },
          }
        : {}),
    };
  }
  return undefined;
}

function compactClipTranscript(
  clip: TimelineClip,
  maximumWords: number,
): {
  timebase: 'timeline-seconds';
  totalWords: number;
  truncated: boolean;
  words: Array<{ text: string; timelineEnd: number; timelineStart: number }>;
} | undefined {
  if (!clip.transcript?.length || maximumWords <= 0) return undefined;
  const matchingWords = clip.transcript.flatMap((word) => {
    const { start, end } = effectiveWordTiming(word);
    const text = typeof word.text === 'string' ? boundedTranscriptText(word.text.trim()) : '';
    if (
      !Number.isFinite(start)
      || !Number.isFinite(end)
      || end <= start
      || end < clip.inPoint
      || start > clip.outPoint
      || text.length === 0
    ) {
      return [];
    }
    const timelineA = sourceTimeToTimelineTime(clip, Math.max(clip.inPoint, start));
    const timelineB = sourceTimeToTimelineTime(clip, Math.min(clip.outPoint, end));
    return [{
      text,
      timelineEnd: Math.max(timelineA, timelineB),
      timelineStart: Math.min(timelineA, timelineB),
    }];
  });
  if (matchingWords.length === 0) return undefined;
  const words = matchingWords.slice(0, maximumWords);
  return {
    timebase: 'timeline-seconds',
    totalWords: matchingWords.length,
    truncated: words.length < matchingWords.length,
    words,
  };
}

function compactTimelinePayload(input: HostedAgentFastV2TimelineSnapshotInput) {
  const semanticTimelineState = sanitizeHostedAgentFastV2SemanticJson(input.semanticTimelineState);
  const activeComposition = semanticTimelineState.activeComposition;
  const compositionSize = activeComposition !== null
    && typeof activeComposition === 'object'
    && !Array.isArray(activeComposition)
    && typeof (activeComposition as Record<string, unknown>).width === 'number'
    && typeof (activeComposition as Record<string, unknown>).height === 'number'
    ? {
        width: (activeComposition as Record<string, number>).width,
        height: (activeComposition as Record<string, number>).height,
      }
    : undefined;
  const hookMetadata = resolveEditableHookLayerMetadata(input.clips, input.tracks);
  const tracksById = new Map(input.tracks.map((track) => [track.id, track]));
  const clipsById = new Map(input.clips.map((clip) => [clip.id, clip]));
  const transcriptByClipId = new Map<
    string,
    NonNullable<ReturnType<typeof compactClipTranscript>>
  >();
  let remainingTranscriptWords = MAX_TRANSCRIPT_WORDS_PER_SNAPSHOT;
  const transcriptCandidates = [...input.clips]
    .filter((clip) => {
      if (!clip.transcript?.length) return false;
      const track = tracksById.get(clip.trackId);
      const linkedTrack = clip.linkedClipId === undefined
        ? undefined
        : tracksById.get(clipsById.get(clip.linkedClipId)?.trackId ?? '');
      // A linked video/audio pair shares one source transcript. Put it on the
      // video clip so the model has one unambiguous edit target and withLinked
      // can preserve the partner without duplicating every word in the payload.
      return track?.type !== 'audio' || linkedTrack?.type !== 'video';
    })
    .sort((left, right) => (
      Number(input.selectedClipIds.has(right.id)) - Number(input.selectedClipIds.has(left.id))
      || left.startTime - right.startTime
      || left.id.localeCompare(right.id)
    ));
  for (const clip of transcriptCandidates) {
    if (remainingTranscriptWords <= 0) break;
    const transcript = compactClipTranscript(
      clip,
      Math.min(MAX_TRANSCRIPT_WORDS_PER_CLIP, remainingTranscriptWords),
    );
    if (!transcript) continue;
    transcriptByClipId.set(clip.id, transcript);
    remainingTranscriptWords -= transcript.words.length;
  }

  return {
    clips: input.clips.map((clip) => {
      const compactHook = compactEditableHook(clip, hookMetadata.get(clip.id), compositionSize);
      return {
      duration: clip.duration,
      id: clip.id,
      inPoint: clip.inPoint,
      ...(clip.linkedClipId === undefined ? {} : { linkedClipId: clip.linkedClipId }),
      name: boundedLabel(clip.name),
      outPoint: clip.outPoint,
      startTime: clip.startTime,
      trackId: clip.trackId,
      ...(compactHook === undefined ? {} : { hook: compactHook }),
      ...(transcriptByClipId.has(clip.id)
        ? { transcript: transcriptByClipId.get(clip.id)! }
        : {}),
      };
    }),
    duration: input.duration,
    inPoint: finiteOrNull(input.inPoint),
    outPoint: finiteOrNull(input.outPoint),
    playheadPosition: input.playheadPosition,
    selectedClipIds: [...input.selectedClipIds].sort(),
    semanticTimelineState,
    tracks: input.tracks.map((track) => ({
      id: track.id,
      locked: track.locked === true,
      muted: track.muted,
      name: boundedLabel(track.name),
      solo: track.solo,
      type: track.type,
      visible: track.visible,
    })),
  };
}

export async function buildHostedAgentFastV2BrowserRequest(
  input: BuildHostedAgentFastV2BrowserRequestInput,
): Promise<HostedAgentFastV2StartRequest> {
  const snapshot = input.snapshot;
  const stateFingerprint = await fingerprintPublicTimelineStateV1({
    clips: snapshot.clips.map((clip) => ({
      duration: clip.duration,
      id: clip.id,
      inPoint: clip.inPoint,
      ...(clip.linkedClipId === undefined ? {} : { linkedClipId: clip.linkedClipId }),
      outPoint: clip.outPoint,
      startTime: clip.startTime,
      trackId: clip.trackId,
    })),
    tracks: snapshot.tracks.map((track) => ({ id: track.id, type: track.type })),
  });
  return parseHostedAgentFastV2StartRequest({
    clientInstanceId: input.clientInstanceId,
    compactSnapshot: {
      payload: compactTimelinePayload(snapshot),
      schemaVersion: 1,
      stateFingerprint,
      timelineRevision: snapshot.timelineRevision,
    },
    ...(input.conversationRef === undefined ? {} : { conversationRef: input.conversationRef }),
    editorBuildId: `masterselects:${APP_VERSION}`,
    editorToolCatalog: buildHostedAgentFastV2EditorToolCatalog(),
    executionContractDigest: HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_DIGEST,
    executionContractVersion: HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_VERSION,
    ...(input.executionProfile === undefined
      ? {}
      : { executionProfile: input.executionProfile }),
    protocolVersion: HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION,
    request: input.request,
    ...(input.requestedExecutionMode === undefined
      ? {}
      : { requestedExecutionMode: input.requestedExecutionMode }),
    ...(input.requestedModelClass === undefined
      ? {}
      : { requestedModelClass: input.requestedModelClass }),
    runSource: input.runSource,
    turnId: input.turnId,
    visualReferences: input.visualReferences ?? [],
  });
}
