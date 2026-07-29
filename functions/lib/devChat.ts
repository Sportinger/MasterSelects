import type { AppContext, AppUser, Env } from './env';

export const DEV_CHAT_MAX_MESSAGE_LENGTH = 2_000;
export const DEV_CHAT_MAX_PAGE_LENGTH = 500;
export const DEV_CHAT_POLL_LIMIT = 100;
export const DEV_CHAT_RETENTION_DAYS = 90;

const TELEGRAM_MESSAGE_LIMIT = 4_096;
const TELEGRAM_TIMEOUT_MS = 8_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_RETENTION_MINUTES = 2;

export type DevChatRateLimitResult = 'allowed' | 'limited' | 'unavailable';

export interface DevChatMessage {
  createdAt: string;
  deliveryStatus: 'delivered' | 'pending';
  id: number;
  message: string;
  sender: 'developer' | 'user';
}

export class TelegramConfigurationError extends Error {
  constructor() {
    super('Telegram dev chat is not configured.');
    this.name = 'TelegramConfigurationError';
  }
}

export class TelegramDeliveryError extends Error {
  readonly deliveryUnknown: boolean;

  constructor(deliveryUnknown: boolean) {
    super(deliveryUnknown
      ? 'Telegram delivery could not be confirmed.'
      : 'Telegram rejected the dev chat message.');
    this.name = 'TelegramDeliveryError';
    this.deliveryUnknown = deliveryUnknown;
  }
}

interface TelegramSendMessageResponse {
  ok?: unknown;
  result?: {
    message_id?: unknown;
  };
}

interface RateCounterRow {
  count: number;
}

function bytesToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function digestLabel(value: string, length: number): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToHex(digest).slice(0, length).toUpperCase();
}

export function hasTelegramDevChatConfig(env: Env): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN?.trim() && env.TELEGRAM_DEV_CHAT_ID?.trim());
}

export function normalizeConversationId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)
    ? normalized
    : null;
}

export function normalizeClientMessageId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)
    ? normalized
    : null;
}

export function normalizePage(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > DEV_CHAT_MAX_PAGE_LENGTH) return undefined;

  try {
    const url = new URL(normalized);
    return url.pathname.slice(0, DEV_CHAT_MAX_PAGE_LENGTH) || '/';
  } catch {
    return normalized
      .split(/[?#]/, 1)[0]
      .replace(/[\r\n\t]+/g, ' ')
      .slice(0, DEV_CHAT_MAX_PAGE_LENGTH) || undefined;
  }
}

export function devChatExpiresAt(date = new Date()): string {
  return new Date(date.getTime() + DEV_CHAT_RETENTION_DAYS * 24 * 60 * 60 * 1_000).toISOString();
}

export async function deleteExpiredAnonymousDevChats(env: Env, now = new Date().toISOString()): Promise<void> {
  await env.DB
    .prepare(
      `DELETE FROM dev_chat_conversations
       WHERE user_id IS NULL AND expires_at <= ?`,
    )
    .bind(now)
    .run();
}

export async function consumeDevChatRateLimit(
  context: AppContext,
  scope: 'poll' | 'send',
  maximum: number,
): Promise<DevChatRateLimitResult> {
  const clientIdentity = context.request.headers.get('cf-connecting-ip')?.trim()
    || context.data.user?.id;
  if (!clientIdentity) return 'allowed';

  try {
    const secret = context.env.SESSION_SECRET?.trim()
      || context.env.VISITOR_NOTIFY_SECRET?.trim()
      || 'masterselects-dev-chat-rate';
    const clientHash = await digestLabel(`${secret}:${clientIdentity}`, 24);
    const now = new Date();
    const windowMinute = Math.floor(now.getTime() / RATE_LIMIT_WINDOW_MS);
    const expiresAt = new Date(
      (windowMinute + RATE_LIMIT_RETENTION_MINUTES) * RATE_LIMIT_WINDOW_MS,
    ).toISOString();
    const counter = await context.env.DB
      .prepare(
        `INSERT INTO dev_chat_rate_limits (
           identity_hash, scope, window_minute, count, expires_at
         )
         VALUES (?, ?, ?, 1, ?)
         ON CONFLICT(identity_hash, scope, window_minute) DO UPDATE SET
           count = dev_chat_rate_limits.count + 1,
           expires_at = excluded.expires_at
         WHERE dev_chat_rate_limits.count < ?
         RETURNING count`,
      )
      .bind(clientHash, scope, windowMinute, expiresAt, maximum)
      .first<RateCounterRow>();

    context.waitUntil(
      context.env.DB
        .prepare('DELETE FROM dev_chat_rate_limits WHERE expires_at <= ?')
        .bind(now.toISOString())
        .run()
        .catch(() => undefined),
    );
    return counter ? 'allowed' : 'limited';
  } catch {
    return 'unavailable';
  }
}

export async function buildTelegramDevChatText(input: {
  appVersion?: string;
  correlationId: string;
  conversationId: string;
  message: string;
  page?: string;
  user?: AppUser | null;
}): Promise<string> {
  const conversationLabel = await digestLabel(`conversation:${input.conversationId}`, 10);
  const lines = [
    `MasterSelects dev chat #${conversationLabel}`,
    `MasterSelects ref: ${input.correlationId}`,
  ];

  if (input.user) {
    const userLabel = await digestLabel(`user:${input.user.id}`, 8);
    lines.push(`Account: signed in (${userLabel})`);
  } else {
    lines.push('Account: anonymous');
  }

  if (input.appVersion) lines.push(`App: ${input.appVersion}`);
  if (input.page) lines.push(`Page: ${input.page}`);
  lines.push('', input.message, '', 'Reply directly to this message.');

  return lines.join('\n').slice(0, TELEGRAM_MESSAGE_LIMIT);
}

export async function sendTelegramDevChatMessage(
  env: Env,
  text: string,
  replyToMessageId?: number,
): Promise<number> {
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.TELEGRAM_DEV_CHAT_ID?.trim();
  if (!botToken || !chatId) throw new TelegramConfigurationError();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await fetch(`https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`, {
        body: JSON.stringify({
          chat_id: chatId,
          ...(replyToMessageId
            ? {
                reply_parameters: {
                  allow_sending_without_reply: true,
                  message_id: replyToMessageId,
                },
              }
            : {}),
          text: text.slice(0, TELEGRAM_MESSAGE_LIMIT),
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        signal: controller.signal,
      });
    } catch {
      throw new TelegramDeliveryError(true);
    }

    let payload: TelegramSendMessageResponse | null;
    try {
      payload = await response.json() as TelegramSendMessageResponse;
    } catch {
      // Without a valid Telegram response body, even an HTTP error could have
      // crossed the external delivery boundary. Never make it retryable.
      throw new TelegramDeliveryError(true);
    }
    const messageId = payload?.result?.message_id;

    if (payload?.ok === false) {
      throw new TelegramDeliveryError(false);
    }
    if (!response.ok) {
      throw new TelegramDeliveryError(true);
    }
    if (payload?.ok !== true || typeof messageId !== 'number' || !Number.isSafeInteger(messageId)) {
      throw new TelegramDeliveryError(true);
    }

    return messageId;
  } finally {
    clearTimeout(timeout);
  }
}
