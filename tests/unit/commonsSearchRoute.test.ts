import { afterEach, describe, expect, it, vi } from 'vitest';

import { onRequest } from '../../functions/api/media/commons/search';
import type { AppContext } from '../../functions/lib/env';

function contextFor(query: string): AppContext {
  return {
    data: { user: { email: 'debug@local.invalid', id: 'commons-route-test' } },
    env: { SESSION_SECRET: 'commons-route-test-secret' },
    next: async () => new Response(null, { status: 404 }),
    params: {},
    request: new Request('http://localhost/api/media/commons/search', {
      body: JSON.stringify({ limit: 4, query }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }),
    waitUntil: vi.fn(),
  } as AppContext;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Commons search route', () => {
  it('returns filtered images with signed import authorization', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      query: {
        pages: [{
          imageinfo: [{
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:Karlsruhe.jpg',
            extmetadata: {
              Artist: { value: 'Example photographer' },
              ImageDescription: { value: 'Bundesverfassungsgericht Karlsruhe' },
              LicenseShortName: { value: 'CC BY-SA 4.0' },
              LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0/' },
            },
            height: 900,
            mime: 'image/jpeg',
            thumburl: 'https://upload.wikimedia.org/karlsruhe-thumb.jpg',
            url: 'https://upload.wikimedia.org/karlsruhe.jpg',
            width: 1_600,
          }],
          ns: 6,
          pageid: 42,
          revisions: [{ revid: 7 }],
          title: 'File:Karlsruhe.jpg',
        }],
      },
    })));

    const response = await onRequest(contextFor('Bundesverfassungsgericht Karlsruhe'));
    const payload = await response.json() as { results: Array<Record<string, unknown>> };

    expect(response.status).toBe(200);
    expect(payload.results).toHaveLength(1);
    expect(payload.results[0]).toMatchObject({
      license: 'CC BY-SA 4.0',
      mimeType: 'image/jpeg',
      pageId: 42,
      title: 'Karlsruhe.jpg',
    });
    expect(payload.results[0]?.importToken).toEqual(expect.stringMatching(/^[^.]+\.[^.]+$/u));
  });

  it('surfaces upstream rate limits with a bounded retry delay', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, {
      headers: { 'Retry-After': '2' },
      status: 429,
    })));

    const response = await onRequest(contextFor('Karlsruhe'));
    const payload = await response.json() as { error: string; retryAfterMs: number };

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('2');
    expect(payload).toMatchObject({ retryAfterMs: 2_000 });
  });

  it('turns an outgoing network exception into a stable JSON error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network unavailable')));

    const response = await onRequest(contextFor('Karlsruhe'));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: 'Wikimedia Commons search request failed.',
    });
  });
});
