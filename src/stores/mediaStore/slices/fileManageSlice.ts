// File management actions - remove, rename, reload
// SIMPLIFIED: Uses RAW folder for easy relinking

import type { MediaSliceCreator } from '../types';
import { createFileDeleteActions, type DeleteMediaFilesEverywhereResult } from './fileManage/deleteActions';
import { createFileMetadataActions } from './fileManage/metadataActions';
import { createMediaAudioAnalysisActions } from './fileManage/audioAnalysisActions';
import { createMediaReloadActions } from './fileManage/reloadActions';
import { createMediaThumbnailActions } from './fileManage/thumbnailActions';
import type { MediaFileUsageSummary } from './fileManage/mediaUsagePlanner';

export type {
  DeleteMediaFilesEverywhereResult,
  MediaFileUsageSummary,
};
export type { MediaFileCompositionUsage } from './fileManage/mediaUsagePlanner';
export type { MediaSourceReplacementPatch } from './fileManage/sourceResolution';
export type { UpdateTimelineClipsOptions } from './fileManage/timelineClipReload';
export {
  collectMediaFileUsages,
} from './fileManage/mediaUsagePlanner';
export {
  createMediaSourceReplacementPatch,
  createMediaSourceReplacementResetPatch,
} from './fileManage/sourceResolution';
export {
  updateTimelineClips,
} from './fileManage/timelineClipReload';

export interface FileManageActions {
  removeFile: (id: string) => void;
  getMediaFileUsages: (ids: string[]) => MediaFileUsageSummary[];
  deleteMediaFilesEverywhere: (ids: string[]) => Promise<DeleteMediaFilesEverywhereResult>;
  renameFile: (id: string, name: string) => void;
  removeSignalAsset: (id: string) => void;
  renameSignalAsset: (id: string, name: string) => void;
  ensureFileThumbnail: (id: string, options?: { force?: boolean }) => Promise<boolean>;
  generateMediaWaveform: (id: string, options?: { force?: boolean }) => Promise<void>;
  generateMediaSpectrogram: (id: string, options?: { force?: boolean }) => Promise<void>;
  refreshFileUrls: (id: string, options?: { refreshThumbnail?: boolean }) => Promise<boolean>;
  reloadFile: (id: string) => Promise<boolean>;
  reloadAllFiles: () => Promise<number>;
}

export const createFileManageSlice: MediaSliceCreator<FileManageActions> = (set, get) => ({
  ...createFileDeleteActions(set, get),
  ...createFileMetadataActions(set, get),
  ...createMediaThumbnailActions(set, get),
  ...createMediaAudioAnalysisActions(set, get),
  ...createMediaReloadActions(set, get),
});
