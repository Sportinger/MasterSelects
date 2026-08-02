import type { KernelRunReport } from '../kernelClient/runReport';
import type { FlashBoardChatMessage } from '../../stores/flashboardStore/types';
import { redactFlashBoardChatImageData } from '../flashboard/FlashBoardChatImageData';
import { normalizeStoredAgentActivityEvents } from '../flashboard/FlashBoardChatActivity';
import type { AgentActivityEvent } from '../flashboard/FlashBoardChatTypes';
import { hasHostedAgentReloadSnapshot } from '../kernelClient/hostedAgent';
import type { ProjectFlashBoardChatMessage } from './types/flashboard.types';

/**
 * Guards a persisted report before it is handed back to the run card. Project
 * files are user-editable, so only a report of the schema version this build
 * knows how to render is restored.
 */
function isStoredKernelReport(value: unknown): value is KernelRunReport {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const report = value as Partial<KernelRunReport>;
  return report.schemaVersion === 1
    && Array.isArray(report.steps)
    && (report.outcome === 'verified'
      || report.outcome === 'declined'
      || report.outcome === 'failed');
}

/**
 * Rebuilds every event from its public fields. The normalizer rejects invalid
 * variants; this second projection guarantees that user-edited project JSON
 * cannot smuggle provider payloads or arbitrary properties into a saved run.
 */
function safeStoredActivityEvents(value: unknown): AgentActivityEvent[] | undefined {
  return normalizeStoredAgentActivityEvents(value)?.map((event): AgentActivityEvent => {
    if (event.kind === 'narration') {
      return {
        id: event.id,
        runId: event.runId,
        kind: 'narration',
        source: 'model',
        phase: event.phase,
        roundIndex: event.roundIndex,
        text: event.text,
        createdAt: event.createdAt,
      };
    }
    if (event.kind === 'operation') {
      return {
        id: event.id,
        runId: event.runId,
        kind: 'operation',
        source: 'runtime',
        phase: event.phase,
        safeLabel: event.safeLabel,
        ...(event.operationId === undefined ? {} : { operationId: event.operationId }),
        ...(event.toolName === undefined ? {} : { toolName: event.toolName }),
        createdAt: event.createdAt,
      };
    }
    return {
      id: event.id,
      runId: event.runId,
      kind: 'progress',
      source: 'runtime',
      label: event.label,
      ...(event.current === undefined ? {} : { current: event.current }),
      ...(event.total === undefined ? {} : { total: event.total }),
      createdAt: event.createdAt,
    };
  });
}

export function serializeFlashBoardChatMessage(
  message: FlashBoardChatMessage,
): ProjectFlashBoardChatMessage {
  return {
    activityEvents: safeStoredActivityEvents(message.activityEvents),
    id: message.id,
    role: message.role,
    text: message.text,
    decisionId: message.decisionId,
    createdAt: message.createdAt ? new Date(message.createdAt).toISOString() : undefined,
    editOptions: message.editOptions,
    isError: message.isError,
    isPending: message.isPending,
    isStreaming: message.isStreaming,
    kernelReport: message.kernelReport,
    toolCalls: redactFlashBoardChatImageData(message.toolCalls),
  };
}

export function normalizeFlashBoardChatMessage(
  message: ProjectFlashBoardChatMessage,
): FlashBoardChatMessage | null {
  if (
    (message.role !== 'user' && message.role !== 'assistant')
    || typeof message.text !== 'string'
  ) {
    return null;
  }

  const createdAt = message.createdAt ? new Date(message.createdAt).getTime() : undefined;
  const wasPending = message.isPending === true;
  const messageId = typeof message.id === 'string' && message.id.trim()
    ? message.id
    : crypto.randomUUID();
  const canResume = wasPending && hasHostedAgentReloadSnapshot(messageId);
  const resumableStreamingText = canResume
    && message.isStreaming === true
    && message.text
    ? message.text
    : undefined;
  return {
    activityEvents: safeStoredActivityEvents(message.activityEvents),
    id: messageId,
    role: message.role,
    text: resumableStreamingText ?? (canResume
      ? 'Reconnecting to kernel…'
      : wasPending ? 'Chat interrupted by reload.' : message.text),
    decisionId: typeof message.decisionId === 'string' && message.decisionId.trim()
      ? message.decisionId
      : undefined,
    createdAt: createdAt !== undefined && Number.isFinite(createdAt) ? createdAt : undefined,
    editOptions: Array.isArray(message.editOptions) ? message.editOptions : undefined,
    isError: message.isError || (wasPending && !canResume) || undefined,
    isPending: canResume,
    isStreaming: canResume && message.isStreaming === true ? true : undefined,
    kernelReport: !wasPending && isStoredKernelReport(message.kernelReport)
      ? message.kernelReport
      : undefined,
    toolCalls: Array.isArray(message.toolCalls)
      ? redactFlashBoardChatImageData(message.toolCalls)
      : undefined,
  };
}

export function normalizeFlashBoardChatMessages(
  messages: ProjectFlashBoardChatMessage[] | undefined,
): FlashBoardChatMessage[] {
  return Array.isArray(messages)
    ? messages
      .map(normalizeFlashBoardChatMessage)
      .filter((message): message is FlashBoardChatMessage => message !== null)
    : [];
}
