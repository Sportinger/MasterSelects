import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCloudflareAdminSnapshot } from '../../functions/lib/cloudflareAdmin';
import type { Env } from '../../functions/lib/env';

describe('Cloudflare admin recent visits', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the live dashboard limited to one hour and stops before retained history', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-16T20:00:00Z'));
    const now = Date.now();
    const list = vi.fn()
      .mockResolvedValueOnce({
        cursor: 'older-page',
        keys: [
          {
            metadata: {
              country: 'DE',
              path: '/editor',
              ts: now - 5 * 60 * 1_000,
              visitorId: 'visitor-a',
            },
            name: 'visit2:newest',
          },
          {
            metadata: {
              country: 'US',
              path: '/',
              ts: now - 2 * 60 * 60 * 1_000,
              visitorId: 'visitor-b',
            },
            name: 'visit2:old',
          },
        ],
        list_complete: false,
      })
      .mockResolvedValueOnce({ keys: [], list_complete: true });
    const env = {
      KV: { list },
    } as unknown as Env;

    const snapshot = await getCloudflareAdminSnapshot(env);

    expect(list).toHaveBeenCalledTimes(1);
    expect(snapshot.visitsLastHour).toEqual({
      countries: [{ count: 1, country: 'DE' }],
      paths: [{ count: 1, path: '/editor' }],
      requests: 1,
      uniqueVisitors: 1,
    });
  });
});
