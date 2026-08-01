import type { AudioCodec, VideoCodec } from 'mediabunny';
import type { ExportSettings } from '../../../stores/exportStore';
import { BatchSourceExportUnsupportedError } from './batchSourceExportErrors';
import type { BatchSourceMediaType } from './batchSourceExportTypes';

export type BatchSourceVideoContainer = 'mp4' | 'webm';
export type BatchSourceAudioContainer = 'wav' | 'mp3' | 'mp4' | 'webm';

interface BatchSourceBasePlan {
  filename: string;
  mimeType: string;
}

export interface BatchSourceVideoPlan extends BatchSourceBasePlan {
  kind: 'video';
  container: BatchSourceVideoContainer;
  width: number;
  height: number;
  frameRate: number;
  videoCodec: VideoCodec;
  videoBitrate: number;
  includeAudio: boolean;
  audioCodec: 'aac' | 'opus';
  audioBitrate: number;
  audioSampleRate: number;
}

export interface BatchSourceAudioPlan extends BatchSourceBasePlan {
  kind: 'audio';
  container: BatchSourceAudioContainer;
  audioCodec: AudioCodec;
  audioBitrate?: number;
  audioSampleRate: number;
}

export interface BatchSourceImagePlan extends BatchSourceBasePlan {
  kind: 'image';
  format: 'png' | 'jpg' | 'webp' | 'bmp';
  width: number;
  height: number;
  quality: number;
  background: 'transparent' | 'black';
}

export type BatchSourceExportPlan =
  | BatchSourceVideoPlan
  | BatchSourceAudioPlan
  | BatchSourceImagePlan;

export interface BatchSourceExportPlanInput {
  mediaType: BatchSourceMediaType;
  settings: ExportSettings;
  outputName: string;
}

const VIDEO_CODEC_MAP: Readonly<Record<ExportSettings['videoCodec'], VideoCodec>> = {
  h264: 'avc',
  h265: 'hevc',
  vp9: 'vp9',
  av1: 'av1',
};

const IMAGE_MIME_TYPES: Readonly<Record<ExportSettings['imageFormat'], string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

export function mapBatchSourceVideoCodec(codec: ExportSettings['videoCodec']): VideoCodec {
  return VIDEO_CODEC_MAP[codec];
}

export function getBatchSourceResolution(
  settings: Pick<ExportSettings, 'width' | 'height' | 'customWidth' | 'customHeight' | 'useCustomResolution'>,
): { width: number; height: number } {
  const width = settings.useCustomResolution ? settings.customWidth : settings.width;
  const height = settings.useCustomResolution ? settings.customHeight : settings.height;

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new BatchSourceExportUnsupportedError('The batch export resolution must have positive finite dimensions.');
  }

  return {
    width: Math.round(width),
    height: Math.round(height),
  };
}

export function getBatchSourceFrameRate(
  settings: Pick<ExportSettings, 'fps' | 'customFps' | 'useCustomFps'>,
): number {
  const frameRate = settings.useCustomFps ? settings.customFps : settings.fps;
  if (!Number.isFinite(frameRate) || frameRate <= 0) {
    throw new BatchSourceExportUnsupportedError('The batch export frame rate must be a positive finite number.');
  }
  return frameRate;
}

export function replaceBatchSourceOutputExtension(outputName: string, extension: string): string {
  const leafName = outputName.trim().replaceAll('\\', '/').split('/').at(-1) ?? '';
  const safeName = [...leafName]
    .map((character) => character.charCodeAt(0) < 32 ? '_' : character)
    .join('')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  const extensionless = safeName.replace(/\.[^.]+$/, '') || 'export';
  const normalizedExtension = extension.startsWith('.') ? extension : `.${extension}`;
  return `${extensionless}${normalizedExtension.toLowerCase()}`;
}

export function createBatchSourceExportPlan(input: BatchSourceExportPlanInput): BatchSourceExportPlan {
  const { mediaType, settings, outputName } = input;

  if (settings.specialContainer !== 'none') {
    throw new BatchSourceExportUnsupportedError(
      'Timeline interchange/XML output is not supported for source media batch exports.',
    );
  }

  if (settings.visualMode === 'gif' && mediaType !== 'audio') {
    throw new BatchSourceExportUnsupportedError('GIF source media batch export is not supported.');
  }

  if (settings.normalizeAudio && mediaType !== 'image') {
    throw new BatchSourceExportUnsupportedError(
      'Audio normalization is not available for direct source media batch exports yet.',
    );
  }

  if (mediaType === 'image') {
    const { width, height } = getBatchSourceResolution(settings);
    const format = settings.imageFormat;
    return {
      kind: 'image',
      format,
      filename: replaceBatchSourceOutputExtension(outputName, format === 'jpg' ? '.jpg' : `.${format}`),
      mimeType: IMAGE_MIME_TYPES[format],
      width,
      height,
      quality: Math.max(0, Math.min(1, settings.imageQuality)),
      background: format === 'jpg' || format === 'bmp' ? 'black' : 'transparent',
    };
  }

  if (mediaType === 'audio') {
    const common = {
      kind: 'audio' as const,
      audioSampleRate: settings.audioSampleRate,
    };

    if (settings.audioOnlyFormat === 'wav') {
      return {
        ...common,
        container: 'wav',
        audioCodec: 'pcm-s16',
        filename: replaceBatchSourceOutputExtension(outputName, '.wav'),
        mimeType: 'audio/wav',
      };
    }

    if (settings.audioOnlyFormat === 'mp3') {
      return {
        ...common,
        container: 'mp3',
        audioCodec: 'mp3',
        audioBitrate: settings.audioBitrate,
        filename: replaceBatchSourceOutputExtension(outputName, '.mp3'),
        mimeType: 'audio/mpeg',
      };
    }

    if (settings.containerFormat === 'webm') {
      return {
        ...common,
        container: 'webm',
        audioCodec: 'opus',
        audioBitrate: settings.audioBitrate,
        filename: replaceBatchSourceOutputExtension(outputName, '.webm'),
        mimeType: 'audio/webm',
      };
    }

    return {
      ...common,
      container: 'mp4',
      audioCodec: 'aac',
      audioBitrate: settings.audioBitrate,
      filename: replaceBatchSourceOutputExtension(outputName, '.m4a'),
      mimeType: 'audio/mp4',
    };
  }

  const container = settings.containerFormat;
  const videoCodec = mapBatchSourceVideoCodec(settings.videoCodec);
  if (container === 'webm' && videoCodec !== 'vp9' && videoCodec !== 'av1') {
    throw new BatchSourceExportUnsupportedError(
      `The ${settings.videoCodec.toUpperCase()} codec is not supported in WebM. Choose VP9 or AV1.`,
    );
  }

  const { width, height } = getBatchSourceResolution(settings);
  return {
    kind: 'video',
    container,
    filename: replaceBatchSourceOutputExtension(outputName, `.${container}`),
    mimeType: container === 'mp4' ? 'video/mp4' : 'video/webm',
    width,
    height,
    frameRate: getBatchSourceFrameRate(settings),
    videoCodec,
    videoBitrate: settings.bitrate,
    includeAudio: settings.includeAudio,
    audioCodec: container === 'mp4' ? 'aac' : 'opus',
    audioBitrate: settings.audioBitrate,
    audioSampleRate: settings.audioSampleRate,
  };
}
