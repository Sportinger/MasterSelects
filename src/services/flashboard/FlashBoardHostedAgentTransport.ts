import { getTimelineRevision } from '../../stores/timeline/revisionMiddleware';
import { useTimelineStore } from '../../stores/timeline';
import { createSerializableTimelineState } from '../../stores/timeline/serialization/serializableTimelineState';
import { useMediaStore } from '../../stores/mediaStore';
import { getStoryboardProjectSnapshot } from '../../stores/storyboardStore';
import { executeAIToolCalls } from '../aiTools';
import { handleCaptureFrame } from '../aiTools/handlers/preview';
import {
  HOSTED_AGENT_MAXIMUM_ITERATIONS,
  HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION,
  HOSTED_AGENT_FAST_V2_CAPABILITY_BUNDLE_VERSION,
  HostedAgentFastV2ContractError,
  HostedAgentK2ClientSession,
  adaptHostedAgentFastV2TransportToK2,
  buildHostedAgentFastV2BrowserRequest,
  buildHostedAgentFastV2ProjectContext,
  clearHostedAgentReloadSnapshot,
  createHostedAgentFastV2FetchTransport,
  createHostedAgentK2FetchTransport,
  getHostedAgentClientInstanceId,
  describeHostedAgentFastV2AspectRatio,
  hostedAgentFastV2RoundIdempotencyKey,
  hostedAgentRoundIdempotencyKey,
  readHostedAgentFastV2ReloadSnapshot,
  readHostedAgentReloadSnapshot,
  saveHostedAgentFastV2ReloadSnapshot,
  saveHostedAgentReloadSnapshot,
  startHostedAgentK2Turn,
  type HostedAgentEvent,
  type HostedAgentFastV2FetchTransport,
  type HostedAgentFastV2StartRequest,
  type HostedAgentFastV2TurnAccepted,
  type HostedAgentFastV2VisualReference,
  type HostedAgentK1TurnRequest,
  type HostedAgentK2BatchExecutorResult,
  type HostedAgentK2ClientPersistedState,
  type HostedAgentToolExecutionMode,
  type HostedAgentTurnAccepted,
} from '../kernelClient/hostedAgent';
import { buildHostedAgentFastV2SemanticTimelineState } from '../kernelClient/hostedAgent/fastV2SemanticTimelineState';
import { createWp1AgentTransactionAdapter } from '../kernelClient/wp1Spike/agentTransactionAdapter';
import { createWp1EditorOperationDispatcher } from '../kernelClient/wp1Spike/editorOperationDispatcher';
import { KernelOperationRoundTripV1 } from '../kernelClient/wp1Spike/operationRoundTrip';
import { fingerprintPublicTimelineStateV1 } from '../kernelClient/wp1Spike/publicOperationContracts';
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
import {
  FLASHBOARD_CHAT_MAX_OUTPUT_TOKENS,
  clampTemperature,
  isOpenAiReasoningEffortSupported,
  isTemperatureSupported,
  normalizeOpenAiReasoningEffort,
} from './FlashBoardChatConfig';
import {
  ANTHROPIC_TOOLS,
  OPENAI_RESPONSES_TOOLS,
  executeFlashBoardToolCalls,
  getFlashBoardToolResultImage,
  prepareFlashBoardToolCallsForHistory,
} from './FlashBoardChatTools';
import {
  emitAgentActivity,
  safeToolActivityLabel,
} from './FlashBoardChatActivity';
import {
  appendFlashBoardChatRunToolCalls,
  completeFlashBoardChatRun,
  reactivateFlashBoardChatRunByIdempotencyKey,
} from './FlashBoardChatRunAudit';
import { findFlashBoardChatImageData } from './FlashBoardChatImageData';
import { approveFlashBoardKernelOperation } from './FlashBoardKernelOperationConfirmation';
import type {
  FlashBoardChatRequest,
  FlashBoardChatExecutionProfile,
  FlashBoardChatModelClass,
  FlashBoardChatToolExecutionMode,
  FlashBoardChatVisualReference,
  FlashBoardExecutedToolCall,
  FlashBoardKieChatProtocol,
  FlashBoardToolCall,
} from './FlashBoardChatTypes';

const HOSTED_AGENT_PROMPT_VERSION = 'flashboard-chat-v2';
const HOSTED_AGENT_HISTORY_VERSION = 'flashboard-provider-history-v1';
const HOSTED_AGENT_TOOL_SCHEMA_VERSION = 'flashboard-chat-tools-v2';
const HOSTED_AGENT_MAX_TURN_SPEND_CREDITS = 500;
const HOSTED_AGENT_MAXIMUM_INLINE_RESULT_CHARACTERS = 32 * 1024 * 1024;

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

function providerInput(
  protocol: FlashBoardKieChatProtocol,
  prompt: string,
  supportsTools: boolean,
  visualReferences: FlashBoardChatVisualReference[],
): HostedAgentK1TurnRequest['providerInput'] {
  if (protocol === 'openai-responses') {
    return {
      input: [{
        role: 'user',
        content: visualReferences.length === 0
          ? prompt
          : [
              { text: prompt, type: 'input_text' },
              ...visualReferences.map((reference) => ({
                detail: 'high',
                image_url: reference.dataUrl,
                type: 'input_image',
              })),
            ],
      }],
      protocol,
      store: false,
      toolChoice: 'auto',
      tools: supportsTools ? OPENAI_RESPONSES_TOOLS : [],
    };
  }
  return {
    messages: [{
      role: 'user',
      content: visualReferences.length === 0
        ? prompt
        : [
            { text: prompt, type: 'text' },
            ...visualReferences.map((reference) => {
              const image = getVisualReferenceImage(reference);
              return {
                source: {
                  data: image.base64,
                  media_type: image.mediaType,
                  type: 'base64',
                },
                type: 'image',
              };
            }),
          ],
    }],
    protocol,
    tools: supportsTools ? ANTHROPIC_TOOLS : [],
  };
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

function hostedVisualReferences(
  protocol: FlashBoardKieChatProtocol,
  visualReferences: FlashBoardChatVisualReference[],
): HostedAgentK1TurnRequest['visualReferences'] {
  return visualReferences.map((reference, index) => {
    const image = getVisualReferenceImage(reference);
    return {
      id: `initial-reference-${index + 1}`,
      mediaType: image.mediaType,
      role: 'initial',
      source: protocol === 'openai-responses' ? reference.dataUrl : image.base64,
      transport: 'data-url',
    };
  });
}

export function buildHostedAgentTurnRequest(input: {
  protocol: FlashBoardKieChatProtocol;
  request: FlashBoardChatRequest;
  supportsTools: boolean;
  systemPrompt: string;
}): HostedAgentK1TurnRequest {
  const tools = input.supportsTools
    ? (input.protocol === 'openai-responses' ? OPENAI_RESPONSES_TOOLS : ANTHROPIC_TOOLS)
    : [];
  const visualReferences = input.request.visualReferences ?? [];
  const request: HostedAgentK1TurnRequest = {
    clientCapabilities: {
      maximumInlineResultCharacters: HOSTED_AGENT_MAXIMUM_INLINE_RESULT_CHARACTERS,
      supportsImageResultRefs: false,
      supportsNarrationDeltas: true,
      toolNames: tools.map((tool) => tool.name),
    },
    clientInstanceId: clientInstanceId(),
    historyFormatVersion: HOSTED_AGENT_HISTORY_VERSION,
    maximumOutputTokens: FLASHBOARD_CHAT_MAX_OUTPUT_TOKENS,
    maxTurnSpendCredits: HOSTED_AGENT_MAX_TURN_SPEND_CREDITS,
    model: input.request.model,
    modelPrompt: input.request.prompt,
    playbookPrompt: input.request.playbookPrompt ?? input.request.prompt,
    promptVersion: HOSTED_AGENT_PROMPT_VERSION,
    providerInput: providerInput(
      input.protocol,
      input.request.prompt,
      input.supportsTools,
      visualReferences,
    ),
    request: input.request.prompt,
    routePreference: 'auto',
    runSource: input.request.runSource === 'bridge' || input.request.runSource === 'mcp'
      ? input.request.runSource
      : 'ui',
    systemPrompt: input.systemPrompt,
    toolExecutionMode: hostedExecutionMode(input.request.toolExecutionMode),
    toolSchemaVersion: HOSTED_AGENT_TOOL_SCHEMA_VERSION,
    turnId: turnId(input.request),
    visualReferences: hostedVisualReferences(input.protocol, visualReferences),
  };
  if (isTemperatureSupported('kie', input.request.model)) {
    request.temperature = clampTemperature(input.request.temperature);
  }
  if (isOpenAiReasoningEffortSupported(input.request.model)) {
    request.reasoningEffort = normalizeOpenAiReasoningEffort(
      input.request.model,
      input.request.openAiReasoningEffort,
    );
  }
  return request;
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
    const transcriptsByClipId = new Map<string, typeof state.clips[number]['transcript']>();
    const clips = state.clips.map((clip) => {
      const transcript = resolveClipTranscriptWords(clip);
      if (transcript !== undefined) transcriptsByClipId.set(clip.id, transcript);
      return {
        ...clip,
        ...(transcript === undefined ? {} : { transcript }),
      };
    });
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
          executionProfile: request.executionProfile ?? 'fast',
          request: request.prompt,
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
    if (!built) throw startSizeError ?? new Error('The Fast V2 start request could not be bounded.');
    const currentProjectContext = buildHostedAgentFastV2ProjectContext(useMediaStore.getState(), {
      maximumCharacters: builtProjectContextMaximumCharacters,
      referencedMediaItemIds,
    });
    if (
      getTimelineRevision() === timelineRevision
      && JSON.stringify(currentProjectContext) === JSON.stringify(builtProjectContext)
    ) return built;
  }
  throw new Error('The timeline changed while the Fast V2 snapshot was being prepared.');
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
  const transport = createHostedAgentFastV2FetchTransport({ signal: input.signal });
  const selection = await transport.getProtocol({ signal: input.signal });
  return selection.protocolVersion === HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION
    ? ['very-fast', 'fast', 'slow']
    : [];
}

function toolCallsForEvent(
  event: Extract<HostedAgentEvent, { kind: 'tool-batch-request' }>,
): FlashBoardToolCall[] {
  return event.toolCalls.map((toolCall) => ({
    arguments: typeof toolCall.args === 'string'
      ? toolCall.args
      : JSON.stringify(toolCall.args ?? {}),
    id: toolCall.toolCallId,
    name: toolCall.toolName,
  }));
}

function hostedToolResultProviderContent(
  protocol: FlashBoardKieChatProtocol,
  image: { base64: string; dataUrl: string; mediaType: string },
  label: string,
  modelContent: string,
) {
  if (protocol === 'openai-responses') {
    return {
      openAiFollowupInput: [{
        content: [
          { text: label, type: 'input_text' },
          { detail: 'high', image_url: image.dataUrl, type: 'input_image' },
        ],
        role: 'user',
      }],
    };
  }
  return {
    claudeToolResultContent: [
      {
        source: {
          data: image.base64,
          media_type: image.mediaType,
          type: 'base64',
        },
        type: 'image',
      },
      { text: modelContent, type: 'text' },
    ],
  };
}

const VISUAL_RESULT_TOOL_NAMES = new Set([
  'captureFrame',
  'getCutPreviewQuad',
  'getFramesAtTimes',
]);

async function executeKernelToolBatch(
  request: FlashBoardChatRequest,
  protocol: FlashBoardKieChatProtocol,
  executionMode: HostedAgentToolExecutionMode,
  event: Extract<HostedAgentEvent, { kind: 'tool-batch-request' }>,
): Promise<HostedAgentK2BatchExecutorResult> {
  const toolCalls = toolCallsForEvent(event);
  for (const toolCall of toolCalls) {
    emitAgentActivity(request, {
      kind: 'operation',
      phase: 'started',
      safeLabel: safeToolActivityLabel(toolCall.name),
      operationId: toolCall.id,
      toolName: toolCall.name,
    });
  }
  const stateRevisionBefore = getTimelineRevision();
  const executed = await executeFlashBoardToolCalls(
    toolCalls,
    Number.POSITIVE_INFINITY,
    { toolExecutionMode: executionMode },
  );
  const stateRevisionAfter = getTimelineRevision();
  for (const toolResult of executed) {
    emitAgentActivity(request, {
      kind: 'operation',
      phase: toolResult.result.success ? 'completed' : 'failed',
      safeLabel: safeToolActivityLabel(toolResult.toolCall.name),
      operationId: toolResult.toolCall.id,
      toolName: toolResult.toolCall.name,
    });
  }
  request.onExecutedToolCalls?.(prepareFlashBoardToolCallsForHistory(executed));
  const includesRequestedVisualResult = executed.some((toolResult) => (
    toolResult.result.success && VISUAL_RESULT_TOOL_NAMES.has(toolResult.toolCall.name)
  ));
  let automaticPostEditPreview: ReturnType<typeof findFlashBoardChatImageData> = null;
  if (stateRevisionAfter !== stateRevisionBefore && !includesRequestedVisualResult) {
    try {
      const capture = await handleCaptureFrame(
        { mode: 'auto', settleMs: 180 },
        useTimelineStore.getState(),
      );
      if (capture.success) {
        automaticPostEditPreview = findFlashBoardChatImageData(capture.data);
      }
    } catch {
      // The edit result remains authoritative when a best-effort preview cannot render.
    }
  }
  const automaticPreviewResultIndex = automaticPostEditPreview && executed.length > 0
    ? executed.length - 1
    : -1;
  return {
    authority: {
      approval: 'not-required',
      executionMode,
      policyChecked: true,
      stateRevisionAfter: `timeline:${stateRevisionAfter}`,
      stateRevisionBefore: `timeline:${stateRevisionBefore}`,
      validationPassed: true,
    },
    results: executed.map((toolResult, index) => {
      const requestedImage = getFlashBoardToolResultImage(toolResult);
      const image = requestedImage
        ?? (index === automaticPreviewResultIndex ? automaticPostEditPreview : null);
      return {
        ...(toolResult.result.error === undefined ? {} : { error: toolResult.result.error }),
        modelContent: toolResult.modelContent,
        ...(image ? {
          providerContent: hostedToolResultProviderContent(
            protocol,
            image,
            requestedImage
              ? `Visual output from ${toolResult.toolCall.name}:`
              : 'Automatic post-edit preview after this tool batch. This current frame is valid visual evidence; do not call captureFrame again unless you need another time or the image reveals a problem:',
            toolResult.modelContent,
          ),
        } : {}),
        success: toolResult.result.success,
        toolCallId: toolResult.toolCall.id,
      };
    }),
  };
}

async function sendHostedKieAgentChatV1(input: {
  protocol: FlashBoardKieChatProtocol;
  request: FlashBoardChatRequest;
  supportsTools: boolean;
  systemPrompt: string;
}): Promise<string> {
  const turnRequest = buildHostedAgentTurnRequest(input);
  if (input.request.resumeMessageId) {
    saveHostedAgentReloadSnapshot({
      assistantMessageId: input.request.resumeMessageId,
      completedBatches: [],
      cursor: null,
      request: turnRequest,
    });
  }
  let accepted: HostedAgentTurnAccepted;
  try {
    input.request.signal?.throwIfAborted();
    accepted = await startHostedAgentK2Turn({
      request: turnRequest,
      // The accepted response carries the lease required to cancel the kernel
      // turn. Keep this short handshake alive across a UI abort; the client
      // session observes the original signal immediately afterwards and sends
      // the authoritative cancellation with that lease.
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
  assertCompatibleAcceptedTurn(turnRequest, accepted);
  input.request.onPhase?.('provider');
  return runHostedAgentSession({
    accepted,
    assistantMessageId: input.request.resumeMessageId,
    callbackRequest: input.request,
    turnRequest,
  });
}

function assertCompatibleAcceptedTurn(
  turnRequest: HostedAgentK1TurnRequest,
  accepted: HostedAgentTurnAccepted,
): void {
  if (
    accepted.maximumIterations !== HOSTED_AGENT_MAXIMUM_ITERATIONS
    || accepted.acceptedPromptVersion !== turnRequest.promptVersion
    || accepted.acceptedHistoryFormatVersion !== turnRequest.historyFormatVersion
    || accepted.acceptedToolSchemaVersion !== turnRequest.toolSchemaVersion
  ) {
    throw new Error('The kernel accepted an incompatible hosted-agent contract.');
  }
}

function createKernelOperationRoundTrip(
  descriptor: KernelOperationSessionDescriptorV1,
  sessionId: string,
  turnRequest: Pick<HostedAgentK1TurnRequest, 'clientInstanceId' | 'turnId'>,
  callbackRequest: FlashBoardChatRequest,
): KernelOperationRoundTripV1 {
  return new KernelOperationRoundTripV1({
    authority: new KernelOperationSessionAuthorityV1({
      binding: {
        clientInstanceId: turnRequest.clientInstanceId,
        sessionId,
        turnId: turnRequest.turnId,
      },
      descriptor,
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
  });
}

async function sendHostedFastV2AgentChat(
  input: {
    protocol: FlashBoardKieChatProtocol;
    request: FlashBoardChatRequest;
    supportsTools: boolean;
    systemPrompt: string;
  },
  transport: HostedAgentFastV2FetchTransport,
): Promise<string> {
  const turnRequest = await buildCurrentHostedAgentFastV2Request(input.request);
  if (input.request.resumeMessageId) {
    saveHostedAgentFastV2ReloadSnapshot({
      assistantMessageId: input.request.resumeMessageId,
      cursor: null,
      request: turnRequest,
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
    if (state.status !== 'active') {
      clearHostedAgentReloadSnapshot(input.assistantMessageId);
      return;
    }
    saveHostedAgentFastV2ReloadSnapshot({
      assistantMessageId: input.assistantMessageId,
      cursor: state.cursor,
      request: input.turnRequest,
    });
  };
  if (input.assistantMessageId) {
    saveHostedAgentFastV2ReloadSnapshot({
      assistantMessageId: input.assistantMessageId,
      cursor: input.restoredCursor ?? null,
      request: input.turnRequest,
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
      createOperationRoundTrip: (descriptor) => createKernelOperationRoundTrip(
        descriptor,
        input.accepted.pageLease.sessionId,
        input.turnRequest,
        input.callbackRequest,
      ),
      execute: async () => {
        throw new Error('Fast V2 rejected an unexpected client tool-batch request.');
      },
      onEvent: (event) => {
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
          finishActivity('completed');
        } else if (
          event.kind === 'turn-failed'
          || event.kind === 'turn-canceled'
          || event.kind === 'turn-interrupted'
        ) {
          terminalError = event.message === 'verified-family-unsupported'
            ? 'The Verified profile does not support this request yet. Choose Fast or use a supported range-removal request.'
            : event.message === 'fast-family-unsupported'
              ? 'The Fast profile does not support this request yet.'
              : event.message;
          finishActivity(event.kind === 'turn-canceled' ? 'canceled' : 'failed');
        }
      },
      signal: input.callbackRequest.signal,
    });
    if (result.status !== 'completed') {
      throw new Error(terminalError || `The kernel Fast V2 turn ended as ${result.status}.`);
    }
    if (input.assistantMessageId) {
      clearHostedAgentReloadSnapshot(input.assistantMessageId);
    }
    if (!finalMessage.trim()) {
      throw new Error('The kernel completed without a final Fast V2 response.');
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

export async function sendHostedKieAgentChat(input: {
  protocol: FlashBoardKieChatProtocol;
  request: FlashBoardChatRequest;
  supportsTools: boolean;
  systemPrompt: string;
}): Promise<string> {
  const fastV2Transport = createHostedAgentFastV2FetchTransport({
    signal: input.request.signal,
  });
  const selection = await fastV2Transport.getProtocol({ signal: input.request.signal });
  if (
    input.request.requestedModelClass !== undefined
    && selection.protocolVersion !== 'fast-agent-v2'
  ) {
    throw new Error(
      'Fast V2 model switching is currently unavailable. Please try again shortly.',
    );
  }
  const executionProfile = input.request.executionProfile ?? 'fast';
  if (executionProfile === 'verified') {
    if (
      selection.protocolVersion !== 'fast-agent-v2'
      || !selection.availableExecutionProfiles.includes('verified')
    ) {
      throw new Error(
        'The Verified profile pilot is unavailable for this account. Choose Fast and try again.',
      );
    }
    return sendHostedFastV2AgentChat(input, fastV2Transport);
  }
  if (selection.protocolVersion === 'fast-agent-v2') {
    return sendHostedFastV2AgentChat(input, fastV2Transport);
  }
  return sendHostedKieAgentChatV1(input);
}

async function runHostedAgentSession(input: {
  accepted: HostedAgentTurnAccepted;
  assistantMessageId?: string;
  callbackRequest: FlashBoardChatRequest;
  restoredState?: Pick<HostedAgentK2ClientPersistedState, 'completedBatches' | 'cursor'>;
  turnRequest: HostedAgentK1TurnRequest;
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
    if (state.status !== 'active') {
      clearHostedAgentReloadSnapshot(input.assistantMessageId);
      return;
    }
    saveHostedAgentReloadSnapshot({
      assistantMessageId: input.assistantMessageId,
      completedBatches: state.completedBatches,
      cursor: state.cursor,
      request: input.turnRequest,
    });
  };

  if (input.assistantMessageId) {
    saveHostedAgentReloadSnapshot({
      assistantMessageId: input.assistantMessageId,
      completedBatches: input.restoredState?.completedBatches ?? [],
      cursor: input.restoredState?.cursor ?? null,
      request: input.turnRequest,
    });
  }

  let client: HostedAgentK2ClientSession;
  try {
    client = new HostedAgentK2ClientSession({
      clientInstanceId: input.turnRequest.clientInstanceId,
      completedBatches: input.restoredState?.completedBatches,
      cursor: input.restoredState?.cursor,
      lease: input.accepted.pageLease,
      onStateChange: persist,
      toolSchemaVersion: input.turnRequest.toolSchemaVersion,
      transport: createHostedAgentK2FetchTransport({ signal: input.callbackRequest.signal }),
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
      createOperationRoundTrip: (descriptor) => (
        createKernelOperationRoundTrip(
          descriptor,
          input.accepted.pageLease.sessionId,
          input.turnRequest,
          input.callbackRequest,
        )
      ),
      execute: (event) => executeKernelToolBatch(
        input.callbackRequest,
        input.turnRequest.providerInput.protocol,
        input.turnRequest.toolExecutionMode,
        event,
      ),
      onEvent: (event) => {
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
              : `debit:hosted:ai_chat:${hostedAgentRoundIdempotencyKey(event.turnId, event.roundIndex)}`,
            source: 'hosted:ai_chat',
          });
        } else if (event.kind === 'turn-complete') {
          recordCreditActivityTotal(activityId, event.creditsCharged);
          finalMessage = event.message;
          finishActivity('completed');
        } else if (
          event.kind === 'turn-failed'
          || event.kind === 'turn-canceled'
          || event.kind === 'turn-interrupted'
        ) {
          terminalError = event.message;
          finishActivity(event.kind === 'turn-canceled' ? 'canceled' : 'failed');
        }
      },
      signal: input.callbackRequest.signal,
    });
    if (result.status !== 'completed') {
      throw new Error(terminalError || `The kernel fast-agent turn ended as ${result.status}.`);
    }
    if (input.assistantMessageId) {
      clearHostedAgentReloadSnapshot(input.assistantMessageId);
    }
    if (!finalMessage.trim()) {
      throw new Error('The kernel completed without a final agent response.');
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

async function resumeHostedFastV2AgentChat(input: {
  assistantMessageId: string;
  request: FlashBoardChatRequest;
}): Promise<string | null> {
  const snapshot = readHostedAgentFastV2ReloadSnapshot(input.assistantMessageId);
  if (!snapshot) return null;
  if (snapshot.request.clientInstanceId !== clientInstanceId()) {
    clearHostedAgentReloadSnapshot(input.assistantMessageId);
    return null;
  }

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

export async function resumeHostedKieAgentChat(input: {
  assistantMessageId: string;
  request: FlashBoardChatRequest;
}): Promise<string | null> {
  if (readHostedAgentFastV2ReloadSnapshot(input.assistantMessageId)) {
    return resumeHostedFastV2AgentChat(input);
  }
  const snapshot = readHostedAgentReloadSnapshot(input.assistantMessageId);
  if (!snapshot) return null;
  if (snapshot.request.clientInstanceId !== clientInstanceId()) {
    clearHostedAgentReloadSnapshot(input.assistantMessageId);
    return null;
  }

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
  try {
    input.request.signal?.throwIfAborted();
    const accepted = await startHostedAgentK2Turn({
      request: snapshot.request,
      signal: input.request.signal === undefined
        ? undefined
        : new AbortController().signal,
    });
    assertCompatibleAcceptedTurn(snapshot.request, accepted);
    input.request.onPhase?.('provider');
    const response = await runHostedAgentSession({
      accepted,
      assistantMessageId: input.assistantMessageId,
      callbackRequest,
      restoredState: {
        completedBatches: snapshot.completedBatches,
        cursor: snapshot.cursor,
      },
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
