import { createPresetId, createBatchJobId, createBatchSettings, createDefaultExportStoreData, cloneExportSettings, cloneBatchJob, sanitizeSettings, applyBatchSourceInvariants, applySharedTechnicalSettings, sanitizeStoreData } from './exportDefinitions';
export { createDefaultExportSettings, createDefaultExportStoreData, getExportStoreData } from './exportDefinitions';
import { withRepositoryStoreMutation } from '../services/project/repository/transaction/storeMutationBoundary';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { withExclusiveHistorySnapshotMutationLease } from './timeline/exclusiveMutationLease';
import type { ContainerFormat, VideoCodec } from '../engine/export';
import type { AudioOnlyExportFormat } from '../engine/audio/AudioFileEncoder';
import type {
  DnxhrProfile,
  FFmpegContainer,
  FFmpegVideoCodec,
  HapFormat,
  ProResProfile,
} from '../engine/ffmpeg';
import type { GifDither, GifLoopMode, GifPaletteMode } from '../engine/gif/gifOptions';

export type ExportEncoderType = 'webcodecs' | 'htmlvideo' | 'ffmpeg' | 'hap';
export type ExportVisualMode = 'video' | 'image' | 'gif';
export type ExportImageFormat = 'png' | 'jpg' | 'webp' | 'bmp';
export type ExportImageMode = 'frame' | 'sequence';
export type ExportSpecialContainer = 'none' | 'xml';
export type ExportAudioFormat = AudioOnlyExportFormat;

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
  hapFormat: HapFormat;
  ffmpegQuality: number;
  ffmpegBitrate: number;
  ffmpegRateControl: 'crf' | 'cbr' | 'vbr';
  gifColors: number;
  gifDither: GifDither;
  gifLoop: GifLoopMode;
  gifLoopCount: number;
  gifPaletteMode: GifPaletteMode;
  gifOptimize: boolean;
  gifTransparency: boolean;
  gifAlphaThreshold: number;
  gifBayerScale: number;
  includeAlpha: boolean;
  stackedAlpha: boolean;
  includeAudio: boolean;
  audioOnlyFormat: ExportAudioFormat;
  audioSampleRate: 44100 | 48000;
  audioBitrate: number;
  normalizeAudio: boolean;
  videoEnabled: boolean;
  visualMode: ExportVisualMode;
  imageFormat: ExportImageFormat;
  imageExportMode: ExportImageMode;
  imageQuality: number;
  specialContainer: ExportSpecialContainer;
  /** 3D scene quality: engine override, raster sub-samples, path traced samples and denoise. Absent: defaults. */
  renderQuality?: import('../types/renderSettings').ExportRenderQuality;
}

export interface ExportPreset {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  settings: ExportSettings;
}

export type BatchExportMediaType = 'video' | 'audio' | 'image';

export interface BatchExportSource {
  mediaFileId: string;
  sourceName: string;
  mediaType: BatchExportMediaType;
}

export interface BatchExportJob {
  id: string;
  mediaFileId: string;
  sourceName: string;
  mediaType: BatchExportMediaType;
  settings: ExportSettings;
  createdAt: number;
}

export interface BatchExportData {
  enabled: boolean;
  useSharedSettings: boolean;
  selectedJobId: string | null;
  jobs: BatchExportJob[];
}

export interface ExportStoreData {
  settings: ExportSettings;
  presets: ExportPreset[];
  selectedPresetId: string | null;
  batch: BatchExportData;
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
  savePreset: (name: string, settingsOverride?: ExportSettings) => SavePresetResult | null;
  updatePreset: (presetId: string, settingsOverride?: ExportSettings) => ExportPreset | null;
  loadPreset: (presetId: string) => boolean;
  deletePreset: (presetId: string) => void;
  enqueueBatchJobs: (sources: BatchExportSource[]) => void;
  removeBatchJob: (jobId: string) => void;
  clearBatchJobs: () => void;
  setBatchEnabled: (enabled: boolean) => void;
  setBatchUseSharedSettings: (useSharedSettings: boolean) => void;
  setSelectedBatchJobId: (jobId: string | null) => void;
  updateBatchJobSettings: (jobId: string, patch: Partial<ExportSettings>) => void;
  replaceBatchJobSettings: (jobId: string, settings: Partial<ExportSettings>) => void;
  hydrateFromProject: (data?: Partial<ExportStoreData> | null) => void;
}

export const useExportStore = create<ExportStoreState>()(
  subscribeWithSelector(withRepositoryStoreMutation('export', withExclusiveHistorySnapshotMutationLease((set, get) => ({
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

    savePreset: (name, settingsOverride) => {
      const trimmedName = name.trim();
      if (!trimmedName) {
        return null;
      }

      const now = Date.now();
      const { presets, settings } = get();
      const settingsToSave = settingsOverride
        ? sanitizeSettings(settingsOverride)
        : settings;
      const normalizedName = trimmedName.toLowerCase();
      const existingPreset = presets.find((preset) => preset.name.toLowerCase() === normalizedName);
      const nextPreset: ExportPreset = existingPreset
        ? {
            ...existingPreset,
            name: trimmedName,
            updatedAt: now,
            settings: cloneExportSettings(settingsToSave),
          }
        : {
            id: createPresetId(),
            name: trimmedName,
            createdAt: now,
            updatedAt: now,
            settings: cloneExportSettings(settingsToSave),
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

    updatePreset: (presetId, settingsOverride) => {
      const { presets, settings } = get();
      const existingPreset = presets.find((preset) => preset.id === presetId);
      if (!existingPreset) {
        return null;
      }

      const settingsToSave = settingsOverride
        ? sanitizeSettings(settingsOverride)
        : settings;

      const nextPreset: ExportPreset = {
        ...existingPreset,
        updatedAt: Date.now(),
        settings: cloneExportSettings(settingsToSave),
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

    enqueueBatchJobs: (sources) => {
      set((state) => {
        const existingMediaFileIds = new Set(state.batch.jobs.map((job) => job.mediaFileId));
        let firstExistingJobId: string | null = null;
        const now = Date.now();
        const nextJobs: BatchExportJob[] = [];

        sources.forEach((source, index) => {
          if (
            !source
            || typeof source.mediaFileId !== 'string'
            || !source.mediaFileId.trim()
            || typeof source.sourceName !== 'string'
            || !source.sourceName.trim()
            || !(['video', 'audio', 'image'] as const).includes(source.mediaType)
          ) {
            return;
          }

          const mediaFileId = source.mediaFileId.trim();
          if (existingMediaFileIds.has(mediaFileId)) {
            firstExistingJobId ??= state.batch.jobs.find((job) => job.mediaFileId === mediaFileId)?.id ?? null;
            return;
          }
          existingMediaFileIds.add(mediaFileId);
          const normalizedSource: BatchExportSource = {
            ...source,
            mediaFileId,
            sourceName: source.sourceName.trim(),
          };
          nextJobs.push({
            id: createBatchJobId(),
            mediaFileId,
            sourceName: normalizedSource.sourceName,
            mediaType: normalizedSource.mediaType,
            settings: createBatchSettings(state.settings, normalizedSource),
            createdAt: now + index,
          });
        });

        if (nextJobs.length === 0) {
          return firstExistingJobId
            ? {
                batch: {
                  ...state.batch,
                  enabled: true,
                  selectedJobId: firstExistingJobId,
                },
              }
            : {};
        }

        const jobs = [...state.batch.jobs, ...nextJobs];
        const selectedJobId = state.batch.selectedJobId
          && jobs.some((job) => job.id === state.batch.selectedJobId)
          ? state.batch.selectedJobId
          : nextJobs[0].id;
        const selectedJob = jobs.find((job) => job.id === selectedJobId);

        return {
          batch: {
            ...state.batch,
            enabled: true,
            selectedJobId,
            jobs: state.batch.useSharedSettings && selectedJob
              ? applySharedTechnicalSettings(jobs, selectedJob)
              : jobs,
          },
        };
      });
    },

    removeBatchJob: (jobId) => {
      set((state) => {
        const removedIndex = state.batch.jobs.findIndex((job) => job.id === jobId);
        if (removedIndex < 0) {
          return {};
        }

        const jobs = state.batch.jobs.filter((job) => job.id !== jobId);
        const selectedJobId = state.batch.selectedJobId === jobId
          ? jobs[Math.min(removedIndex, jobs.length - 1)]?.id ?? null
          : state.batch.selectedJobId;
        return {
          batch: {
            ...state.batch,
            enabled: jobs.length > 0 ? state.batch.enabled : false,
            selectedJobId,
            jobs,
          },
        };
      });
    },

    clearBatchJobs: () => {
      set((state) => ({
        batch: {
          ...state.batch,
          enabled: false,
          selectedJobId: null,
          jobs: [],
        },
      }));
    },

    setBatchEnabled: (enabled) => {
      set((state) => ({
        batch: {
          ...state.batch,
          enabled: enabled && state.batch.jobs.length > 0,
        },
      }));
    },

    setBatchUseSharedSettings: (useSharedSettings) => {
      set((state) => {
        if (useSharedSettings === state.batch.useSharedSettings) {
          return {};
        }

        const selectedJob = state.batch.jobs.find((job) => job.id === state.batch.selectedJobId)
          ?? state.batch.jobs[0];
        return {
          batch: {
            ...state.batch,
            useSharedSettings,
            selectedJobId: state.batch.selectedJobId ?? selectedJob?.id ?? null,
            jobs: useSharedSettings && selectedJob
              ? applySharedTechnicalSettings(state.batch.jobs, selectedJob)
              : state.batch.jobs.map(cloneBatchJob),
          },
        };
      });
    },

    setSelectedBatchJobId: (jobId) => {
      set((state) => ({
        batch: {
          ...state.batch,
          selectedJobId: jobId && state.batch.jobs.some((job) => job.id === jobId)
            ? jobId
            : null,
        },
      }));
    },

    updateBatchJobSettings: (jobId, patch) => {
      set((state) => {
        const targetJob = state.batch.jobs.find((job) => job.id === jobId);
        if (!targetJob) {
          return {};
        }

        const updatedJob: BatchExportJob = {
          ...targetJob,
          settings: applyBatchSourceInvariants(sanitizeSettings({
            ...targetJob.settings,
            ...patch,
          }), targetJob.mediaType),
        };
        const jobs = state.batch.jobs.map((job) => job.id === jobId ? updatedJob : job);
        return {
          batch: {
            ...state.batch,
            jobs: state.batch.useSharedSettings
              ? applySharedTechnicalSettings(jobs, updatedJob)
              : jobs,
          },
        };
      });
    },

    replaceBatchJobSettings: (jobId, settings) => {
      set((state) => {
        const targetJob = state.batch.jobs.find((job) => job.id === jobId);
        if (!targetJob) {
          return {};
        }

        const updatedJob: BatchExportJob = {
          ...targetJob,
          settings: applyBatchSourceInvariants(sanitizeSettings(settings), targetJob.mediaType),
        };
        const jobs = state.batch.jobs.map((job) => job.id === jobId ? updatedJob : job);
        return {
          batch: {
            ...state.batch,
            jobs: state.batch.useSharedSettings
              ? applySharedTechnicalSettings(jobs, updatedJob)
              : jobs,
          },
        };
      });
    },

    hydrateFromProject: (data) => {
      set(() => sanitizeStoreData(data));
    },
  }))))
);
