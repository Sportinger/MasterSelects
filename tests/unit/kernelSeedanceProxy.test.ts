import { afterEach, describe, expect, it, vi } from 'vitest';

import { onRequest } from '../../functions/api/kernel/[[path]]';
import type { AppContext, Env } from '../../functions/lib/env';

afterEach(() => vi.unstubAllGlobals());

describe('Seedance kernel proxy', () => {
  it('binds source-bundle access to the authenticated user principal', async () => {
    let forwardedHeaders = new Headers();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      forwardedHeaders = new Headers(init?.headers);
      return Response.json({ schemaVersion: 1, kind: 'ideas', ideas: [] });
    }));
    const request = new Request('https://masterselects.test/api/kernel/preproduction/seedance', {
      body: JSON.stringify({ operation: 'ingest-sources', input: {} }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    const context = {
      data: { user: { email: 'user@example.test', id: 'user-123' } },
      env: {
        KERNEL_AUTH_TOKEN: 'kernel-token',
        KERNEL_ORIGIN: 'https://kernel.example.test',
      } as Env,
      next: async () => new Response(null),
      params: { path: 'preproduction/seedance' },
      request,
      waitUntil: () => undefined,
    } satisfies AppContext;

    await onRequest(context);

    expect(forwardedHeaders.get('Authorization')).toBe('Bearer kernel-token');
    expect(forwardedHeaders.get('X-MasterSelects-Principal')).toBe('user-123');
  });

  it('propagates a browser cancellation to the upstream kernel request', async () => {
    const browserAbort = new AbortController();
    let forwardedSignal: AbortSignal | null = null;
    let markFetchStarted: (() => void) | undefined;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      forwardedSignal = init?.signal ?? null;
      markFetchStarted?.();
      return new Promise<Response>((_resolve, reject) => {
        forwardedSignal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        }, { once: true });
      });
    }));
    const request = new Request('https://masterselects.test/api/kernel/preproduction/seedance', {
      body: JSON.stringify({ operation: 'ideas', input: { prompt: 'test' } }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal: browserAbort.signal,
    });
    const context = {
      data: { user: { email: 'user@example.test', id: 'user-123' } },
      env: {
        KERNEL_AUTH_TOKEN: 'kernel-token',
        KERNEL_ORIGIN: 'https://kernel.example.test',
      } as Env,
      next: async () => new Response(null),
      params: { path: 'preproduction/seedance' },
      request,
      waitUntil: () => undefined,
    } satisfies AppContext;

    const responsePromise = onRequest(context);
    await fetchStarted;
    browserAbort.abort();
    const response = await responsePromise;

    expect(forwardedSignal?.aborted).toBe(true);
    expect(response.status).toBe(502);
  });

  it('preserves orchestration replay queries, SSE content type, and cursors', async () => {
    let forwardedUrl = '';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      forwardedUrl = url;
      return new Response('id: 8\nevent: run.phase\ndata: {}\n\n', {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'X-Seedance-Next-Sequence': '8',
          'X-Seedance-Phase': 'reviewing',
        },
      });
    }));
    const request = new Request(
      'https://masterselects.test/api/kernel/preproduction/seedance/runs/run-1/events?after=3&limit=50',
      { headers: { Accept: 'text/event-stream' } },
    );
    const context = {
      data: { user: { email: 'user@example.test', id: 'user-123' } },
      env: {
        KERNEL_AUTH_TOKEN: 'kernel-token',
        KERNEL_ORIGIN: 'https://kernel.example.test',
      } as Env,
      next: async () => new Response(null),
      params: { path: ['preproduction', 'seedance', 'runs', 'run-1', 'events'] },
      request,
      waitUntil: () => undefined,
    } satisfies AppContext;

    const response = await onRequest(context);

    expect(forwardedUrl).toBe(
      'https://kernel.example.test/kernel/preproduction/seedance/runs/run-1/events?after=3&limit=50',
    );
    expect(response.headers.get('Content-Type')).toContain('text/event-stream');
    expect(response.headers.get('X-Seedance-Next-Sequence')).toBe('8');
    expect(response.headers.get('X-Seedance-Phase')).toBe('reviewing');
  });

  it('allows authenticated visual-frame status and upload traffic', async () => {
    const forwarded: Array<{ method: string; url: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      forwarded.push({ method: String(init?.method ?? 'GET'), url });
      return Response.json({ schemaVersion: 1, kind: 'source-frame-status', complete: true, media: [] });
    }));
    const contextFor = (request: Request) => ({
      data: { user: { email: 'user@example.test', id: 'user-123' } },
      env: { KERNEL_AUTH_TOKEN: 'kernel-token', KERNEL_ORIGIN: 'https://kernel.example.test' } as Env,
      next: async () => new Response(null),
      params: { path: ['preproduction', 'seedance', 'source-frames'] },
      request,
      waitUntil: () => undefined,
    }) satisfies AppContext;

    await onRequest(contextFor(new Request(
      `https://masterselects.test/api/kernel/preproduction/seedance/source-frames?sourceBundleId=source-bundle-${'a'.repeat(64)}`,
    )));
    await onRequest(contextFor(new Request(
      'https://masterselects.test/api/kernel/preproduction/seedance/source-frames',
      { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } },
    )));

    expect(forwarded).toEqual([
      expect.objectContaining({ method: 'GET' }),
      expect.objectContaining({ method: 'POST' }),
    ]);
    expect(forwarded[0]?.url).toContain('/kernel/preproduction/seedance/source-frames?sourceBundleId=');
  });
});
