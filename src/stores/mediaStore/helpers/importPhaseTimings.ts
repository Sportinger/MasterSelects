// Always-on phase timings of a media import. Each import keeps one report with the milliseconds of
// its phases (metadata probe, thumbnail, hash, copy into the project, ...) on
// window.__MS_MEDIA_IMPORT__ (last 12), logs it at info level and warns once when it was slow, so a
// real-device run (remote DevTools, the device harness, bridge getLogs) shows where an import's time
// went. Machine fields only: the media kind, the byte size and phase names, never a file name or path.

import { Logger } from '../../../services/logger';

const log = Logger.create('MediaImportTimings');

/** Reports kept on the window. */
export const MEDIA_IMPORT_REPORT_LIMIT = 12;
/** An import slower than this files one warning with its phases. */
export const SLOW_MEDIA_IMPORT_MS = 8_000;

export interface MediaImportPhase {
  phase: string;
  ms: number;
}

export interface MediaImportReport {
  /** Who started it: 'pipeline' (one file through processImport) or a caller like 'phone-add'. */
  kind: string;
  mediaType: string;
  bytes: number;
  /** performance.now() at the start. */
  startedAt: number;
  phases: MediaImportPhase[];
  totalMs: number;
  outcome: 'ok' | 'failed' | 'running';
}

type ImportWindow = typeof globalThis & { __MS_MEDIA_IMPORT__?: MediaImportReport[] };

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function reports(): MediaImportReport[] {
  const holder = globalThis as ImportWindow;
  holder.__MS_MEDIA_IMPORT__ ??= [];
  return holder.__MS_MEDIA_IMPORT__;
}

/** 'probe 820 · hash 12 · copy 2100 (total 3050 ms)'. */
export function formatMediaImportReport(report: Pick<MediaImportReport, 'phases' | 'totalMs'>): string {
  return `${report.phases.map((entry) => `${entry.phase} ${Math.round(entry.ms)}`).join(' · ')} (total ${Math.round(report.totalMs)} ms)`;
}

export interface MediaImportTimer {
  /** Closes the running phase (time since the previous mark) under `phase`. */
  mark(phase: string): void;
  /** Adds an already measured phase (e.g. a sub-phase reported by the project copy). */
  add(phase: string, ms: number): void;
  /** Adds the time `work` takes as `phase`; returns its result (also when it throws, the time is kept). */
  time<T>(phase: string, work: Promise<T> | (() => Promise<T>)): Promise<T>;
  finish(outcome: 'ok' | 'failed'): MediaImportReport;
  readonly report: MediaImportReport;
}

/**
 * Starts a report. Phases added with `time` may overlap (parallel work); `mark` measures from the
 * previous mark. Both are rounded to whole milliseconds.
 */
export function beginMediaImportTiming(kind: string, mediaType: string, bytes: number, clock: () => number = now): MediaImportTimer {
  const startedAt = clock();
  let last = startedAt;
  let finished = false;
  const report: MediaImportReport = { kind, mediaType, bytes, startedAt: Math.round(startedAt), phases: [], totalMs: 0, outcome: 'running' };
  const list = reports();
  list.push(report);
  if (list.length > MEDIA_IMPORT_REPORT_LIMIT) list.splice(0, list.length - MEDIA_IMPORT_REPORT_LIMIT);
  const add = (phase: string, ms: number) => {
    if (!finished) report.phases.push({ phase, ms: Math.round(ms) });
  };
  return {
    report,
    add,
    mark(phase) {
      const at = clock();
      add(phase, at - last);
      last = at;
    },
    async time(phase, work) {
      const at = clock();
      try {
        return await (typeof work === 'function' ? work() : work);
      } finally {
        add(phase, clock() - at);
      }
    },
    finish(outcome) {
      if (finished) return report;
      finished = true;
      report.totalMs = Math.round(clock() - startedAt);
      report.outcome = outcome;
      const line = `${kind} ${mediaType} ${(bytes / 1e6).toFixed(1)} MB: ${formatMediaImportReport(report)}`;
      if (report.totalMs > SLOW_MEDIA_IMPORT_MS) log.warn(`Slow media import: ${line}`);
      else log.info(`Media import ${outcome}: ${line}`);
      return report;
    },
  };
}
