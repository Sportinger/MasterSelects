import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCloudflareAdminSnapshot } from '../../functions/lib/cloudflareAdmin';
import type { Env } from '../../functions/lib/env';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
}

describe('Cloudflare admin analytics', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('discovers Pages Web Analytics and Functions analytics without a zone id', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-29T12:00:00.000Z'));

    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/pages/projects/masterselects')) {
        return jsonResponse({
          result: {
            build_config: { web_analytics_tag: 'rum-site-tag' },
            domains: ['masterselects.pages.dev'],
            name: 'masterselects',
            production_branch: 'main',
            production_script_name: 'pages-worker-production',
          },
          success: true,
        });
      }
      if (url.includes('/pages/projects/masterselects/deployments')) {
        return jsonResponse({ result: [], success: true });
      }
      if (url.endsWith('/graphql')) {
        const request = JSON.parse(String(init?.body)) as {
          query: string;
          variables: Record<string, string>;
        };
        expect(request.variables.start).toBe('2026-08-23');
        expect(request.variables.end).toBe('2026-08-29');

        if (request.query.includes('AdminWebAnalytics')) {
          expect(request.variables.siteTag).toBe('rum-site-tag');
          return jsonResponse({ data: { viewer: { accounts: [{
            browsers: [{ count: 8, dimensions: { userAgentBrowser: 'Chrome' } }],
            countries: [{ count: 9, dimensions: { countryName: 'Germany' } }],
            daily: [
              { count: 10, dimensions: { date: '2026-08-28' }, sum: { visits: 7 } },
              { count: 20, dimensions: { date: '2026-08-29' }, sum: { visits: 12 } },
            ],
            devices: [{ count: 14, dimensions: { deviceType: 'mobile' } }],
            referrers: [{ count: 6, dimensions: { refererHost: 'instagram.com' } }],
            topPaths: [{ count: 22, dimensions: { requestPath: '/editor' } }],
          }] } } });
        }

        expect(request.query).toContain('AdminPagesFunctions');
        expect(request.variables.scriptName).toBe('pages-worker-production');
        return jsonResponse({ data: { viewer: { accounts: [{
          daily: [
            {
              dimensions: { date: '2026-08-28' },
              sum: { errors: 2, requests: 100, responseBodySize: 2048 },
            },
            {
              dimensions: { date: '2026-08-29' },
              sum: { errors: 1, requests: 50, responseBodySize: 1024 },
            },
          ],
          statuses: [
            { dimensions: { status: 'success' }, sum: { requests: 147 } },
            { dimensions: { status: 'internalError' }, sum: { requests: 3 } },
          ],
        }] } } });
      }
      throw new Error(`Unexpected Cloudflare request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const env = {
      CLOUDFLARE_ACCOUNT_ID: 'account-id',
      CLOUDFLARE_API_TOKEN: 'secret-token',
      CLOUDFLARE_PAGES_PROJECT: 'masterselects',
      KV: { list: vi.fn().mockResolvedValue({ keys: [], list_complete: true }) },
    } as unknown as Env;

    const snapshot = await getCloudflareAdminSnapshot(env);

    expect(snapshot.error).toBeNull();
    expect(snapshot.traffic).toMatchObject({
      available: true,
      browsers: [{ browser: 'Chrome', count: 8 }],
      countries: [{ count: 9, country: 'Germany' }],
      devices: [{ count: 14, device: 'mobile' }],
      referrers: [{ count: 6, referrer: 'instagram.com' }],
      requests7d: 30,
      source: 'web-analytics',
      topPaths: [{ bytes: 0, path: '/editor', requests: 22 }],
      visits7d: 19,
    });
    expect(snapshot.pagesFunctions).toMatchObject({
      available: true,
      errors7d: 3,
      requests7d: 150,
      responseBytes7d: 3072,
      statuses: [
        { count: 147, status: 'success' },
        { count: 3, status: 'internalError' },
      ],
    });
  });
});
