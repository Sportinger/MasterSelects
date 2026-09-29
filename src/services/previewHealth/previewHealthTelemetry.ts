// Samples the real preview canvas during playback: delivered FPS, black/unchanged
// frames and time to first visible frame. Only aggregate numbers leave the browser.
import { Logger } from '../logger';
import { fingerprintCanvas, type FrameFingerprint } from '../aiTools/frameFingerprint';
import type { renderHostPort as RenderHostPort } from '../render/renderHostPort';
import { productAnalytics } from '../productAnalytics';
import type { ProductAnalyticsProperties } from '../productAnalytics/catalog';

const log = Logger.create('PreviewHealth');

export const PREVIEW_HEALTH_TICK_MS = 500;
export const PREVIEW_HEALTH_WINDOW_MS = 30_000;
export const PREVIEW_HEALTH_BLACK_ALERT_TICKS = 4;
const BLACK_NON_BLANK_RATIO = 0.02;

// Analytics is also imported by account initialization. Loading the render host
// eagerly here would re-enter those stores before they have initialized.
let renderHostPort: typeof RenderHostPort | null = null;
let renderHostLoad: Promise<void> | null = null;

function loadRenderHost(): void {
  if (renderHostPort || renderHostLoad) return;
  renderHostLoad = import('../render/renderHostPort')
    .then((module) => { renderHostPort = module.renderHostPort; })
    .catch((error: unknown) => { log.warn('Preview sampling unavailable', error); })
    .finally(() => { renderHostLoad = null; });
}

export interface PreviewHealthSample {
  fps: number;
  targetFps: number;
  drops: number;
  layerCount: number;
  decoder: string;
  hash: string | null;
  nonBlankRatio: number | null;
}

export interface PreviewHealthAccumulator {
  startedAt: number;
  windowStartedAt: number;
  firstFrameMs: number;
  samples: number;
  fpsSum: number;
  fpsMin: number;
  targetFps: number;
  drops: number;
  dropsAtWindowStart: number | null;
  blackSamples: number;
  blackStreak: number;
  blackLongest: number;
  blackAlerted: boolean;
  frozenSamples: number;
  lastHash: string | null;
  layers: number;
  decoder: string;
}

export function createPreviewHealthAccumulator(now: number): PreviewHealthAccumulator {
  return {
    startedAt: now, windowStartedAt: now, firstFrameMs: -1, samples: 0, fpsSum: 0,
    fpsMin: Number.POSITIVE_INFINITY, targetFps: 0, drops: 0, dropsAtWindowStart: null,
    blackSamples: 0, blackStreak: 0, blackLongest: 0, blackAlerted: false,
    frozenSamples: 0, lastHash: null, layers: 0, decoder: 'none',
  };
}

export function isBlackPreviewSample(sample: PreviewHealthSample): boolean {
  // A gap on the timeline is legitimately black; only count it when layers should be visible.
  return sample.layerCount > 0 && sample.nonBlankRatio !== null && sample.nonBlankRatio < BLACK_NON_BLANK_RATIO;
}

export type PreviewHealthSignal = 'none' | 'black_alert' | 'black_recovered';

export function recordPreviewHealthSample(
  acc: PreviewHealthAccumulator,
  sample: PreviewHealthSample,
  now: number,
): PreviewHealthSignal {
  acc.samples += 1;
  acc.fpsSum += sample.fps;
  acc.fpsMin = Math.min(acc.fpsMin, sample.fps);
  acc.targetFps = sample.targetFps;
  acc.layers = sample.layerCount;
  acc.decoder = sample.decoder;
  if (acc.dropsAtWindowStart === null) acc.dropsAtWindowStart = sample.drops;
  acc.drops = Math.max(0, sample.drops - acc.dropsAtWindowStart);

  const black = isBlackPreviewSample(sample);
  let signal: PreviewHealthSignal = 'none';
  if (black) {
    acc.blackSamples += 1;
    acc.blackStreak += 1;
    acc.blackLongest = Math.max(acc.blackLongest, acc.blackStreak);
    if (!acc.blackAlerted && acc.blackStreak >= PREVIEW_HEALTH_BLACK_ALERT_TICKS) {
      acc.blackAlerted = true;
      signal = 'black_alert';
    }
  } else {
    if (acc.firstFrameMs < 0 && sample.layerCount > 0 && sample.nonBlankRatio !== null) {
      acc.firstFrameMs = now - acc.startedAt;
    }
    if (acc.blackAlerted) signal = 'black_recovered';
    acc.blackStreak = 0;
    acc.blackAlerted = false;
    if (sample.hash && sample.layerCount > 0 && sample.hash === acc.lastHash) acc.frozenSamples += 1;
  }
  acc.lastHash = sample.hash;
  return signal;
}

export function buildPreviewHealthProperties(
  acc: PreviewHealthAccumulator,
  kind: 'window' | 'black_alert' | 'black_recovered',
  now: number,
): ProductAnalyticsProperties {
  const seconds = (ticks: number) => Math.round((ticks * PREVIEW_HEALTH_TICK_MS) / 100) / 10;
  return {
    kind,
    window_s: Math.round((now - acc.windowStartedAt) / 1000),
    samples: acc.samples,
    fps_avg: acc.samples ? Math.round((acc.fpsSum / acc.samples) * 10) / 10 : 0,
    fps_min: Number.isFinite(acc.fpsMin) ? Math.round(acc.fpsMin * 10) / 10 : 0,
    fps_target: acc.targetFps,
    drops: acc.drops,
    black_s: Math.round(seconds(acc.blackSamples)),
    black_longest_s: Math.round(seconds(acc.blackLongest)),
    frozen_s: Math.round(seconds(acc.frozenSamples)),
    first_frame_ms: acc.firstFrameMs,
    layers: acc.layers,
    decoder: acc.decoder.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'none',
  };
}

// Same idea as the Stats panel's effective FPS: the slowest of render, preview update and decoder cadence.
function deliveredFps(stats: ReturnType<typeof RenderHostPort.getStats>): number {
  const cadence = stats.playback?.recentCadence ?? stats.playback;
  const values = [stats.fps, cadence?.previewUpdates ? cadence.previewUpdateFps : undefined,
    cadence?.previewFrames ? cadence.previewRenderFps : undefined]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  return values.length ? Math.min(...values) : 0;
}

function collectSample(): PreviewHealthSample | null {
  if (!renderHostPort) return null;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return null;
  let stats;
  try { stats = renderHostPort.getStats(); } catch { return null; }
  let fingerprint: FrameFingerprint | null = null;
  const canvas = renderHostPort.getCaptureCanvas()?.canvas ?? null;
  if (canvas && canvas.width > 0 && canvas.height > 0) {
    try { fingerprint = fingerprintCanvas(canvas, { sampleWidth: 16, sampleHeight: 9 }); } catch { /* unreadable canvas */ }
  }
  return {
    fps: deliveredFps(stats), targetFps: stats.targetFps ?? 0, drops: stats.drops?.count ?? 0,
    layerCount: stats.layerCount ?? 0, decoder: stats.decoder ?? 'none',
    hash: fingerprint?.hash ?? null, nonBlankRatio: fingerprint?.nonBlankRatio ?? null,
  };
}

let active: { acc: PreviewHealthAccumulator; timer: ReturnType<typeof setInterval> } | null = null;

function emit(acc: PreviewHealthAccumulator, kind: 'window' | 'black_alert' | 'black_recovered') {
  const properties = buildPreviewHealthProperties(acc, kind, Date.now());
  productAnalytics.track('preview_health', properties);
  if (kind !== 'window') log.warn(`preview ${kind}`, properties);
}

function resetWindow(acc: PreviewHealthAccumulator, now: number): void {
  acc.windowStartedAt = now; acc.samples = 0; acc.fpsSum = 0; acc.fpsMin = Number.POSITIVE_INFINITY;
  acc.dropsAtWindowStart = null; acc.drops = 0; acc.blackSamples = 0; acc.blackLongest = acc.blackStreak;
  acc.frozenSamples = 0;
}

export function startPreviewHealthSession(): void {
  if (active) return;
  loadRenderHost();
  const acc = createPreviewHealthAccumulator(Date.now());
  const timer = setInterval(() => {
    const sample = collectSample();
    if (!sample) return;
    const now = Date.now();
    const signal = recordPreviewHealthSample(acc, sample, now);
    if (signal !== 'none') emit(acc, signal);
    if (now - acc.windowStartedAt >= PREVIEW_HEALTH_WINDOW_MS) { emit(acc, 'window'); resetWindow(acc, now); }
  }, PREVIEW_HEALTH_TICK_MS);
  active = { acc, timer };
}

export function stopPreviewHealthSession(): void {
  if (!active) return;
  const { acc, timer } = active;
  clearInterval(timer);
  active = null;
  if (acc.samples >= 2) emit(acc, 'window');
}
