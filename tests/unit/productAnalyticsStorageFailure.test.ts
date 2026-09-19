import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let privacy: typeof import('../../src/services/productAnalytics/privacy');
let Service: typeof import('../../src/services/productAnalytics/ProductAnalyticsService')['ProductAnalyticsService'];
let service: InstanceType<typeof Service> | undefined;
let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn> };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  vi.resetModules();
  storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('navigator', { doNotTrack: '0' });
  fetchMock = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal('fetch', fetchMock);
  privacy = await import('../../src/services/productAnalytics/privacy');
  Service = (await import('../../src/services/productAnalytics/ProductAnalyticsService')).ProductAnalyticsService;
});
afterEach(() => { service?.dispose(); service = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('analytics storage failures', () => {
  it('still delivers permitted events when preference storage works', async () => {
    service = new Service();
    service.track('app_opened');
    await service.flush();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not throw or deliver queued events when pagehide cannot read the preference', async () => {
    service = new Service();
    service.track('app_opened');
    storage.getItem.mockImplementation(() => { throw new DOMException('Storage inaccessible', 'NS_ERROR_FAILURE'); });
    const errors = vi.fn((event: ErrorEvent) => event.preventDefault());
    window.addEventListener('error', errors);
    try {
      window.dispatchEvent(new Event('pagehide'));
      expect(errors).not.toHaveBeenCalled();
      await expect(service.flush({ keepalive: true })).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { window.removeEventListener('error', errors); }
  });

  it('retains an explicit opt-out and notifies subscribers when saving it fails', () => {
    storage.getItem.mockReturnValue('true');
    storage.setItem.mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    const listener = vi.fn();
    const unsubscribe = privacy.subscribeProductAnalyticsPreference(listener);
    try {
      expect(() => privacy.setStoredProductAnalyticsPreference(false)).not.toThrow();
      expect(privacy.getStoredProductAnalyticsPreference()).toBe(false);
      expect(privacy.isProductAnalyticsEnabled()).toBe(false);
      expect(listener).toHaveBeenCalledOnce();
    } finally { unsubscribe(); }
  });

  it('treats unavailable storage as disabled until an explicit session choice', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(privacy.isProductAnalyticsEnabled()).toBe(false);
    privacy.setStoredProductAnalyticsPreference(true);
    expect(privacy.isProductAnalyticsEnabled()).toBe(true);
    vi.stubGlobal('navigator', { globalPrivacyControl: true });
    expect(privacy.isProductAnalyticsEnabled()).toBe(false);
  });

  it('contains a throwing storage getter as well as getItem failures', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new DOMException('Denied', 'SecurityError'); } });
    expect(() => privacy.getStoredProductAnalyticsPreference()).not.toThrow();
    expect(privacy.getStoredProductAnalyticsPreference()).toBe(false);
    expect(() => privacy.setStoredProductAnalyticsPreference(false)).not.toThrow();
    expect(privacy.getStoredProductAnalyticsPreference()).toBe(false);
  });

  it('returns to persisted preferences after a successful write', () => {
    storage.setItem.mockImplementationOnce(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    privacy.setStoredProductAnalyticsPreference(false);
    storage.setItem.mockImplementation((_key, value) => storage.getItem.mockReturnValue(value));
    privacy.setStoredProductAnalyticsPreference(true);
    expect(privacy.getStoredProductAnalyticsPreference()).toBe(true);
    storage.getItem.mockReturnValue('false');
    window.dispatchEvent(new Event('storage'));
    expect(privacy.getStoredProductAnalyticsPreference()).toBe(false);
  });
});
