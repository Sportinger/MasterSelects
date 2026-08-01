import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest as onAudioRequest } from '../../functions/api/ai/audio';
import { onRequest as onChatRequest } from '../../functions/api/ai/chat';
import { onRequest as onVideoRequest } from '../../functions/api/ai/video';
import type { AppContext, AppRouteHandler } from '../../functions/lib/env';
import {
  hasByokCredentialField,
  hasByokProviderKeyHeader,
} from '../../functions/lib/noByok';

function contextFor(path: string, init: RequestInit): AppContext {
  return {
    data: { requestId: 'no-byok-request' },
    env: {} as AppContext['env'],
    next: async () => new Response(null),
    params: {},
    request: new Request(`https://masterselects.test${path}`, init),
    waitUntil: vi.fn(),
  };
}

async function payload(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('no-BYOK request classifier', () => {
  it.each(['apiKey', 'api_key', 'accessKey', 'secretKey', 'hfToken'])(
    'finds recursive %s fields, including inside arrays',
    (field) => {
      expect(hasByokCredentialField({
        params: [{ nested: { [field]: '' } }],
      })).toBe(true);
    },
  );

  it('does not reject ordinary similarly named metadata', () => {
    expect(hasByokCredentialField({
      accessKeyId: 'catalog-item',
      apiKeys: ['display-label'],
      hfTokenCount: 2,
      keyboard: 'qwerty',
      providerKey: 'video-decoder-1',
      secretKeyHint: 'not-present',
    })).toBe(false);
  });

  it('recognizes provider credential headers but not adjacent metadata headers', () => {
    for (const name of [
      'anthropic-api-key',
      'api-key',
      'provider-key',
      'x-api-key',
      'x-evolink-api-key',
      'x-provider-api-key',
      'xi-api-key',
    ]) {
      expect(hasByokProviderKeyHeader(new Headers({ [name]: 'secret' })), name).toBe(true);
    }

    expect(hasByokProviderKeyHeader(new Headers({
      'x-api-key-id': 'catalog-item',
      'x-provider-key-version': 'v1',
    }))).toBe(false);
  });
});

describe('hosted AI no-BYOK boundary', () => {
  const routes: Array<{
    handler: AppRouteHandler;
    path: string;
  }> = [
    { handler: onAudioRequest, path: '/api/ai/audio' },
    { handler: onVideoRequest, path: '/api/ai/video' },
    { handler: onChatRequest, path: '/api/ai/chat' },
  ];

  it.each(routes)('rejects a provider-key header before $path route work', async ({ handler, path }) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await handler(contextFor(path, {
      headers: { 'x-provider-api-key': 'user-secret' },
      method: 'GET',
    }));

    expect(response.status).toBe(400);
    expect(await payload(response)).toMatchObject({ error: 'byok_disabled' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(routes)('rejects a nested key-bearing body before $path route work', async ({ handler, path }) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await handler(contextFor(path, {
      body: JSON.stringify({ params: { references: [{ api_key: 'user-secret' }] } }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }));

    expect(response.status).toBe(400);
    expect(await payload(response)).toMatchObject({ error: 'byok_disabled' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('retired EvoLink BYO boundaries', () => {
  it('removes the route handlers and Vite development proxy entirely', () => {
    const source = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');

    expect(existsSync(resolve(process.cwd(), 'functions/api/evolink/byo/request.ts'))).toBe(false);
    expect(existsSync(resolve(process.cwd(), 'functions/api/evolink/byo/upload.ts'))).toBe(false);
    expect(source).not.toContain('/api/evolink/byo/');
    expect(source).not.toContain('https://api.evolink.ai');
    expect(source).not.toContain('https://files-api.evolink.ai');
  });
});
