import {
  getTimelineRevision,
  restoreTimelineRevisionForHostedAgentResume,
} from '../../stores/timeline/revisionMiddleware';
import { useTimelineStore } from '../../stores/timeline';
import { createSerializableTimelineState } from '../../stores/timeline/serialization/serializableTimelineState';
import { useMediaStore } from '../../stores/mediaStore';
import { getStoryboardProjectSnapshot } from '../../stores/storyboardStore';
import { executeAIToolCalls } from '../aiTools';
import {
  HOSTED_AGENT_FAST_V2_CAPABILITY_BUNDLE_VERSION,
  HostedAgentFastV2ContractError,
  HostedAgentK2ClientSession,
  adaptHostedAgentFastV2TransportToK2,
  buildHostedAgentFastV2BrowserRequest,
  buildHostedAgentFastV2ProjectContext,
  clearHostedAgentReloadSnapshot,
  createHostedAgentFastV2FetchTransport,
  getHostedAgentClientInstanceId,
  describeHostedAgentFastV2AspectRatio,
  hostedAgentFastV2RoundIdempotencyKey,
  readHostedAgentFastV2ReloadSnapshot,
  saveHostedAgentFastV2ReloadSnapshot,
  type HostedAgentFastV2FetchTransport,
  type HostedAgentFastV2StartRequest,
  type HostedAgentFastV2TurnAccepted,
  type HostedAgentFastV2VisualReference,
  type HostedAgentK2ClientPersistedState,
  type HostedAgentK2OperationCheckpoint,
  type HostedAgentToolExecutionMode,
} from '../kernelClient/hostedAgent';
import { buildHostedAgentFastV2SemanticTimelineState } from '../kernelClient/hostedAgent/fastV2SemanticTimelineState';
import { hostedAgentProgressForEvent } from '../kernelClient/hostedAgent/hostedAgentProgress';
import { createKernelProgressEvent } from '../kernelClient/runProgress';
import { createWp1AgentTransactionAdapter } from '../kernelClient/wp1Spike/agentTransactionAdapter';
import { createWp1EditorOperationDispatcher } from '../kernelClient/wp1Spike/editorOperationDispatcher';
import { KernelOperationRoundTripV1 } from '../kernelClient/wp1Spike/operationRoundTrip';
import {
  canonicalPublicTimelineStateV1,
  fingerprintPublicTimelineStateV1,
} from '../kernelClient/wp1Spike/publicOperationContracts';
import { resolveClipTranscriptWords } from '../transcription/clipTranscriptResolver';
import {
  KernelOperationSessionAuthorityV1,
  type KernelOperationSessionDescriptorV1,
} from '../kernelClient/wp1Spike/operationSessionAuthority';
import {
  applyConfirmedCreditUpdate,
  beginCreditActivity,
  endCreditActivity,
  recordCreditActivityTotal,
} from '../credits/creditBalanceCoordinator';
import { emitAgentActivity } from './FlashBoardChatActivity';
import {
  appendFlashBoardChatRunToolCalls,
  completeFlashBoardChatRun,
  reactivateFlashBoardChatRunByIdempotencyKey,
} from './FlashBoardChatRunAudit';
import { findFlashBoardChatImageData } from './FlashBoardChatImageData';
import { approveFlashBoardKernelOperation } from './FlashBoardKernelOperationConfirmation';
import type {
  FlashBoardChatAgentMode,
  FlashBoardChatRequest,
  FlashBoardChatExecutionProfile,
  FlashBoardChatModelClass,
  FlashBoardChatToolExecutionMode,
  FlashBoardChatVisualReference,
  FlashBoardExecutedToolCall,
} from './FlashBoardChatTypes';

function clientInstanceId(): string {
  return getHostedAgentClientInstanceId();
}

function turnId(request: FlashBoardChatRequest): string {
  const candidate = request.idempotencyKey?.trim();
  if (candidate && /^[A-Za-z0-9:_-]{1,160}$/.test(candidate)) {
    return candidate;
  }
  return `flashboard-chat-turn:${Date.now()}:${crypto.randomUUID()}`;
}

function hostedExecutionMode(
  mode: FlashBoardChatToolExecutionMode | undefined,
): HostedAgentToolExecutionMode {
  return mode === 'plan' || mode === 'read-only' ? mode : 'normal';
}

function getVisualReferenceImage(reference: FlashBoardChatVisualReference): {
  base64: string;
  mediaType: string;
} {
  const image = findFlashBoardChatImageData(reference.dataUrl);
  if (!image) {
    throw new Error('A chat reference is not a supported PNG, JPEG, GIF, or WebP image.');
  }
  return { base64: image.base64.replace(/\s+/g, ''), mediaType: image.mediaType };
}

function fastV2VisualReferences(
  visualReferences: readonly FlashBoardChatVisualReference[],
): HostedAgentFastV2VisualReference[] {
  return visualReferences.map((reference, index) => {
    const image = getVisualReferenceImage(reference);
    return {
      id: `initial-reference-${index + 1}`,
      mediaType: image.mediaType as HostedAgentFastV2VisualReference['mediaType'],
      role: 'initial',
      source: reference.dataUrl,
      transport: 'data-url',
    };
  });
}

async function buildCurrentHostedAgentFastV2Request(
  request: FlashBoardChatRequest,
): Promise<HostedAgentFastV2StartRequest> {
  const currentTurnId = turnId(request);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const timelineRevision = getTimelineRevision();
    const state = useTimelineStore.getState();
    request.onKernelProgress?.(createKernelProgressEvent('reading-timeline', {
      detail: `${state.clips.length} timeline clip${state.clips.length === 1 ? '' : 's'}`,
    }));
    const transcriptsByClipId = new Map<string, typeof state.clips[number]['transcript']>();
    const clips = state.clips.map((clip) => {
      const transcript = resolveClipTranscriptWords(clip);
      if (transcript !== undefined) transcriptsByClipId.set(clip.id, transcript);
      return {
        ...clip,
        ...(transcript === undefined ? {} : { transcript }),
      };
    });
    if (transcriptsByClipId.size > 0) {
      request.onKernelProgress?.(createKernelProgressEvent('reading-transcript', {
        detail: `${transcriptsByClipId.size} clip transcript${transcriptsByClipId.size === 1 ? '' : 's'}`,
      }));
    }
    const tracks = state.tracks.map((track) => ({
      height: track.height,
      id: track.id,
      locked: track.locked,
      muted: track.muted,
      name: track.name,
      solo: track.solo,
      type: track.type,
      visible: track.visible,
    }));
    const mediaState = useMediaStore.getState();
    request.onKernelProgress?.(createKernelProgressEvent('preparing-evidence', {
      detail: `${mediaState.files.length} project file${mediaState.files.length === 1 ? '' : 's'}`,
    }));
    const sourceArtifactsByMediaFileId = new Map(mediaState.files.map((file) => [file.id, {
      analysis: file.analysis,
      analysisProgress: file.analysisProgress,
      analysisStatus: file.analysisStatus,
      faceAnalysisMessage: file.faceAnalysisMessage,
      faceAnalysisProgress: file.faceAnalysisProgress,
      faceAnalysisStatus: file.faceAnalysisStatus,
      sceneDescriptionMessage: file.sceneDescriptionMessage,
      sceneDescriptionProgress: file.sceneDescriptionProgress,
      sceneDescriptions: file.sceneDescriptions,
      sceneDescriptionStatus: file.sceneDescriptionStatus,
      transcript: file.transcript,
      transcriptStatus: file.transcriptStatus,
    }]));
    const composition = mediaState.activeCompositionId
      ? mediaState.compositions.find((candidate) => candidate.id === mediaState.activeCompositionId)
      : undefined;
    const referencedMediaItemIds = state.clips.flatMap((clip) => [
      clip.source?.mediaFileId,
      clip.mediaFileId,
      clip.compositionId,
      clip.signalAssetId,
    ].filter((id): id is string => typeof id === 'string' && id.length > 0));
    const compositionAspect = composition
      ? describeHostedAgentFastV2AspectRatio(composition.width, composition.height)
      : undefined;
    const activeComposition = composition && compositionAspect
      ? {
          aspectLabel: compositionAspect.aspectLabel,
          aspectRatio: compositionAspect.aspectRatio,
          backgroundColor: composition.backgroundColor,
          ...(composition.camera === undefined ? {} : { camera: composition.camera }),
          ...(composition.captionComp === undefined ? {} : { captionComp: composition.captionComp }),
          duration: composition.duration,
          frameRate: composition.frameRate,
          height: composition.height,
          id: composition.id,
          name: composition.name,
          orientation: compositionAspect.orientation,
          ...(composition.transitionComp === undefined
            ? {}
            : { transitionComp: composition.transitionComp }),
          width: composition.width,
        }
      : null;
    const serializedTimeline = createSerializableTimelineState(state);
    const storyboard = getStoryboardProjectSnapshot();
    const visualReferences = fastV2VisualReferences(request.visualReferences ?? []);
    let built: HostedAgentFastV2StartRequest | undefined;
    let builtProjectContext: ReturnType<typeof buildHostedAgentFastV2ProjectContext> | undefined;
    let builtProjectContextMaximumCharacters: number | undefined;
    let startSizeError: HostedAgentFastV2ContractError | undefined;
    for (const maximumCharacters of [350_000, 200_000, 100_000, 50_000, 25_000]) {
      const projectContext = buildHostedAgentFastV2ProjectContext(mediaState, {
        maximumCharacters,
        referencedMediaItemIds,
      });
      const semanticTimelineState = buildHostedAgentFastV2SemanticTimelineState({
        activeComposition,
        activeMaskId: state.activeMaskId,
        layers: state.layers,
        primarySelectedClipId: state.primarySelectedClipId,
        projectContext,
        propertiesSelection: state.propertiesSelection,
        runtimeClips: state.clips,
        selectedClipIds: [...state.selectedClipIds],
        selectedKeyframeIds: [...state.selectedKeyframeIds],
        selectedLayerId: state.selectedLayerId,
        selectedVertexIds: [...state.selectedVertexIds],
        serializedTimeline,
        sourceArtifactsByMediaFileId,
        storyboard,
        timelineRangeSelection: state.timelineRangeSelection,
        timelineRevision,
        transcriptsByClipId,
      });
      try {
        built = await buildHostedAgentFastV2BrowserRequest({
          clientInstanceId: clientInstanceId(),
          ...(request.conversationRef === undefined
            ? {}
            : { conversationRef: request.conversationRef }),
          executionProfile: request.executionProfile ?? 'fast',
          ...(request.preproductionRunId === undefined
            ? {}
            : { preproductionRunId: request.preproductionRunId }),
          request: request.prompt,
          ...(request.requestedAgentMode === undefined
            ? {}
            : { requestedAgentMode: request.requestedAgentMode }),
          requestedExecutionMode: hostedExecutionMode(request.toolExecutionMode),
          requestedModelClass: request.requestedModelClass ?? 'fast',
          runSource: request.runSource === 'bridge' || request.runSource === 'mcp'
            ? request.runSource
            : 'ui',
          snapshot: {
            clips,
            duration: state.duration,
            inPoint: state.inPoint,
            outPoint: state.outPoint,
            playheadPosition: state.playheadPosition,
            selectedClipIds: new Set(state.selectedClipIds),
            semanticTimelineState,
            timelineRevision,
            tracks,
          },
          turnId: currentTurnId,
          visualReferences,
        });
        builtProjectContext = projectContext;
        builtProjectContextMaximumCharacters = maximumCharacters;
        break;
      } catch (error) {
        if (
          !(error instanceof HostedAgentFastV2ContractError)
          || !error.message.includes('canonical total byte bound')
        ) throw error;
        startSizeError = error;
      }
    }
    if (!built) throw startSizeError ?? new Error('The Auto request could not be bounded.');
    const currentProjectContext = buildHostedAgentFastV2ProjectContext(useMediaStore.getState(), {
      maximumCharacters: builtProjectContextMaximumCharacters,
      referencedMediaItemIds,
    });
    if (
      getTimelineRevision() === timelineRevision
      && JSON.stringify(currentProjectContext) === JSON.stringify(builtProjectContext)
    ) return built;
  }
  throw new Error('The timeline changed while the Auto snapshot was being prepared.');
}

export async function getHostedAgentExecutionProfileAvailability(
  input: { signal?: AbortSignal } = {},
): Promise<readonly FlashBoardChatExecutionProfile[]> {
  const transport = createHostedAgentFastV2FetchTransport({ signal: input.signal });
  const selection = await transport.getProtocol({ signal: input.signal });
  return [...selection.availableExecutionProfiles];
}

export async function getHostedAgentModelClassAvailability(
  input: { signal?: AbortSignal } = {},
): Promise<readonly FlashBoardChatModelClass[]> {
  return (await getHostedAgentCapabilityAvailability(input)).modelClasses;
}

export interface HostedAgentCapabilityAvailability {
  agentModes: readonly FlashBoardChatAgentMode[];
  modelClasses: readonly FlashBoardChatModelClass[];
}

export async function getHostedAgentCapabilityAvailability(
  input: { signal?: AbortSignal } = {},
): Promise<HostedAgentCapabilityAvailability> {
  const transport = createHostedAgentFastV2FetchTransport({ signal: input.signal });
  const selection = await transport.getProtocol({ signal: input.signal });
  return {
    agentModes: [...selection.availableAgentModes],
    modelClasses: ['very-fast', 'fast', 'slow'],
  };
}

function createKernelOperationRoundTrip(
  descriptor: KernelOperationSessionDescriptorV1,
  sessionId: string,
  turnRequest: Pick<HostedAgentFastV2StartRequest, 'clientInstanceId' | 'turnId'>,
  callbackRequest: FlashBoardChatRequest,
  restoredNextSequence?: number,
): KernelOperationRoundTripV1 {
  return new KernelOperationRoundTripV1({
    authority: new KernelOperationSessionAuthorityV1({
      binding: {
        clientInstanceId: turnRequest.clientInstanceId,
        sessionId,
        turnId: turnRequest.turnId,
      },
      descriptor,
      restoredNextSequence,
    }),
    requestConfirmation: async (request) => {
      const approved = await approveFlashBoardKernelOperation(callbackRequest, request);
      return {
        decision: approved ? 'approved' : 'denied',
        planBinding: request.planBinding,
      };
    },
    dependencies: {
      dispatch: createWp1EditorOperationDispatcher(executeAIToolCalls),
      getCommittedStateFingerprint: async () => {
        const { clips, tracks } = useTimelineStore.getState();
        return fingerprintPublicTimelineStateV1({ clips, tracks });
      },
      getPreparedStateFingerprint: async () => {
        const { clips, tracks } = useTimelineStore.getState();
        return fingerprintPublicTimelineStateV1({ clips, tracks });
      },
      getTimelineRevision,
      transaction: createWp1AgentTransactionAdapter(),
    },
    onProgress: callbackRequest.onKernelProgress,
  });
}

async function sendNormalPathTurn(
  input: { request: FlashBoardChatRequest },
  transport: HostedAgentFastV2FetchTransport,
): Promise<string> {
  const turnRequest = await buildCurrentHostedAgentFastV2Request(input.request);
  if (input.request.resumeMessageId) {
    saveHostedAgentFastV2ReloadSnapshot({
      assistantMessageId: input.request.resumeMessageId,
      cursor: null,
      operationCheckpoint: null,
      request: turnRequest,
      ...currentFastV2ReloadTimelineCheckpoint(),
    });
  }
  let accepted: HostedAgentFastV2TurnAccepted;
  try {
    input.request.signal?.throwIfAborted();
    accepted = await transport.start({
      request: turnRequest,
      // Do not lose the server binding if Stop/New lands while start is in
      // flight. Once accepted, runHostedFastV2Session sees the original abort
      // and cancels the bound kernel turn before doing any further work.
      signal: input.request.signal === undefined
        ? undefined
        : new AbortController().signal,
    });
  } catch (error) {
    if (input.request.resumeMessageId) {
      clearHostedAgentReloadSnapshot(input.request.resumeMessageId);
    }
    throw error;
  }
  input.request.onPhase?.('provider');
  input.request.onKernelProgress?.(createKernelProgressEvent('compiling'));
  return runHostedFastV2Session({
    accepted,
    assistantMessageId: input.request.resumeMessageId,
    callbackRequest: input.request,
    transport,
    turnRequest,
  });
}

async function runHostedFastV2Session(input: {
  accepted: HostedAgentFastV2TurnAccepted;
  assistantMessageId?: string;
  callbackRequest: FlashBoardChatRequest;
  restoredCursor?: string | null;
  restoredOperationCheckpoint?: HostedAgentK2OperationCheckpoint | null;
  transport: HostedAgentFastV2FetchTransport;
  turnRequest: HostedAgentFastV2StartRequest;
}): Promise<string> {
  const activityId = input.turnRequest.turnId;
  beginCreditActivity({
    feature: 'AI agent',
    id: activityId,
    targetId: 'flashboard-credit-activity-anchor',
  });
  let activityEnded = false;
  const finishActivity = (status: 'completed' | 'failed' | 'canceled') => {
    if (activityEnded) return;
    activityEnded = true;
    endCreditActivity({ id: activityId, status });
  };
  const persist = (state: HostedAgentK2ClientPersistedState) => {
    if (!input.assistantMessageId) return;
    if (state.status !== 'active' || !state.reloadResumable) {
      clearHostedAgentReloadSnapshot(input.assistantMessageId);
      return;
    }
    saveHostedAgentFastV2ReloadSnapshot({
      assistantMessageId: input.assistantMessageId,
      cursor: state.cursor,
      operationCheckpoint: state.operationCheckpoint,
      request: input.turnRequest,
      ...currentFastV2ReloadTimelineCheckpoint(),
    });
  };
  if (input.assistantMessageId) {
    saveHostedAgentFastV2ReloadSnapshot({
      assistantMessageId: input.assistantMessageId,
      cursor: input.restoredCursor ?? null,
      operationCheckpoint: input.restoredOperationCheckpoint ?? null,
      request: input.turnRequest,
      ...currentFastV2ReloadTimelineCheckpoint(),
    });
  }

  let client: HostedAgentK2ClientSession;
  try {
    client = new HostedAgentK2ClientSession({
      clientInstanceId: input.turnRequest.clientInstanceId,
      completedBatches: [],
      cursor: input.restoredCursor,
      lease: input.accepted.pageLease,
      onStateChange: persist,
      operationCheckpoint: input.restoredOperationCheckpoint,
      toolSchemaVersion: HOSTED_AGENT_FAST_V2_CAPABILITY_BUNDLE_VERSION,
      transport: adaptHostedAgentFastV2TransportToK2(input.transport),
      turnId: input.turnRequest.turnId,
    });
  } catch (error) {
    finishActivity('failed');
    throw error;
  }

  let finalMessage = '';
  let terminalError = '';
  let detachingForReload = false;
  const interruptForPageExit = () => {
    detachingForReload = true;
    client.detachForReload();
  };
  window.addEventListener('pagehide', interruptForPageExit);
  try {
    const result = await client.runUntilTerminal({
      createOperationRoundTrip: (descriptor, restoredNextSequence) => createKernelOperationRoundTrip(
        descriptor,
        input.accepted.pageLease.sessionId,
        input.turnRequest,
        input.callbackRequest,
        restoredNextSequence,
      ),
      execute: async () => {
        throw new Error('Auto rejected an unexpected client tool-batch request.');
      },
      onEvent: (event) => {
        const progress = hostedAgentProgressForEvent(event, 'settled');
        if (progress) input.callbackRequest.onKernelProgress?.(progress);
        if (event.kind === 'narration-delta') {
          input.callbackRequest.onTextDelta?.(event.text);
        } else if (event.kind === 'narration-complete') {
          emitAgentActivity(input.callbackRequest, {
            kind: 'narration',
            phase: event.phase,
            roundIndex: event.roundIndex,
            text: event.text,
          });
        } else if (event.kind === 'billing-settled') {
          applyConfirmedCreditUpdate({
            activityId,
            activityTotalCredits: event.totalCreditsCharged,
            balance: event.creditBalance,
            credits: event.creditsCharged,
            kind: 'debit',
            mutationId: event.ledgerEntryId
              ? `debit:hosted:ai_chat:${event.ledgerEntryId}`
              : `debit:hosted:ai_chat:${hostedAgentFastV2RoundIdempotencyKey(event.turnId, event.roundIndex)}`,
            source: 'hosted:ai_chat',
          });
        } else if (event.kind === 'turn-complete') {
          recordCreditActivityTotal(activityId, event.creditsCharged);
          finalMessage = event.message;
          if (event.inputRequest) input.callbackRequest.onKernelInputRequest?.(event.inputRequest);
          finishActivity('completed');
        } else if (
          event.kind === 'turn-failed'
          || event.kind === 'turn-canceled'
          || event.kind === 'turn-interrupted'
        ) {
          terminalError = event.message === 'fast-family-unsupported'
            ? 'Auto does not support this request yet.'
            : event.message;
          finishActivity(event.kind === 'turn-canceled' ? 'canceled' : 'failed');
        }
      },
      onEventStart: (event) => {
        const progress = hostedAgentProgressForEvent(event, 'starting');
        if (progress) input.callbackRequest.onKernelProgress?.(progress);
      },
      signal: input.callbackRequest.signal,
    });
    if (result.status !== 'completed') {
      throw new Error(terminalError || `The Auto turn ended as ${result.status}.`);
    }
    if (input.assistantMessageId) {
      clearHostedAgentReloadSnapshot(input.assistantMessageId);
    }
    if (!finalMessage.trim()) {
      throw new Error('The kernel completed without a final Auto response.');
    }
    return finalMessage;
  } catch (error) {
    if (!detachingForReload) {
      finishActivity(input.callbackRequest.signal?.aborted ? 'canceled' : 'failed');
    }
    if (!detachingForReload && input.assistantMessageId) {
      clearHostedAgentReloadSnapshot(input.assistantMessageId);
    }
    throw error;
  } finally {
    window.removeEventListener('pagehide', interruptForPageExit);
  }
}

function currentFastV2ReloadTimelineCheckpoint(): {
  timelineRevision: number;
  timelineStateCanonical: string;
} {
  const { clips, timelineRevision, tracks } = useTimelineStore.getState();
  return {
    timelineRevision,
    timelineStateCanonical: JSON.stringify(canonicalPublicTimelineStateV1({ clips, tracks })),
  };
}

export async function sendNormalPathAgentChat(input: {
  request: FlashBoardChatRequest;
}): Promise<string> {
  const fastV2Transport = createHostedAgentFastV2FetchTransport({
    signal: input.request.signal,
  });
  const selection = await fastV2Transport.getProtocol({ signal: input.request.signal });
  if (
    input.request.requestedAgentMode === 'logic'
    && !selection.availableAgentModes.some((mode) => mode === 'logic')
  ) {
    throw new Error(
      'Logic is not available for this account yet. Choose the standard agent and try again.',
    );
  }
  if ((input.request.executionProfile ?? 'fast') !== 'fast') {
    throw new Error('Auto is the only supported general editing profile.');
  }
  return sendNormalPathTurn(input, fastV2Transport);
}

async function resumeNormalPathTurn(input: {
  assistantMessageId: string;
  request: FlashBoardChatRequest;
}): Promise<string | null> {
  const snapshot = readHostedAgentFastV2ReloadSnapshot(input.assistantMessageId);
  if (!snapshot) return null;
  if (snapshot.request.clientInstanceId !== clientInstanceId()) {
    clearHostedAgentReloadSnapshot(input.assistantMessageId);
    return null;
  }
  const currentTimeline = currentFastV2ReloadTimelineCheckpoint();
  if (currentTimeline.timelineStateCanonical !== snapshot.timelineStateCanonical) {
    clearHostedAgentReloadSnapshot(input.assistantMessageId);
    throw new Error(
      'The timeline changed while the hosted agent was reconnecting, so the run was stopped safely.',
    );
  }
  restoreTimelineRevisionForHostedAgentResume(snapshot.timelineRevision);

  const auditRun = await reactivateFlashBoardChatRunByIdempotencyKey(snapshot.request.turnId);
  const resumedToolCalls: FlashBoardExecutedToolCall[] = [];
  const callbackRequest: FlashBoardChatRequest = {
    ...input.request,
    onExecutedToolCalls: (toolCalls) => {
      resumedToolCalls.push(...toolCalls);
      if (auditRun) appendFlashBoardChatRunToolCalls(auditRun.runId, toolCalls);
      input.request.onExecutedToolCalls?.(toolCalls);
    },
  };
  const transport = createHostedAgentFastV2FetchTransport({ signal: input.request.signal });
  try {
    input.request.signal?.throwIfAborted();
    const accepted = await transport.start({
      request: snapshot.request,
      signal: input.request.signal === undefined
        ? undefined
        : new AbortController().signal,
    });
    input.request.onPhase?.('provider');
    const response = await runHostedFastV2Session({
      accepted,
      assistantMessageId: input.assistantMessageId,
      callbackRequest,
      restoredCursor: snapshot.cursor,
      restoredOperationCheckpoint: snapshot.operationCheckpoint,
      transport,
      turnRequest: snapshot.request,
    });
    if (auditRun) {
      completeFlashBoardChatRun(auditRun.runId, {
        executedToolCalls: resumedToolCalls,
        response,
      });
    }
    return response;
  } catch (error) {
    if (auditRun) {
      completeFlashBoardChatRun(auditRun.runId, {
        error,
        executedToolCalls: resumedToolCalls,
      });
    }
    throw error;
  }
}

export async function resumeNormalPathAgentChat(input: {
  assistantMessageId: string;
  request: FlashBoardChatRequest;
}): Promise<string | null> {
  return readHostedAgentFastV2ReloadSnapshot(input.assistantMessageId)
    ? resumeNormalPathTurn(input)
    : null;
}
