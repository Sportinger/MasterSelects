import { Logger } from '../logger';
import type { ExportProgress } from '../../engine/export/types';

const log = Logger.create('ExportDiagnostics');

type ExportRunStatus = 'running' | 'success' | 'failed' | 'cancelled';

export type ExportTimingPhase =
  | 'encoderInit'
  | 'prepare'
  | 'preload3D'
  | 'preloadSplats'
  | 'seek'
  | 'wait'
  | 'buildLayers'
  | 'maskSync'
  | 'ensureLayers'
  | 'render'
  | 'capture'
  | 'encode'
  | 'audio'
  | 'mux'
  | 'cleanup';

export interface ExportFrameTiming {
  frame: number;
  time: number;
  totalMs: number;
  seekMs: number;
  waitMs: number;
  buildLayersMs: number;
  maskSyncMs: number;
  ensureLayersMs: number;
  renderMs: number;
  captureMs: number;
  encodeMs: number;
  layerCount: number;
  activeClipIds: string[];
  activeClipNames: string[];
  cutBoundary: boolean;
}

interface ExportRunState {
  runId: string;
  startedAt: string;
  startedAtMs: number;
  endedAt?: string;
  elapsedMs?: number;
  status: ExportRunStatus;
  settings: Record<string, unknown>;
  requestedAudio?: boolean;
  effectiveAudio?: boolean;
  audioClipCount?: number;
  renderableClipCount?: number;
  skippedAudioReason?: string;
  currentFrame?: number;
  totalFrames?: number;
  currentTime?: number;
  phase?: string;
  percent?: number;
  error?: string;
  phaseTotals: Partial<Record<ExportTimingPhase, number>>;
  phaseCounts: Partial<Record<ExportTimingPhase, number>>;
  frameTotals: number[];
  cutFrameTotals: number[];
  nonCutFrameTotals: number[];
  slowFrames: ExportFrameTiming[];
  cutFrames: ExportFrameTiming[];
  progressSamples: Array<Record<string, unknown>>;
}

const MAX_SLOW_FRAMES = 40;
const MAX_CUT_FRAMES = 80;
const MAX_PROGRESS_SAMPLES = 80;
const SLOW_FRAME_WARN_MS = 1500;
const SLOW_CUT_WARN_MS = 500;

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1)
  );
  return sorted[index];
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function compactFrame(frame: ExportFrameTiming): Record<string, unknown> {
  return {
    frame: frame.frame,
    time: round(frame.time),
    totalMs: round(frame.totalMs),
    seekMs: round(frame.seekMs),
    waitMs: round(frame.waitMs),
    buildLayersMs: round(frame.buildLayersMs),
    ensureLayersMs: round(frame.ensureLayersMs),
    captureMs: round(frame.captureMs),
    encodeMs: round(frame.encodeMs),
    layerCount: frame.layerCount,
    cutBoundary: frame.cutBoundary,
    activeClipIds: frame.activeClipIds,
    activeClipNames: frame.activeClipNames,
  };
}

function summarizeFrames(values: number[]): Record<string, number> {
  return {
    count: values.length,
    avgMs: round(average(values)),
    p95Ms: round(percentile(values, 95)),
    maxMs: round(values.length > 0 ? Math.max(...values) : 0),
  };
}

function summarizeRun(run: ExportRunState): Record<string, unknown> {
  const phaseAverages: Record<string, number> = {};
  const phaseTotals: Record<string, number> = {};

  for (const [phase, total] of Object.entries(run.phaseTotals)) {
    const count = run.phaseCounts[phase as ExportTimingPhase] ?? 0;
    phaseTotals[phase] = round(total ?? 0);
    phaseAverages[phase] = count > 0 ? round((total ?? 0) / count) : 0;
  }

  return {
    runId: run.runId,
    status: run.status,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    elapsedMs: run.elapsedMs ?? round(nowMs() - run.startedAtMs),
    settings: run.settings,
    requestedAudio: run.requestedAudio,
    effectiveAudio: run.effectiveAudio,
    audioClipCount: run.audioClipCount,
    renderableClipCount: run.renderableClipCount,
    skippedAudioReason: run.skippedAudioReason,
    progress: {
      phase: run.phase,
      percent: run.percent,
      currentFrame: run.currentFrame,
      totalFrames: run.totalFrames,
      currentTime: run.currentTime,
    },
    frames: {
      all: summarizeFrames(run.frameTotals),
      cuts: summarizeFrames(run.cutFrameTotals),
      nonCuts: summarizeFrames(run.nonCutFrameTotals),
      slowFrameCount: run.slowFrames.length,
      cutFrameCount: run.cutFrameTotals.length,
    },
    phaseTotals,
    phaseAverages,
    slowFrames: run.slowFrames.map(compactFrame),
    cutFrames: run.cutFrames.slice(-20).map(compactFrame),
    progressSamples: run.progressSamples,
    error: run.error,
  };
}

class ExportDiagnosticsService {
  private currentRun: ExportRunState | null = null;
  private lastRun: Record<string, unknown> | null = null;
  private nextRunId = 1;

  start(settings: Record<string, unknown>): string {
    const runId = `export-${this.nextRunId++}`;
    this.currentRun = {
      runId,
      startedAt: new Date().toISOString(),
      startedAtMs: nowMs(),
      status: 'running',
      settings,
      phaseTotals: {},
      phaseCounts: {},
      frameTotals: [],
      cutFrameTotals: [],
      nonCutFrameTotals: [],
      slowFrames: [],
      cutFrames: [],
      progressSamples: [],
    };
    log.info('Export diagnostics started', { runId, settings });
    return runId;
  }

  annotate(patch: Partial<Pick<
    ExportRunState,
    'requestedAudio' | 'effectiveAudio' | 'audioClipCount' | 'renderableClipCount' | 'skippedAudioReason'
  >>): void {
    if (!this.currentRun) {
      return;
    }
    Object.assign(this.currentRun, patch);
  }

  recordPhase(phase: ExportTimingPhase, durationMs: number): void {
    if (!this.currentRun || !Number.isFinite(durationMs)) {
      return;
    }

    this.currentRun.phaseTotals[phase] = (this.currentRun.phaseTotals[phase] ?? 0) + durationMs;
    this.currentRun.phaseCounts[phase] = (this.currentRun.phaseCounts[phase] ?? 0) + 1;
  }

  updateProgress(progress: ExportProgress): void {
    if (!this.currentRun) {
      return;
    }

    this.currentRun.phase = progress.phase;
    this.currentRun.percent = round(progress.percent);
    this.currentRun.currentFrame = progress.currentFrame;
    this.currentRun.totalFrames = progress.totalFrames;
    this.currentRun.currentTime = progress.currentTime;

    const previous = this.currentRun.progressSamples.at(-1);
    const previousPercent = typeof previous?.percent === 'number' ? previous.percent : -1;
    const previousPhase = typeof previous?.phase === 'string' ? previous.phase : '';
    const shouldSample =
      this.currentRun.progressSamples.length === 0 ||
      progress.phase !== previousPhase ||
      progress.percent >= 100 ||
      progress.percent - previousPercent >= 5;

    if (shouldSample) {
      this.currentRun.progressSamples.push({
        phase: progress.phase,
        percent: round(progress.percent),
        currentFrame: progress.currentFrame,
        totalFrames: progress.totalFrames,
        currentTime: round(progress.currentTime),
        audioPhase: progress.audioPhase,
        audioPercent: progress.audioPercent,
      });

      if (this.currentRun.progressSamples.length > MAX_PROGRESS_SAMPLES) {
        this.currentRun.progressSamples.shift();
      }
    }
  }

  recordFrame(timing: ExportFrameTiming): void {
    if (!this.currentRun) {
      return;
    }

    this.recordPhase('seek', timing.seekMs);
    this.recordPhase('wait', timing.waitMs);
    this.recordPhase('buildLayers', timing.buildLayersMs);
    this.recordPhase('maskSync', timing.maskSyncMs);
    this.recordPhase('ensureLayers', timing.ensureLayersMs);
    this.recordPhase('render', timing.renderMs);
    this.recordPhase('capture', timing.captureMs);
    this.recordPhase('encode', timing.encodeMs);

    this.currentRun.frameTotals.push(timing.totalMs);

    if (timing.cutBoundary) {
      this.currentRun.cutFrameTotals.push(timing.totalMs);
      this.currentRun.cutFrames.push(timing);
      if (this.currentRun.cutFrames.length > MAX_CUT_FRAMES) {
        this.currentRun.cutFrames.shift();
      }
    } else {
      this.currentRun.nonCutFrameTotals.push(timing.totalMs);
    }

    const shouldTrackSlow = timing.totalMs >= SLOW_CUT_WARN_MS || timing.cutBoundary;
    if (shouldTrackSlow) {
      this.currentRun.slowFrames.push(timing);
      this.currentRun.slowFrames.sort((a, b) => b.totalMs - a.totalMs);
      if (this.currentRun.slowFrames.length > MAX_SLOW_FRAMES) {
        this.currentRun.slowFrames.length = MAX_SLOW_FRAMES;
      }
    }

    if (timing.cutBoundary && timing.totalMs >= SLOW_CUT_WARN_MS) {
      log.warn('Slow export cut frame', compactFrame(timing));
    } else if (timing.totalMs >= SLOW_FRAME_WARN_MS) {
      log.warn('Slow export frame', compactFrame(timing));
    }
  }

  finish(status: Exclude<ExportRunStatus, 'running'>, error?: unknown): void {
    if (!this.currentRun) {
      return;
    }

    this.currentRun.status = status;
    this.currentRun.endedAt = new Date().toISOString();
    this.currentRun.elapsedMs = round(nowMs() - this.currentRun.startedAtMs);
    if (error) {
      this.currentRun.error = error instanceof Error ? error.message : String(error);
    }

    this.lastRun = summarizeRun(this.currentRun);
    log.info('Export diagnostics finished', {
      runId: this.currentRun.runId,
      status,
      elapsedMs: this.currentRun.elapsedMs,
      frames: (this.lastRun.frames as Record<string, unknown> | undefined)?.all,
      cuts: (this.lastRun.frames as Record<string, unknown> | undefined)?.cuts,
      error: this.currentRun.error,
    });
    this.currentRun = null;
  }

  snapshot(): Record<string, unknown> {
    return {
      current: this.currentRun ? summarizeRun(this.currentRun) : null,
      last: this.lastRun,
    };
  }
}

export const exportDiagnostics = new ExportDiagnosticsService();
