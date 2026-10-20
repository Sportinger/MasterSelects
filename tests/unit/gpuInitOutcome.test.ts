import { afterEach, describe, expect, it, vi } from 'vitest';

const track = vi.hoisted(() => vi.fn());
vi.mock('../../src/services/productAnalytics/index', () => ({ productAnalytics: { track } }));

const {
  classifyGpuVendor, isInAppBrowser, resolveBrowser, resolveOsMajor, trackGpuInitOutcome, resetGpuInitOutcomeForTests,
} = await import('../../src/services/productAnalytics/gpuInitOutcome');
const { recordGpuStartupFailure, resetGpuStartupProbeForTests } = await import('../../src/services/diagnostics/gpuStartupProbe');
const { sanitizeProductAnalyticsProperties } = await import('../../src/services/productAnalytics/catalog');

afterEach(() => { track.mockReset(); resetGpuInitOutcomeForTests(); resetGpuStartupProbeForTests(); });

describe('gpu_init_outcome classification', () => {
  it('buckets GPU names from adapter info and WebGL renderer strings', () => {
    expect(classifyGpuVendor('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11)')).toBe('nvidia');
    expect(classifyGpuVendor('AMD Radeon R9 200 Series, or similar')).toBe('amd');
    expect(classifyGpuVendor('intel', 'gen-8')).toBe('intel');
    expect(classifyGpuVendor('Qualcomm Adreno (TM) 740')).toBe('qualcomm');
    expect(classifyGpuVendor('ARM Mali-G68')).toBe('arm');
    expect(classifyGpuVendor('Samsung Xclipse 940')).toBe('samsung');
    expect(classifyGpuVendor('Imagination PowerVR Rogue GE8320')).toBe('imagination');
    expect(classifyGpuVendor('Google SwiftShader')).toBe('software');
    expect(classifyGpuVendor('Mesa llvmpipe (LLVM 17.0.6, 256 bits) AMD')).toBe('software');
    expect(classifyGpuVendor('apple')).toBe('apple');
    expect(classifyGpuVendor('Some Vendor X1')).toBe('other');
    expect(classifyGpuVendor(undefined, '')).toBe('unknown');
  });

  it('resolves browser family, major version and in-app browsers', () => {
    const instagram = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 400.0';
    expect(isInAppBrowser(instagram)).toBe(true);
    expect(resolveOsMajor('ios', instagram)).toBe(18);
    expect(resolveBrowser('Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0', 'firefox')).toEqual({ browser: 'firefox', major: 157 });
    expect(resolveBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 OPR/125.0.0.0', 'chrome'))
      .toEqual({ browser: 'opera', major: 125 });
    expect(resolveBrowser('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36', 'chrome'))
      .toEqual({ browser: 'samsung', major: 28 });
    expect(resolveBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15', 'safari'))
      .toEqual({ browser: 'safari', major: 18 });
  });

  it('maps client-hint platform versions to OS majors', () => {
    expect(resolveOsMajor('windows', '', '15.0.0')).toBe(11);
    expect(resolveOsMajor('windows', '', '10.0.0')).toBe(10);
    expect(resolveOsMajor('android', 'Android 10; K', '15.0.0')).toBe(15);
    expect(resolveOsMajor('macos', 'Mac OS X 10_15_7')).toBeUndefined();
  });
});

describe('gpu_init_outcome tracking', () => {
  it('reports one failure per host with the failure code and a catalog-valid payload', () => {
    recordGpuStartupFailure('unsupported');
    trackGpuInitOutcome({ host: 'main', ready: false, failure: 'unsupported', startedAt: performance.now() });
    trackGpuInitOutcome({ host: 'main', ready: true });
    expect(track).toHaveBeenCalledTimes(1);
    const [name, properties] = track.mock.calls[0];
    expect(name).toBe('gpu_init_outcome');
    expect(properties).toMatchObject({ outcome: 'failed', failure: 'unsupported', host: 'main' });
    // Everything sent must survive the allowlist the server applies again.
    expect(sanitizeProductAnalyticsProperties('gpu_init_outcome', properties)).toEqual(properties);
  });

  it('reports successes without a failure code', () => {
    trackGpuInitOutcome({ host: 'worker', ready: true });
    expect(track.mock.calls[0][1]).toMatchObject({ outcome: 'ready', host: 'worker' });
    expect(track.mock.calls[0][1]).not.toHaveProperty('failure');
  });
});
