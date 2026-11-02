import { describe, expect, it, vi } from 'vitest';
import { isKnownCrawler } from '../../functions/lib/crawlerUserAgents';
import { onRequest as onEvents } from '../../functions/api/analytics/events';
import type { AppContext } from '../../functions/lib/env';

const GOOGLEBOT_PHONE = 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

describe('crawler user agents', () => {
  it.each([
    GOOGLEBOT_PHONE,
    'DuckDuckBot/1.0; (+http://duckduckgo.com/duckduckbot.html)',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ShapBot/0.1.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/156.0.0.0 Safari/537.36',
    'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
  ])('recognises %s', (agent) => {
    expect(isKnownCrawler(agent)).toBe(true);
  });

  it.each([
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64; rv:153.0) Gecko/20100101 Firefox/153.0',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/23D127 Instagram 453.0.0.39.58',
    'Mozilla/5.0 (Linux; Android 13; CUBOT KingKong 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36',
  ])('leaves people alone: %s', (agent) => {
    expect(isKnownCrawler(agent)).toBe(false);
  });

  it('product analytics store nothing from a crawler', async () => {
    const prepare = vi.fn();
    const context = {
      data: {}, params: {}, waitUntil: vi.fn(),
      env: { DB: { prepare, batch: vi.fn(), exec: vi.fn() }, KV: { get: vi.fn(async () => null), put: vi.fn(async () => undefined) }, SESSION_SECRET: 'test-secret-value-long-enough' },
      request: new Request('https://masterselects.com/api/analytics/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://masterselects.com', 'User-Agent': GOOGLEBOT_PHONE },
        body: JSON.stringify({ events: [{ id: 'x' }] }),
      }),
    } as unknown as AppContext;
    const response = await onEvents(context);
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ ok: true, accepted: 0, discarded: 1 });
    expect(prepare).not.toHaveBeenCalled();
  });
});
