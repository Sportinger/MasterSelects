import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { ContainerFormat, VideoCodec } from '../engine/export';
import type {
  DnxhrProfile,
  FFmpegContainer,
  FFmpegVideoCodec,
  ProResProfile,
} from '../engine/ffmpeg';

export type ExportEncoderType = 'webcodecs' | 'htmlvideo' | 'ffmpeg';
export type ExportVisualMode = 'video' | 'image';
export type ExportImageFormat = 'png' | 'jpg' | 'webp' | 'bmp';
export type ExportSpecialContainer = 'none' | 'xml';

export interface ExportSettings {
  encoder: ExportEncoderType;
  width: number;
  height: number;
  customWidth: number;
  customHeight: number;
  useCustomResolution: boolean;
  fps: number;
  customFps: number;
  useCustomFps: boolean;
  useInOut: boolean;
  filename: string;
  bitrate: number;
  containerFormat: ContainerFormat;
  videoCodec: VideoCodec;
  rateControl: 'vbr' | 'cbr';
  ffmpegCodec: FFmpegVideoCodec;
  ffmpegContainer: FFmpegContainer;
  ffmpegPreset: string;
  proresProfile: ProResProfile;
  dnxhrProfile: DnxhrProfile;
  ffmpegQuality: number;
  ffmpegBitrate: number;
  ffmpegRateControl: 'crf' | 'cbr' | 'vbr';
  stackedAlpha: boolean;
  includeAudio: boolean;
  audioSampleRate: 44100 | 48000;
  audioBitrate: number;
  normalizeAudio: boolean;
  videoEnabled: boolean;
  visualMode: ExportVisualMode;
  imageFormat: ExportImageFormat;
  imageQuality: number;
  specialContainer: ExportSpecialContainer;
}

export interface ExportPreset {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  settings: ExportSettings;
}

export interface ExportStoreData {
  settings: ExportSettings;
  presets: ExportPreset[];
  selectedPresetId: string | null;
}

interface SavePresetResult {
  preset: ExportPreset;
  overwritten: boolean;
}

interface ExportStoreState extends ExportStoreData {
  setSettings: (patch: Partial<ExportSettings>) => void;
  replaceSettings: (settings: Partial<ExportSettings>) => void;
  reset: () => void;
  setSelectedPresetId: (presetId: string | null) => void;
  savePreset: (name: string) => SavePresetResult | null;
  updatePreset: (presetId: string) => ExportPreset | null;
  loadPreset: (presetId: string) => boolean;
  deletePreset: (presetId: string) => void;
  hydrateFromProject: (data?: Partial<ExportStoreData> | null) => void;
}

const ENCODERS: ExportEncoderType[] = ['webcodecs', 'htmlvideo', 'ffmpeg'];
const VIDEO_CODECS: VideoCodec[] = ['h264', 'h265', 'vp9', 'av1'];
const WEB_CONTAINERS: ContainerFormat[] = ['mp4', 'webm'];
const FFMPEG_CONTAINERS: FFmpegContainer[] = ['mov', 'mkv', 'avi', 'mxf'];
const FFMPEG_CODECS: FFmpegVideoCodec[] = ['prores', 'dnxhd', 'ffv1', 'utvideo', 'mjpeg'];
const PRORES_PROFILES: ProResProfile[] = ['proxy', 'lt', 'standard', 'hq', '4444', '4444xq'];
const DNXHR_PROFILES: DnxhrProfile[] = ['dnxhr_lb', 'dnxhr_sq', 'dnxhr_hq', 'dnxhr_hqx', 'dnxhr_444'];
const IMAGE_FORMATS: ExportImageFormat[] = ['png', 'jpg', 'webp', 'bmp'];
const VISUAL_MODES: ExportVisualMode[] = ['video', 'image'];
const SPECIAL_CONTAINERS: ExportSpecialContainer[] = ['none', 'xml'];

function createPresetId(): string {
  return `export-preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
    ffmpegQuality: 18,
    ffmpegBitrate: 20_000_000,
    ffmpegRateControl: 'crf',
    stackedAlpha: false,
    includeAudio: true,
    audioSampleRate: 48000,
    audioBitrate: 256_000,
    normalizeAudio: false,
    videoEnabled: true,
    visualMode: 'video',
    imageFormat: 'png',
    imageQuality: 0.92,
    specialContainer: 'none',
  };
}

export function createDefaultExportStoreData(): ExportStoreData {
  return {
    settings: createDefaultExportSettings(),
    presets: [],
    selectedPresetId: null,
  };
}

function cloneExportSettings(settings: ExportSettings): ExportSettings {
  return { ...settings };
}

function clonePreset(preset: ExportPreset): ExportPreset {
  return {
    ...preset,
    settings: cloneExportSettings(preset.settings),
  };
}

function pickEnumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;
}

function pickNumber(value: unknown, fallback: number, options?: { min?: number; max?: number }): number {
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

function sanitizeSettings(input?: Partial<ExportSettings> | null): ExportSettings {
  const defaults = createDefaultExportSettings();
  if (!input) {
    return defaults;
  }

  return {
    encoder: pickEnumValue(input.encoder, ENCODERS, defaults.encoder),
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
    ffmpegCodec: pickEnumValue(input.ffmpegCodec, FFMPEG_CODECS, defaults.ffmpegCodec),
    ffmpegContainer: pickEnumValue(input.ffmpegContainer, FFMPEG_CONTAINERS, defaults.ffmpegContainer),
    ffmpegPreset: typeof input.ffmpegPreset === 'string' ? input.ffmpegPreset : defaults.ffmpegPreset,
    proresProfile: pickEnumValue(input.proresProfile, PRORES_PROFILES, defaults.proresProfile),
    dnxhrProfile: pickEnumValue(input.dnxhrProfile, DNXHR_PROFILES, defaults.dnxhrProfile),
    ffmpegQuality: Math.round(pickNumber(input.ffmpegQuality, defaults.ffmpegQuality, { min: 1, max: 31 })),
    ffmpegBitrate: Math.round(pickNumber(input.ffmpegBitrate, defaults.ffmpegBitrate, { min: 1_000_000, max: 100_000_000 })),
    ffmpegRateControl: pickEnumValue(input.ffmpegRateControl, ['crf', 'cbr', 'vbr'] as const, defaults.ffmpegRateControl),
    stackedAlpha: typeof input.stackedAlpha === 'boolean' ? input.stackedAlpha : defaults.stackedAlpha,
    includeAudio: typeof input.includeAudio === 'boolean' ? input.includeAudio : defaults.includeAudio,
    audioSampleRate: input.audioSampleRate === 44100 || input.audioSampleRate === 48000
      ? input.audioSampleRate
      : defaults.audioSampleRate,
    audioBitrate: Math.round(pickNumber(input.audioBitrate, defaults.audioBitrate, { min: 64_000, max: 512_000 })),
    normalizeAudio: typeof input.normalizeAudio === 'boolean' ? input.normalizeAudio : defaults.normalizeAudio,
    videoEnabled: typeof input.videoEnabled === 'boolean' ? input.videoEnabled : defaults.videoEnabled,
    visualMode: pickEnumValue(input.visualMode, VISUAL_MODES, defaults.visualMode),
    imageFormat: pickEnumValue(input.imageFormat, IMAGE_FORMATS, defaults.imageFormat),
    imageQuality: pickNumber(input.imageQuality, defaults.imageQuality, { min: 0.4, max: 1 }),
    specialContainer: pickEnumValue(input.specialContainer, SPECIAL_CONTAINERS, defaults.specialContainer),
  };
}

function sanitizePreset(input: Partial<ExportPreset> | null | undefined): ExportPreset | null {
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

function sanitizeStoreData(input?: Partial<ExportStoreData> | null): ExportStoreData {
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
  };
}

export function getExportStoreData(state: Pick<ExportStoreState, 'settings' | 'presets' | 'selectedPresetId'>): ExportStoreData {
  return {
    settings: cloneExportSettings(state.settings),
    presets: state.presets.map(clonePreset),
    selectedPresetId: state.selectedPresetId,
  };
}

export const useExportStore = create<ExportStoreState>()(
  subscribeWithSelector((set, get) => ({
    ...createDefaultExportStoreData(),

    setSettings: (patch) => {
      set((state) => ({
        settings: sanitizeSettings({
          ...state.settings,
          ...patch,
        }),
      }));
    },

    replaceSettings: (settings) => {
      set(() => ({
        settings: sanitizeSettings(settings),
      }));
    },

    reset: () => {
      set(() => createDefaultExportStoreData());
    },

    setSelectedPresetId: (presetId) => {
      set((state) => ({
        selectedPresetId: presetId && state.presets.some((preset) => preset.id === presetId)
          ? presetId
          : null,
      }));
    },

    savePreset: (name) => {
      const trimmedName = name.trim();
      if (!trimmedName) {
        return null;
      }

      const now = Date.now();
      const { presets, settings } = get();
      const normalizedName = trimmedName.toLowerCase();
      const existingPreset = presets.find((preset) => preset.name.toLowerCase() === normalizedName);
      const nextPreset: ExportPreset = existingPreset
        ? {
            ...existingPreset,
            name: trimmedName,
            updatedAt: now,
            settings: cloneExportSettings(settings),
          }
        : {
            id: createPresetId(),
            name: trimmedName,
            createdAt: now,
            updatedAt: now,
            settings: cloneExportSettings(settings),
          };

      set((state) => ({
        presets: existingPreset
          ? state.presets.map((preset) => preset.id === nextPreset.id ? nextPreset : preset)
          : [...state.presets, nextPreset],
        selectedPresetId: nextPreset.id,
      }));

      return {
        preset: nextPreset,
        overwritten: !!existingPreset,
      };
    },

    updatePreset: (presetId) => {
      const { presets, settings } = get();
      const existingPreset = presets.find((preset) => preset.id === presetId);
      if (!existingPreset) {
        return null;
      }

      const nextPreset: ExportPreset = {
        ...existingPreset,
        updatedAt: Date.now(),
        settings: cloneExportSettings(settings),
      };

      set((state) => ({
        presets: state.presets.map((preset) => preset.id === presetId ? nextPreset : preset),
        selectedPresetId: presetId,
      }));

      return nextPreset;
    },

    loadPreset: (presetId) => {
      const preset = get().presets.find((entry) => entry.id === presetId);
      if (!preset) {
        return false;
      }

      set(() => ({
        settings: cloneExportSettings(preset.settings),
        selectedPresetId: preset.id,
      }));
      return true;
    },

    deletePreset: (presetId) => {
      set((state) => ({
        presets: state.presets.filter((preset) => preset.id !== presetId),
        selectedPresetId: state.selectedPresetId === presetId ? null : state.selectedPresetId,
      }));
    },

    hydrateFromProject: (data) => {
      set(() => sanitizeStoreData(data));
    },
  }))
);
