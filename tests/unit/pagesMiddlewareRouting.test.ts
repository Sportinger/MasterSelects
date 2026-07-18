import { describe, expect, it, vi } from 'vitest';
import { onRequest } from '../../functions/_middleware';
import type { AppContext, Env } from '../../functions/lib/env';

function makeContext(path: string, response: Response, method = 'GET') {
  const pending: Promise<unknown>[] = [];
  const put = vi.fn(async () => undefined);
  const context: AppContext = {
    data: {},
    env: {
      KV: { put },
    } as unknown as Env,
    next: vi.fn(async () => response),
    params: {},
    request: new Request(`https://www.masterselects.com${path}`, { method }),
    waitUntil: (promise) => pending.push(promise),
  };

  return { context, pending, put };
}

describe('Pages middleware routing', () => {
  it('returns a real 404 without tracking unknown HTML fallbacks', async () => {
    const { context, pending, put } = makeContext('/about', new Response('<!doctype html>', {
      headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      status: 200,
    }));

    const response = await onRequest(context);

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-MasterSelects-Edge')).toBe('pages-functions');
    expect(await response.text()).toBe('Not Found');
    expect(pending).toHaveLength(0);
    expect(put).not.toHaveBeenCalled();

    const headContext = makeContext('/about', new Response('<!doctype html>', {
      headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      status: 200,
    }), 'HEAD').context;
    const headResponse = await onRequest(headContext);

    expect(headResponse.status).toBe(404);
    expect(headResponse.body).toBeNull();
  });

  it('keeps supported pages and real extensionless assets', async () => {
    for (const path of [
      '/',
      '/?test=parallel-decode',
      '/index.html',
      '/landing',
      '/claim/code',
      '/credits/claim/code',
      '/impressum',
      '/datenschutz',
      '/imprint',
      '/privacy',
    ]) {
      const { context, pending } = makeContext(path, new Response('<!doctype html>', {
        headers: { 'Content-Type': 'text/html; charset=UTF-8' },
        status: 200,
      }));

      expect((await onRequest(context)).status).toBe(200);
      await Promise.all(pending);
    }

    const { context, pending, put } = makeContext(
      '/downloads/masterselects-helper',
      new Response('binary', { headers: { 'Content-Type': 'application/octet-stream' } }),
    );

    expect((await onRequest(context)).status).toBe(200);
    await Promise.all(pending);
    expect(pending).toHaveLength(0);
    expect(put).not.toHaveBeenCalled();

    const api = makeContext('/api/me', Response.json({ ok: true }));
    expect((await onRequest(api.context)).status).toBe(200);
    expect(api.pending).toHaveLength(0);
  });
});
