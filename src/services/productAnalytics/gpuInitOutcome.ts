import type { GPUInitializationFailure } from '../../engine/core/gpuInitializationFailure';
import { getHighEntropyUserAgent } from '../diagnostics/diagnosticContext';
import { getGpuStartupProbe } from '../diagnostics/gpuStartupProbe';
import { readWebGlDebugAdapterInfo } from '../render/webglAdapterHint';
import { getRuntimeDeviceContext } from '../../utils/runtimeDeviceContext';
import type { ProductAnalyticsBrowser, ProductAnalyticsGpuVendor } from './catalog';
import { productAnalytics } from './index';

type RenderHost = 'main' | 'worker';
const reportedHosts = new Set<RenderHost>();

const VENDOR_PATTERNS: ReadonlyArray<[ProductAnalyticsGpuVendor, RegExp]> = [
  // Software rasterizers first: their strings often name the host GPU vendor too.
  ['software', /swiftshader|llvmpipe|softpipe|lavapipe|microsoft basic render|software/i],
  ['nvidia', /nvidia|geforce|quadro|rtx|gtx/i],
  ['amd', /\bamd\b|radeon|\bati\b/i],
  ['intel', /intel/i],
  ['apple', /apple/i],
  ['qualcomm', /qualcomm|adreno/i],
  ['arm', /\barm\b|mali/i],
  ['imagination', /imagination|powervr|\bimg\b/i],
  ['samsung', /samsung|xclipse/i],
  ['microsoft', /microsoft/i],
];

export function classifyGpuVendor(...descriptions: Array<string | undefined>): ProductAnalyticsGpuVendor {
  const text = descriptions.filter(Boolean).join(' ').trim();
  if (!text) return 'unknown';
  return VENDOR_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] ?? 'other';
}

export function isInAppBrowser(userAgent: string): boolean {
  return /instagram|fban|fbav|fb_iab|\bline\/|tiktok|musical_ly|snapchat/i.test(userAgent);
}

export function resolveBrowser(userAgent: string, fallback: ProductAnalyticsBrowser): { browser: ProductAnalyticsBrowser; major?: number } {
  const match = (pattern: RegExp) => {
    const version = Number(pattern.exec(userAgent)?.[1]);
    return Number.isFinite(version) && version > 0 ? version : undefined;
  };
  if (/samsungbrowser\//i.test(userAgent)) return { browser: 'samsung', major: match(/samsungbrowser\/(\d+)/i) };
  if (/\bopr\/|opera/i.test(userAgent)) return { browser: 'opera', major: match(/\bopr\/(\d+)/i) };
  if (/edg(?:e|a|ios)?\//i.test(userAgent)) return { browser: 'edge', major: match(/edg(?:e|a|ios)?\/(\d+)/i) };
  if (/firefox|fxios/i.test(userAgent)) return { browser: 'firefox', major: match(/(?:firefox|fxios)\/(\d+)/i) };
  if (/chrome|crios/i.test(userAgent)) return { browser: 'chrome', major: match(/(?:chrome|crios)\/(\d+)/i) };
  if (fallback === 'safari') return { browser: 'safari', major: match(/version\/(\d+)/i) };
  return { browser: fallback };
}

/** OS major version where it is knowable: iOS from the user agent, the rest from
 * Chromium client hints (Windows reports 13+ for Windows 11). */
export function resolveOsMajor(platform: string, userAgent: string, platformVersion?: string): number | undefined {
  if (platform === 'ios') {
    const ios = Number(/\bOS (\d+)[_.]\d+/.exec(userAgent)?.[1]);
    return Number.isFinite(ios) && ios > 0 ? ios : undefined;
  }
  const major = Number(platformVersion?.split('.')[0]);
  if (!platformVersion || !Number.isFinite(major)) return undefined;
  if (platform === 'windows') return major >= 13 ? 11 : major > 0 ? 10 : undefined;
  return major > 0 ? major : undefined;
}

export function trackGpuInitOutcome(input: {
  host: RenderHost;
  ready: boolean;
  failure?: GPUInitializationFailure | 'worker_failed' | null;
  startedAt?: number;
}): void {
  if (reportedHosts.has(input.host) || typeof navigator === 'undefined') return;
  reportedHosts.add(input.host);
  const userAgent = navigator.userAgent ?? '';
  const runtime = getRuntimeDeviceContext();
  const { browser, major } = resolveBrowser(userAgent, runtime.browser);
  const probe = getGpuStartupProbe();
  const osMajor = resolveOsMajor(runtime.platform, userAgent, getHighEntropyUserAgent()?.platformVersion);
  let gpuVendor = classifyGpuVendor(probe?.adapter?.vendor, probe?.adapter?.architecture,
    probe?.adapter?.description, probe?.webgl?.description);
  // Firefox exposes no adapter info; its WebGL renderer name is the only hint.
  if (gpuVendor === 'unknown' && input.ready) gpuVendor = classifyGpuVendor(readWebGlDebugAdapterInfo()?.description);
  productAnalytics.track('gpu_init_outcome', {
    outcome: input.ready ? 'ready' : 'failed',
    ...(input.ready ? {} : { failure: input.failure ?? 'initialization_failed' }),
    host: input.host,
    webgpu_api: 'gpu' in navigator,
    gpu_vendor: gpuVendor,
    ...(probe?.adapter?.featureLevel === 'core' || probe?.adapter?.featureLevel === 'compatibility'
      ? { feature_level: probe.adapter.featureLevel } : {}),
    browser,
    ...(major ? { browser_major: major } : {}),
    in_app_browser: isInAppBrowser(userAgent),
    ...(osMajor ? { os_major: osMajor } : {}),
    platform: runtime.platform,
    device_class: runtime.deviceClass,
    ...(input.startedAt !== undefined ? { init_ms: Math.round(performance.now() - input.startedAt) } : {}),
  });
}

export function resetGpuInitOutcomeForTests(): void {
  reportedHosts.clear();
}
