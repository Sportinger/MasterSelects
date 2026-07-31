import { describe, expect, it } from 'vitest';
import {
  redactHostedChatPayloadForStorage,
  stringifyHostedChatPayloadForStorage,
} from '../../functions/lib/aiAudit';
import { insertChatLog } from '../../functions/lib/chatLog';
import type { AppD1Database, AppD1Statement } from '../../functions/lib/env';

function createCapturingDb(): {
  db: AppD1Database;
  getBoundValues(): unknown[];
} {
  let boundValues: unknown[] = [];

  class CapturingStatement implements AppD1Statement {
    bind(...values: unknown[]): AppD1Statement {
      boundValues = values;
      return this;
    }

    async all<T>(): Promise<{ results: T[] }> {
      return { results: [] };
    }

    async first<T>(): Promise<T | null> {
      return null;
    }

    async raw<T = unknown[]>(): Promise<T[]> {
      return [];
    }

    async run(): Promise<unknown> {
      return { meta: { changes: 1 } };
    }
  }

  return {
    db: {
      async batch<T>(): Promise<T[]> {
        return [];
      },
      async exec(): Promise<unknown> {
        return {};
      },
      prepare(): AppD1Statement {
        return new CapturingStatement();
      },
    },
    getBoundValues: () => boundValues,
  };
}

describe('hosted chat persistence redaction', () => {
  it('removes prompt/history/transcript/tool-result content, secrets, and binary variants', () => {
    const redacted = stringifyHostedChatPayloadForStorage({
      authorization: 'Bearer top-secret-token',
      instructions: 'SYSTEM_SENTINEL',
      messages: [{
        content: 'HISTORY_SENTINEL',
        role: 'user',
      }],
      nested: {
        apiKey: 'KEY_SENTINEL',
        audio: 'data:audio/wav;base64,AUDIO_SENTINEL',
        image: 'data:image/png;base64,IMAGE_SENTINEL',
        source: {
          data: 'QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFB',
          type: 'base64',
        },
        transcript: 'TRANSCRIPT_SENTINEL',
      },
      tool_result: {
        content: 'TOOL_RESULT_SENTINEL',
      },
      videoBase64: 'VIDEO_SENTINEL',
    });

    for (const sentinel of [
      'SYSTEM_SENTINEL',
      'HISTORY_SENTINEL',
      'KEY_SENTINEL',
      'AUDIO_SENTINEL',
      'IMAGE_SENTINEL',
      'TRANSCRIPT_SENTINEL',
      'TOOL_RESULT_SENTINEL',
      'VIDEO_SENTINEL',
      'top-secret-token',
      'QUFBQUFB',
    ]) {
      expect(redacted).not.toContain(sentinel);
    }
    expect(redacted).toContain('[content omitted]');
    expect(redacted).toContain('[redacted]');
  });

  it('persists only redacted chat-log fixtures', async () => {
    const capture = createCapturingDb();
    await insertChatLog(capture.db, {
      creditCost: 3,
      durationMs: 10,
      errorMessage: 'Authorization: Bearer ERROR_SECRET',
      idempotencyKey: 'turn:round:0',
      messages: [{
        instructions: 'SYSTEM_DB_SENTINEL',
        messages: [{ role: 'tool', content: 'TOOL_DB_SENTINEL' }],
      }],
      model: 'gpt-5-6-terra',
      requestId: 'request-1',
      response: {
        output: [{
          arguments: JSON.stringify({
            transcript: 'TRANSCRIPT_DB_SENTINEL',
            token: 'TOKEN_DB_SENTINEL',
          }),
          name: 'getTimelineState',
          type: 'function_call',
        }],
      },
      status: 'failed',
      userId: 'user-1',
    });

    const persisted = JSON.stringify(capture.getBoundValues());
    for (const sentinel of [
      'SYSTEM_DB_SENTINEL',
      'TOOL_DB_SENTINEL',
      'TRANSCRIPT_DB_SENTINEL',
      'TOKEN_DB_SENTINEL',
      'ERROR_SECRET',
    ]) {
      expect(persisted).not.toContain(sentinel);
    }
  });

  it('keeps non-content billing metadata useful', () => {
    expect(redactHostedChatPayloadForStorage({
      credits_consumed: 1.5,
      model: 'gpt-5-6-terra',
      status: 'completed',
      usage: { input_tokens: 10, output_tokens: 2 },
    })).toEqual({
      credits_consumed: 1.5,
      model: 'gpt-5-6-terra',
      status: 'completed',
      usage: { input_tokens: 10, output_tokens: 2 },
    });
  });
});
