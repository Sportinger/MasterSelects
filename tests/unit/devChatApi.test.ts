import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { onRequest as onChatRequest } from '../../functions/api/support/chat';
import { onRequest as onTelegramWebhookRequest } from '../../functions/api/support/telegram-webhook';
import { consumeDevChatRateLimit } from '../../functions/lib/devChat';
import type {
  AppContext,
  AppD1Statement,
  AppUser,
  Env,
} from '../../functions/lib/env';

interface StoredConversation {
  createdAt: string;
  expiresAt: string;
  id: string;
  updatedAt: string;
  userId: string | null;
}

interface StoredMessage {
  clientMessageId: string | null;
  conversationId: string;
  createdAt: string;
  deliveryStatus: 'delivered' | 'pending';
  id: number;
  message: string;
  sender: 'developer' | 'user';
  telegramChatId: string | null;
  telegramCorrelationId: string | null;
  telegramMessageId: number | null;
  telegramUpdateId: number | null;
}

interface StoredRateCounter {
  count: number;
  expiresAt: string;
}

class MemoryDevChatStatement {
  private values: unknown[] = [];

  constructor(
    private readonly database: MemoryDevChatDatabase,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]): MemoryDevChatStatement {
    this.values = values;
    return this;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return {
      results: this.database.all(this.query, this.values) as T[],
    };
  }

  async first<T = Record<string, unknown>>(_columnName?: string): Promise<T | null> {
    return this.database.first(this.query, this.values) as T | null;
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    return [] as T[];
  }

  async run(): Promise<unknown> {
    return this.database.run(this.query, this.values);
  }
}

class MemoryDevChatDatabase {
  failRateCounters = false;
  readonly conversations = new Map<string, StoredConversation>();
  readonly messages: StoredMessage[] = [];
  readonly rateCounters = new Map<string, StoredRateCounter>();
  private nextMessageId = 1;

  prepare(query: string): MemoryDevChatStatement {
    return new MemoryDevChatStatement(this, query);
  }

  async batch<T = unknown>(statements: AppD1Statement[]): Promise<T[]> {
    const results: unknown[] = [];
    for (const statement of statements) results.push(await statement.run());
    return results as T[];
  }

  async exec(_query: string): Promise<unknown> {
    return undefined;
  }

  all(query: string, values: unknown[]): unknown[] {
    const sql = normalizeSql(query);
    if (sql.includes('FROM dev_chat_messages')
      && sql.includes('WHERE conversation_id = ?')
      && sql.includes('id > ?')) {
      const conversationId = String(values[0]);
      const after = Number(values[1]);
      const pendingIds = values.slice(2, -1).map(Number);
      const limit = Number(values.at(-1));
      return this.messages
        .filter((message) => (
          message.conversationId === conversationId
          && (message.id > after || pendingIds.includes(message.id))
        ))
        .sort((a, b) => a.id - b.id)
        .slice(0, limit)
        .map((message) => ({
          created_at: message.createdAt,
          delivery_status: message.deliveryStatus,
          id: message.id,
          message: message.message,
          sender: message.sender,
        }));
    }

    throw new Error(`Unhandled D1 all query in test: ${sql}`);
  }

  first(query: string, values: unknown[]): unknown | null {
    const sql = normalizeSql(query);

    if (sql.startsWith('SELECT id, user_id')
      && sql.includes('FROM dev_chat_conversations')) {
      const conversation = this.conversations.get(String(values[0]));
      return conversation
        ? {
            expires_at: conversation.expiresAt,
            id: conversation.id,
            user_id: conversation.userId,
          }
        : null;
    }

    if (sql.startsWith('INSERT INTO dev_chat_messages')
      && sql.includes("'user'")) {
      const message: StoredMessage = {
        clientMessageId: values[2] === null ? null : String(values[2]),
        conversationId: String(values[0]),
        createdAt: String(values[4]),
        deliveryStatus: 'pending',
        id: this.nextMessageId++,
        message: String(values[1]),
        sender: 'user',
        telegramChatId: null,
        telegramCorrelationId: String(values[3]),
        telegramMessageId: null,
        telegramUpdateId: null,
      };
      this.messages.push(message);
      return toMessageRow(message);
    }

    if (sql.includes('FROM dev_chat_messages m')
      && sql.includes('WHERE m.client_message_id = ?')) {
      const message = this.messages.find(
        (candidate) => candidate.clientMessageId === String(values[0]),
      );
      if (!message) return null;
      const conversation = this.conversations.get(message.conversationId);
      if (!conversation) return null;
      return {
        ...toMessageRow(message),
        client_message_id: message.clientMessageId,
        conversation_id: message.conversationId,
        delivery_status: message.deliveryStatus,
        expires_at: conversation.expiresAt,
        user_id: conversation.userId,
      };
    }

    if (sql.startsWith('SELECT telegram_message_id FROM dev_chat_messages')) {
      const conversationId = String(values[0]);
      const excludedMessageId = Number(values[1]);
      const previous = this.messages
        .filter((message) => (
          message.conversationId === conversationId
          && message.id !== excludedMessageId
          && message.deliveryStatus === 'delivered'
          && message.telegramChatId !== null
          && message.telegramMessageId !== null
        ))
        .sort((a, b) => b.id - a.id)[0];
      return previous ? { telegram_message_id: previous.telegramMessageId } : null;
    }

    if (sql.startsWith('SELECT id FROM dev_chat_messages WHERE telegram_update_id')) {
      const existing = this.messages.find(
        (message) => message.telegramUpdateId === Number(values[0]),
      );
      return existing ? { id: existing.id } : null;
    }

    if (sql.startsWith('SELECT id FROM dev_chat_messages')
      && sql.includes('WHERE telegram_chat_id = ? AND telegram_message_id = ?')) {
      const existing = this.messages.find((message) => (
        message.telegramChatId === String(values[0])
        && message.telegramMessageId === Number(values[1])
      ));
      return existing ? { id: existing.id } : null;
    }

    if (sql.includes('FROM dev_chat_messages m')
      && sql.includes('m.telegram_chat_id = ?')
      && sql.includes('m.telegram_message_id = ?')) {
      const existing = this.messages.find((message) => (
        message.telegramChatId === String(values[0])
        && message.telegramMessageId === Number(values[1])
        && message.sender === 'user'
        && message.deliveryStatus === 'delivered'
      ));
      if (!existing) return null;
      const conversation = this.conversations.get(existing.conversationId);
      return conversation
        ? {
            conversation_id: existing.conversationId,
            expires_at: conversation.expiresAt,
            id: existing.id,
            user_id: conversation.userId,
          }
        : null;
    }

    if (sql.includes('FROM dev_chat_messages m')
      && sql.includes('WHERE m.telegram_correlation_id = ?')) {
      const existing = this.messages.find((message) => (
        message.telegramCorrelationId === String(values[0])
        && message.sender === 'user'
        && message.deliveryStatus === 'pending'
      ));
      if (!existing) return null;
      const conversation = this.conversations.get(existing.conversationId);
      return conversation
        ? {
            conversation_id: existing.conversationId,
            expires_at: conversation.expiresAt,
            id: existing.id,
            user_id: conversation.userId,
          }
        : null;
    }

    if (sql.startsWith('SELECT id FROM dev_chat_messages')
      && sql.includes('WHERE id = ?')
      && sql.includes("delivery_status = 'delivered'")) {
      const existing = this.messages.find((message) => (
        message.id === Number(values[0])
        && message.telegramChatId === String(values[1])
        && message.telegramMessageId === Number(values[2])
        && message.deliveryStatus === 'delivered'
      ));
      return existing ? { id: existing.id } : null;
    }

    if (sql.startsWith('INSERT OR IGNORE INTO dev_chat_messages')) {
      const telegramChatId = String(values[2]);
      const telegramMessageId = Number(values[3]);
      const telegramUpdateId = Number(values[4]);
      const duplicate = this.messages.some((message) => (
        message.telegramUpdateId === telegramUpdateId
        || (
          message.telegramChatId === telegramChatId
          && message.telegramMessageId === telegramMessageId
        )
      ));
      if (duplicate) return null;

      const message: StoredMessage = {
        clientMessageId: null,
        conversationId: String(values[0]),
        createdAt: String(values[5]),
        deliveryStatus: 'delivered',
        id: this.nextMessageId++,
        message: String(values[1]),
        sender: 'developer',
        telegramChatId,
        telegramCorrelationId: null,
        telegramMessageId,
        telegramUpdateId,
      };
      this.messages.push(message);
      return { id: message.id };
    }

    if (sql.startsWith('INSERT INTO dev_chat_rate_limits')) {
      if (this.failRateCounters) throw new Error('D1 rate counter unavailable');
      const key = `${String(values[0])}:${String(values[1])}:${String(values[2])}`;
      const maximum = Number(values[4]);
      const existing = this.rateCounters.get(key);
      if (existing && existing.count >= maximum) return null;

      const count = (existing?.count ?? 0) + 1;
      this.rateCounters.set(key, {
        count,
        expiresAt: String(values[3]),
      });
      return { count };
    }

    throw new Error(`Unhandled D1 first query in test: ${sql}`);
  }

  run(query: string, values: unknown[]): unknown {
    const sql = normalizeSql(query);

    if (sql.startsWith('INSERT INTO dev_chat_conversations')) {
      const conversation: StoredConversation = {
        id: String(values[0]),
        userId: values[1] === null ? null : String(values[1]),
        createdAt: String(values[2]),
        updatedAt: String(values[3]),
        expiresAt: String(values[4]),
      };
      this.conversations.set(conversation.id, conversation);
      return { success: true };
    }

    if (sql.startsWith('INSERT OR IGNORE INTO dev_chat_messages')
      && sql.includes("'developer'")) {
      const telegramChatId = String(values[2]);
      const telegramMessageId = Number(values[3]);
      const telegramUpdateId = Number(values[4]);
      const duplicate = this.messages.some((message) => (
        message.telegramUpdateId === telegramUpdateId
        || (
          message.telegramChatId === telegramChatId
          && message.telegramMessageId === telegramMessageId
        )
      ));
      if (duplicate) return { success: true };

      this.messages.push({
        clientMessageId: null,
        conversationId: String(values[0]),
        createdAt: String(values[5]),
        deliveryStatus: 'delivered',
        id: this.nextMessageId++,
        message: String(values[1]),
        sender: 'developer',
        telegramChatId,
        telegramCorrelationId: null,
        telegramMessageId,
        telegramUpdateId,
      });
      return { success: true };
    }

    if (sql.startsWith('UPDATE dev_chat_messages SET telegram_chat_id')) {
      const message = this.messages.find((candidate) => (
        candidate.id === Number(values[2])
        && candidate.conversationId === String(values[3])
      ));
      if (message) {
        message.telegramChatId = String(values[0]);
        message.telegramMessageId = Number(values[1]);
        message.deliveryStatus = 'delivered';
      }
      return { success: true };
    }

    if (sql.startsWith('UPDATE dev_chat_conversations SET updated_at')) {
      const hasExpiry = sql.includes('expires_at');
      const conversationId = String(values[hasExpiry ? 2 : 1]);
      const conversation = this.conversations.get(conversationId);
      if (conversation) {
        conversation.updatedAt = String(values[0]);
        if (hasExpiry) conversation.expiresAt = String(values[1]);
      }
      return { success: true };
    }

    if (sql.startsWith('DELETE FROM dev_chat_messages')) {
      const index = this.messages.findIndex((message) => (
        message.id === Number(values[0])
        && message.conversationId === String(values[1])
        && message.telegramMessageId === null
      ));
      if (index >= 0) this.messages.splice(index, 1);
      return { success: true };
    }

    if (sql.startsWith('DELETE FROM dev_chat_conversations')) {
      if (sql.includes('WHERE user_id IS NULL AND expires_at <= ?')) {
        const now = String(values[0]);
        for (const [id, conversation] of this.conversations) {
          if (conversation.userId === null && conversation.expiresAt <= now) {
            this.conversations.delete(id);
            for (let index = this.messages.length - 1; index >= 0; index -= 1) {
              if (this.messages[index]?.conversationId === id) this.messages.splice(index, 1);
            }
          }
        }
        return { success: true };
      }

      if (sql.includes('WHERE id = ? AND user_id IS NULL AND expires_at <= ?')) {
        const conversationId = String(values[0]);
        const now = String(values[1]);
        const conversation = this.conversations.get(conversationId);
        if (
          conversation
          && conversation.userId === null
          && conversation.expiresAt <= now
        ) {
          this.conversations.delete(conversationId);
        }
        return { success: true };
      }

      const conversationId = String(values[0]);
      if (!this.messages.some((message) => message.conversationId === conversationId)) {
        this.conversations.delete(conversationId);
      }
      return { success: true };
    }

    if (sql.startsWith('DELETE FROM dev_chat_rate_limits WHERE expires_at <= ?')) {
      const now = String(values[0]);
      for (const [key, counter] of this.rateCounters) {
        if (counter.expiresAt <= now) this.rateCounters.delete(key);
      }
      return { success: true };
    }

    throw new Error(`Unhandled D1 run query in test: ${sql}`);
  }
}

function normalizeSql(query: string): string {
  return query.replace(/\s+/g, ' ').trim();
}

function toMessageRow(message: StoredMessage): Record<string, unknown> {
  return {
    created_at: message.createdAt,
    client_message_id: message.clientMessageId,
    delivery_status: message.deliveryStatus,
    id: message.id,
    message: message.message,
    sender: message.sender,
    telegram_correlation_id: message.telegramCorrelationId,
  };
}

function makeEnv(database: MemoryDevChatDatabase): Env {
  return {
    DB: database as unknown as Env['DB'],
    KV: {
      delete: vi.fn(async () => undefined),
      get: vi.fn(async () => null),
      list: vi.fn(async () => ({ keys: [], list_complete: true })),
      put: vi.fn(async () => undefined),
    },
    MEDIA: {} as Env['MEDIA'],
    SESSION_SECRET: 'test-session-secret',
    TELEGRAM_BOT_TOKEN: 'test-bot-token',
    TELEGRAM_DEV_CHAT_ID: '-1001234567890',
    TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
  };
}

function makeContext(request: Request, env: Env, user: AppUser | null = null): AppContext {
  return {
    data: {
      requestId: 'request-test',
      user,
    },
    env,
    next: vi.fn(),
    params: {},
    request,
    waitUntil: vi.fn(),
  };
}

function makeChatPostRequest(body: unknown, clientIp?: string): Request {
  const headers = new Headers({
    'Content-Type': 'application/json',
    Origin: 'https://www.masterselects.com',
    'X-App-Version': '2.4.4-test',
  });
  if (clientIp) headers.set('cf-connecting-ip', clientIp);

  return new Request('https://www.masterselects.com/api/support/chat', {
    body: JSON.stringify(body),
    headers,
    method: 'POST',
  });
}

async function createConversation(
  env: Env,
  clientMessageId = '9d550f0e-f026-4eca-93c8-24aa1b11d4d2',
): Promise<{
  conversationId: string;
  message: {
    createdAt: string;
    id: number;
    message: string;
    sender: string;
  };
}> {
  const response = await onChatRequest(makeContext(
    makeChatPostRequest({
      clientMessageId,
      message: 'Please help with this edit',
      page: 'https://www.masterselects.com/editor?project=secret',
    }),
    env,
  ));
  expect(response.status).toBe(201);
  return response.json();
}

describe('developer chat API contract', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('creates a conversation, posts to Telegram, and returns messages by cursor', async () => {
    const database = new MemoryDevChatDatabase();
    const env = makeEnv(database);
    const telegramFetch = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      result: { message_id: 700 },
    }), { status: 200 }));
    vi.stubGlobal('fetch', telegramFetch);

    const created = await createConversation(env);

    expect(created.conversationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(created.message).toMatchObject({
      deliveryStatus: 'delivered',
      id: 1,
      message: 'Please help with this edit',
      sender: 'user',
    });

    expect(telegramFetch).toHaveBeenCalledOnce();
    const [telegramUrl, telegramInit] = telegramFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(telegramUrl).toContain('/sendMessage');
    const telegramBody = JSON.parse(String(telegramInit.body)) as {
      chat_id: string;
      text: string;
    };
    expect(telegramBody.chat_id).toBe('-1001234567890');
    expect(telegramBody.text).toContain('Please help with this edit');
    expect(telegramBody.text).toContain('Page: /editor');
    expect(telegramBody.text).toMatch(
      /MasterSelects ref: [0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/,
    );

    const getResponse = await onChatRequest(makeContext(
      new Request(
        `https://www.masterselects.com/api/support/chat?conversationId=${created.conversationId}&after=0`,
      ),
      env,
    ));
    const getPayload = await getResponse.json() as {
      conversationId: string;
      cursor: number;
      messages: StoredMessage[];
    };

    expect(getResponse.status).toBe(200);
    expect(getPayload).toMatchObject({
      conversationId: created.conversationId,
      cursor: 1,
      messages: [{
        id: 1,
        message: 'Please help with this edit',
        sender: 'user',
      }],
    });
  });

  it('rejects an empty message before touching Telegram or D1', async () => {
    const database = new MemoryDevChatDatabase();
    const telegramFetch = vi.fn();
    vi.stubGlobal('fetch', telegramFetch);

    const response = await onChatRequest(makeContext(
      makeChatPostRequest({ message: '   ' }),
      makeEnv(database),
    ));

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: 'invalid_message' });
    expect(telegramFetch).not.toHaveBeenCalled();
    expect(database.conversations.size).toBe(0);
    expect(database.messages).toHaveLength(0);
  });

  it('returns the delivered message for a repeated client ID without calling Telegram twice', async () => {
    const database = new MemoryDevChatDatabase();
    const env = makeEnv(database);
    const telegramFetch = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      result: { message_id: 700 },
    }), { status: 200 }));
    vi.stubGlobal('fetch', telegramFetch);
    const clientMessageId = 'f0f00918-3d7c-4e48-bd59-0d70e563d06b';

    const first = await createConversation(env, clientMessageId);
    const repeated = await createConversation(env, clientMessageId);

    expect(repeated).toEqual(first);
    expect(telegramFetch).toHaveBeenCalledOnce();
    expect(database.messages).toHaveLength(1);
    expect(database.messages[0]).toMatchObject({
      clientMessageId,
      deliveryStatus: 'delivered',
    });
  });

  it('rolls back an explicit Telegram rejection so the same client ID can retry safely', async () => {
    const database = new MemoryDevChatDatabase();
    const env = makeEnv(database);
    const telegramFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false }), { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        result: { message_id: 700 },
      }), { status: 200 }));
    vi.stubGlobal('fetch', telegramFetch);
    const requestBody = {
      clientMessageId: '6c46c98f-816f-4395-b38f-94f9fc521dc1',
      message: 'Retry this safely after rejection',
    };

    const firstResponse = await onChatRequest(makeContext(
      makeChatPostRequest(requestBody),
      env,
    ));
    expect(firstResponse.status).toBe(502);
    expect(await firstResponse.json()).toMatchObject({
      error: 'telegram_delivery_failed',
    });
    expect(database.messages).toHaveLength(0);
    expect(database.conversations.size).toBe(0);

    const retryResponse = await onChatRequest(makeContext(
      makeChatPostRequest(requestBody),
      env,
    ));
    expect(retryResponse.status).toBe(201);
    expect(await retryResponse.json()).toMatchObject({
      message: {
        deliveryStatus: 'delivered',
        message: requestBody.message,
      },
    });
    expect(telegramFetch).toHaveBeenCalledTimes(2);
    expect(database.messages).toHaveLength(1);
    expect(database.messages[0]?.deliveryStatus).toBe('delivered');
  });

  it('returns 202 for ambiguous delivery and reconciles the pending ID after the cursor advances', async () => {
    const database = new MemoryDevChatDatabase();
    const env = makeEnv(database);
    const telegramFetch = vi.fn(async () => {
      throw new TypeError('network result is unknown');
    });
    vi.stubGlobal('fetch', telegramFetch);
    const requestBody = {
      clientMessageId: '719fce77-c1ad-4671-a926-f1fedc0dd51e',
      message: 'Do not resend while delivery is unknown',
    };

    const firstResponse = await onChatRequest(makeContext(
      makeChatPostRequest(requestBody),
      env,
    ));
    const firstPayload = await firstResponse.json() as {
      conversationId: string;
      message: { deliveryStatus: string; id: number };
    };
    expect(firstResponse.status).toBe(202);
    expect(firstResponse.headers.get('Retry-After')).toBe('3');
    expect(firstPayload.message).toMatchObject({
      deliveryStatus: 'pending',
      id: 1,
    });

    const retryResponse = await onChatRequest(makeContext(
      makeChatPostRequest(requestBody),
      env,
    ));
    expect(retryResponse.status).toBe(202);
    expect(retryResponse.headers.get('Retry-After')).toBe('3');
    expect(await retryResponse.json()).toMatchObject({
      conversationId: firstPayload.conversationId,
      message: {
        deliveryStatus: 'pending',
        id: 1,
      },
    });
    expect(telegramFetch).toHaveBeenCalledOnce();
    expect(database.messages).toHaveLength(1);
    expect(database.messages[0]?.deliveryStatus).toBe('pending');

    const pendingPoll = await onChatRequest(makeContext(
      new Request(
        `https://www.masterselects.com/api/support/chat?conversationId=${firstPayload.conversationId}&after=0`,
      ),
      env,
    ));
    expect(await pendingPoll.json()).toMatchObject({
      cursor: 1,
      messages: [{ deliveryStatus: 'pending', id: 1 }],
    });

    database.messages[0]!.deliveryStatus = 'delivered';
    const deliveredPoll = await onChatRequest(makeContext(
      new Request(
        `https://www.masterselects.com/api/support/chat?conversationId=${firstPayload.conversationId}&after=1&pendingIds=1`,
      ),
      env,
    ));
    expect(await deliveredPoll.json()).toMatchObject({
      cursor: 1,
      messages: [{ deliveryStatus: 'delivered', id: 1 }],
    });
  });

  it.each([
    ['non-JSON', '<html>bad gateway</html>', 'text/html'],
    ['malformed JSON', '{"ok":', 'application/json'],
  ])(
    'keeps a message pending for a Telegram non-2xx response with a %s body',
    async (_label, responseBody, contentType) => {
      const database = new MemoryDevChatDatabase();
      const env = makeEnv(database);
      const telegramFetch = vi.fn(async () => new Response(responseBody, {
        headers: { 'Content-Type': contentType },
        status: 502,
      }));
      vi.stubGlobal('fetch', telegramFetch);
      const requestBody = {
        clientMessageId: 'f4e03d32-ad0c-483e-b04c-06d12ae74c1a',
        message: 'Treat an unparseable rejection as ambiguous',
      };

      const firstResponse = await onChatRequest(makeContext(
        makeChatPostRequest(requestBody),
        env,
      ));
      expect(firstResponse.status).toBe(202);
      expect(await firstResponse.json()).toMatchObject({
        message: { deliveryStatus: 'pending', id: 1 },
      });

      const retryResponse = await onChatRequest(makeContext(
        makeChatPostRequest(requestBody),
        env,
      ));
      expect(retryResponse.status).toBe(202);
      expect(await retryResponse.json()).toMatchObject({
        message: { deliveryStatus: 'pending', id: 1 },
      });
      expect(telegramFetch).toHaveBeenCalledOnce();
      expect(database.messages).toHaveLength(1);
      expect(database.messages[0]?.deliveryStatus).toBe('pending');
    },
  );

  it('consumes the per-minute send limit atomically in D1', async () => {
    const database = new MemoryDevChatDatabase();
    const env = makeEnv(database);
    const contexts = Array.from({ length: 12 }, () => makeContext(
      new Request('https://www.masterselects.com/api/support/chat', {
        headers: { 'cf-connecting-ip': '203.0.113.9' },
      }),
      env,
    ));

    const results = await Promise.all(
      contexts.map((context) => consumeDevChatRateLimit(context, 'send', 10)),
    );

    expect(results.filter((result) => result === 'allowed')).toHaveLength(10);
    expect(results.filter((result) => result === 'limited')).toHaveLength(2);
    expect(database.rateCounters.size).toBe(1);
    expect([...database.rateCounters.values()][0]?.count).toBe(10);
    expect(env.KV.get).not.toHaveBeenCalled();
    expect(env.KV.put).not.toHaveBeenCalled();
  });

  it('fails a send closed when D1 cannot enforce its rate limit', async () => {
    const database = new MemoryDevChatDatabase();
    database.failRateCounters = true;
    const telegramFetch = vi.fn();
    vi.stubGlobal('fetch', telegramFetch);

    const response = await onChatRequest(makeContext(
      makeChatPostRequest({
        clientMessageId: '9abf4850-f8a7-47f0-aa7a-2412bc375c1d',
        message: 'Rate limit must be available',
      }, '203.0.113.10'),
      makeEnv(database),
    ));

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('5');
    expect(await response.json()).toMatchObject({ error: 'rate_limit_unavailable' });
    expect(telegramFetch).not.toHaveBeenCalled();
    expect(database.messages).toHaveLength(0);
  });

  it('ships the correlation and default-expiry safeguards in the D1 migration', () => {
    const migration = readFileSync(
      join(process.cwd(), 'migrations', '0013_dev_chat_hardening.sql'),
      'utf8',
    );

    expect(migration).toContain('ADD COLUMN telegram_correlation_id TEXT');
    expect(migration).toContain('idx_dev_chat_messages_telegram_correlation');
    expect(migration).toMatch(
      /CREATE TRIGGER IF NOT EXISTS trg_dev_chat_conversations_default_expiry[\s\S]+AFTER INSERT[\s\S]+WHEN NEW\.expires_at IS NULL/,
    );
    expect(migration).toContain("NEW.updated_at, '+90 days'");
  });

  it('denies and removes an expired anonymous conversation but not an owned one', async () => {
    const database = new MemoryDevChatDatabase();
    const env = makeEnv(database);
    const expiredAnonymousId = '13528e8e-4669-49eb-9687-4fd701806417';
    const signedInId = '364e73c1-8688-4315-9e84-169b2c491e89';
    const expiredAt = '2020-01-01T00:00:00.000Z';
    database.conversations.set(expiredAnonymousId, {
      createdAt: expiredAt,
      expiresAt: expiredAt,
      id: expiredAnonymousId,
      updatedAt: expiredAt,
      userId: null,
    });
    database.conversations.set(signedInId, {
      createdAt: expiredAt,
      expiresAt: expiredAt,
      id: signedInId,
      updatedAt: expiredAt,
      userId: 'owner-user',
    });

    const anonymousResponse = await onChatRequest(makeContext(
      new Request(
        `https://www.masterselects.com/api/support/chat?conversationId=${expiredAnonymousId}`,
      ),
      env,
    ));
    expect(anonymousResponse.status).toBe(404);
    expect(database.conversations.has(expiredAnonymousId)).toBe(false);

    const ownerResponse = await onChatRequest(makeContext(
      new Request(
        `https://www.masterselects.com/api/support/chat?conversationId=${signedInId}`,
      ),
      env,
      { email: 'owner@example.com', id: 'owner-user' },
    ));
    expect(ownerResponse.status).toBe(200);
    expect(database.conversations.has(signedInId)).toBe(true);
  });

  it('reconciles pending IDs while advancing through more than one poll page', async () => {
    const database = new MemoryDevChatDatabase();
    const env = makeEnv(database);
    const conversationId = 'ed43cc71-b060-4daa-b0f2-23f40dc045c5';
    database.conversations.set(conversationId, {
      createdAt: '2026-07-29T18:00:00.000Z',
      expiresAt: '2099-07-29T18:00:00.000Z',
      id: conversationId,
      updatedAt: '2026-07-29T18:00:00.000Z',
      userId: null,
    });
    for (let id = 1; id <= 105; id += 1) {
      database.messages.push({
        clientMessageId: id === 1 ? '7dfbd8bc-277f-4ad1-a1c0-8cc0906dfe8d' : null,
        conversationId,
        createdAt: `2026-07-29T18:00:${String(id % 60).padStart(2, '0')}.000Z`,
        deliveryStatus: id === 1 ? 'pending' : 'delivered',
        id,
        message: `Message ${id}`,
        sender: 'user',
        telegramChatId: null,
        telegramCorrelationId: id === 1 ? '046758e0-c759-411a-acad-8284224a350a' : null,
        telegramMessageId: null,
        telegramUpdateId: null,
      });
    }

    const firstResponse = await onChatRequest(makeContext(
      new Request(
        `https://www.masterselects.com/api/support/chat?conversationId=${conversationId}&after=0&pendingIds=1`,
      ),
      env,
    ));
    const firstPayload = await firstResponse.json() as {
      cursor: number;
      messages: Array<{ deliveryStatus: string; id: number }>;
    };
    expect(firstPayload.cursor).toBe(100);
    expect(firstPayload.messages).toHaveLength(100);
    expect(firstPayload.messages[0]).toMatchObject({ deliveryStatus: 'pending', id: 1 });

    const secondResponse = await onChatRequest(makeContext(
      new Request(
        `https://www.masterselects.com/api/support/chat?conversationId=${conversationId}&after=100&pendingIds=1`,
      ),
      env,
    ));
    const secondPayload = await secondResponse.json() as {
      cursor: number;
      messages: Array<{ deliveryStatus: string; id: number }>;
    };
    expect(secondPayload.cursor).toBe(105);
    expect(secondPayload.messages).toHaveLength(6);
    expect(secondPayload.messages[0]).toMatchObject({ deliveryStatus: 'pending', id: 1 });
    expect(secondPayload.messages.at(-1)).toMatchObject({ id: 105 });
  });

  it('does not expose a signed-in conversation to another account', async () => {
    const database = new MemoryDevChatDatabase();
    const env = makeEnv(database);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      result: { message_id: 700 },
    }), { status: 200 })));
    const owner: AppUser = { email: 'owner@example.com', id: 'owner-user' };
    const otherUser: AppUser = { email: 'other@example.com', id: 'other-user' };

    const createResponse = await onChatRequest(makeContext(
      makeChatPostRequest({ message: 'Private account conversation' }),
      env,
      owner,
    ));
    const created = await createResponse.json() as { conversationId: string };

    const getResponse = await onChatRequest(makeContext(
      new Request(
        `https://www.masterselects.com/api/support/chat?conversationId=${created.conversationId}`,
      ),
      env,
      otherUser,
    ));

    expect(getResponse.status).toBe(404);
    expect(await getResponse.json()).toMatchObject({ error: 'conversation_not_found' });
  });
});

describe('Telegram developer chat webhook contract', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function webhookRequest(body: unknown, secret = 'test-webhook-secret'): Request {
    return new Request('https://www.masterselects.com/api/support/telegram-webhook', {
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': secret,
      },
      method: 'POST',
    });
  }

  it('rejects a webhook with the wrong secret', async () => {
    const database = new MemoryDevChatDatabase();
    const response = await onTelegramWebhookRequest(makeContext(
      webhookRequest({ update_id: 1 }, 'wrong-secret'),
      makeEnv(database),
    ));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'invalid_webhook_secret' });
    expect(database.messages).toHaveLength(0);
  });

  it('acknowledges an update from a different Telegram chat without storing it', async () => {
    const database = new MemoryDevChatDatabase();
    const response = await onTelegramWebhookRequest(makeContext(
      webhookRequest({
        message: {
          chat: { id: -1009999999999 },
          message_id: 701,
          reply_to_message: { message_id: 700 },
          text: 'This belongs to another group',
        },
        update_id: 900,
      }),
      makeEnv(database),
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ignored: true, ok: true });
    expect(database.messages).toHaveLength(0);
  });

  it('terminally ignores a direct reply from a developer outside the allowlist', async () => {
    const database = new MemoryDevChatDatabase();
    const env = makeEnv(database);
    env.TELEGRAM_DEV_USER_IDS = '42,99';
    const response = await onTelegramWebhookRequest(makeContext(
      webhookRequest({
        message: {
          chat: { id: -1001234567890 },
          from: { id: 7, is_bot: false },
          message_id: 701,
          reply_to_message: {
            from: { is_bot: true },
            message_id: 700,
          },
          text: 'This developer is not allowed',
        },
        update_id: 900,
      }),
      env,
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ignored: true, ok: true });
    expect(database.messages).toHaveLength(0);
  });

  it('returns a retryable error for a direct bot reply whose mapping is not available yet', async () => {
    const database = new MemoryDevChatDatabase();
    const response = await onTelegramWebhookRequest(makeContext(
      webhookRequest({
        message: {
          chat: { id: -1001234567890 },
          from: { id: 42, is_bot: false },
          message_id: 701,
          reply_to_message: {
            from: { is_bot: true },
            message_id: 700,
          },
          text: 'Please persist this after the mapping is ready',
        },
        update_id: 900,
      }),
      makeEnv(database),
    ));

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('3');
    expect(await response.json()).toMatchObject({
      error: 'telegram_reply_mapping_pending',
    });
    expect(database.messages).toHaveLength(0);
  });

  it('ignores a clearly foreign bot message instead of retrying it', async () => {
    const database = new MemoryDevChatDatabase();
    const response = await onTelegramWebhookRequest(makeContext(
      webhookRequest({
        message: {
          chat: { id: -1001234567890 },
          from: { id: 42, is_bot: false },
          message_id: 701,
          reply_to_message: {
            from: { is_bot: true },
            message_id: 700,
            text: 'Unrelated monitoring bot notification',
          },
          text: 'This is unrelated',
        },
        update_id: 900,
      }),
      makeEnv(database),
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ignored: true, ok: true });
    expect(database.messages).toHaveLength(0);
  });

  it('heals a pending Telegram mapping from the MasterSelects reference in the replied-to text', async () => {
    const database = new MemoryDevChatDatabase();
    const env = makeEnv(database);
    const telegramFetch = vi.fn(async () => {
      throw new TypeError('response was lost after send');
    });
    vi.stubGlobal('fetch', telegramFetch);
    const pendingResponse = await onChatRequest(makeContext(
      makeChatPostRequest({
        clientMessageId: 'bb64458a-d997-4e80-a5f2-486763a285bf',
        message: 'Please correlate this reply',
      }),
      env,
    ));
    expect(pendingResponse.status).toBe(202);
    const pendingPayload = await pendingResponse.json() as {
      conversationId: string;
      message: { id: number };
    };
    const [, telegramInit] = telegramFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const telegramBody = JSON.parse(String(telegramInit.body)) as { text: string };
    expect(telegramBody.text).toContain('MasterSelects ref:');

    const webhookResponse = await onTelegramWebhookRequest(makeContext(
      webhookRequest({
        message: {
          chat: { id: -1001234567890 },
          from: { id: 42, is_bot: false },
          message_id: 701,
          reply_to_message: {
            from: { is_bot: true },
            message_id: 700,
            text: telegramBody.text,
          },
          text: 'The healed developer reply',
        },
        update_id: 900,
      }),
      env,
    ));

    expect(webhookResponse.status).toBe(200);
    expect(await webhookResponse.json()).toEqual({ ok: true });
    expect(database.messages).toHaveLength(2);
    expect(database.messages[0]).toMatchObject({
      deliveryStatus: 'delivered',
      id: pendingPayload.message.id,
      sender: 'user',
      telegramChatId: '-1001234567890',
      telegramMessageId: 700,
    });
    expect(database.messages[1]).toMatchObject({
      deliveryStatus: 'delivered',
      message: 'The healed developer reply',
      sender: 'developer',
      telegramMessageId: 701,
      telegramUpdateId: 900,
    });

    const pollResponse = await onChatRequest(makeContext(
      new Request(
        `https://www.masterselects.com/api/support/chat?conversationId=${pendingPayload.conversationId}&after=0`,
      ),
      env,
    ));
    expect(await pollResponse.json()).toMatchObject({
      cursor: 2,
      messages: [
        { deliveryStatus: 'delivered', id: 1, sender: 'user' },
        { deliveryStatus: 'delivered', id: 2, sender: 'developer' },
      ],
    });
  });

  it('stores a direct reply once and treats duplicate update and message IDs as success', async () => {
    const database = new MemoryDevChatDatabase();
    const env = makeEnv(database);
    env.TELEGRAM_DEV_USER_IDS = '42,99';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      result: { message_id: 700 },
    }), { status: 200 })));
    const created = await createConversation(env);
    const reply = {
      message: {
        chat: { id: -1001234567890 },
        from: { id: 42, is_bot: false },
        message_id: 701,
        reply_to_message: {
          from: { is_bot: true },
          message_id: 700,
        },
        text: 'Here is the developer reply',
      },
      update_id: 900,
    };

    const firstResponse = await onTelegramWebhookRequest(makeContext(
      webhookRequest(reply),
      env,
    ));
    expect(firstResponse.status).toBe(200);
    expect(await firstResponse.json()).toEqual({ ok: true });

    const repeatedUpdateResponse = await onTelegramWebhookRequest(makeContext(
      webhookRequest(reply),
      env,
    ));
    expect(await repeatedUpdateResponse.json()).toEqual({ duplicate: true, ok: true });

    const repeatedMessageResponse = await onTelegramWebhookRequest(makeContext(
      webhookRequest({ ...reply, update_id: 901 }),
      env,
    ));
    expect(await repeatedMessageResponse.json()).toEqual({ duplicate: true, ok: true });

    const developerMessages = database.messages.filter(
      (message) => message.sender === 'developer',
    );
    expect(developerMessages).toHaveLength(1);

    const pollResponse = await onChatRequest(makeContext(
      new Request(
        `https://www.masterselects.com/api/support/chat?conversationId=${created.conversationId}&after=1`,
      ),
      env,
    ));
    expect(await pollResponse.json()).toMatchObject({
      conversationId: created.conversationId,
      cursor: 2,
      messages: [{
        id: 2,
        message: 'Here is the developer reply',
        sender: 'developer',
      }],
    });
  });
});
