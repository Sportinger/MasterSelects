import { describe, expect, it, vi } from 'vitest';
import { onRequest } from '../../functions/_middleware';
import type { AppContext, Env } from '../../functions/lib/env';

function makeContext(
  path: string,
  response: Response,
  method = 'GET',
  options: {
    cf?: Record<string, string>;
    headers?: HeadersInit;
    sessionSecret?: string;
    visitorSecret?: string;
  } = {},
) {
  const pending: Promise<unknown>[] = [];
  const put = vi.fn(async () => undefined);
  const request = new Request(`https://www.masterselects.com${path}`, {
    headers: options.headers,
    method,
  });
  if (options.cf) Object.defineProperty(request, 'cf', { value: options.cf });
  const context: AppContext = {
    data: {},
    env: {
      KV: { put },
      SESSION_SECRET: options.sessionSecret,
      VISITOR_NOTIFY_SECRET: options.visitorSecret,
    } as unknown as Env,
    next: vi.fn(async () => response),
    params: {},
    request,
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
      '/landing-preview',
      '/chat',
      '/editor',
      '/claim/code',
      '/credits/claim/code',
      '/impressum',
      '/datenschutz',
      '/imprint',
      '/privacy',
      '/docs/',
      '/docs/features/timeline/',
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

  it('stores privacy-minimized visit metadata for 180 days', async () => {
    const { context, pending, put } = makeContext('/editor?project=private', new Response('<!doctype html>', {
      headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      status: 200,
    }), 'GET', {
      cf: { city: 'Berlin', country: 'de' },
      headers: {
        'cf-connecting-ip': '203.0.113.42',
        referer: 'https://news.ycombinator.com/item?id=secret',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36',
      },
      visitorSecret: 'test-only-visitor-secret',
    });

    expect((await onRequest(context)).status).toBe(200);
    await Promise.all(pending);

    expect(put).toHaveBeenCalledTimes(1);
    const [key, value, writeOptions] = put.mock.calls[0];
    expect(key).toMatch(/^visit2:\d{13}:\d{13}:[a-f0-9]{8}$/);
    expect(value).toBe('');
    expect(writeOptions).toEqual({
      expirationTtl: 180 * 24 * 60 * 60,
      metadata: {
        browser: 'chrome',
        country: 'DE',
        device: 'desktop',
        os: 'windows',
        path: '/editor',
        referrerHost: 'news.ycombinator.com',
        ts: expect.any(Number),
        visitorId: expect.stringMatching(/^[a-f0-9]{16}$/),
      },
    });
    expect(writeOptions.metadata).not.toHaveProperty('city');
    expect(writeOptions.metadata).not.toHaveProperty('ua');
    expect(writeOptions.metadata).not.toHaveProperty('referer');
  });

  it('rotates the pseudonymous visitor id at the UTC day boundary', async () => {
    vi.useFakeTimers();

    const captureVisitorId = async (timestamp: string) => {
      vi.setSystemTime(new Date(timestamp));
      const { context, pending, put } = makeContext('/editor', new Response('<!doctype html>', {
        headers: { 'Content-Type': 'text/html; charset=UTF-8' },
        status: 200,
      }), 'GET', {
        headers: { 'cf-connecting-ip': '203.0.113.42' },
        visitorSecret: 'test-only-visitor-secret',
      });

      await onRequest(context);
      await Promise.all(pending);
      return put.mock.calls[0][2].metadata.visitorId as string;
    };

    try {
      const morning = await captureVisitorId('2026-08-16T08:00:00Z');
      const evening = await captureVisitorId('2026-08-16T20:00:00Z');
      const nextDay = await captureVisitorId('2026-08-17T08:00:00Z');

      expect(evening).toBe(morning);
      expect(nextDay).not.toBe(morning);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses trusted proxy and session-secret fallbacks for the daily visitor id', async () => {
    const { context, pending, put } = makeContext('/editor', new Response('<!doctype html>', {
      headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      status: 200,
    }), 'GET', {
      headers: { 'x-forwarded-for': '203.0.113.42, 198.51.100.10' },
      sessionSecret: 'test-only-session-secret',
    });

    await onRequest(context);
    await Promise.all(pending);

    expect(put.mock.calls[0][2].metadata.visitorId).toMatch(/^[a-f0-9]{16}$/);
  });

  it('removes credit-claim secrets from stored paths', async () => {
    for (const [requestedPath, storedPath] of [
      ['/claim/sensitive-code', '/claim'],
      ['/credits/claim/another-sensitive-code', '/credits/claim'],
    ]) {
      const { context, pending, put } = makeContext(requestedPath, new Response('<!doctype html>', {
        headers: { 'Content-Type': 'text/html; charset=UTF-8' },
        status: 200,
      }));

      expect((await onRequest(context)).status).toBe(200);
      await Promise.all(pending);
      expect(put.mock.calls[0][2].metadata.path).toBe(storedPath);
    }
  });

  it('returns 404 for the removed admin page and protects the remaining admin API', async () => {
    const page = makeContext('/admin', new Response('<!doctype html>', {
      headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      status: 200,
    }));
    const pageResponse = await onRequest(page.context);

    expect(pageResponse.status).toBe(404);
    expect(await pageResponse.text()).toBe('Not Found');

    const api = makeContext('/api/admin/stats-brief', Response.json({ ok: true }));
    const apiResponse = await onRequest(api.context);
    expect(apiResponse.headers.get('Cache-Control')).toBe('no-store, private, max-age=0');
    expect(apiResponse.headers.get('Content-Security-Policy')).toBeNull();
    expect(apiResponse.headers.get('X-Frame-Options')).toBe('DENY');
  });
});

describe('Pages middleware security headers', () => {
  it('hardens every response and keeps same-origin framing for the claim page', async () => {
    const { context } = makeContext('/api/me', Response.json({ ok: true }));
    const response = await onRequest(context);

    expect(response.headers.get('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
    expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('Permissions-Policy')).toBe('geolocation=(), payment=(), interest-cohort=()');
    expect(response.headers.get('Content-Security-Policy')).toBeNull();

    const html = makeContext('/editor', new Response('<!doctype html>', {
      headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      status: 200,
    }));
    const htmlResponse = await onRequest(html.context);
    expect(htmlResponse.headers.get('Content-Security-Policy')).toBe("frame-ancestors 'self'");
    expect(htmlResponse.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
    await Promise.all(html.pending);
  });

  it('keeps the stricter admin API headers', async () => {
    const { context } = makeContext('/api/admin/session', Response.json({ ok: true }));
    const response = await onRequest(context);

    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains');
  });
});
