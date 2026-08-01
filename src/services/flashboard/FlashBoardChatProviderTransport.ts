import {
  createLemonadeChatCompletionStream,
  DEFAULT_LEMONADE_MODEL,
  loadLemonadeModel,
} from '../lemonadeProvider';
import {
  FLASHBOARD_CHAT_MODEL_OPTIONS,
  FLASHBOARD_LEMONADE_INITIAL_RESPONSE_TIMEOUT_MS,
  FLASHBOARD_LEMONADE_MAX_TOOL_RESULT_CHARS,
  FLASHBOARD_LEMONADE_STREAM_IDLE_TIMEOUT_MS,
  clampTemperature,
} from './FlashBoardChatConfig';
import {
  FLASHBOARD_CHAT_TOOLS,
  runChatCompletionToolLoop,
} from './FlashBoardChatTools';
import {
  emitAgentActivity,
  inferNarrationPhase,
  safeToolActivityLabel,
} from './FlashBoardChatActivity';
import type { FlashBoardChatCompletionMessage, FlashBoardChatRequest } from './FlashBoardChatTypes';
import { sendHostedKieAgentChat } from './FlashBoardHostedAgentTransport';

const FLASHBOARD_LEMONADE_TOOL_NAMES = new Set([
  'getTimelineState',
  'getTimelineAnalysis',
  'getClipDetails',
  'getClipFaceAnalysis',
  'startClipFaceAnalysis',
  'mergeClipFacePeople',
  'moveClipFaceAppearance',
  'assignClipFaceReviewCandidate',
  'getClipsInTimeRange',
  'selectClips',
  'clearSelection',
  'setPlayhead',
  'setInOutPoints',
  'splitClip',
  'deleteClip',
  'moveClip',
  'trimClip',
  'cutRangesFromClip',
  'getMediaItems',
  'setTransform',
  'getTextProperties',
  'createTextClip',
  'updateTextProperties',
  'setTextBox',
  'addTextBoundsKeyframe',
  'listEffects',
  'addEffect',
  'updateEffect',
  'undo',
  'redo',
  'play',
  'pause',
]);
const FLASHBOARD_LEMONADE_TOOLS = FLASHBOARD_CHAT_TOOLS.filter((tool) => (
  FLASHBOARD_LEMONADE_TOOL_NAMES.has(tool.function.name)
));
export async function sendKieChat(request: FlashBoardChatRequest, systemPrompt: string): Promise<string> {
  if (!request.hostedAvailable) {
    throw new Error('Sign in and enable hosted credits to use AI chat.');
  }
  const turnRequest = !request.idempotencyKey
    ? {
        ...request,
        idempotencyKey: `flashboard-chat-turn:${Date.now()}:${crypto.randomUUID()}`,
      }
    : request;
  const model = FLASHBOARD_CHAT_MODEL_OPTIONS.kie.find((candidate) => candidate.id === turnRequest.model);
  if (!model?.kieProtocol) {
    throw new Error(`Unsupported Kie.ai chat model: ${turnRequest.model}`);
  }
  return sendHostedKieAgentChat({
    protocol: model.kieProtocol,
    request: turnRequest,
    supportsTools: model.supportsTools,
    systemPrompt,
  });
}

export async function sendLemonadeChat(request: FlashBoardChatRequest, systemPrompt: string): Promise<string> {
  await loadLemonadeModel({
    contextSize: request.lemonadeContextSize,
    endpoint: request.lemonadeEndpoint ?? '',
    model: request.model || DEFAULT_LEMONADE_MODEL,
    signal: request.signal,
    timeoutMs: FLASHBOARD_LEMONADE_INITIAL_RESPONSE_TIMEOUT_MS,
  });

  const messages: FlashBoardChatCompletionMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: request.prompt },
  ];

  return runChatCompletionToolLoop(messages, async (currentMessages) => (
    createLemonadeChatCompletionStream({
      endpoint: request.lemonadeEndpoint ?? '',
      model: request.model || DEFAULT_LEMONADE_MODEL,
      messages: currentMessages,
      tools: FLASHBOARD_LEMONADE_TOOLS,
      maxTokens: 1024,
      temperature: clampTemperature(request.temperature),
      signal: request.signal,
      timeoutMs: FLASHBOARD_LEMONADE_INITIAL_RESPONSE_TIMEOUT_MS,
      streamIdleTimeoutMs: FLASHBOARD_LEMONADE_STREAM_IDLE_TIMEOUT_MS,
    })
  ), 'Lemonade', FLASHBOARD_LEMONADE_MAX_TOOL_RESULT_CHARS, request.onExecutedToolCalls, false, request.toolExecutionMode, (event) => {
    if (event.kind === 'narration') {
      emitAgentActivity(request, {
        ...event,
        phase: inferNarrationPhase(event.roundIndex, event.text),
      });
      return;
    }
    if (event.kind === 'operation') {
      emitAgentActivity(request, {
        ...event,
        safeLabel: safeToolActivityLabel(event.toolName ?? event.safeLabel),
      });
      return;
    }
    emitAgentActivity(request, event);
  }, request.signal);
}
