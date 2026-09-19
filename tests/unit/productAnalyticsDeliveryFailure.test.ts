import { afterEach, expect, it, vi } from 'vitest';
import { ProductAnalyticsService } from '../../src/services/productAnalytics/ProductAnalyticsService';

vi.mock('../../src/services/productAnalytics/privacy', () => ({
  isProductAnalyticsEnabled: () => true,
  subscribeProductAnalyticsPreference: () => () => undefined,
}));

let service: ProductAnalyticsService | undefined;
afterEach(() => { service?.dispose(); vi.unstubAllGlobals(); });

it.each(['rejection', 'synchronous throw'])('contains fetch %s and bounds retries without duplicating the event', async (mode) => {
  const fetchMock = vi.fn(() => {
    const error = new TypeError('Controlled analytics network failure');
    if (mode === 'synchronous throw') throw error;
    return Promise.reject(error);
  });
  vi.stubGlobal('fetch', fetchMock);
  service = new ProductAnalyticsService();
  service.track('app_opened');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await expect(service.flush({ keepalive: true })).resolves.toBeUndefined();
  }
  expect(fetchMock).toHaveBeenCalledTimes(3);
  const batches = fetchMock.mock.calls.map((call) => {
    const [url, options] = call as unknown as [string, RequestInit];
    expect(url).toBe('/api/analytics/events');
    expect(options.keepalive).toBe(true);
    return JSON.parse(options.body as string).events;
  });
  expect(batches.every(batch => batch.length === 1)).toBe(true);
  expect(new Set(batches.map(batch => batch[0].id)).size).toBe(1);
});

it('recovers on a later delivery and does not resend acknowledged events', async () => {
  const fetchMock = vi.fn()
    .mockRejectedValueOnce(new TypeError('Controlled network failure'))
    .mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal('fetch', fetchMock);
  service = new ProductAnalyticsService();
  service.track('app_opened');
  await service.flush();
  await service.flush();
  await service.flush();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
