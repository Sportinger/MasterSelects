import type { MediaFile, MediaState } from '../../types';
import { projectFileService } from '../../../../services/projectFileService';
import { calculateFileHash } from '../../helpers/fileHashHelpers';
import { fileManageLog as log } from './log';

export type MediaSourceReplacementPatch = Partial<Pick<
  MediaFile,
  | 'fileHash'
  | 'thumbnailUrl'
  | 'audioAnalysisRefs'
  | 'waveform'
  | 'waveformChannels'
  | 'waveformStatus'
  | 'waveformProgress'
  | 'proxyStatus'
  | 'proxyProgress'
  | 'proxyFrameCount'
  | 'proxyFps'
  | 'proxyFormat'
  | 'proxyVideoUrl'
  | 'hasProxyAudio'
  | 'audioProxyStatus'
  | 'audioProxyProgress'
  | 'audioProxyStorageKey'
  | 'audioProxyUrl'
>>;

export function createMediaSourceReplacementResetPatch(fileHash?: string): MediaSourceReplacementPatch {
  return {
    fileHash,
    thumbnailUrl: undefined,
    audioAnalysisRefs: undefined,
    waveform: undefined,
    waveformChannels: undefined,
    waveformStatus: 'idle',
    waveformProgress: undefined,
    proxyStatus: undefined,
    proxyProgress: undefined,
    proxyFrameCount: undefined,
    proxyFps: undefined,
    proxyFormat: undefined,
    proxyVideoUrl: undefined,
    hasProxyAudio: undefined,
    audioProxyStatus: undefined,
    audioProxyProgress: undefined,
    audioProxyStorageKey: undefined,
    audioProxyUrl: undefined,
  };
}

export async function createMediaSourceReplacementPatch(file: File): Promise<MediaSourceReplacementPatch> {
  const fileHash = await calculateFileHash(file);
  return createMediaSourceReplacementResetPatch(fileHash || undefined);
}

export function mediaFileCanHaveAudio(mediaFile: MediaFile): boolean {
  if (mediaFile.type === 'audio') return true;
  if (mediaFile.type !== 'video') return false;
  return mediaFile.hasAudio !== false || Boolean(mediaFile.audioCodec);
}

export async function resolveMediaFileSourceFile(mediaFile: MediaFile): Promise<File | null> {
  if (mediaFile.file && mediaFile.file.size > 0) {
    return mediaFile.file;
  }

  if (mediaFile.projectPath && projectFileService.isProjectOpen()) {
    const result = await projectFileService.getFileFromRaw(mediaFile.projectPath);
    if (result?.file) return result.file;
  }

  if (mediaFile.url) {
    try {
      const response = await fetch(mediaFile.url);
      if (response.ok) {
        const blob = await response.blob();
        return new File([blob], mediaFile.name, { type: blob.type || mediaFile.file?.type || '' });
      }
    } catch (error) {
      log.warn('Failed to resolve media source URL', { id: mediaFile.id, name: mediaFile.name, error });
    }
  }

  return null;
}

export function updateMediaFileWaveform(
  set: (partial: Partial<MediaState> | ((state: MediaState) => Partial<MediaState>)) => void,
  id: string,
  updates: Partial<Pick<MediaFile, 'audioAnalysisRefs' | 'waveform' | 'waveformChannels' | 'waveformProgress' | 'waveformStatus'>>,
): void {
  set((state) => ({
    files: state.files.map((file) => (
      file.id === id
        ? { ...file, ...updates }
        : file
    )),
  }));
}
