// Where the time of a project open, create, duplicate, scratch open or explicit save goes.
//
// The repository lifecycle reports its phase timings (repositoryLoadTimings); this module adds what
// the main thread did meanwhile (long tasks, the longest gap between animation frames, a hidden page)
// and sends one `project_load_phases` product analytics event with rounded milliseconds. Nothing
// identifies the project: no name, path or ID. The last reports also stay on
// window.__MS_PROJECT_LOAD__ and in the log, so a remote-debugged device shows them directly; that
// list holds only a sanitized copy (kind, outcome, storage kind, timings, counts), never a location,
// folder handle or path.
//
// The lifecycle ends its measurement once the editor stores are activated, before React has rendered
// the editor. After a ready open the observation therefore runs on until the second animation frame
// (the first frame callback runs before the paint, the second after it) and reports that time as
// firstFrameMs. Long tasks and frame gaps of that render count too, so a screen that stays frozen
// after "Restoring editor" shows up instead of being ruled out by short phases.
//
// A long phase points at storage or the editor; short phases with a long frame gap point at a screen
// that did not repaint while the work itself was quick.

import { Logger } from '../../logger';
import { productAnalytics } from '../../productAnalytics';
import { getRuntimeDeviceContext } from '../../../utils/runtimeDeviceContext';
import {
  REPOSITORY_LOAD_PHASES,
  type RepositoryLoadKind,
  type RepositoryLoadReport,
} from '../repository/lifecycle/repositoryLoadTimings';

const log = Logger.create('ProjectLoadTiming');

/** An operation slower than this also files a warning, which reaches the diagnostics buffer. */
export const SLOW_PROJECT_LOAD_MS = 5_000;
const MAX_REPORTED_MS = 600_000;
const KEPT_REPORTS = 12;
/** Longest wait for the first frame after a ready open; a hidden page renders no frames at all. */
export const FIRST_FRAME_TIMEOUT_MS = 60_000;

export interface MainThreadStats {
  longTaskMs: number;
  longTaskMaxMs: number;
  longTaskCount: number;
  /** Longest time between two animation frames; -1 when frames were not observed. */
  frameGapMaxMs: number;
  pageHidden: boolean;
}

export interface ProjectLoadTiming extends RepositoryLoadReport {
  mainThread: MainThreadStats;
  /** Time from the end of the lifecycle work to the first painted frame after it (ready opens only). */
  firstFrameMs?: number;
}

type TimingWindow = typeof globalThis & { __MS_PROJECT_LOAD__?: ProjectLoadTiming[] };

/** 10 ms steps below 1 s, 100 ms steps below 10 s, whole seconds above; capped at 10 minutes. */
export function roundLoadMs(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  const step = ms < 1_000 ? 10 : ms < 10_000 ? 100 : 1_000;
  return Math.min(MAX_REPORTED_MS, Math.round(ms / step) * step);
}

/** Observes long tasks, frame gaps and page visibility until stopped. Every API is optional. */
export function observeMainThread(): () => MainThreadStats {
  const stats: MainThreadStats = { longTaskMs: 0, longTaskMaxMs: 0, longTaskCount: 0, frameGapMaxMs: -1, pageHidden: false };
  if (typeof window === 'undefined') return () => stats;
  let observer: PerformanceObserver | null = null;
  try {
    if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          stats.longTaskMs += entry.duration; stats.longTaskCount++;
          stats.longTaskMaxMs = Math.max(stats.longTaskMaxMs, entry.duration);
        }
      });
      observer.observe({ type: 'longtask', buffered: false });
    }
  } catch { observer = null; }
  let frame: number | null = null; let lastFrame = -1;
  const tick = (time: number) => {
    if (lastFrame >= 0) stats.frameGapMaxMs = Math.max(stats.frameGapMaxMs, time - lastFrame);
    lastFrame = time; frame = requestAnimationFrame(tick);
  };
  if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(tick);
  const visibility = () => { if (document.hidden) stats.pageHidden = true; };
  if (typeof document !== 'undefined') { stats.pageHidden = document.hidden; document.addEventListener('visibilitychange', visibility); }
  let stopped = false;
  return () => {
    if (stopped) return stats;
    stopped = true;
    try { observer?.takeRecords().forEach(entry => { stats.longTaskMs += entry.duration; stats.longTaskCount++; stats.longTaskMaxMs = Math.max(stats.longTaskMaxMs, entry.duration); }); } catch { /* optional */ }
    observer?.disconnect();
    if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visibility);
    // Frames stop while the page is hidden; that gap says nothing about the work.
    if (stats.pageHidden) stats.frameGapMaxMs = -1;
    return stats;
  };
}

/**
 * Copies only the reported fields, so nothing else a caller attached (a location, folder handle or
 * path) reaches the global list, the log or analytics.
 */
export function sanitizeProjectLoadTiming(timing: ProjectLoadTiming): ProjectLoadTiming {
  const phases: ProjectLoadTiming['phases'] = {};
  for (const phase of REPOSITORY_LOAD_PHASES) {
    const value = timing.phases?.[phase];
    if (typeof value === 'number' && Number.isFinite(value)) phases[phase] = value;
  }
  const thread = timing.mainThread;
  const storage = (['opfs', 'indexeddb', 'fsa', 'native'] as const).find(kind => kind === timing.storage) ?? 'unknown';
  return {
    kind: timing.kind, outcome: timing.outcome, totalMs: timing.totalMs, phases, storage,
    mainThread: { longTaskMs: thread.longTaskMs, longTaskMaxMs: thread.longTaskMaxMs, longTaskCount: thread.longTaskCount,
      frameGapMaxMs: thread.frameGapMaxMs, pageHidden: thread.pageHidden },
    ...(typeof timing.writable === 'boolean' ? { writable: timing.writable } : {}),
    ...(typeof timing.recoveredRecords === 'number' ? { recoveredRecords: timing.recoveredRecords } : {}),
    ...(typeof timing.workerStartMs === 'number' && Number.isFinite(timing.workerStartMs) ? { workerStartMs: timing.workerStartMs } : {}),
    ...(typeof timing.firstFrameMs === 'number' ? { firstFrameMs: timing.firstFrameMs } : {}),
  };
}

/** Analytics properties of one timing: rounded milliseconds and technical context only. */
export function projectLoadAnalyticsProperties(timing: ProjectLoadTiming): Record<string, string | number | boolean> {
  const runtime = getRuntimeDeviceContext();
  const properties: Record<string, string | number | boolean> = {
    kind: timing.kind,
    outcome: timing.outcome,
    storage: timing.storage,
    platform: runtime.platform,
    device_class: runtime.deviceClass,
    total_ms: roundLoadMs(timing.totalMs),
    long_task_ms: roundLoadMs(timing.mainThread.longTaskMs),
    long_task_max_ms: roundLoadMs(timing.mainThread.longTaskMaxMs),
    long_task_count: timing.mainThread.longTaskCount,
    page_hidden: timing.mainThread.pageHidden,
  };
  if (timing.mainThread.frameGapMaxMs >= 0) properties.frame_gap_max_ms = roundLoadMs(timing.mainThread.frameGapMaxMs);
  if (timing.firstFrameMs !== undefined) properties.first_frame_ms = roundLoadMs(timing.firstFrameMs);
  if (timing.writable !== undefined) properties.writable = timing.writable;
  if (timing.recoveredRecords !== undefined) properties.recovered_records = timing.recoveredRecords;
  for (const phase of REPOSITORY_LOAD_PHASES) {
    const value = timing.phases[phase];
    if (value !== undefined) properties[`${phase}_ms`] = roundLoadMs(value);
  }
  return properties;
}

/** 'total 31200 ms · queue 20 · storage_open 410 · session_read 29800 …', for logs and diagnostics. */
export function formatProjectLoadTiming(timing: ProjectLoadTiming): string {
  const phases = REPOSITORY_LOAD_PHASES.filter(phase => timing.phases[phase] !== undefined)
    .map(phase => `${phase} ${Math.round(timing.phases[phase]!)}`);
  const thread = timing.mainThread;
  return [`${timing.kind} ${timing.outcome} total ${Math.round(timing.totalMs)} ms`, ...phases,
    ...(timing.workerStartMs !== undefined ? [`storage worker start ${Math.round(timing.workerStartMs)}`] : []),
    `long tasks ${Math.round(thread.longTaskMs)} (max ${Math.round(thread.longTaskMaxMs)})`,
    thread.frameGapMaxMs >= 0 ? `frame gap ${Math.round(thread.frameGapMaxMs)}` : 'frames not observed',
    ...(timing.firstFrameMs !== undefined ? [`first frame ${Math.round(timing.firstFrameMs)}`] : []),
    `storage ${timing.storage}`].join(' · ');
}

export function readProjectLoadTimings(): ProjectLoadTiming[] {
  return [...((globalThis as TimingWindow).__MS_PROJECT_LOAD__ ?? [])];
}

function keep(timing: ProjectLoadTiming): void {
  const holder = globalThis as TimingWindow;
  const list = holder.__MS_PROJECT_LOAD__ ??= [];
  list.push(timing);
  if (list.length > KEPT_REPORTS) list.splice(0, list.length - KEPT_REPORTS);
}

/**
 * Resolves with the time until the second animation frame (the first paint after now), or undefined
 * when frames are unavailable, the page is hidden or no frame came within FIRST_FRAME_TIMEOUT_MS.
 */
export function waitForFirstFrame(now: () => number = () => performance.now()): Promise<number | undefined> {
  if (typeof requestAnimationFrame !== 'function' || typeof document !== 'undefined' && document.hidden) return Promise.resolve(undefined);
  const started = now();
  return new Promise(resolve => {
    let frame: number | null = null;
    const timeout = setTimeout(() => {
      if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      resolve(undefined);
    }, FIRST_FRAME_TIMEOUT_MS);
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => { clearTimeout(timeout); resolve(Math.max(0, now() - started)); });
    });
  });
}

function publish(timing: ProjectLoadTiming): void {
  keep(timing);
  const summary = formatProjectLoadTiming(timing);
  if (timing.totalMs >= SLOW_PROJECT_LOAD_MS || (timing.firstFrameMs ?? 0) >= SLOW_PROJECT_LOAD_MS) log.warn(`Slow project ${timing.kind}`, { timing: summary });
  else log.info(`Project ${timing.kind} timing`, { timing: summary });
  productAnalytics.track('project_load_phases', projectLoadAnalyticsProperties(timing));
}

/**
 * The lifecycle's measure hook: starts observing now, reports when the operation ends. A ready open,
 * create, duplicate or scratch open reports one frame later (see the header); saves report at once.
 */
export function startProjectLoadMeasurement(kind: RepositoryLoadKind): (report: RepositoryLoadReport | null) => void {
  const stop = observeMainThread();
  return report => {
    if (!report || report.kind !== kind) { stop(); return; }
    const finish = (firstFrameMs?: number) => {
      publish(sanitizeProjectLoadTiming({ ...report, mainThread: stop(), ...(firstFrameMs !== undefined ? { firstFrameMs } : {}) }));
    };
    if (report.outcome !== 'ready' || kind === 'save') { finish(); return; }
    void waitForFirstFrame().then(finish, () => finish()).catch(error => log.warn('Project load timing could not be reported', error));
  };
}
