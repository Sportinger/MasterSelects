import {
  deleteExpiredAnonymousDevChats,
  DEV_CHAT_MAX_MESSAGE_LENGTH,
  devChatExpiresAt,
} from '../../lib/devChat';
import { json, methodNotAllowed, parseJson } from '../../lib/db';
import type { AppContext, AppRouteHandler, Env } from '../../lib/env';

const TELEGRAM_MAX_TEXT_LENGTH = 4_096;

interface TelegramWebhookBody {
  message?: {
    chat?: {
      id?: number | string;
    };
    from?: {
      id?: number | string;
      is_bot?: boolean;
    };
    message_id?: number;
    reply_to_message?: {
      from?: {
        is_bot?: boolean;
      };
      message_id?: number;
      text?: string;
    };
    text?: string;
  };
  update_id?: number;
}

interface ExistingUpdateRow {
  id: number;
}

interface ConversationMappingRow {
  conversation_id: string;
  expires_at: string | null;
  id?: number;
  user_id: string | null;
}

const TELEGRAM_CORRELATION_PATTERN = /(?:^|\n)MasterSelects ref: ([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\n|$)/i;

function isSafeTelegramInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isAllowedDeveloper(env: Env, userId: unknown): boolean {
  const configured = env.TELEGRAM_DEV_USER_IDS?.trim();
  if (!configured) return true;

  const allowedIds = configured.split(',').map((value) => value.trim());
  if (allowedIds.length === 0 || allowedIds.some((value) => !/^\d+$/.test(value))) {
    return false;
  }

  const normalizedUserId = typeof userId === 'number' && Number.isSafeInteger(userId)
    ? String(userId)
    : typeof userId === 'string' && /^\d+$/.test(userId)
      ? userId
      : null;
  return normalizedUserId !== null && allowedIds.includes(normalizedUserId);
}

function parseTelegramCorrelationId(text: string): string | null {
  return TELEGRAM_CORRELATION_PATTERN.exec(text)?.[1]?.toLowerCase() ?? null;
}

function mappingPendingResponse(): Response {
  return json(
    {
      error: 'telegram_reply_mapping_pending',
      message: 'The replied-to MasterSelects message is not mapped yet.',
    },
    {
      headers: { 'Retry-After': '3' },
      status: 503,
    },
  );
}

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (context.request.method !== 'POST') {
    return methodNotAllowed(['POST']);
  }

  const expectedSecret = context.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  const expectedChatId = context.env.TELEGRAM_DEV_CHAT_ID?.trim();
  if (!expectedSecret || !expectedChatId) {
    return json(
      {
        error: 'telegram_webhook_not_configured',
        message: 'Telegram webhook handling is not configured.',
      },
      { status: 503 },
    );
  }

  const suppliedSecret = context.request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  if (!suppliedSecret || suppliedSecret !== expectedSecret) {
    return json(
      {
        error: 'invalid_webhook_secret',
        message: 'Webhook authentication failed.',
      },
      { status: 401 },
    );
  }

  const receivedAt = new Date().toISOString();
  context.waitUntil(
    deleteExpiredAnonymousDevChats(context.env, receivedAt).catch(() => undefined),
  );

  const update = await parseJson<TelegramWebhookBody>(context.request);
  if (!update || !isSafeTelegramInteger(update.update_id)) {
    return json(
      {
        error: 'invalid_telegram_update',
        message: 'Expected a valid Telegram update.',
      },
      { status: 400 },
    );
  }

  const message = update.message;
  if (
    !message
    || String(message.chat?.id ?? '') !== expectedChatId
    || message.from?.is_bot === true
    || !isAllowedDeveloper(context.env, message.from?.id)
  ) {
    return json({ ignored: true, ok: true });
  }

  const telegramMessageId = message.message_id;
  const repliedToMessageId = message.reply_to_message?.message_id;
  const text = typeof message.text === 'string' ? message.text.trim() : '';
  const isDirectBotReply = message.reply_to_message?.from?.is_bot === true;
  if (
    !isSafeTelegramInteger(telegramMessageId)
    || !isSafeTelegramInteger(repliedToMessageId)
    || !text
    || text.length > TELEGRAM_MAX_TEXT_LENGTH
    || !isDirectBotReply
  ) {
    return json({ ignored: true, ok: true });
  }

  try {
    const existing = await context.env.DB
      .prepare('SELECT id FROM dev_chat_messages WHERE telegram_update_id = ? LIMIT 1')
      .bind(update.update_id)
      .first<ExistingUpdateRow>();
    if (existing) {
      return json({ duplicate: true, ok: true });
    }

    const existingTelegramMessage = await context.env.DB
      .prepare(
        `SELECT id
         FROM dev_chat_messages
         WHERE telegram_chat_id = ? AND telegram_message_id = ?
         LIMIT 1`,
      )
      .bind(expectedChatId, telegramMessageId)
      .first<ExistingUpdateRow>();
    if (existingTelegramMessage) {
      return json({ duplicate: true, ok: true });
    }

    let mapping = await context.env.DB
      .prepare(
        `SELECT
           m.id,
           m.conversation_id,
           c.user_id,
           c.expires_at
         FROM dev_chat_messages m
         INNER JOIN dev_chat_conversations c ON c.id = m.conversation_id
         WHERE m.telegram_chat_id = ?
           AND m.telegram_message_id = ?
           AND m.sender = 'user'
           AND m.delivery_status = 'delivered'
         LIMIT 1`,
      )
      .bind(expectedChatId, repliedToMessageId)
      .first<ConversationMappingRow>();

    let healingPendingMessageId: number | null = null;
    if (!mapping) {
      const repliedToText = message.reply_to_message?.text ?? '';
      const correlationId = parseTelegramCorrelationId(repliedToText);
      const isClearlyForeignBotMessage = Boolean(repliedToText)
        && !repliedToText.includes('MasterSelects dev chat #')
        && !repliedToText.includes('MasterSelects ref:');

      if (!correlationId) {
        return isClearlyForeignBotMessage
          ? json({ ignored: true, ok: true })
          : mappingPendingResponse();
      }

      mapping = await context.env.DB
        .prepare(
          `SELECT
             m.id,
             m.conversation_id,
             c.user_id,
             c.expires_at
           FROM dev_chat_messages m
           INNER JOIN dev_chat_conversations c ON c.id = m.conversation_id
           WHERE m.telegram_correlation_id = ?
             AND m.sender = 'user'
             AND m.delivery_status = 'pending'
           LIMIT 1`,
        )
        .bind(correlationId)
        .first<ConversationMappingRow>();
      if (!mapping?.id) return mappingPendingResponse();
      healingPendingMessageId = mapping.id;
    }
    if (!mapping.user_id && mapping.expires_at && mapping.expires_at <= new Date().toISOString()) {
      try {
        await context.env.DB
          .prepare('DELETE FROM dev_chat_conversations WHERE id = ? AND user_id IS NULL AND expires_at <= ?')
          .bind(mapping.conversation_id, new Date().toISOString())
          .run();
      } catch {
        // Retention is enforced even when the best-effort deletion is delayed.
      }
      return json({ expired: true, ignored: true, ok: true });
    }

    const createdAt = new Date().toISOString();
    const expiresAt = devChatExpiresAt(new Date(createdAt));
    const insertDeveloperReply = context.env.DB
        .prepare(
          `INSERT OR IGNORE INTO dev_chat_messages (
             conversation_id, sender, message, delivery_status, telegram_chat_id,
             telegram_message_id, telegram_update_id, created_at
           )
           VALUES (?, 'developer', ?, 'delivered', ?, ?, ?, ?)`,
        )
        .bind(
          mapping.conversation_id,
          text.slice(0, DEV_CHAT_MAX_MESSAGE_LENGTH),
          expectedChatId,
          telegramMessageId,
          update.update_id,
          createdAt,
        );
    const updateConversation = context.env.DB
      .prepare(
        `UPDATE dev_chat_conversations
         SET updated_at = ?, expires_at = ?
         WHERE id = ?
           AND EXISTS (
             SELECT 1
             FROM dev_chat_messages
             WHERE telegram_update_id = ?
           )`,
      )
      .bind(createdAt, expiresAt, mapping.conversation_id, update.update_id);

    if (healingPendingMessageId !== null) {
      const healTelegramMapping = context.env.DB
        .prepare(
          `UPDATE dev_chat_messages
           SET telegram_chat_id = ?,
               telegram_message_id = ?,
               delivery_status = 'delivered'
           WHERE id = ?
             AND conversation_id = ?
             AND sender = 'user'
             AND delivery_status = 'pending'`,
        )
        .bind(
          expectedChatId,
          repliedToMessageId,
          healingPendingMessageId,
          mapping.conversation_id,
        );
      await context.env.DB.batch([
        healTelegramMapping,
        insertDeveloperReply,
        updateConversation,
      ]);
    } else {
      await context.env.DB.batch([
        insertDeveloperReply,
        updateConversation,
      ]);
    }

    const persisted = await context.env.DB
      .prepare('SELECT id FROM dev_chat_messages WHERE telegram_update_id = ? LIMIT 1')
      .bind(update.update_id)
      .first<ExistingUpdateRow>();
    if (!persisted) {
      const concurrentDuplicate = await context.env.DB
        .prepare(
          `SELECT id
           FROM dev_chat_messages
           WHERE telegram_chat_id = ? AND telegram_message_id = ?
           LIMIT 1`,
        )
        .bind(expectedChatId, telegramMessageId)
        .first<ExistingUpdateRow>();
      if (concurrentDuplicate) {
        return json({ duplicate: true, ok: true });
      }
      throw new Error('Telegram update batch did not persist the message.');
    }

    if (healingPendingMessageId !== null) {
      const healed = await context.env.DB
        .prepare(
          `SELECT id
           FROM dev_chat_messages
           WHERE id = ?
             AND telegram_chat_id = ?
             AND telegram_message_id = ?
             AND delivery_status = 'delivered'
           LIMIT 1`,
        )
        .bind(healingPendingMessageId, expectedChatId, repliedToMessageId)
        .first<ExistingUpdateRow>();
      if (!healed) throw new Error('Telegram correlation mapping was not healed.');
    }

    return json({ ok: true });
  } catch {
    // Non-2xx makes Telegram retry the update; update_id keeps that retry idempotent.
    return json(
      {
        error: 'telegram_webhook_failed',
        message: 'The Telegram update could not be persisted.',
      },
      { status: 500 },
    );
  }
};
