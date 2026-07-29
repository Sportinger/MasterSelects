import {
  buildTelegramDevChatText,
  consumeDevChatRateLimit,
  deleteExpiredAnonymousDevChats,
  DEV_CHAT_MAX_MESSAGE_LENGTH,
  DEV_CHAT_MAX_PAGE_LENGTH,
  DEV_CHAT_POLL_LIMIT,
  devChatExpiresAt,
  hasTelegramDevChatConfig,
  normalizeClientMessageId,
  normalizeConversationId,
  normalizePage,
  sendTelegramDevChatMessage,
  TelegramConfigurationError,
  TelegramDeliveryError,
  type DevChatMessage,
} from '../../lib/devChat';
import { hasTrustedOrigin, json, methodNotAllowed, parseJson } from '../../lib/db';
import type { AppContext, AppRouteHandler } from '../../lib/env';

const SEND_RATE_LIMIT_PER_MINUTE = 10;
const POLL_RATE_LIMIT_PER_MINUTE = 120;
const MAX_PENDING_RECONCILIATION_IDS = 50;

interface ChatRequestBody {
  clientMessageId?: unknown;
  conversationId?: unknown;
  message?: unknown;
  page?: unknown;
}

interface ConversationRow {
  expires_at: string;
  id: string;
  user_id: string | null;
}

interface MessageRow {
  client_message_id?: string | null;
  created_at: string;
  delivery_status?: 'delivered' | 'pending';
  id: number;
  message: string;
  sender: 'developer' | 'user';
  telegram_correlation_id?: string | null;
}

interface IdempotentMessageRow extends MessageRow {
  conversation_id: string;
  expires_at: string | null;
  user_id: string | null;
}

interface TelegramMessageRow {
  telegram_message_id: number;
}

type PendingIdsParseResult =
  | { ids: number[]; valid: true }
  | { valid: false };

function conversationNotFound(): Response {
  return json(
    {
      error: 'conversation_not_found',
      message: 'This dev chat conversation is not available.',
    },
    { status: 404 },
  );
}

function parsePendingIds(value: string | null): PendingIdsParseResult {
  if (value === null) return { ids: [], valid: true };
  if (!value) return { valid: false };

  const rawIds = value.split(',');
  if (rawIds.length > MAX_PENDING_RECONCILIATION_IDS) return { valid: false };

  const ids: number[] = [];
  const seen = new Set<number>();
  for (const rawId of rawIds) {
    if (!/^\d+$/.test(rawId)) return { valid: false };
    const id = Number(rawId);
    if (!Number.isSafeInteger(id) || id < 0) return { valid: false };
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return { ids, valid: true };
}

async function getAuthorizedConversation(
  context: AppContext,
  conversationId: string,
): Promise<ConversationRow | null> {
  const conversation = await context.env.DB
    .prepare('SELECT id, user_id, expires_at FROM dev_chat_conversations WHERE id = ? LIMIT 1')
    .bind(conversationId)
    .first<ConversationRow>();

  if (!conversation) return null;
  if (conversation.user_id && conversation.user_id !== context.data.user?.id) return null;
  if (!conversation.user_id && conversation.expires_at <= new Date().toISOString()) {
    try {
      await context.env.DB
        .prepare('DELETE FROM dev_chat_conversations WHERE id = ? AND user_id IS NULL AND expires_at <= ?')
        .bind(conversation.id, new Date().toISOString())
        .run();
    } catch {
      // Expiration is enforced even if the best-effort physical deletion fails.
    }
    return null;
  }
  return conversation;
}

async function getMessageByClientId(
  context: AppContext,
  clientMessageId: string,
): Promise<IdempotentMessageRow | null> {
  const row = await context.env.DB
    .prepare(
      `SELECT
         m.id, m.conversation_id, m.sender, m.message, m.client_message_id,
         m.delivery_status, m.created_at, c.user_id, c.expires_at
       FROM dev_chat_messages m
       INNER JOIN dev_chat_conversations c ON c.id = m.conversation_id
       WHERE m.client_message_id = ?
       LIMIT 1`,
    )
    .bind(clientMessageId)
    .first<IdempotentMessageRow>();
  if (!row || row.user_id || !row.expires_at || row.expires_at > new Date().toISOString()) return row;

  try {
    await context.env.DB
      .prepare('DELETE FROM dev_chat_conversations WHERE id = ? AND user_id IS NULL AND expires_at <= ?')
      .bind(row.conversation_id, new Date().toISOString())
      .run();
  } catch {
    // The expired capability remains inaccessible even if cleanup is delayed.
  }
  return null;
}

function toMessage(row: MessageRow): DevChatMessage {
  return {
    createdAt: row.created_at,
    deliveryStatus: row.delivery_status ?? 'delivered',
    id: row.id,
    message: row.message,
    sender: row.sender,
  };
}

function rateLimitResponse(): Response {
  return json(
    {
      error: 'rate_limited',
      message: 'Please wait a moment before using dev chat again.',
    },
    {
      headers: { 'Retry-After': '60' },
      status: 429,
    },
  );
}

function rateLimitUnavailableResponse(): Response {
  return json(
    {
      error: 'rate_limit_unavailable',
      message: 'Dev chat cannot safely accept a message right now. Please try again.',
    },
    {
      headers: { 'Retry-After': '5' },
      status: 503,
    },
  );
}

function pendingMessageResponse(row: IdempotentMessageRow): Response {
  return json(
    {
      conversationId: row.conversation_id,
      message: toMessage(row),
    },
    {
      headers: { 'Retry-After': '3' },
      status: 202,
    },
  );
}

function idempotentMessageResponse(
  context: AppContext,
  row: IdempotentMessageRow,
  requestedConversationId: string | null,
  message: string,
): Response {
  if (row.user_id && row.user_id !== context.data.user?.id) return conversationNotFound();
  if (
    (requestedConversationId && requestedConversationId !== row.conversation_id)
    || row.message !== message
  ) {
    return json(
      {
        error: 'client_message_id_conflict',
        message: 'This clientMessageId is already associated with a different message.',
      },
      { status: 409 },
    );
  }
  if (row.delivery_status !== 'delivered') return pendingMessageResponse(row);

  return json(
    {
      conversationId: row.conversation_id,
      message: toMessage(row),
    },
    { status: 201 },
  );
}

async function handleGet(context: AppContext): Promise<Response> {
  const url = new URL(context.request.url);
  const conversationId = normalizeConversationId(url.searchParams.get('conversationId'));
  if (!conversationId) {
    return json(
      {
        error: 'invalid_conversation_id',
        message: 'A valid conversationId is required.',
      },
      { status: 400 },
    );
  }

  const rawAfter = url.searchParams.get('after');
  if (rawAfter !== null && !/^\d+$/.test(rawAfter)) {
    return json(
      {
        error: 'invalid_cursor',
        message: 'The after cursor must be a non-negative message ID.',
      },
      { status: 400 },
    );
  }
  const after = rawAfter === null ? 0 : Number(rawAfter);
  if (!Number.isSafeInteger(after) || after < 0) {
    return json(
      {
        error: 'invalid_cursor',
        message: 'The after cursor must be a non-negative message ID.',
      },
      { status: 400 },
    );
  }

  const parsedPendingIds = parsePendingIds(url.searchParams.get('pendingIds'));
  if (!parsedPendingIds.valid) {
    return json(
      {
        error: 'invalid_pending_ids',
        message: `pendingIds must contain at most ${MAX_PENDING_RECONCILIATION_IDS} comma-separated message IDs.`,
      },
      { status: 400 },
    );
  }
  const pendingIds = parsedPendingIds.ids;

  const requestedAt = new Date().toISOString();
  context.waitUntil(
    deleteExpiredAnonymousDevChats(context.env, requestedAt).catch(() => undefined),
  );

  const rateLimit = await consumeDevChatRateLimit(context, 'poll', POLL_RATE_LIMIT_PER_MINUTE);
  if (rateLimit === 'limited') {
    return rateLimitResponse();
  }

  const conversation = await getAuthorizedConversation(context, conversationId);
  if (!conversation) return conversationNotFound();

  const pendingPlaceholders = pendingIds.map(() => '?').join(', ');
  const reconciliationClause = pendingIds.length > 0
    ? ` OR id IN (${pendingPlaceholders})`
    : '';
  const result = await context.env.DB
    .prepare(
      `SELECT id, sender, message, delivery_status, created_at
       FROM dev_chat_messages
       WHERE conversation_id = ?
         AND (id > ?${reconciliationClause})
       ORDER BY id ASC
       LIMIT ?`,
    )
    .bind(conversation.id, after, ...pendingIds, DEV_CHAT_POLL_LIMIT)
    .all<MessageRow>();
  const messages = result.results.map(toMessage);
  const cursor = messages.reduce((maximum, item) => Math.max(maximum, item.id), after);

  return json({
    conversationId: conversation.id,
    cursor,
    messages,
  });
}

async function rollbackPendingBeforeTelegram(
  context: AppContext,
  conversationId: string,
  messageId: number,
  deleteEmptyConversation: boolean,
): Promise<void> {
  try {
    await context.env.DB
      .prepare(
        `DELETE FROM dev_chat_messages
         WHERE id = ?
           AND conversation_id = ?
           AND delivery_status = 'pending'
           AND telegram_message_id IS NULL`,
      )
      .bind(messageId, conversationId)
      .run();

    if (deleteEmptyConversation) {
      await context.env.DB
        .prepare(
          `DELETE FROM dev_chat_conversations
           WHERE id = ?
             AND NOT EXISTS (
               SELECT 1 FROM dev_chat_messages WHERE conversation_id = ?
             )`,
        )
        .bind(conversationId, conversationId)
        .run();
    }
  } catch {
    // Used only before sendMessage or after Telegram explicitly rejected it.
  }
}

async function handlePost(context: AppContext): Promise<Response> {
  if (!hasTrustedOrigin(context.request)) {
    return json(
      {
        error: 'invalid_origin',
        message: 'Dev chat messages must be sent from MasterSelects.',
      },
      { status: 403 },
    );
  }

  const body = await parseJson<ChatRequestBody>(context.request);
  if (!body) {
    return json(
      {
        error: 'invalid_json',
        message: 'Expected a JSON dev chat message.',
      },
      { status: 400 },
    );
  }

  if (typeof body.message !== 'string') {
    return json(
      {
        error: 'invalid_message',
        message: 'A text message is required.',
      },
      { status: 422 },
    );
  }
  const message = body.message.trim();
  if (!message || message.length > DEV_CHAT_MAX_MESSAGE_LENGTH) {
    return json(
      {
        error: 'invalid_message',
        message: `The message must contain between 1 and ${DEV_CHAT_MAX_MESSAGE_LENGTH} characters.`,
      },
      { status: 422 },
    );
  }

  if (
    body.page !== undefined
    && (typeof body.page !== 'string' || body.page.trim().length > DEV_CHAT_MAX_PAGE_LENGTH)
  ) {
    return json(
      {
        error: 'invalid_page',
        message: `The page context must be at most ${DEV_CHAT_MAX_PAGE_LENGTH} characters.`,
      },
      { status: 422 },
    );
  }
  const page = normalizePage(body.page);

  let requestedConversationId: string | null = null;
  if (body.conversationId !== undefined) {
    requestedConversationId = normalizeConversationId(body.conversationId);
    if (!requestedConversationId) {
      return json(
        {
          error: 'invalid_conversation_id',
          message: 'The conversationId is invalid.',
        },
        { status: 400 },
      );
    }
  }

  let clientMessageId: string | null = null;
  if (body.clientMessageId !== undefined) {
    clientMessageId = normalizeClientMessageId(body.clientMessageId);
    if (!clientMessageId) {
      return json(
        {
          error: 'invalid_client_message_id',
          message: 'The clientMessageId must be a valid UUID.',
        },
        { status: 400 },
      );
    }

    try {
      const existing = await getMessageByClientId(context, clientMessageId);
      if (existing) {
        return idempotentMessageResponse(context, existing, requestedConversationId, message);
      }
    } catch {
      return json(
        {
          error: 'dev_chat_unavailable',
          message: 'Dev chat could not verify this message. Please try again.',
        },
        {
          headers: { 'Retry-After': '5' },
          status: 503,
        },
      );
    }
  }

  if (!hasTelegramDevChatConfig(context.env)) {
    return json(
      {
        error: 'dev_chat_not_configured',
        message: 'Dev chat is not available right now.',
      },
      { status: 503 },
    );
  }

  const rateLimit = await consumeDevChatRateLimit(context, 'send', SEND_RATE_LIMIT_PER_MINUTE);
  if (rateLimit === 'limited') return rateLimitResponse();
  if (rateLimit === 'unavailable') return rateLimitUnavailableResponse();

  const createdAt = new Date().toISOString();
  const expiresAt = devChatExpiresAt(new Date(createdAt));
  const telegramCorrelationId = crypto.randomUUID();
  const isNewConversation = requestedConversationId === null;
  const conversationId = requestedConversationId ?? crypto.randomUUID();
  let insertedMessage: MessageRow | null = null;
  let latestTelegramMessage: TelegramMessageRow | null = null;

  context.waitUntil(
    deleteExpiredAnonymousDevChats(context.env, createdAt).catch(() => undefined),
  );

  try {
    if (isNewConversation) {
      await context.env.DB
        .prepare(
          `INSERT INTO dev_chat_conversations (id, user_id, created_at, updated_at, expires_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(conversationId, context.data.user?.id ?? null, createdAt, createdAt, expiresAt)
        .run();
    } else {
      const conversation = await getAuthorizedConversation(context, conversationId);
      if (!conversation) return conversationNotFound();
    }

    try {
      insertedMessage = await context.env.DB
        .prepare(
          `INSERT INTO dev_chat_messages (
             conversation_id, sender, message, client_message_id, delivery_status,
             telegram_correlation_id, created_at
           )
           VALUES (?, 'user', ?, ?, 'pending', ?, ?)
           RETURNING
             id, sender, message, client_message_id, delivery_status,
             telegram_correlation_id, created_at`,
        )
        .bind(conversationId, message, clientMessageId, telegramCorrelationId, createdAt)
        .first<MessageRow>();
    } catch (error) {
      if (clientMessageId) {
        const existing = await getMessageByClientId(context, clientMessageId);
        if (existing) {
          if (isNewConversation) {
            await rollbackPendingBeforeTelegram(context, conversationId, -1, true);
          }
          return idempotentMessageResponse(context, existing, requestedConversationId, message);
        }
      }
      throw error;
    }
    if (!insertedMessage) throw new Error('Dev chat message insert returned no row.');

    latestTelegramMessage = await context.env.DB
      .prepare(
        `SELECT telegram_message_id
         FROM dev_chat_messages
         WHERE conversation_id = ?
           AND id <> ?
           AND delivery_status = 'delivered'
           AND telegram_chat_id IS NOT NULL
           AND telegram_message_id IS NOT NULL
         ORDER BY id DESC
         LIMIT 1`,
      )
      .bind(conversationId, insertedMessage.id)
      .first<TelegramMessageRow>();
  } catch (error) {
    if (insertedMessage) {
      await rollbackPendingBeforeTelegram(context, conversationId, insertedMessage.id, isNewConversation);
    } else if (isNewConversation) {
      await rollbackPendingBeforeTelegram(context, conversationId, -1, true);
    }

    if (error instanceof TelegramConfigurationError) {
      return json(
        {
          error: 'dev_chat_not_configured',
          message: 'Dev chat is not available right now.',
        },
        { status: 503 },
      );
    }

    return json(
      {
        error: 'dev_chat_failed',
        message: 'Dev chat could not process the message. Please try again.',
      },
      { status: 500 },
    );
  }

  if (!insertedMessage) {
    return json(
      {
        error: 'dev_chat_failed',
        message: 'Dev chat could not persist the message.',
      },
      { status: 500 },
    );
  }

  let telegramMessageId: number;
  try {
    /*
     * Telegram and D1 cannot share a transaction. Once sendMessage starts, the
     * row stays pending until the Telegram mapping is committed. Unless
     * Telegram explicitly rejects the request, we never compensate or resend
     * that key: this is the unavoidable external exactly-once boundary.
     */
    telegramMessageId = await sendTelegramDevChatMessage(
      context.env,
      await buildTelegramDevChatText({
        appVersion: context.request.headers.get('X-App-Version')?.trim().slice(0, 80),
        correlationId: telegramCorrelationId,
        conversationId,
        message,
        page,
        user: context.data.user,
      }),
      latestTelegramMessage?.telegram_message_id,
    );
  } catch (error) {
    if (error instanceof TelegramConfigurationError) {
      return json(
        {
          clientMessageId,
          conversationId,
          error: 'dev_chat_not_configured',
          message: 'Dev chat is not available right now.',
        },
        { status: 503 },
      );
    }
    if (error instanceof TelegramDeliveryError) {
      if (!error.deliveryUnknown) {
        await rollbackPendingBeforeTelegram(
          context,
          conversationId,
          insertedMessage.id,
          isNewConversation,
        );
        return json(
          {
            error: 'telegram_delivery_failed',
            message: 'Telegram rejected the message. Please try again.',
          },
          { status: 502 },
        );
      }
      return json(
        {
          conversationId,
          message: toMessage(insertedMessage),
        },
        {
          headers: { 'Retry-After': '3' },
          status: 202,
        },
      );
    }
    return json(
      {
        clientMessageId,
        conversationId,
        error: 'telegram_delivery_unknown',
        message: 'Delivery could not be confirmed. Poll the conversation before sending again.',
      },
      {
        headers: { 'Retry-After': '5' },
        status: 503,
      },
    );
  }

  try {
    await context.env.DB.batch([
      context.env.DB
        .prepare(
          `UPDATE dev_chat_messages
           SET telegram_chat_id = ?, telegram_message_id = ?, delivery_status = 'delivered'
           WHERE id = ? AND conversation_id = ? AND delivery_status = 'pending'`,
        )
        .bind(context.env.TELEGRAM_DEV_CHAT_ID!.trim(), telegramMessageId, insertedMessage.id, conversationId),
      context.env.DB
        .prepare(
          `UPDATE dev_chat_conversations
           SET updated_at = ?, expires_at = ?
           WHERE id = ?`,
        )
        .bind(createdAt, expiresAt, conversationId),
    ]);
  } catch {
    return json(
      {
        conversationId,
        message: toMessage(insertedMessage),
      },
      {
        headers: { 'Retry-After': '3' },
        status: 202,
      },
    );
  }

  insertedMessage.delivery_status = 'delivered';
  return json(
    {
      conversationId,
      message: toMessage(insertedMessage),
    },
    { status: 201 },
  );
}

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (context.request.method === 'GET') return handleGet(context);
  if (context.request.method === 'POST') return handlePost(context);
  return methodNotAllowed(['GET', 'POST']);
};
