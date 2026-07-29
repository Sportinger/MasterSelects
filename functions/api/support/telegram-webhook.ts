import { DEV_CHAT_MAX_MESSAGE_LENGTH } from '../../lib/devChat';
import { json, methodNotAllowed, parseJson } from '../../lib/db';
import type { AppContext, AppRouteHandler } from '../../lib/env';

const TELEGRAM_MAX_TEXT_LENGTH = 4_096;

interface TelegramWebhookBody {
  message?: {
    chat?: {
      id?: number | string;
    };
    from?: {
      is_bot?: boolean;
    };
    message_id?: number;
    reply_to_message?: {
      message_id?: number;
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
}

interface InsertedMessageRow {
  id: number;
}

function isSafeTelegramInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
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
  if (!message || String(message.chat?.id ?? '') !== expectedChatId || message.from?.is_bot === true) {
    return json({ ignored: true, ok: true });
  }

  const telegramMessageId = message.message_id;
  const repliedToMessageId = message.reply_to_message?.message_id;
  const text = typeof message.text === 'string' ? message.text.trim() : '';
  if (
    !isSafeTelegramInteger(telegramMessageId)
    || !isSafeTelegramInteger(repliedToMessageId)
    || !text
    || text.length > TELEGRAM_MAX_TEXT_LENGTH
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

    const mapping = await context.env.DB
      .prepare(
         `SELECT conversation_id
         FROM dev_chat_messages
         WHERE telegram_chat_id = ?
           AND telegram_message_id = ?
           AND sender = 'user'
         LIMIT 1`,
      )
      .bind(expectedChatId, repliedToMessageId)
      .first<ConversationMappingRow>();
    if (!mapping) {
      return json({ ignored: true, ok: true });
    }

    const createdAt = new Date().toISOString();
    const inserted = await context.env.DB
      .prepare(
        `INSERT OR IGNORE INTO dev_chat_messages (
           conversation_id, sender, message, telegram_chat_id,
           telegram_message_id, telegram_update_id, created_at
         )
         VALUES (?, 'developer', ?, ?, ?, ?, ?)
         RETURNING id`,
      )
      .bind(
        mapping.conversation_id,
        text.slice(0, DEV_CHAT_MAX_MESSAGE_LENGTH),
        expectedChatId,
        telegramMessageId,
        update.update_id,
        createdAt,
      )
      .first<InsertedMessageRow>();
    if (!inserted) {
      return json({ duplicate: true, ok: true });
    }

    await context.env.DB
      .prepare('UPDATE dev_chat_conversations SET updated_at = ? WHERE id = ?')
      .bind(createdAt, mapping.conversation_id)
      .run();

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
