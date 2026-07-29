import {
  buildTelegramDevChatText,
  DEV_CHAT_MAX_MESSAGE_LENGTH,
  DEV_CHAT_MAX_PAGE_LENGTH,
  DEV_CHAT_POLL_LIMIT,
  hasTelegramDevChatConfig,
  isDevChatRateLimited,
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

interface ChatRequestBody {
  conversationId?: unknown;
  message?: unknown;
  page?: unknown;
}

interface ConversationRow {
  id: string;
  user_id: string | null;
}

interface MessageRow {
  created_at: string;
  id: number;
  message: string;
  sender: 'developer' | 'user';
}

interface TelegramMessageRow {
  telegram_message_id: number;
}

function conversationNotFound(): Response {
  return json(
    {
      error: 'conversation_not_found',
      message: 'This dev chat conversation is not available.',
    },
    { status: 404 },
  );
}

async function getAuthorizedConversation(
  context: AppContext,
  conversationId: string,
): Promise<ConversationRow | null> {
  const conversation = await context.env.DB
    .prepare('SELECT id, user_id FROM dev_chat_conversations WHERE id = ? LIMIT 1')
    .bind(conversationId)
    .first<ConversationRow>();

  if (!conversation) return null;
  if (conversation.user_id && conversation.user_id !== context.data.user?.id) return null;
  return conversation;
}

function toMessage(row: MessageRow): DevChatMessage {
  return {
    createdAt: row.created_at,
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

  if (await isDevChatRateLimited(context, 'poll', POLL_RATE_LIMIT_PER_MINUTE)) {
    return rateLimitResponse();
  }

  const conversation = await getAuthorizedConversation(context, conversationId);
  if (!conversation) return conversationNotFound();

  const result = await context.env.DB
    .prepare(
      `SELECT id, sender, message, created_at
       FROM dev_chat_messages
       WHERE conversation_id = ? AND id > ?
       ORDER BY id ASC
       LIMIT ?`,
    )
    .bind(conversation.id, after, DEV_CHAT_POLL_LIMIT)
    .all<MessageRow>();
  const messages = result.results.map(toMessage);
  const cursor = messages.length > 0 ? messages[messages.length - 1].id : after;

  return json({
    conversationId: conversation.id,
    cursor,
    messages,
  });
}

async function deleteUndeliveredMessage(
  context: AppContext,
  conversationId: string,
  messageId: number,
  deleteEmptyConversation: boolean,
): Promise<void> {
  try {
    await context.env.DB
      .prepare(
        `DELETE FROM dev_chat_messages
         WHERE id = ? AND conversation_id = ? AND telegram_message_id IS NULL`,
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
    // Best-effort compensation after an external delivery failure.
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

  if (!hasTelegramDevChatConfig(context.env)) {
    return json(
      {
        error: 'dev_chat_not_configured',
        message: 'Dev chat is not available right now.',
      },
      { status: 503 },
    );
  }

  if (await isDevChatRateLimited(context, 'send', SEND_RATE_LIMIT_PER_MINUTE)) {
    return rateLimitResponse();
  }

  const createdAt = new Date().toISOString();
  const isNewConversation = requestedConversationId === null;
  const conversationId = requestedConversationId ?? crypto.randomUUID();
  let insertedMessage: MessageRow | null = null;

  try {
    if (isNewConversation) {
      await context.env.DB
        .prepare(
          `INSERT INTO dev_chat_conversations (id, user_id, created_at, updated_at)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(conversationId, context.data.user?.id ?? null, createdAt, createdAt)
        .run();
    } else {
      const conversation = await getAuthorizedConversation(context, conversationId);
      if (!conversation) return conversationNotFound();
    }

    insertedMessage = await context.env.DB
      .prepare(
        `INSERT INTO dev_chat_messages (conversation_id, sender, message, created_at)
         VALUES (?, 'user', ?, ?)
         RETURNING id, sender, message, created_at`,
      )
      .bind(conversationId, message, createdAt)
      .first<MessageRow>();
    if (!insertedMessage) throw new Error('Dev chat message insert returned no row.');

    const latestTelegramMessage = await context.env.DB
      .prepare(
        `SELECT telegram_message_id
         FROM dev_chat_messages
         WHERE conversation_id = ?
           AND id <> ?
           AND telegram_chat_id IS NOT NULL
           AND telegram_message_id IS NOT NULL
         ORDER BY id DESC
         LIMIT 1`,
      )
      .bind(conversationId, insertedMessage.id)
      .first<TelegramMessageRow>();
    const telegramText = await buildTelegramDevChatText({
      appVersion: context.request.headers.get('X-App-Version')?.trim().slice(0, 80),
      conversationId,
      message,
      page,
      user: context.data.user,
    });
    const telegramMessageId = await sendTelegramDevChatMessage(
      context.env,
      telegramText,
      latestTelegramMessage?.telegram_message_id,
    );

    await context.env.DB.batch([
      context.env.DB
        .prepare(
          `UPDATE dev_chat_messages
           SET telegram_chat_id = ?, telegram_message_id = ?
           WHERE id = ? AND conversation_id = ?`,
        )
        .bind(context.env.TELEGRAM_DEV_CHAT_ID!.trim(), telegramMessageId, insertedMessage.id, conversationId),
      context.env.DB
        .prepare('UPDATE dev_chat_conversations SET updated_at = ? WHERE id = ?')
        .bind(createdAt, conversationId),
    ]);

    return json(
      {
        conversationId,
        message: toMessage(insertedMessage),
      },
      { status: 201 },
    );
  } catch (error) {
    if (insertedMessage) {
      await deleteUndeliveredMessage(context, conversationId, insertedMessage.id, isNewConversation);
    } else if (isNewConversation) {
      await deleteUndeliveredMessage(context, conversationId, -1, true);
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
    if (error instanceof TelegramDeliveryError) {
      return json(
        {
          error: 'telegram_delivery_failed',
          message: 'Your message could not be delivered. Please try again.',
        },
        { status: 502 },
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
}

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (context.request.method === 'GET') return handleGet(context);
  if (context.request.method === 'POST') return handlePost(context);
  return methodNotAllowed(['GET', 'POST']);
};
