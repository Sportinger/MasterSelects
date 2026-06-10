import type { MediaFile, ProxyStatus } from '../../stores/mediaStore/types';
import { encodeAudioBufferToWavBlob } from '../../engine/audio/AudioFileEncoder';
import { projectFileService } from '../projectFileService';
import { Logger } from '../logger';
import { AudioDecodeServiceError, getSharedAudioDecodeService } from './AudioDecodeService';

const log = Logger.create('AudioProxy');

export interface AudioProxyGenerationUpdate {
  status: ProxyStatus;
  progress: number;
  storageKey: string;
  url?: string;
  error?: string;
}

export interface AudioProxyGenerationCallbacks {
  onUpdate?: (update: AudioProxyGenerationUpdate) => void;
  force?: boolean;
}

const activeJobs = new Map<string, Promise<void>>();

export function getAudioProxyStorageKey(mediaFile: Pick<MediaFile, 'id' | 'fileHash' | 'audioProxyStorageKey'>): string {
  return mediaFile.audioProxyStorageKey || mediaFile.fileHash || mediaFile.id;
}

export function shouldGenerateAudioProxy(mediaFile: Pick<MediaFile, 'type' | 'hasAudio' | 'audioCodec'>): boolean {
  if (mediaFile.type === 'audio') return true;
  if (mediaFile.type !== 'video') return false;
  return mediaFile.hasAudio !== false || Boolean(mediaFile.audioCodec);
}

async function resolveSourceFile(mediaFile: MediaFile): Promise<File | null> {
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
      log.warn('Failed to read media URL for audio proxy', { mediaId: mediaFile.id, error });
    }
  }

  return null;
}

function isDecodeMissingAudio(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'EncodingError') {
    return true;
  }

  return error instanceof AudioDecodeServiceError
    && error.cause instanceof DOMException
    && error.cause.name === 'EncodingError';
}

export async function ensureAudioProxyForMediaFile(
  mediaFile: MediaFile,
  callbacks: AudioProxyGenerationCallbacks = {},
): Promise<void> {
  if (!shouldGenerateAudioProxy(mediaFile)) {
    return;
  }

  const storageKey = getAudioProxyStorageKey(mediaFile);
  const existingJob = activeJobs.get(mediaFile.id);
  if (existingJob) {
    await existingJob;
    return;
  }

  const job = (async () => {
    callbacks.onUpdate?.({ status: 'generating', progress: 2, storageKey });

    if (projectFileService.isProjectOpen() && !callbacks.force) {
      const existing = await projectFileService.hasProxyAudio(storageKey);
      if (existing) {
        callbacks.onUpdate?.({ status: 'ready', progress: 100, storageKey });
        return;
      }
    }

    const sourceFile = await resolveSourceFile(mediaFile);
    if (!sourceFile) {
      callbacks.onUpdate?.({
        status: 'error',
        progress: 0,
        storageKey,
        error: 'Audio source is not available',
      });
      return;
    }

    callbacks.onUpdate?.({ status: 'generating', progress: 18, storageKey });

    let audioBuffer: AudioBuffer;
    try {
      callbacks.onUpdate?.({ status: 'generating', progress: 35, storageKey });
      audioBuffer = await getSharedAudioDecodeService().decodeAudioBuffer(
        { kind: 'file', file: sourceFile },
        {
          mediaFileId: mediaFile.id,
          sourceFingerprint: storageKey,
          metadata: {
            source: 'audio-proxy',
            sourceFileName: sourceFile.name,
            sourceFileSize: sourceFile.size,
          },
        },
      );
    } catch (error) {
      if (mediaFile.type === 'video' && isDecodeMissingAudio(error)) {
        callbacks.onUpdate?.({ status: 'none', progress: 0, storageKey });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      callbacks.onUpdate?.({ status: 'error', progress: 0, storageKey, error: message });
      log.warn('Audio proxy decode failed', { mediaId: mediaFile.id, name: mediaFile.name, error });
      return;
    }

    callbacks.onUpdate?.({ status: 'generating', progress: 75, storageKey });
    let wavBlob: Blob;
    try {
      wavBlob = encodeAudioBufferToWavBlob(audioBuffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      callbacks.onUpdate?.({ status: 'error', progress: 0, storageKey, error: message });
      log.warn('Audio proxy WAV encode failed', { mediaId: mediaFile.id, name: mediaFile.name, error });
      return;
    }

    callbacks.onUpdate?.({ status: 'generating', progress: 92, storageKey });

    if (projectFileService.isProjectOpen()) {
      const saved = await projectFileService.saveProxyAudio(storageKey, wavBlob);
      if (!saved) {
        callbacks.onUpdate?.({
          status: 'error',
          progress: 0,
          storageKey,
          error: 'Could not save audio proxy to project',
        });
        return;
      }

      callbacks.onUpdate?.({ status: 'ready', progress: 100, storageKey });
      return;
    }

    callbacks.onUpdate?.({
      status: 'ready',
      progress: 100,
      storageKey,
      url: URL.createObjectURL(wavBlob),
    });
  })();

  activeJobs.set(mediaFile.id, job);
  try {
    await job;
  } finally {
    activeJobs.delete(mediaFile.id);
  }
}
