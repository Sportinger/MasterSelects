// Collects playback cadence without synchronous GPU readback. Pixel-health
// aggregation supports supplied fingerprints; the live sampler leaves them unknown.
import { Logger } from '../logger';
import { APP_BUILD_ID } from '../appBuild';
import type { renderHostPort as RenderHostPort } from '../render/renderHostPort';
import type { RendererMode } from '../render/renderHostTypes';
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
  renderer?: RendererMode;
  idle?: boolean;
}

export interface PreviewHealthAccumulator {
  startedAt: number;
  windowStartedAt: number;
  firstFrameMs: number;
  samples: number;
  pixelSamples: number;
  fpsSum: number;
  fpsMin: number;
  targetFps: number;
  drops: number;
  lastDrops: number | null;
  lastSampleAt: number | null;
  dropResets: number;
  comparedSamples: number;
  slowSamples: number;
  idleSamples: number;
  renderer: RendererMode | 'unknown';
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
    startedAt: now, windowStartedAt: now, firstFrameMs: -1, samples: 0, pixelSamples: 0, fpsSum: 0,
    fpsMin: Number.POSITIVE_INFINITY, targetFps: 0, drops: 0, lastDrops: null, lastSampleAt: null,
    dropResets: 0, comparedSamples: 0, slowSamples: 0, idleSamples: 0, renderer: 'unknown',
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
  // Invalid samples must not turn into apparently healthy zero-FPS telemetry.
  if (!Number.isFinite(sample.fps) || sample.fps < 0) return 'none';
  acc.samples += 1;
  acc.fpsSum += sample.fps;
  acc.fpsMin = Math.min(acc.fpsMin, sample.fps);
  acc.targetFps = sample.targetFps;
  acc.layers = sample.layerCount;
  acc.decoder = sample.decoder;
  acc.renderer = sample.renderer ?? 'unknown';
  if (sample.idle === true) acc.idleSamples += 1;
  if (sample.layerCount > 0 && Number.isFinite(sample.targetFps) && sample.targetFps > 0) {
    acc.comparedSamples += 1;
    if (sample.fps < sample.targetFps * 0.8) acc.slowSamples += 1;
  }
  if (Number.isFinite(sample.drops) && sample.drops >= 0) {
    if (acc.lastDrops !== null && acc.lastSampleAt !== null && now - acc.lastSampleAt <= 3 * PREVIEW_HEALTH_TICK_MS) {
      // Preserve already measured drops when an engine counter resets. Do not
      // attribute hidden-tab gaps to the next visible sampling window.
      if (sample.drops < acc.lastDrops) acc.dropResets += 1;
      acc.drops += sample.drops >= acc.lastDrops ? sample.drops - acc.lastDrops : sample.drops;
    }
    acc.lastDrops = sample.drops;
  } else {
    acc.lastDrops = null;
  }
  acc.lastSampleAt = now;

  if (sample.nonBlankRatio === null) {
    acc.lastHash = null;
    return 'none';
  }
  acc.pixelSamples += 1;

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
    build_id: APP_BUILD_ID,
    telemetry_version: 2,
    renderer: acc.renderer,
    compared_samples: acc.comparedSamples,
    slow_samples: acc.slowSamples,
    idle_samples: acc.idleSamples,
    drop_resets: acc.dropResets,
    kind,
    window_s: Math.round((now - acc.windowStartedAt) / 1000),
    samples: acc.samples,
    fps_avg: acc.samples ? Math.round((acc.fpsSum / acc.samples) * 10) / 10 : 0,
    fps_min: Number.isFinite(acc.fpsMin) ? Math.round(acc.fpsMin * 10) / 10 : 0,
    fps_target: acc.targetFps,
    drops: acc.drops,
    ...(acc.pixelSamples > 0 ? {
      black_s: Math.round(seconds(acc.blackSamples)),
      black_longest_s: Math.round(seconds(acc.blackLongest)),
      frozen_s: Math.round(seconds(acc.frozenSamples)),
      first_frame_ms: acc.firstFrameMs,
    } : {}),
    layers: acc.layers,
    decoder: acc.decoder.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'none',
  };
}

// Same idea as the Stats panel's effective FPS: the slowest of render, preview update and decoder cadence.
export function deliveredFps(stats: ReturnType<typeof RenderHostPort.getStats>): number {
  const cadence = stats.playback?.recentCadence ?? stats.playback;
  const values = [stats.fps, cadence?.previewUpdates ? cadence.previewUpdateFps : undefined,
    cadence?.previewFrames ? cadence.previewRenderFps : undefined]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  return values.length ? Math.min(...values) : 0;
}

function collectSample(): PreviewHealthSample | null {
  if (!renderHostPort) return null;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return null;
  let stats;
  let renderer: RendererMode | undefined;
  try { stats = renderHostPort.getStats(); } catch { return null; }
  try { renderer = renderHostPort.getTelemetry().mode; } catch { /* Cadence remains useful without host metadata. */ }
  // Do not read GPU pixels synchronously during playback. Even a 16x9
  // drawImage/getImageData sample can wait for the entire GPU queue and stall
  // the UI. Pixel health stays unknown until an asynchronous sample is available.
  return {
    fps: deliveredFps(stats), targetFps: stats.targetFps ?? 0, drops: stats.drops?.count ?? 0,
    layerCount: stats.layerCount ?? 0, decoder: stats.decoder ?? 'none',
    renderer, idle: stats.isIdle,
    hash: null, nonBlankRatio: null,
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
  acc.drops = 0; acc.dropResets = 0; acc.blackSamples = 0; acc.blackLongest = acc.blackStreak;
  acc.comparedSamples = 0; acc.slowSamples = 0; acc.idleSamples = 0;
  acc.frozenSamples = 0;
  acc.pixelSamples = 0;
}

export function startPreviewHealthSession(): void {
  if (active) return;
  loadRenderHost();
  const acc = createPreviewHealthAccumulator(Date.now());
  const timer = setInterval(() => {
    const sample = collectSample();
    if (!sample) return;
    const now = Date.now();
    if (acc.samples > 0 && (acc.decoder !== sample.decoder || acc.renderer !== (sample.renderer ?? 'unknown'))) {
      emit(acc, 'window');
      resetWindow(acc, now);
    }
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
