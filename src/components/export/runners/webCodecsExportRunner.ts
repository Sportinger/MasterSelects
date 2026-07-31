import { FrameExporter } from '../../../engine/export';
import type { ContainerFormat, ExportProgress, VideoCodec } from '../../../engine/export';
import type { ExportRenderFrameDecorator } from '../../../engine/export/ExportRenderSessionImpl';

export interface WebCodecsExportRunnerInput {
  width: number;
  height: number;
  fps: number;
  videoCodec: VideoCodec;
  containerFormat: ContainerFormat;
  bitrate: number;
  rateControl: 'vbr' | 'cbr';
  startTime: number;
  endTime: number;
  stackedAlpha: boolean;
  includeAudio: boolean;
  audioSampleRate: 44100 | 48000;
  audioBitrate: number;
  normalizeAudio: boolean;
  exportMode: 'fast' | 'precise';
  filename: string;
  onExporter: (exporter: FrameExporter) => void;
  onProgress: (progress: ExportProgress) => void;
  onTimelineProgress: (percent: number, currentTime: number) => void;
  frameDecorator?: ExportRenderFrameDecorator;
}

export interface WebCodecsExportRunnerResult {
  blob: Blob;
  filename: string;
}

export async function runWebCodecsExport(
  input: WebCodecsExportRunnerInput,
): Promise<WebCodecsExportRunnerResult | null> {
  const exporter = new FrameExporter({
    width: input.width,
    height: input.height,
    fps: input.fps,
    codec: input.videoCodec,
    container: input.containerFormat,
    bitrate: input.bitrate,
    rateControl: input.rateControl,
    startTime: input.startTime,
    endTime: input.endTime,
    stackedAlpha: input.stackedAlpha,
    includeAudio: input.includeAudio,
    audioSampleRate: input.audioSampleRate,
    audioBitrate: input.audioBitrate,
    normalizeAudio: input.normalizeAudio,
    exportMode: input.exportMode,
    frameDecorator: input.frameDecorator,
  });
  input.onExporter(exporter);

  const blob = await exporter.export((progress) => {
    input.onProgress(progress);
    input.onTimelineProgress(progress.percent, progress.currentTime);
  });

  if (!blob) {
    return null;
  }

  return {
    blob,
    filename: `${input.filename}.${input.containerFormat === 'webm' ? 'webm' : 'mp4'}`,
  };
}
