import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebGPUContext } from '../../src/engine/core/WebGPUContext';
import {
  ANDROID_ADAPTER_MEMORY_KEY,
  STALLED_DEVICE_TIMEOUT_MS,
  browserIdentity,
  planAndroidAdapterRequests,
  readAndroidAdapterMemory,
  recordAndroidAdapterOutcome,
} from '../../src/engine/core/androidAdapterMemory';
import { shouldDeferPhoneEngineStart } from '../../src/components/mobileSkin/runtime/phoneEngineStartPolicy';
import {
  formatPhoneBootTimeline,
  isPhoneBootSettled,
  markPhoneBootPhase,
  readPhoneBootTimeline,
  resetPhoneBootTimelineForTests,
} from '../../src/components/mobileSkin/runtime/phoneBootTimeline';

const log = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../../src/services/logger', () => ({ Logger: { create: vi.fn(() => log) } }));

const PIXEL_UA = 'Mozilla/5.0 (Linux; Android 16; Pixel 10 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

function createAdapter(): GPUAdapter {
  const device = { lost: new Promise<GPUDeviceLostInfo>(() => {}), destroy: vi.fn() } as unknown as GPUDevice;
  return {
    features: new Set(),
    limits: { maxTextureDimension2D: 8192, maxStorageBufferBindingSize: 1 << 30, maxBufferSize: 1 << 30 },
    requestDevice: vi.fn(async () => device),
  } as unknown as GPUAdapter;
}

function setNavigator(userAgent: string, platform: string, requestAdapter: (...args: unknown[]) => Promise<GPUAdapter | null>): void {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: userAgent });
  Object.defineProperty(navigator, 'platform', { configurable: true, value: platform });
  Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: undefined });
  Object.defineProperty(navigator, 'gpu', { configurable: true, value: { requestAdapter, getPreferredCanvasFormat: () => 'rgba8unorm' } });
}

const original = {
  gpu: navigator.gpu,
  userAgent: navigator.userAgent,
  platform: navigator.platform,
  userAgentData: (navigator as Navigator & { userAgentData?: unknown }).userAgentData,
};

beforeEach(() => {
  localStorage.clear();
  resetPhoneBootTimelineForTests();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  localStorage.clear();
  for (const [key, value] of Object.entries(original)) Object.defineProperty(navigator, key, { configurable: true, value });
});

describe('Android adapter memory', () => {
  const browser = browserIdentity(PIXEL_UA);

  it('identifies the browser by name and major version', () => {
    expect(browser).toBe('chrome-146');
    expect(browserIdentity('Mozilla/5.0 (Linux; Android 14) SamsungBrowser/27.0 Chrome/125.0')).toBe('samsungbrowser-27');
  });

  it('asks for compatibility first after a core timeout, and fails fast after both stalled', () => {
    expect(planAndroidAdapterRequests(null, browser)).toMatchObject({ order: ['core', 'compatibility'], timeoutMs: 15_000, reason: 'default' });
    const afterCore = recordAndroidAdapterOutcome('core', 'timeout', browser);
    expect(planAndroidAdapterRequests(afterCore, browser)).toMatchObject({ order: ['compatibility', 'core'], timeoutMs: 15_000, reason: 'core-timed-out' });
    const afterBoth = recordAndroidAdapterOutcome('compatibility', 'timeout', browser);
    expect(planAndroidAdapterRequests(afterBoth, browser)).toMatchObject({ timeoutMs: STALLED_DEVICE_TIMEOUT_MS, reason: 'both-timed-out' });
  });

  it('keeps the path that worked and forgets old timeouts once a start succeeds', () => {
    recordAndroidAdapterOutcome('core', 'timeout', browser);
    const worked = recordAndroidAdapterOutcome('compatibility', 'ok', browser);
    expect(worked).toMatchObject({ coreTimeouts: 0, compatibilityTimeouts: 0, worked: 'compatibility' });
    expect(planAndroidAdapterRequests(worked, browser).order).toEqual(['compatibility', 'core']);
  });

  it('starts fresh after a browser update and reads damaged storage as no memory', () => {
    const stored = recordAndroidAdapterOutcome('core', 'timeout', 'chrome-145');
    expect(planAndroidAdapterRequests(stored, browser)).toMatchObject({ order: ['core', 'compatibility'], reason: 'browser-changed' });
    localStorage.setItem(ANDROID_ADAPTER_MEMORY_KEY, '{not json');
    expect(readAndroidAdapterMemory()).toBeNull();
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readAndroidAdapterMemory(throwing)).toBeNull();
    expect(recordAndroidAdapterOutcome('core', 'timeout', browser, throwing)).toBeNull();
  });
});

describe('WebGPUContext on Android remembers an adapter stall per device', () => {
  it('times out on core once, then goes straight to compatibility mode on the next start', async () => {
    vi.useFakeTimers();
    const pending = vi.fn(() => new Promise<GPUAdapter | null>(() => {}));
    setNavigator(PIXEL_UA, 'Linux armv8l', pending);
    const first = new WebGPUContext().initialize();
    await vi.advanceTimersByTimeAsync(15_001);
    expect(await first).toBe(false);
    expect(pending).toHaveBeenCalledExactlyOnceWith();
    expect(readAndroidAdapterMemory()).toMatchObject({ coreTimeouts: 1, browser: 'chrome-146' });
    expect(log.warn).toHaveBeenCalledWith(expect.stringMatching(/core adapter request stalled for 15000 ms; remembered/), expect.anything());

    vi.useRealTimers();
    const adapter = createAdapter();
    const second = vi.fn(async () => adapter);
    setNavigator(PIXEL_UA, 'Linux armv8l', second);
    const context = new WebGPUContext();
    expect(await context.initialize()).toBe(true);
    expect(second).toHaveBeenCalledExactlyOnceWith({ featureLevel: 'compatibility' });
    expect(readAndroidAdapterMemory()).toMatchObject({ worked: 'compatibility', coreTimeouts: 0 });
  });

  it('uses the short deadline once both adapter paths stalled on this device', async () => {
    const browser = browserIdentity(PIXEL_UA);
    recordAndroidAdapterOutcome('core', 'timeout', browser);
    recordAndroidAdapterOutcome('compatibility', 'timeout', browser);
    vi.useFakeTimers();
    const pending = vi.fn(() => new Promise<GPUAdapter | null>(() => {}));
    setNavigator(PIXEL_UA, 'Linux armv8l', pending);
    const context = new WebGPUContext();
    const result = context.initialize();
    await vi.advanceTimersByTimeAsync(STALLED_DEVICE_TIMEOUT_MS + 1);
    expect(await result).toBe(false);
    expect(context.getInitializationFailure()).toBe('adapter_timeout');
  });

  it('never reads or writes the memory on desktop, even after a desktop timeout', async () => {
    recordAndroidAdapterOutcome('core', 'timeout', browserIdentity(DESKTOP_UA));
    const before = localStorage.getItem(ANDROID_ADAPTER_MEMORY_KEY);
    vi.useFakeTimers();
    const pending = vi.fn(() => new Promise<GPUAdapter | null>(() => {}));
    setNavigator(DESKTOP_UA, 'Win32', pending);
    const result = new WebGPUContext().initialize();
    await vi.advanceTimersByTimeAsync(15_001);
    expect(await result).toBe(false);
    expect(pending).toHaveBeenCalledExactlyOnceWith({ powerPreference: 'high-performance' });
    expect(localStorage.getItem(ANDROID_ADAPTER_MEMORY_KEY)).toBe(before);
  });
});

describe('phone engine start and boot timings', () => {
  it('defers the GPU start only on an Android browser whose adapter stalled before', () => {
    const browser = browserIdentity(PIXEL_UA);
    const stalled = recordAndroidAdapterOutcome('core', 'timeout', browser);
    expect(shouldDeferPhoneEngineStart(PIXEL_UA, stalled)).toBe(true);
    expect(shouldDeferPhoneEngineStart(PIXEL_UA, null)).toBe(false);
    expect(shouldDeferPhoneEngineStart(DESKTOP_UA, stalled)).toBe(false);
    const healthy = recordAndroidAdapterOutcome('core', 'ok', browser);
    expect(shouldDeferPhoneEngineStart(PIXEL_UA, healthy)).toBe(false);
  });

  it('records each boot phase once and files one warning when a settled boot was slow', () => {
    expect(markPhoneBootPhase('boot-start', undefined, 100)).toBe(true);
    expect(markPhoneBootPhase('boot-start', undefined, 900)).toBe(false);
    markPhoneBootPhase('repository-open', 'restored', 400);
    markPhoneBootPhase('stores-hydrated', 'restored', 1_200);
    markPhoneBootPhase('timeline-visible', undefined, 1_500);
    expect(isPhoneBootSettled(readPhoneBootTimeline())).toBe(false);
    expect(log.warn).not.toHaveBeenCalled();
    markPhoneBootPhase('gpu-failed', 'timed out', 28_000);
    expect(log.info).toHaveBeenCalledWith('Boot phase timeline-visible at 1500 ms', undefined);
    expect(log.warn).toHaveBeenCalledExactlyOnceWith('Phone boot finished without a GPU', {
      timeline: 'boot-start 100 ms · repository-open 400 ms (+300) [restored] · stores-hydrated 1200 ms (+800) [restored] · timeline-visible 1500 ms (+300) · gpu-failed 28000 ms (+26500) [timed out]',
    });
    expect(formatPhoneBootTimeline(readPhoneBootTimeline())).toContain('timeline-visible 1500 ms');
  });

  it('stays quiet for a fast boot that drew its first frame', () => {
    markPhoneBootPhase('boot-start', undefined, 50);
    markPhoneBootPhase('timeline-visible', undefined, 900);
    markPhoneBootPhase('gpu-ready', undefined, 1_100);
    markPhoneBootPhase('first-preview-frame', undefined, 1_300);
    expect(isPhoneBootSettled(readPhoneBootTimeline())).toBe(true);
    expect(log.warn).not.toHaveBeenCalled();
  });
});
