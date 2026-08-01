import type {
  AgentActivityEvent,
  AgentActivityEventInput,
  FlashBoardChatRequest,
} from './FlashBoardChatTypes';

const MAX_NARRATION_CHARS = 2_000;
const MAX_LABEL_CHARS = 160;

function createActivityId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `activity-${crypto.randomUUID()}`
    : `activity-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeText(value: string, maxLength: number): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function createAgentActivityEvent(
  runId: string,
  input: AgentActivityEventInput,
): AgentActivityEvent | null {
  const createdAt = Date.now();
  if (input.kind === 'narration') {
    const text = normalizeText(input.text, MAX_NARRATION_CHARS);
    return text
      ? {
          id: createActivityId(),
          runId,
          kind: 'narration',
          source: 'model',
          phase: input.phase,
          roundIndex: input.roundIndex,
          text,
          createdAt,
        }
      : null;
  }

  if (input.kind === 'operation') {
    const safeLabel = normalizeText(input.safeLabel, MAX_LABEL_CHARS);
    return safeLabel
      ? {
          id: createActivityId(),
          runId,
          kind: 'operation',
          source: 'runtime',
          phase: input.phase,
          safeLabel,
          operationId: input.operationId,
          toolName: input.toolName,
          createdAt,
        }
      : null;
  }

  const label = normalizeText(input.label, MAX_LABEL_CHARS);
  return label
    ? {
        id: createActivityId(),
        runId,
        kind: 'progress',
        source: 'runtime',
        label,
        current: input.current,
        total: input.total,
        createdAt,
      }
    : null;
}

export function emitAgentActivity(
  request: FlashBoardChatRequest,
  input: AgentActivityEventInput,
): void {
  if (!request.onActivityEvent) return;
  const event = createAgentActivityEvent(request.activityRunId ?? 'pending-chat-run', input);
  if (event) request.onActivityEvent(event);
}

export function inferNarrationPhase(
  roundIndex: number,
  narration: string,
): Extract<AgentActivityEvent, { kind: 'narration' }>['phase'] {
  if (/\b(verif|check(?:ing|ed)? the result|confirm(?:ing|ed)?)\b/i.test(narration)) {
    return 'verifying';
  }
  if (/\b(plan|approach|option|strategy)\b/i.test(narration)) {
    return 'planning';
  }
  return roundIndex === 0 ? 'inspecting' : 'acting';
}

export function safeToolActivityLabel(toolName: string): string {
  const spaced = toolName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return spaced || 'Editor operation';
}

export function normalizeStoredAgentActivityEvent(value: unknown): AgentActivityEvent | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<AgentActivityEvent>;
  if (
    typeof candidate.id !== 'string'
    || typeof candidate.runId !== 'string'
    || typeof candidate.createdAt !== 'number'
    || !Number.isFinite(candidate.createdAt)
  ) {
    return null;
  }

  if (
    candidate.kind === 'narration'
    && candidate.source === 'model'
    && (candidate.phase === 'inspecting'
      || candidate.phase === 'planning'
      || candidate.phase === 'acting'
      || candidate.phase === 'verifying')
    && typeof candidate.roundIndex === 'number'
    && Number.isInteger(candidate.roundIndex)
    && candidate.roundIndex >= 0
    && typeof candidate.text === 'string'
  ) {
    const text = normalizeText(candidate.text, MAX_NARRATION_CHARS);
    return text ? { ...candidate, text } as AgentActivityEvent : null;
  }

  if (
    candidate.kind === 'operation'
    && candidate.source === 'runtime'
    && (candidate.phase === 'started'
      || candidate.phase === 'completed'
      || candidate.phase === 'failed')
    && typeof candidate.safeLabel === 'string'
    && (candidate.operationId === undefined || typeof candidate.operationId === 'string')
    && (candidate.toolName === undefined || typeof candidate.toolName === 'string')
  ) {
    const safeLabel = normalizeText(candidate.safeLabel, MAX_LABEL_CHARS);
    return safeLabel ? { ...candidate, safeLabel } as AgentActivityEvent : null;
  }

  if (
    candidate.kind === 'progress'
    && candidate.source === 'runtime'
    && typeof candidate.label === 'string'
    && (candidate.current === undefined || typeof candidate.current === 'number')
    && (candidate.total === undefined || typeof candidate.total === 'number')
  ) {
    const label = normalizeText(candidate.label, MAX_LABEL_CHARS);
    return label ? { ...candidate, label } as AgentActivityEvent : null;
  }

  return null;
}

export function normalizeStoredAgentActivityEvents(value: unknown): AgentActivityEvent[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .map(normalizeStoredAgentActivityEvent)
    .filter((event): event is AgentActivityEvent => event !== null)
    .slice(-100);
  return normalized.length > 0 ? normalized : undefined;
}
