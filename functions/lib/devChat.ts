import type { AppContext, AppUser, Env } from './env';

export const DEV_CHAT_MAX_MESSAGE_LENGTH = 2_000;
export const DEV_CHAT_MAX_PAGE_LENGTH = 500;
export const DEV_CHAT_POLL_LIMIT = 100;

const TELEGRAM_MESSAGE_LIMIT = 4_096;
const TELEGRAM_TIMEOUT_MS = 8_000;
const RATE_LIMIT_WINDOW_SECONDS = 60;

export interface DevChatMessage {
  createdAt: string;
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
  constructor() {
    super('Telegram did not accept the dev chat message.');
    this.name = 'TelegramDeliveryError';
  }
}

interface TelegramSendMessageResponse {
  ok?: unknown;
  result?: {
    message_id?: unknown;
  };
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

export async function isDevChatRateLimited(
  context: AppContext,
  scope: 'poll' | 'send',
  maximum: number,
): Promise<boolean> {
  const clientIdentity = context.request.headers.get('cf-connecting-ip')?.trim()
    || context.data.user?.id;
  if (!clientIdentity) return false;

  try {
    const secret = context.env.SESSION_SECRET?.trim()
      || context.env.VISITOR_NOTIFY_SECRET?.trim()
      || 'masterselects-dev-chat-rate';
    const clientHash = await digestLabel(`${secret}:${clientIdentity}`, 24);
    const window = Math.floor(Date.now() / (RATE_LIMIT_WINDOW_SECONDS * 1_000));
    const key = `dev-chat-rate:${scope}:${clientHash}:${window}`;
    const count = Number(await context.env.KV.get(key)) || 0;
    if (count >= maximum) return true;

    await context.env.KV.put(key, String(count + 1), {
      expirationTtl: RATE_LIMIT_WINDOW_SECONDS * 2,
    });
    return false;
  } catch {
    // A temporary KV failure must not make support unavailable.
    return false;
  }
}

export async function buildTelegramDevChatText(input: {
  appVersion?: string;
  conversationId: string;
  message: string;
  page?: string;
  user?: AppUser | null;
}): Promise<string> {
  const conversationLabel = await digestLabel(`conversation:${input.conversationId}`, 10);
  const lines = [`MasterSelects dev chat #${conversationLabel}`];

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
    const response = await fetch(`https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`, {
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
    const payload = await response.json().catch(() => null) as TelegramSendMessageResponse | null;
    const messageId = payload?.result?.message_id;

    if (!response.ok || payload?.ok !== true || typeof messageId !== 'number' || !Number.isSafeInteger(messageId)) {
      throw new TelegramDeliveryError();
    }

    return messageId;
  } catch (error) {
    if (error instanceof TelegramDeliveryError) throw error;
    throw new TelegramDeliveryError();
  } finally {
    clearTimeout(timeout);
  }
}
