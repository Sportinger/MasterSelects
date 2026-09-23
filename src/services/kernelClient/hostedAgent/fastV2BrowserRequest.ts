import type { TimelineClip, TimelineTrack } from '../../../types/timeline';
import { resolveEditableHookLayerMetadata } from '../../aiTools/editableHookIdentity';
import { APP_VERSION } from '../../../version';
import {
  TIMELINE_SPEECH_SNAPSHOT_MAX_SEGMENTS,
  TIMELINE_SPEECH_SNAPSHOT_MAX_TEXT_CHARACTERS,
} from '../../transcription/timelineSpeechContract';
import { buildTimelineSpeechProjection } from '../../transcription/timelineSpeechProjection';
import { sanitizeHostedAgentFastV2SemanticJson } from './fastV2SemanticTimelineState';
import { buildHostedAgentFastV2EditorToolCatalog } from './fastV2EditorToolCatalog';
import { buildAgentNodeCatalogContext } from '../../nodeGraph/agentNodeCatalog';
import {
  fingerprintPublicTimelineStateV1,
} from '../wp1Spike/publicOperationContracts';
import {
  HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_DIGEST,
  HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_VERSION,
  HOSTED_AGENT_FAST_V2_MAX_TIMELINE_TRANSCRIPT_WORDS,
  HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION,
  parseHostedAgentFastV2StartRequest,
  type HostedAgentFastV2RequestedAgentMode,
  type HostedAgentFastV2ExecutionProfile,
  type HostedAgentFastV2RequestedExecutionMode,
  type HostedAgentFastV2RequestedModelClass,
  type HostedAgentFastV2RunSource,
  type HostedAgentFastV2StartRequest,
  type HostedAgentFastV2VisualReference,
} from './fastV2StartContract';

const MAX_LABEL_CHARACTERS = 500;

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
  preproductionRunId?: string;
  request: string;
  requestedAgentMode?: HostedAgentFastV2RequestedAgentMode;
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

function compactTimelinePayload(input: HostedAgentFastV2TimelineSnapshotInput, request: string) {
  const semanticTimelineState = sanitizeHostedAgentFastV2SemanticJson({
    ...input.semanticTimelineState,
    editorNodeCatalog: buildAgentNodeCatalogContext(request),
  });
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
  const timelineSpeech = buildTimelineSpeechProjection({
    clips: input.clips,
    maximumWords: HOSTED_AGENT_FAST_V2_MAX_TIMELINE_TRANSCRIPT_WORDS,
    tracks: input.tracks,
  });
  const transcriptWordsByClipId = new Map<
    string,
    Array<{ text: string; timelineEnd: number; timelineStart: number }>
  >();
  for (const word of timelineSpeech.words) {
    const words = transcriptWordsByClipId.get(word.clipId) ?? [];
    words.push({
      text: word.text,
      timelineEnd: word.timelineEnd,
      timelineStart: word.timelineStart,
    });
    transcriptWordsByClipId.set(word.clipId, words);
  }
  const transcriptByClipId = new Map([...transcriptWordsByClipId].map(([clipId, words]) => {
    const counts = timelineSpeech.clipWordCounts.get(clipId);
    const totalWords = counts?.totalWords ?? words.length;
    return [clipId, {
      timebase: 'timeline-seconds' as const,
      totalWords,
      truncated: words.length < totalWords,
      words,
    }] as const;
  }));
  const speechSegments = timelineSpeech.segments.slice(0, TIMELINE_SPEECH_SNAPSHOT_MAX_SEGMENTS);
  const speechText = timelineSpeech.text.slice(0, TIMELINE_SPEECH_SNAPSHOT_MAX_TEXT_CHARACTERS);

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
    timelineSpeech: {
      schemaVersion: 1,
      audibleClipCount: timelineSpeech.audibleClipCount,
      excluded: timelineSpeech.excluded,
      overlappingWordCount: timelineSpeech.overlappingWordCount,
      projectedWordCount: timelineSpeech.words.length,
      range: timelineSpeech.range,
      segments: speechSegments,
      segmentsTruncated: speechSegments.length < timelineSpeech.segments.length,
      sourceClipCount: timelineSpeech.sourceClipCount,
      text: speechText,
      textTruncated: speechText.length < timelineSpeech.text.length,
      timebase: timelineSpeech.timebase,
      timelineRevision: input.timelineRevision,
      totalWords: timelineSpeech.totalWords,
      truncated: timelineSpeech.truncated,
    },
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
      payload: compactTimelinePayload(snapshot, input.request),
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
    ...(input.preproductionRunId === undefined
      ? {}
      : { preproductionRunId: input.preproductionRunId }),
    protocolVersion: HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION,
    request: input.request,
    ...(input.requestedAgentMode === undefined
      ? {}
      : { requestedAgentMode: input.requestedAgentMode }),
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
