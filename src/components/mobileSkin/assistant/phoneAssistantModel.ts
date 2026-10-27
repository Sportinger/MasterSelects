// Pure rules of the phone assistant: which account state the chat is in, the live progress line,
// the run's tool calls as rows (name, status, short result) and how many editor steps a request
// left behind. The sheet renders these; unit tests pin them (tests/unit/phoneAssistantModel.test.ts).

import type { AgentActivityEvent } from '../../../services/flashboard/FlashBoardChatTypes';
import { isDirectCodexUnavailableMessage } from '../../../services/flashboard/FlashBoardDirectCodexAvailability';
import type { FlashBoardChatMessage } from '../../../stores/flashboardStore';

// ---------------------------------------------------------------------------
// Access: signed out, guest, no credits, offline (INV-6/guest-hosted-access)
// ---------------------------------------------------------------------------

export type PhoneAssistantAccessKind = 'checking' | 'offline' | 'signedOut' | 'guest' | 'noCredits' | 'ready';

export interface PhoneAssistantAccess {
  kind: PhoneAssistantAccessKind;
  /** One line on top of the chat. */
  message: string;
  /** True when a request cannot be sent at all; the field still takes a draft. */
  blocksSending: boolean;
  /** The account dialog that helps, if any (the app-wide dialogs the settings sheet opens too). */
  action: { label: string; dialog: 'auth' | 'pricing' | 'account' } | null;
}

export interface PhoneAssistantAccessInput {
  online: boolean;
  accountKnown: boolean;
  authenticated: boolean;
  guest: boolean;
  creditBalance: number;
}

export function resolvePhoneAssistantAccess(input: PhoneAssistantAccessInput): PhoneAssistantAccess {
  if (!input.online) {
    return { kind: 'offline', blocksSending: true, action: null,
      message: 'You are offline. The assistant needs the internet; editing by hand keeps working.' };
  }
  if (!input.accountKnown) {
    return { kind: 'checking', blocksSending: false, action: null, message: 'Checking your account…' };
  }
  if (!input.authenticated && !input.guest) {
    return { kind: 'signedOut', blocksSending: true, action: { label: 'Sign in', dialog: 'auth' },
      message: 'Signed out. Sign in to use the assistant; editing by hand keeps working.' };
  }
  if (!input.authenticated && input.guest) {
    return { kind: 'guest', blocksSending: false, action: { label: 'Create account', dialog: 'auth' },
      message: 'Guest access: the server lets this device use the assistant within its guest limit.' };
  }
  if (input.creditBalance <= 0) {
    return { kind: 'noCredits', blocksSending: false, action: { label: 'Get credits', dialog: 'pricing' },
      message: 'No credits left on your account. Requests that need credits will be refused.' };
  }
  return { kind: 'ready', blocksSending: false, action: { label: 'Account', dialog: 'account' },
    message: `Signed in · ${Math.floor(input.creditBalance)} credits` };
}

// ---------------------------------------------------------------------------
// Live progress line
// ---------------------------------------------------------------------------

export function phoneActivityText(event: AgentActivityEvent): string {
  if (event.kind === 'narration') return event.text;
  if (event.kind === 'progress') {
    return event.current !== undefined && event.total !== undefined
      ? `${event.label} (${event.current}/${event.total})`
      : event.label;
  }
  if (event.phase === 'completed') return `${event.safeLabel} done`;
  if (event.phase === 'failed') return `${event.safeLabel} failed`;
  return `${event.safeLabel}…`;
}

/** The newest thing the running request reports, or 'Thinking…' before it reports anything. */
export function phoneProgressLine(pending: FlashBoardChatMessage | undefined): string {
  if (!pending) return '';
  const latest = pending.activityEvents?.at(-1);
  if (latest) return phoneActivityText(latest);
  if (pending.kernelProgress) {
    const { label, detail } = pending.kernelProgress;
    return detail ? `${label}: ${detail}` : label;
  }
  if (pending.isStreaming) return 'Writing the answer…';
  return 'Thinking…';
}

export function formatPhoneElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Tool calls of one request
// ---------------------------------------------------------------------------

export type PhoneToolCallStatus = 'running' | 'done' | 'failed';

export interface PhoneToolCallRow {
  id: string;
  name: string;
  status: PhoneToolCallStatus;
  /** Short result or error, at most ~90 characters. */
  summary: string;
  /** True when the tool may change the project (not a read-only tool). */
  changes: boolean;
}

const SUMMARY_LIMIT = 90;

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > SUMMARY_LIMIT ? `${flat.slice(0, SUMMARY_LIMIT - 1)}…` : flat;
}

/** A short readable result: a message/summary field if the tool gave one, otherwise its shape. */
export function summarizePhoneToolResult(result: { success: boolean; data?: unknown; error?: string }): string {
  if (!result.success) return clip(result.error?.trim() || 'Failed without a reason.');
  const data = result.data;
  if (data === undefined || data === null) return 'Done';
  if (typeof data === 'string') return clip(data);
  if (typeof data === 'number' || typeof data === 'boolean') return String(data);
  if (Array.isArray(data)) return `${data.length} item${data.length === 1 ? '' : 's'}`;
  if (typeof data === 'object') {
    const record = data as Record<string, unknown>;
    for (const key of ['message', 'summary', 'description', 'status']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return clip(value);
    }
    const keys = Object.keys(record);
    if (keys.length === 0) return 'Done';
    return clip(`Done · ${keys.slice(0, 4).join(', ')}${keys.length > 4 ? ', …' : ''}`);
  }
  return 'Done';
}

/**
 * Rows of one assistant message: every executed call (from the run audit the chat keeps) plus calls
 * that started and have not finished yet. `isReadOnly` comes from the editor's tool policy.
 */
export function buildPhoneToolCallRows(
  message: FlashBoardChatMessage,
  isReadOnly: (toolName: string) => boolean,
): PhoneToolCallRow[] {
  const rows: PhoneToolCallRow[] = (message.toolCalls ?? []).map((call) => ({
    id: call.toolCall.id,
    name: call.toolCall.name,
    status: call.result.success ? 'done' : 'failed',
    summary: summarizePhoneToolResult(call.result),
    changes: !isReadOnly(call.toolCall.name),
  }));
  if (!message.isPending) return rows;
  const known = new Set(rows.map((row) => row.id));
  const latestByOperation = new Map<string, Extract<AgentActivityEvent, { kind: 'operation' }>>();
  for (const event of message.activityEvents ?? []) {
    if (event.kind === 'operation' && event.operationId) latestByOperation.set(event.operationId, event);
  }
  for (const [operationId, event] of latestByOperation) {
    if (known.has(operationId) || event.phase !== 'started') continue;
    const name = event.toolName ?? event.safeLabel;
    rows.push({ id: operationId, name, status: 'running', summary: 'Running…', changes: !isReadOnly(name) });
  }
  return rows;
}

/** Successful calls that may have changed the project: each is one undo step in the editor today. */
export function countPhoneChangeSteps(rows: readonly PhoneToolCallRow[]): number {
  return rows.filter((row) => row.status === 'done' && row.changes).length;
}

/** The latest settled assistant message, the one whose changes Undo would take back first. */
export function latestSettledAssistantMessage(messages: readonly FlashBoardChatMessage[]): FlashBoardChatMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'assistant') return message.isPending ? undefined : message;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Undo after a request (INV-8/assistant-request-undo)
// ---------------------------------------------------------------------------

export interface PhoneUndoOffer {
  /** 'request': the editor applied the whole request as one step; 'step': one undo per change. */
  kind: 'request' | 'step';
  label: string;
  hint: string;
  /** Undo steps this request left behind. */
  steps: number;
}

/**
 * What Undo means for a settled answer. A verified kernel run is one editor transaction; for every
 * other run the editor groups the revisions of the request's changing tool calls into one Undo step
 * (runAgentRequestScope + historyNavigationPlan), so one tap takes the whole request back. Undo always
 * takes the newest step, so own edits made after the request go first; an own edit made while the
 * request ran splits it there.
 */
export function phoneUndoOffer(message: FlashBoardChatMessage | undefined, rows: readonly PhoneToolCallRow[], undoneSteps = 0): PhoneUndoOffer | null {
  if (!message || message.role !== 'assistant' || message.isPending || message.isError) return null;
  if (message.kernelReport) {
    if (message.kernelReport.outcome !== 'verified' || undoneSteps > 0) return null;
    return { kind: 'request', label: 'Undo this request', steps: 1,
      hint: 'The whole request is one step: one tap takes all of its changes back.' };
  }
  const changes = countPhoneChangeSteps(rows);
  if (changes <= 0 || undoneSteps > 0) return null;
  return changes === 1
    ? { kind: 'request', label: 'Undo', steps: 1, hint: 'Undo takes this change back.' }
    : { kind: 'request', label: 'Undo this request', steps: 1,
      hint: `The whole request is one step: one tap takes all ${changes} changes back. An edit of yours made while it ran stays and splits it there.` };
}

// ---------------------------------------------------------------------------
// Assistant service state (the Direct socket could not be opened)
// ---------------------------------------------------------------------------

export interface PhoneAssistantServiceNotice {
  kind: 'unreachable';
  /** The user-facing reason (production) or the local-stack hint (development builds). */
  message: string;
  /** The request that failed, for one-tap Try again; null when it cannot be found. */
  retryPrompt: string | null;
}

/**
 * A clear state on top of the chat when the newest answer failed because the assistant service could
 * not be reached (relay or kernel down, refused upgrade). Gone as soon as a newer request runs or works.
 */
export function phoneAssistantServiceNotice(messages: readonly FlashBoardChatMessage[]): PhoneAssistantServiceNotice | null {
  const index = messages.findLastIndex((message) => message.role === 'assistant');
  const latest = index >= 0 ? messages[index] : undefined;
  if (!latest || latest.isPending || !latest.isError || !isDirectCodexUnavailableMessage(latest.text)) return null;
  const request = messages.slice(0, index).findLast((message) => message.role === 'user');
  return { kind: 'unreachable', message: latest.text.trim(), retryPrompt: request?.text.trim() || null };
}
