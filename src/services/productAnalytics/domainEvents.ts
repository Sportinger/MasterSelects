import type {
  ProductAnalyticsControlArea,
  ProductAnalyticsControlInteraction,
  ProductAnalyticsProperties,
} from './catalog';
import {
  classifyProductAnalyticsFailure,
  type ProductAnalyticsExportFailureStage,
} from './failureClassification';
import { productAnalytics } from './index';
import { classifyTimelineEdit } from './timelineEditClassification';

export type AnalyticsDurationBucket =
  | 'under_1s'
  | '1_5s'
  | '5_15s'
  | '15_60s'
  | '1_5m'
  | '5_15m'
  | '15m_plus';

export function bucketRuntime(durationMs: number): AnalyticsDurationBucket {
  if (durationMs < 1_000) return 'under_1s';
  if (durationMs < 5_000) return '1_5s';
  if (durationMs < 15_000) return '5_15s';
  if (durationMs < 60_000) return '15_60s';
  if (durationMs < 5 * 60_000) return '1_5m';
  if (durationMs < 15 * 60_000) return '5_15m';
  return '15m_plus';
}

export function bucketTimelineDuration(durationSeconds: number): string {
  if (durationSeconds < 10) return 'under_10s';
  if (durationSeconds < 60) return '10_60s';
  if (durationSeconds < 5 * 60) return '1_5m';
  if (durationSeconds < 30 * 60) return '5_30m';
  return '30m_plus';
}

export function bucketResolution(width: number, height: number): string {
  const pixels = Math.max(0, width) * Math.max(0, height);
  if (pixels <= 720 * 576) return 'sd';
  if (pixels <= 1280 * 720) return 'hd';
  if (pixels <= 1920 * 1080) return 'fhd';
  if (pixels <= 2560 * 1440) return 'qhd';
  if (pixels <= 3840 * 2160) return 'uhd';
  return 'over_uhd';
}

export function bucketFps(fps: number): string {
  if (fps < 24) return 'under_24';
  if (fps <= 30) return '24_30';
  if (fps <= 60) return '31_60';
  return 'over_60';
}

export function isEditorExperienceAnalyticsActive(
  pathname = typeof window === 'undefined' ? '' : window.location.pathname,
): boolean {
  return pathname === '/editor'
    || pathname.startsWith('/editor/')
    || pathname === '/chat'
    || pathname.startsWith('/chat/')
    || pathname === '/medium'
    || pathname.startsWith('/medium/');
}

export function trackLandingOptionSelected(
  mode: 'easy' | 'medium' | 'hard',
  experience: 'chat' | 'editor' | 'medium',
): void {
  productAnalytics.track('landing_option_selected', { experience, mode });
  void productAnalytics.flush({ keepalive: true });
}

export function trackTimelineEdit(label: string): void {
  if (!isEditorExperienceAnalyticsActive()) return;
  const classification = classifyTimelineEdit(label);
  if (!classification) return;
  productAnalytics.track('timeline_edit_committed', { ...classification });
}

export interface EditorControlAnalytics {
  area: ProductAnalyticsControlArea;
  controlId: string;
  controlKind: 'button' | 'checkbox' | 'drag' | 'number' | 'select' | 'slider' | 'toggle';
  inputMethod: 'click' | 'drag' | 'keyboard' | 'reset' | 'select' | 'type';
  interaction: ProductAnalyticsControlInteraction;
  itemId?: string;
  itemKind?: 'audio_effect' | 'effect' | 'property' | 'preset' | 'other';
}

export function trackEditorControlCommitted(details: EditorControlAnalytics): void {
  if (!isEditorExperienceAnalyticsActive()) return;
  productAnalytics.track('editor_control_committed', {
    area: details.area,
    control_id: details.controlId,
    control_kind: details.controlKind,
    input_method: details.inputMethod,
    interaction: details.interaction,
    ...(details.itemId ? { item_id: details.itemId } : {}),
    ...(details.itemKind ? { item_kind: details.itemKind } : {}),
  });
}

export function trackEditorSurfaceViewed(surface: string): void {
  if (!isEditorExperienceAnalyticsActive()) return;
  productAnalytics.track('editor_surface_viewed', { surface });
}

let playbackStartedAt: number | null = null;

export function trackPlaybackStarted(speed: number): void {
  if (!isEditorExperienceAnalyticsActive()) return;
  if (playbackStartedAt !== null) return;
  playbackStartedAt = Date.now();
  const speedBucket = speed < 0
    ? 'reverse'
    : speed < 0.95
      ? 'slow'
      : speed > 1.05
        ? 'fast'
        : 'normal';
  productAnalytics.track('playback_started', { speed_bucket: speedBucket });
}

export function trackPlaybackStopped(reason: 'ended' | 'pause' | 'stop'): void {
  if (playbackStartedAt === null) return;
  const startedAt = playbackStartedAt;
  playbackStartedAt = null;
  productAnalytics.track('playback_stopped', {
    reason,
    runtime_bucket: bucketRuntime(Date.now() - startedAt),
  });
}

let lastPanel = '';
let lastPanelAt = 0;

export function trackPanelOpened(panel: string): void {
  if (!isEditorExperienceAnalyticsActive()) return;
  const now = Date.now();
  if (panel === lastPanel && now - lastPanelAt < 2_000) return;
  lastPanel = panel;
  lastPanelAt = now;
  productAnalytics.track('panel_opened', { panel });
}

export interface AnalyticsExportRun {
  id: string;
  properties: ProductAnalyticsProperties;
  startedAt: number;
}

const finalizedExportRuns = new Set<string>();

export function beginExportAnalytics(properties: Omit<ProductAnalyticsProperties, 'run_id'>): AnalyticsExportRun {
  const id = `run-${typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;
  const run = {
    id,
    properties: { ...properties, run_id: id },
    startedAt: Date.now(),
  };
  productAnalytics.track('export_started', run.properties);
  return run;
}

export function completeExportAnalytics(run: AnalyticsExportRun): void {
  finalizeExportAnalytics(run, 'export_completed');
}

export function cancelExportAnalytics(run: AnalyticsExportRun): void {
  finalizeExportAnalytics(run, 'export_cancelled');
}

export function failExportAnalytics(
  run: AnalyticsExportRun,
  error: unknown,
  failureStage: ProductAnalyticsExportFailureStage = 'processing',
): void {
  finalizeExportAnalytics(run, 'export_failed', {
    error_category: classifyExportError(error),
    failure_code: classifyProductAnalyticsFailure(error),
    failure_stage: failureStage,
  });
}

function finalizeExportAnalytics(
  run: AnalyticsExportRun,
  eventName: 'export_cancelled' | 'export_completed' | 'export_failed',
  extra: ProductAnalyticsProperties = {},
): void {
  if (finalizedExportRuns.has(run.id)) return;
  finalizedExportRuns.add(run.id);
  if (finalizedExportRuns.size > 200) {
    const oldest = finalizedExportRuns.values().next().value as string | undefined;
    if (oldest) finalizedExportRuns.delete(oldest);
  }
  productAnalytics.track(eventName, {
    ...run.properties,
    ...extra,
    runtime_bucket: bucketRuntime(Date.now() - run.startedAt),
  });
}

function classifyExportError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (/cancel|abort/.test(message)) return 'cancelled';
  if (/memory|allocation|out of/.test(message)) return 'memory';
  if (/codec|encoder|decoder|format/.test(message)) return 'codec';
  if (/permission|denied|notallowed/.test(message)) return 'permission';
  if (/media|frame|clip|source|audio|video/.test(message)) return 'media';
  return 'unknown';
}
