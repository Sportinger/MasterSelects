import { FrameExporter, downloadBlob } from '../../../engine/export';
import type { ExportMode, ExportProgress, VideoCodec, ContainerFormat } from '../../../engine/export';
import { engine } from '../../../engine/WebGPUEngine';
import { useExportStore } from '../../../stores/exportStore';
import { useTimelineStore } from '../../../stores/timeline';
import { exportDiagnostics } from '../../export/exportDiagnostics';
import { Logger } from '../../logger';
import type { ToolResult } from '../types';

const log = Logger.create('AIExport');

function finiteNumber(value: unknown, fallback: number, min?: number, max?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  let next = value;
  if (min !== undefined) next = Math.max(min, next);
  if (max !== undefined) next = Math.min(max, next);
  return next;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function pickValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;
}

function resolveCurrentExportRange(): { startTime: number; endTime: number } {
  const timeline = useTimelineStore.getState();
  const exportSettings = useExportStore.getState().settings;
  const duration = Number.isFinite(timeline.duration) ? Math.max(0, timeline.duration) : 0;

  if (!exportSettings.useInOut) {
    return { startTime: 0, endTime: duration };
  }

  const requestedStart = typeof timeline.inPoint === 'number' && Number.isFinite(timeline.inPoint)
    ? timeline.inPoint
    : 0;
  const requestedEnd = typeof timeline.outPoint === 'number' && Number.isFinite(timeline.outPoint)
    ? timeline.outPoint
    : duration;

  const startTime = Math.max(0, Math.min(requestedStart, duration));
  const endTime = Math.max(startTime, Math.min(requestedEnd, duration));
  return { startTime, endTime };
}

function compactProgress(progress: ExportProgress): Record<string, unknown> {
  return {
    phase: progress.phase,
    percent: Math.round(progress.percent * 10) / 10,
    currentFrame: progress.currentFrame,
    totalFrames: progress.totalFrames,
    currentTime: Math.round(progress.currentTime * 1000) / 1000,
    audioPhase: progress.audioPhase,
    audioPercent: progress.audioPercent,
  };
}

function recentExportErrors(startedAtIso: string): unknown[] {
  return Logger.getBuffer('WARN')
    .filter(entry => entry.timestamp >= startedAtIso)
    .filter(entry =>
      entry.level === 'ERROR' ||
      entry.module === 'FrameExporter' ||
      entry.module === 'ExportDiagnostics' ||
      entry.module === 'WebGPUEngine' ||
      entry.module === 'WebGPUContext' ||
      entry.module === 'ParallelDecode'
    )
    .slice(-20);
}

export async function handleDebugExport(args: Record<string, unknown>): Promise<ToolResult> {
  const timeline = useTimelineStore.getState();
  const exportSettings = useExportStore.getState().settings;
  const range = resolveCurrentExportRange();
  const settingsMode: ExportMode = exportSettings.encoder === 'webcodecs' ? 'fast' : 'precise';

  const startTime = finiteNumber(args.startTime, range.startTime, 0);
  let endTime = finiteNumber(args.endTime, range.endTime, startTime);
  const durationSeconds = finiteNumber(args.durationSeconds, 0, 0);
  if (durationSeconds > 0) {
    endTime = Math.min(endTime, startTime + durationSeconds);
  }

  if (endTime <= startTime) {
    return { success: false, error: `Invalid export range ${startTime}s-${endTime}s` };
  }

  const width = Math.round(finiteNumber(
    args.width,
    exportSettings.useCustomResolution ? exportSettings.customWidth : exportSettings.width,
    1,
    7680
  ));
  const height = Math.round(finiteNumber(
    args.height,
    exportSettings.useCustomResolution ? exportSettings.customHeight : exportSettings.height,
    1,
    4320
  ));
  const fps = finiteNumber(
    args.fps,
    exportSettings.useCustomFps ? exportSettings.customFps : exportSettings.fps,
    1,
    240
  );
  const exportMode = pickValue(args.exportMode, ['fast', 'precise'] as const, settingsMode);
  const includeAudio = boolValue(args.includeAudio, exportSettings.includeAudio);
  const download = boolValue(args.download, false);
  const container = pickValue(args.container, ['mp4', 'webm'] as const, exportSettings.containerFormat) as ContainerFormat;
  const codec = pickValue(args.codec, ['h264', 'h265', 'vp9', 'av1'] as const, exportSettings.videoCodec) as VideoCodec;
  const maxRuntimeMs = Math.round(finiteNumber(args.maxRuntimeMs, 25_000, 1_000, 600_000));
  const fileExtension = container === 'webm' ? 'webm' : 'mp4';
  const startedAt = performance.now();
  const startedAtIso = new Date().toISOString();
  const progressSamples: Array<Record<string, unknown>> = [];
  let timedOut = false;

  const exporter = new FrameExporter({
    width,
    height,
    fps,
    codec,
    container,
    bitrate: Math.round(finiteNumber(args.bitrate, exportSettings.bitrate, 1_000_000, 100_000_000)),
    rateControl: exportSettings.rateControl,
    startTime,
    endTime,
    stackedAlpha: exportSettings.stackedAlpha,
    includeAudio,
    audioSampleRate: exportSettings.audioSampleRate,
    audioBitrate: exportSettings.audioBitrate,
    normalizeAudio: exportSettings.normalizeAudio,
    exportMode,
  });

  log.info('Starting debug export', { startTime, endTime, width, height, fps, includeAudio, exportMode, maxRuntimeMs });
  const engineBefore = engine.getDebugInfrastructureState();
  timeline.startExport(startTime, endTime);
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    log.warn('Debug export runtime limit reached, cancelling export', { maxRuntimeMs });
    exporter.cancel();
  }, maxRuntimeMs);

  try {
    const blob = await exporter.export((progress) => {
      timeline.setExportProgress(progress.percent, progress.currentTime);
      const previousPercent = Number(progressSamples.at(-1)?.percent ?? 0);
      const shouldSample =
        progressSamples.length < 8 ||
        progress.percent >= 100 ||
        progress.percent - previousPercent >= 10;
      if (shouldSample) {
        progressSamples.push(compactProgress(progress));
      }
    });

    const elapsedMs = Math.round(performance.now() - startedAt);
    const engineAfter = engine.getDebugInfrastructureState();
    const errors = recentExportErrors(startedAtIso);

    if (!blob) {
      return {
        success: false,
        error: 'Export returned no blob',
        data: {
        elapsedMs,
          timedOut,
          settings: { startTime, endTime, width, height, fps, includeAudio, exportMode, codec, container, maxRuntimeMs },
          progressSamples,
          exportStats: exportDiagnostics.snapshot(),
          engineBefore,
          engineAfter,
          errors,
        },
      };
    }

    if (download) {
      downloadBlob(blob, `${exportSettings.filename || 'debug-export'}.${fileExtension}`);
    }

    return {
      success: true,
      data: {
        elapsedMs,
        timedOut,
        blob: { size: blob.size, type: blob.type },
        settings: { startTime, endTime, width, height, fps, includeAudio, exportMode, codec, container, maxRuntimeMs },
        progressSamples,
        exportStats: exportDiagnostics.snapshot(),
        engineBefore,
        engineAfter,
        errors,
        downloaded: download,
      },
    };
  } catch (error) {
    const elapsedMs = Math.round(performance.now() - startedAt);
    const message = error instanceof Error ? error.message : 'Export failed';
    log.error('Debug export failed', error);
    return {
      success: false,
      error: message,
      data: {
        elapsedMs,
        timedOut,
        settings: { startTime, endTime, width, height, fps, includeAudio, exportMode, codec, container, maxRuntimeMs },
        progressSamples,
        exportStats: exportDiagnostics.snapshot(),
        engineBefore,
        engineAfter: engine.getDebugInfrastructureState(),
        errors: recentExportErrors(startedAtIso),
      },
    };
  } finally {
    window.clearTimeout(timeoutId);
    timeline.endExport();
  }
}
