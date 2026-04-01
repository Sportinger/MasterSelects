// AI Tool Handlers - Export

import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import { FrameExporter, downloadBlob, getRecommendedBitrate } from '../../../engine/export';
import type { VideoCodec, ContainerFormat, ExportMode, ExportProgress } from '../../../engine/export';
import type { ToolResult } from '../types';
import { Logger } from '../../logger';

const log = Logger.create('AIExport');

// Track active exporter for cancel
let activeExporter: FrameExporter | null = null;
let lastProgress: ExportProgress | null = null;

export async function handleStartExport(args: Record<string, unknown>): Promise<ToolResult> {
  const timelineStore = useTimelineStore.getState();
  const mediaStore = useMediaStore.getState();

  // Check if already exporting
  if (timelineStore.isExporting) {
    return { success: false, error: 'Export already in progress. Use cancelExport first.' };
  }

  // Get composition info
  const composition = mediaStore.getActiveComposition();
  const compWidth = composition?.width ?? 1920;
  const compHeight = composition?.height ?? 1080;
  const compFps = composition?.frameRate ?? 30;
  const compDuration = timelineStore.duration;

  // Parse args with defaults
  const width = (args.width as number) ?? compWidth;
  const height = (args.height as number) ?? compHeight;
  const fps = (args.fps as number) ?? compFps;
  const codec = (args.codec as VideoCodec) ?? 'h264';
  const container = (args.container as ContainerFormat) ?? 'mp4';
  const bitrate = (args.bitrate as number) ?? getRecommendedBitrate(width);
  const startTime = (args.startTime as number) ?? (timelineStore.inPoint ?? 0);
  const endTime = (args.endTime as number) ?? (timelineStore.outPoint ?? compDuration);
  const exportMode = (args.exportMode as ExportMode) ?? 'fast';
  const includeAudio = (args.includeAudio as boolean) ?? true;
  const filename = (args.filename as string) ?? 'export';
  const fileExtension = container === 'webm' ? 'webm' : 'mp4';

  log.info('AI-triggered export', { width, height, fps, codec, container, bitrate, startTime, endTime, exportMode });

  const exporter = new FrameExporter({
    width,
    height,
    fps,
    codec,
    container,
    bitrate,
    startTime,
    endTime,
    exportMode,
    includeAudio,
    audioSampleRate: 48000,
    audioBitrate: 192000,
    normalizeAudio: true,
  });

  activeExporter = exporter;
  lastProgress = null;

  // Start export tracking in timeline store
  timelineStore.startExport(startTime, endTime);

  try {
    const blob = await exporter.export((p: ExportProgress) => {
      lastProgress = p;
      timelineStore.setExportProgress(p.percent, p.currentTime);
    });

    if (blob) {
      downloadBlob(blob, `${filename}.${fileExtension}`);
      log.info('Export complete', { filename: `${filename}.${fileExtension}`, size: blob.size });
      return {
        success: true,
        data: {
          filename: `${filename}.${fileExtension}`,
          size: blob.size,
          sizeFormatted: formatBytes(blob.size),
          width,
          height,
          fps,
          codec,
          container,
          duration: endTime - startTime,
          message: 'Export complete. File download triggered in browser.',
        },
      };
    } else {
      return { success: false, error: 'Export produced no output (cancelled or failed)' };
    }
  } catch (e) {
    log.error('AI export failed', e);
    return { success: false, error: e instanceof Error ? e.message : 'Export failed' };
  } finally {
    activeExporter = null;
    lastProgress = null;
    timelineStore.endExport();
  }
}

export async function handleCancelExport(): Promise<ToolResult> {
  if (!activeExporter) {
    return { success: false, error: 'No export in progress' };
  }

  activeExporter.cancel();
  activeExporter = null;
  lastProgress = null;

  const timelineStore = useTimelineStore.getState();
  timelineStore.endExport();

  return { success: true, data: { message: 'Export cancelled' } };
}

export async function handleGetExportStatus(): Promise<ToolResult> {
  const timelineStore = useTimelineStore.getState();

  if (!timelineStore.isExporting) {
    return {
      success: true,
      data: {
        isExporting: false,
        message: 'No export in progress',
      },
    };
  }

  return {
    success: true,
    data: {
      isExporting: true,
      progress: lastProgress ? {
        phase: lastProgress.phase,
        percent: lastProgress.percent,
        currentFrame: lastProgress.currentFrame,
        totalFrames: lastProgress.totalFrames,
        currentTime: lastProgress.currentTime,
        estimatedTimeRemaining: lastProgress.estimatedTimeRemaining,
      } : null,
      exportRange: timelineStore.exportRange,
    },
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
