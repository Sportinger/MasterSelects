import { normalizeExportRenderQuality } from '../engine/native3d/pathtrace/contracts/ptTypes';
import type { ContainerFormat, VideoCodec } from '../engine/export';
import { getChromiumCompatibleAACBitrate } from '../engine/audio/AudioEncoder';
import type { DnxhrProfile, FFmpegContainer, FFmpegVideoCodec, HapFormat, ProResProfile } from '../engine/ffmpeg';
import type { GifDither, GifLoopMode, GifPaletteMode } from '../engine/gif/gifOptions';
import type { BatchExportData, BatchExportJob, BatchExportMediaType, BatchExportSource, ExportAudioFormat, ExportEncoderType, ExportImageFormat, ExportImageMode, ExportPreset, ExportSettings, ExportSpecialContainer, ExportStoreData, ExportVisualMode } from './exportStore';

const ENCODERS: ExportEncoderType[] = ['webcodecs', 'htmlvideo', 'ffmpeg', 'hap'];
const VIDEO_CODECS: VideoCodec[] = ['h264', 'h265', 'vp9', 'av1'];
const WEB_CONTAINERS: ContainerFormat[] = ['mp4', 'webm'];
const FFMPEG_CONTAINERS: FFmpegContainer[] = ['mov', 'mkv', 'avi', 'mxf', 'gif'];
const FFMPEG_CODECS: FFmpegVideoCodec[] = ['prores', 'dnxhd', 'ffv1', 'utvideo', 'mjpeg', 'gif'];
const PRORES_PROFILES: ProResProfile[] = ['proxy', 'lt', 'standard', 'hq', '4444', '4444xq'];
const DNXHR_PROFILES: DnxhrProfile[] = ['dnxhr_lb', 'dnxhr_sq', 'dnxhr_hq', 'dnxhr_hqx', 'dnxhr_444'];
const HAP_FORMATS: HapFormat[] = ['hap', 'hap_alpha', 'hap_q'];
const IMAGE_FORMATS: ExportImageFormat[] = ['png', 'jpg', 'webp', 'bmp'];
const IMAGE_EXPORT_MODES: ExportImageMode[] = ['frame', 'sequence'];
const VISUAL_MODES: ExportVisualMode[] = ['video', 'image', 'gif'];
const SPECIAL_CONTAINERS: ExportSpecialContainer[] = ['none', 'xml'];
const AUDIO_FORMATS: ExportAudioFormat[] = ['wav', 'mp3', 'browser'];
const GIF_DITHERS: GifDither[] = ['sierra2_4a', 'floyd_steinberg', 'bayer', 'none'];
const GIF_LOOPS: GifLoopMode[] = ['forever', 'once', 'count'];
const GIF_PALETTE_MODES: GifPaletteMode[] = ['global', 'per-frame'];

export function createPresetId(): string {
  return `export-preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createBatchJobId(): string {
  return `batch-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function sourceBasename(sourceName: string): string {
  const filename = sourceName.trim().split(/[\\/]/).pop() ?? '';
  const extensionIndex = filename.lastIndexOf('.');
  const basename = extensionIndex > 0 ? filename.slice(0, extensionIndex) : filename;
  return basename || 'export';
}

export function createBatchSettings(
  settings: ExportSettings,
  source: BatchExportSource,
): ExportSettings {
  const sourceSettings: Partial<ExportSettings> = source.mediaType === 'video'
    ? {
        encoder: 'webcodecs',
        useInOut: false,
        filename: sourceBasename(source.sourceName),
        specialContainer: 'none',
        normalizeAudio: false,
        includeAlpha: false,
        stackedAlpha: false,
        visualMode: 'video',
        videoEnabled: true,
        imageExportMode: 'frame',
      }
    : source.mediaType === 'audio'
      ? {
          encoder: 'webcodecs',
          useInOut: false,
          filename: sourceBasename(source.sourceName),
          specialContainer: 'none',
          normalizeAudio: false,
          includeAlpha: false,
          stackedAlpha: false,
          visualMode: 'video',
          videoEnabled: false,
          includeAudio: true,
          imageExportMode: 'frame',
        }
      : {
          encoder: 'webcodecs',
          useInOut: false,
          filename: sourceBasename(source.sourceName),
          specialContainer: 'none',
          normalizeAudio: false,
          includeAlpha: false,
          stackedAlpha: false,
          visualMode: 'image',
          videoEnabled: true,
          imageExportMode: 'frame',
          includeAudio: false,
        };

  return sanitizeSettings({
    ...settings,
    ...sourceSettings,
  });
}

export function createDefaultExportSettings(): ExportSettings {
  return {
    encoder: 'webcodecs',
    width: 1920,
    height: 1080,
    customWidth: 1920,
    customHeight: 1080,
    useCustomResolution: false,
    fps: 30,
    customFps: 30,
    useCustomFps: false,
    useInOut: true,
    filename: 'export',
    bitrate: 15_000_000,
    containerFormat: 'mp4',
    videoCodec: 'h264',
    rateControl: 'vbr',
    ffmpegCodec: 'prores',
    ffmpegContainer: 'mov',
    ffmpegPreset: '',
    proresProfile: 'hq',
    dnxhrProfile: 'dnxhr_hq',
    hapFormat: 'hap',
    ffmpegQuality: 18,
    ffmpegBitrate: 20_000_000,
    ffmpegRateControl: 'crf',
    gifColors: 256,
    gifDither: 'sierra2_4a',
    gifLoop: 'forever',
    gifLoopCount: 3,
    gifPaletteMode: 'global',
    gifOptimize: true,
    gifTransparency: true,
    gifAlphaThreshold: 128,
    gifBayerScale: 3,
    includeAlpha: false,
    stackedAlpha: false,
    includeAudio: true,
    audioOnlyFormat: 'wav',
    audioSampleRate: 48000,
    audioBitrate: 192_000,
    normalizeAudio: false,
    videoEnabled: true,
    visualMode: 'video',
    imageFormat: 'png',
    imageExportMode: 'frame',
    imageQuality: 0.92,
    specialContainer: 'none',
  };
}

export function createDefaultExportStoreData(): ExportStoreData {
  return {
    settings: createDefaultExportSettings(),
    presets: [],
    selectedPresetId: null,
    batch: {
      enabled: false,
      useSharedSettings: false,
      selectedJobId: null,
      jobs: [],
    },
  };
}

export function cloneExportSettings(settings: ExportSettings): ExportSettings {
  return { ...settings };
}

export function clonePreset(preset: ExportPreset): ExportPreset {
  return {
    ...preset,
    settings: cloneExportSettings(preset.settings),
  };
}

export function cloneBatchJob(job: BatchExportJob): BatchExportJob {
  return {
    ...job,
    settings: cloneExportSettings(job.settings),
  };
}

export function cloneBatchData(batch: BatchExportData): BatchExportData {
  return {
    ...batch,
    jobs: batch.jobs.map(cloneBatchJob),
  };
}

export function pickEnumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;
}

export function pickNumber(value: unknown, fallback: number, options?: { min?: number; max?: number }): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }

  let next = value;
  if (options?.min !== undefined) {
    next = Math.max(options.min, next);
  }
  if (options?.max !== undefined) {
    next = Math.min(options.max, next);
  }
  return next;
}

export function sanitizeSettings(input?: Partial<ExportSettings> | null): ExportSettings {
  const defaults = createDefaultExportSettings();
  if (!input) {
    return defaults;
  }

  const ffmpegContainer = pickEnumValue(input.ffmpegContainer, FFMPEG_CONTAINERS, defaults.ffmpegContainer);
  const ffmpegCodec = pickEnumValue(input.ffmpegCodec, FFMPEG_CODECS, defaults.ffmpegCodec);
  const visualMode = pickEnumValue(input.visualMode, VISUAL_MODES, defaults.visualMode);
  const isGifOutput = visualMode === 'gif';
  const encoder = pickEnumValue(input.encoder, ENCODERS, defaults.encoder);
  const audioOnlyFormat = pickEnumValue(input.audioOnlyFormat, AUDIO_FORMATS, defaults.audioOnlyFormat);
  const videoEnabled = typeof input.videoEnabled === 'boolean' ? input.videoEnabled : defaults.videoEnabled;
  const requestedAudioBitrate = Math.round(pickNumber(
    input.audioBitrate,
    defaults.audioBitrate,
    { min: 64_000, max: 512_000 },
  ));
  const usesBrowserAudioEncoder = (videoEnabled && encoder !== 'ffmpeg')
    || (!videoEnabled && audioOnlyFormat === 'browser');
  const audioBitrate = usesBrowserAudioEncoder
    ? getChromiumCompatibleAACBitrate(requestedAudioBitrate)
    : requestedAudioBitrate;

  return {
    encoder,
    width: Math.round(pickNumber(input.width, defaults.width, { min: 1, max: 7680 })),
    height: Math.round(pickNumber(input.height, defaults.height, { min: 1, max: 4320 })),
    customWidth: Math.round(pickNumber(input.customWidth, defaults.customWidth, { min: 1, max: 7680 })),
    customHeight: Math.round(pickNumber(input.customHeight, defaults.customHeight, { min: 1, max: 4320 })),
    useCustomResolution: typeof input.useCustomResolution === 'boolean' ? input.useCustomResolution : defaults.useCustomResolution,
    fps: pickNumber(input.fps, defaults.fps, { min: 1, max: 240 }),
    customFps: pickNumber(input.customFps, defaults.customFps, { min: 1, max: 240 }),
    useCustomFps: typeof input.useCustomFps === 'boolean' ? input.useCustomFps : defaults.useCustomFps,
    useInOut: typeof input.useInOut === 'boolean' ? input.useInOut : defaults.useInOut,
    filename: typeof input.filename === 'string' ? input.filename : defaults.filename,
    bitrate: Math.round(pickNumber(input.bitrate, defaults.bitrate, { min: 1_000_000, max: 100_000_000 })),
    containerFormat: pickEnumValue(input.containerFormat, WEB_CONTAINERS, defaults.containerFormat),
    videoCodec: pickEnumValue(input.videoCodec, VIDEO_CODECS, defaults.videoCodec),
    rateControl: pickEnumValue(input.rateControl, ['vbr', 'cbr'] as const, defaults.rateControl),
    ffmpegCodec: isGifOutput ? 'gif' : ffmpegCodec === 'gif' ? defaults.ffmpegCodec : ffmpegCodec,
    ffmpegContainer: isGifOutput ? 'gif' : ffmpegContainer === 'gif' ? defaults.ffmpegContainer : ffmpegContainer,
    ffmpegPreset: typeof input.ffmpegPreset === 'string' ? input.ffmpegPreset : defaults.ffmpegPreset,
    proresProfile: pickEnumValue(input.proresProfile, PRORES_PROFILES, defaults.proresProfile),
    dnxhrProfile: pickEnumValue(input.dnxhrProfile, DNXHR_PROFILES, defaults.dnxhrProfile),
    hapFormat: pickEnumValue(input.hapFormat, HAP_FORMATS, defaults.hapFormat),
    ffmpegQuality: Math.round(pickNumber(input.ffmpegQuality, defaults.ffmpegQuality, { min: 1, max: 31 })),
    ffmpegBitrate: Math.round(pickNumber(input.ffmpegBitrate, defaults.ffmpegBitrate, { min: 1_000_000, max: 100_000_000 })),
    ffmpegRateControl: pickEnumValue(input.ffmpegRateControl, ['crf', 'cbr', 'vbr'] as const, defaults.ffmpegRateControl),
    gifColors: Math.round(pickNumber(input.gifColors, defaults.gifColors, { min: 2, max: 256 })),
    gifDither: pickEnumValue(input.gifDither, GIF_DITHERS, defaults.gifDither),
    gifLoop: pickEnumValue(input.gifLoop, GIF_LOOPS, defaults.gifLoop),
    gifLoopCount: Math.round(pickNumber(input.gifLoopCount, defaults.gifLoopCount, { min: 2, max: 99 })),
    gifPaletteMode: pickEnumValue(input.gifPaletteMode, GIF_PALETTE_MODES, defaults.gifPaletteMode),
    gifOptimize: typeof input.gifOptimize === 'boolean' ? input.gifOptimize : defaults.gifOptimize,
    gifTransparency: typeof input.gifTransparency === 'boolean' ? input.gifTransparency : defaults.gifTransparency,
    gifAlphaThreshold: Math.round(pickNumber(input.gifAlphaThreshold, defaults.gifAlphaThreshold, { min: 0, max: 255 })),
    gifBayerScale: Math.round(pickNumber(input.gifBayerScale, defaults.gifBayerScale, { min: 0, max: 5 })),
    includeAlpha: typeof input.includeAlpha === 'boolean' ? input.includeAlpha : defaults.includeAlpha,
    stackedAlpha: typeof input.stackedAlpha === 'boolean' ? input.stackedAlpha : defaults.stackedAlpha,
    includeAudio: isGifOutput ? false : typeof input.includeAudio === 'boolean' ? input.includeAudio : defaults.includeAudio,
    audioOnlyFormat,
    audioSampleRate: input.audioSampleRate === 44100 || input.audioSampleRate === 48000
      ? input.audioSampleRate
      : defaults.audioSampleRate,
    audioBitrate,
    normalizeAudio: typeof input.normalizeAudio === 'boolean' ? input.normalizeAudio : defaults.normalizeAudio,
    videoEnabled,
    visualMode: isGifOutput ? 'gif' : visualMode,
    imageFormat: pickEnumValue(input.imageFormat, IMAGE_FORMATS, defaults.imageFormat),
    imageExportMode: pickEnumValue(input.imageExportMode, IMAGE_EXPORT_MODES, defaults.imageExportMode),
    imageQuality: pickNumber(input.imageQuality, defaults.imageQuality, { min: 0.4, max: 1 }),
    specialContainer: pickEnumValue(input.specialContainer, SPECIAL_CONTAINERS, defaults.specialContainer),
    ...(input.renderQuality ? { renderQuality: normalizeExportRenderQuality(input.renderQuality) } : {}),
  };
}

export function sanitizePreset(input: Partial<ExportPreset> | null | undefined): ExportPreset | null {
  if (!input || typeof input.name !== 'string' || !input.name.trim()) {
    return null;
  }

  const now = Date.now();
  return {
    id: typeof input.id === 'string' && input.id ? input.id : createPresetId(),
    name: input.name.trim(),
    createdAt: pickNumber(input.createdAt, now, { min: 0 }),
    updatedAt: pickNumber(input.updatedAt, now, { min: 0 }),
    settings: sanitizeSettings(input.settings),
  };
}

export function sanitizeBatchJob(input: Partial<BatchExportJob> | null | undefined): BatchExportJob | null {
  if (
    !input
    || typeof input.mediaFileId !== 'string'
    || !input.mediaFileId.trim()
    || typeof input.sourceName !== 'string'
    || !input.sourceName.trim()
  ) {
    return null;
  }

  const sanitizedSettings = sanitizeSettings(input.settings);
  const mediaType = pickEnumValue(
    input.mediaType,
    ['video', 'audio', 'image'] as const,
    sanitizedSettings.visualMode === 'image'
      ? 'image'
      : sanitizedSettings.videoEnabled
        ? 'video'
        : 'audio',
  );

  const job: BatchExportJob = {
    id: typeof input.id === 'string' && input.id ? input.id : createBatchJobId(),
    mediaFileId: input.mediaFileId.trim(),
    sourceName: input.sourceName.trim(),
    mediaType,
    settings: sanitizedSettings,
    createdAt: pickNumber(input.createdAt, Date.now(), { min: 0 }),
  };
  return {
    ...job,
    settings: applyBatchSourceInvariants(job.settings, job.mediaType),
  };
}

export function applyBatchSourceInvariants(
  settings: ExportSettings,
  mediaType: BatchExportMediaType,
): ExportSettings {
  const common: Partial<ExportSettings> = {
    encoder: 'webcodecs',
    useInOut: false,
    specialContainer: 'none',
    normalizeAudio: false,
    includeAlpha: false,
    stackedAlpha: false,
    imageExportMode: 'frame',
  };
  const sourceSpecific: Partial<ExportSettings> = mediaType === 'video'
    ? {
        visualMode: 'video',
        videoEnabled: true,
      }
    : mediaType === 'audio'
      ? {
          visualMode: 'video',
          videoEnabled: false,
          includeAudio: true,
        }
      : {
          visualMode: 'image',
          videoEnabled: true,
          includeAudio: false,
        };

  return sanitizeSettings({
    ...settings,
    ...common,
    ...sourceSpecific,
  });
}

export function applySharedTechnicalSettings(
  jobs: BatchExportJob[],
  sourceJob: BatchExportJob,
): BatchExportJob[] {
  const { filename: _sourceFilename, ...technicalSettings } = sourceJob.settings;
  return jobs.map((job) => ({
    ...job,
    settings: applyBatchSourceInvariants({
      ...technicalSettings,
      filename: job.settings.filename,
    }, job.mediaType),
  }));
}

export function sanitizeBatchData(input?: Partial<BatchExportData> | null): BatchExportData {
  if (!input) {
    return createDefaultExportStoreData().batch;
  }

  const seenMediaFileIds = new Set<string>();
  const seenJobIds = new Set<string>();
  const jobs = Array.isArray(input.jobs)
    ? input.jobs
        .map((job) => sanitizeBatchJob(job))
        .filter((job): job is BatchExportJob => {
          if (!job || seenMediaFileIds.has(job.mediaFileId)) {
            return false;
          }
          seenMediaFileIds.add(job.mediaFileId);
          if (seenJobIds.has(job.id)) {
            job.id = createBatchJobId();
          }
          seenJobIds.add(job.id);
          return true;
        })
    : [];
  const selectedJobId = typeof input.selectedJobId === 'string'
    && jobs.some((job) => job.id === input.selectedJobId)
    ? input.selectedJobId
    : jobs[0]?.id ?? null;
  const useSharedSettings = input.useSharedSettings === true;
  const selectedJob = jobs.find((job) => job.id === selectedJobId);

  return {
    enabled: input.enabled === true && jobs.length > 0,
    useSharedSettings,
    selectedJobId,
    jobs: useSharedSettings && selectedJob
      ? applySharedTechnicalSettings(jobs, selectedJob)
      : jobs,
  };
}

export function sanitizeStoreData(input?: Partial<ExportStoreData> | null): ExportStoreData {
  const defaults = createDefaultExportStoreData();
  if (!input) {
    return defaults;
  }

  const presets = Array.isArray(input.presets)
    ? input.presets
        .map((preset) => sanitizePreset(preset))
        .filter((preset): preset is ExportPreset => preset !== null)
    : defaults.presets;
  const selectedPresetId = typeof input.selectedPresetId === 'string' && presets.some((preset) => preset.id === input.selectedPresetId)
    ? input.selectedPresetId
    : null;

  return {
    settings: sanitizeSettings(input.settings),
    presets,
    selectedPresetId,
    batch: sanitizeBatchData(input.batch),
  };
}

export function getExportStoreData(
  state: ExportStoreData,
): ExportStoreData {
  return {
    settings: cloneExportSettings(state.settings),
    presets: state.presets.map(clonePreset),
    selectedPresetId: state.selectedPresetId,
    batch: cloneBatchData(state.batch),
  };
}
