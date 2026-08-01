import type { TimelineClip, TimelineTrack } from '../../../types/timeline';
import { APP_VERSION } from '../../../version';
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

export interface HostedAgentFastV2TimelineSnapshotInput {
  clips: readonly TimelineClip[];
  duration: number;
  inPoint: number | null;
  outPoint: number | null;
  playheadPosition: number;
  selectedClipIds: ReadonlySet<string>;
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

function compactTimelinePayload(input: HostedAgentFastV2TimelineSnapshotInput) {
  return {
    clips: input.clips.map((clip) => ({
      duration: clip.duration,
      id: clip.id,
      inPoint: clip.inPoint,
      ...(clip.linkedClipId === undefined ? {} : { linkedClipId: clip.linkedClipId }),
      name: boundedLabel(clip.name),
      outPoint: clip.outPoint,
      startTime: clip.startTime,
      trackId: clip.trackId,
    })),
    duration: input.duration,
    inPoint: finiteOrNull(input.inPoint),
    outPoint: finiteOrNull(input.outPoint),
    playheadPosition: input.playheadPosition,
    selectedClipIds: [...input.selectedClipIds].sort(),
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
