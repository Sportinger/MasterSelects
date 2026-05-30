// Proxy generation slice

import type { MediaFile, MediaSliceCreator, MediaState, ProxyStatus } from '../types';
import {
  getExpectedProxyFps,
  getExpectedProxyFrameCount,
  isProxyFrameCountComplete,
} from '../helpers/proxyCompleteness';
import { projectFileService } from '../../../services/projectFileService';
import { useTimelineStore } from '../../timeline';
import { Logger } from '../../../services/logger';

const log = Logger.create('Proxy');

// Track active generations for cancellation
const activeProxyGenerations = new Map<string, { cancelled: boolean }>();

/** Check if a proxy is complete (>= 98% of expected frames) */
function isProxyComplete(file: MediaFile, frameCountOverride?: number): boolean {
  return isProxyFrameCountComplete(frameCountOverride ?? file.proxyFrameCount, file.duration, file.proxyFps ?? file.fps);
}

export interface ProxyActions {
  proxyEnabled: boolean;
  setProxyEnabled: (enabled: boolean) => void;
  toggleProxyEnabled: () => void;
  startProxyGenerationQueue: () => void;
  generateProxy: (mediaFileId: string, options?: { force?: boolean }) => Promise<void>;
  generateAudioProxy: (mediaFileId: string, options?: { force?: boolean }) => Promise<void>;
  cancelProxyGeneration: (mediaFileId: string) => void;
  updateProxyProgress: (mediaFileId: string, progress: number) => void;
  setProxyStatus: (mediaFileId: string, status: ProxyStatus) => void;
  getNextFileNeedingProxy: () => MediaFile | undefined;
}

export const createProxySlice: MediaSliceCreator<ProxyActions> = (set, get) => ({
  proxyEnabled: false,

  toggleProxyEnabled: () => {
    const enabled = !get().proxyEnabled;
    set({ proxyEnabled: enabled });

    if (enabled) {
      const clips = useTimelineStore.getState().clips;
      clips.forEach(clip => {
        if (clip.source?.videoElement) {
          clip.source.videoElement.muted = true;
          if (!clip.source.videoElement.paused) {
            clip.source.videoElement.pause();
          }
        }
      });
      log.info('Mode enabled - muted all videos');
      queueMicrotask(() => {
        (get() as MediaState & ProxyActions).startProxyGenerationQueue();
      });
    }
  },

  setProxyEnabled: async (enabled: boolean) => {
    set({ proxyEnabled: enabled });

    if (enabled) {
      // Mute all video elements when enabling proxy mode
      const clips = useTimelineStore.getState().clips;
      clips.forEach(clip => {
        if (clip.source?.videoElement) {
          clip.source.videoElement.muted = true;
          if (!clip.source.videoElement.paused) {
            clip.source.videoElement.pause();
          }
        }
      });
      log.info('Mode enabled - muted all videos');
      queueMicrotask(() => {
        (get() as MediaState & ProxyActions).startProxyGenerationQueue();
      });
    }
  },

  startProxyGenerationQueue: () => {
    const state = get();
    if (!state.proxyEnabled || state.currentlyGeneratingProxyId) {
      return;
    }

    const nextFile = (state as MediaState & ProxyActions).getNextFileNeedingProxy();
    if (!nextFile) {
      return;
    }

    log.debug('Starting queued proxy generation:', nextFile.name);
    void (state as MediaState & ProxyActions).generateProxy(nextFile.id).catch((error) => {
      log.warn('Queued proxy generation failed:', error);
    });
  },

  updateProxyProgress: (mediaFileId: string, progress: number) => {
    set((state) => ({
      files: state.files.map((f) =>
        f.id === mediaFileId ? { ...f, proxyProgress: progress } : f
      ),
    }));
  },

  setProxyStatus: async (mediaFileId: string, status: ProxyStatus) => {
    const { proxyEnabled } = get();

    set((state) => ({
      files: state.files.map((f) =>
        f.id === mediaFileId ? { ...f, proxyStatus: status } : f
      ),
    }));

    // Mute video when proxy becomes ready
    if (status === 'ready' && proxyEnabled) {
      const clips = useTimelineStore.getState().clips;
      clips.forEach(clip => {
        if (clip.mediaFileId === mediaFileId && clip.source?.videoElement) {
          clip.source.videoElement.muted = true;
          if (!clip.source.videoElement.paused) {
            clip.source.videoElement.pause();
          }
        }
      });
    }
  },

  getNextFileNeedingProxy: () => {
    const { files, currentlyGeneratingProxyId } = get();
    return files.find(
      (f) =>
        f.type === 'video' &&
        f.file &&
        f.proxyStatus !== 'generating' &&
        f.proxyStatus !== 'error' &&
        f.id !== currentlyGeneratingProxyId &&
        (f.proxyStatus !== 'ready' || !isProxyComplete(f))
    );
  },

  generateProxy: async (mediaFileId: string, options: { force?: boolean } = {}) => {
    const { files, currentlyGeneratingProxyId } = get();

    if (currentlyGeneratingProxyId) {
      log.debug('Already generating, queuing:', mediaFileId);
      return;
    }

    const mediaFile = files.find((f) => f.id === mediaFileId);
    if (!mediaFile || mediaFile.type !== 'video' || !mediaFile.file) {
      log.warn('Invalid media file:', mediaFileId);
      return;
    }

    if (!projectFileService.isProjectOpen()) {
      log.error('No project open!');
      return;
    }

    set({ currentlyGeneratingProxyId: mediaFileId });
    log.info(`Starting generation for ${mediaFile.name}...`);

    const storageKey = mediaFile.fileHash || mediaFileId;
    const proxyFps = getExpectedProxyFps(mediaFile.proxyFps ?? mediaFile.fps);
    let controller: { cancelled: boolean } | null = null;
    try {
      if (options.force) {
        await projectFileService.deleteEntry('PROXY', storageKey, { recursive: true });
      }

      const hasExistingProxyVideo = !options.force && await projectFileService.hasProxyVideo(storageKey);
      if (hasExistingProxyVideo && isProxyComplete(mediaFile, getExpectedProxyFrameCount(mediaFile.duration, proxyFps) ?? undefined)) {
        const frameCount = getExpectedProxyFrameCount(mediaFile.duration, proxyFps) ?? mediaFile.proxyFrameCount;
        log.debug('Already complete:', mediaFile.name);
        set((s) => ({
          files: s.files.map((f) =>
            f.id === mediaFileId
              ? {
                  ...f,
                  proxyStatus: 'ready' as ProxyStatus,
                  proxyProgress: 100,
                  proxyFrameCount: frameCount,
                  proxyFps,
                  proxyFormat: 'mp4-all-intra' as const,
                }
              : f
          ),
        }));
        return;
      }

      // Set up cancellation
      controller = { cancelled: false };
      activeProxyGenerations.set(mediaFileId, controller);

      // Inline setProxyStatus and updateProxyProgress
      set((state) => ({
        files: state.files.map((f) =>
          f.id === mediaFileId
            ? {
                ...f,
                proxyStatus: 'generating' as ProxyStatus,
                proxyProgress: 0,
                proxyFps,
                proxyFormat: 'mp4-all-intra' as const,
              }
            : f
        ),
      }));

      // Progress updater function
      const updateProgress = (progress: number) => {
        set((state) => ({
          files: state.files.map((f) =>
            f.id === mediaFileId ? { ...f, proxyProgress: progress } : f
          ),
        }));
      };

      // Generate video proxy
      const result = await generateVideoProxy(
        mediaFile,
        storageKey,
        controller,
        updateProgress
      );

      if (result && !controller.cancelled) {
        const resultComplete = isProxyFrameCountComplete(result.frameCount, mediaFile.duration, result.fps);
        if (!result || !resultComplete) {
          log.error('Generation incomplete:', {
            name: mediaFile.name,
            frameCount: result?.frameCount ?? 0,
            expected: getExpectedProxyFrameCount(mediaFile.duration, result?.fps ?? proxyFps),
            fps: result?.fps ?? proxyFps,
          });
          set((state) => ({
            files: state.files.map((f) =>
              f.id === mediaFileId ? { ...f, proxyStatus: 'error' as ProxyStatus } : f
            ),
          }));
          return;
        }

        const completeResult = result;

        // Update status to 'ready' IMMEDIATELY after frames complete
        // Don't wait for audio extraction - it's optional and can happen in background
        set((s) => ({
          files: s.files.map((f) =>
            f.id === mediaFileId
              ? {
                  ...f,
                  proxyStatus: 'ready' as ProxyStatus,
                  proxyProgress: 100,
                  proxyFrameCount: completeResult.frameCount,
                  proxyFps: completeResult.fps,
                  proxyFormat: 'mp4-all-intra' as const,
                }
              : f
          ),
        }));

        log.info(`Complete: ${completeResult.frameCount} all-intra MP4 proxy frames for ${mediaFile.name}`);

        // Extract audio proxy in background (non-blocking)
        if (mediaFile.hasAudio === true || mediaFile.audioCodec) {
          set((s) => ({
            files: s.files.map((f) =>
              f.id === mediaFileId
                ? {
                    ...f,
                    audioProxyStatus: 'generating' as ProxyStatus,
                    audioProxyProgress: 2,
                    audioProxyStorageKey: storageKey,
                  }
                : f
            ),
          }));
          extractAudioProxy(mediaFile, storageKey).then(async () => {
            const hasAudioProxy = await projectFileService.hasProxyAudio(storageKey);
            if (hasAudioProxy) {
              set((s) => ({
                files: s.files.map((f) =>
                  f.id === mediaFileId
                    ? {
                        ...f,
                        hasProxyAudio: true,
                        audioProxyStatus: 'ready' as ProxyStatus,
                        audioProxyProgress: 100,
                        audioProxyStorageKey: storageKey,
                      }
                    : f
                ),
              }));
              log.debug(`Audio proxy ready for ${mediaFile.name}`);
            } else {
              set((s) => ({
                files: s.files.map((f) =>
                  f.id === mediaFileId
                    ? {
                        ...f,
                        audioProxyStatus: 'none' as ProxyStatus,
                        audioProxyProgress: 0,
                        audioProxyStorageKey: storageKey,
                      }
                    : f
                ),
              }));
            }
          }).catch(() => {
            // Audio extraction errors are non-fatal
            set((s) => ({
              files: s.files.map((f) =>
                f.id === mediaFileId
                  ? {
                      ...f,
                      audioProxyStatus: 'error' as ProxyStatus,
                      audioProxyProgress: 0,
                      audioProxyStorageKey: storageKey,
                    }
                  : f
              ),
            }));
          });
        } else {
          log.debug(`Skipping audio proxy for ${mediaFile.name}: no audio track detected`);
        }
      } else if (!controller.cancelled) {
        // Set error status inline
        set((state) => ({
          files: state.files.map((f) =>
            f.id === mediaFileId ? { ...f, proxyStatus: 'error' as ProxyStatus } : f
          ),
        }));
      }
    } catch (e) {
      log.error('Generation failed:', e);
      set((state) => ({
        files: state.files.map((f) =>
          f.id === mediaFileId ? { ...f, proxyStatus: 'error' as ProxyStatus } : f
        ),
      }));
    } finally {
      activeProxyGenerations.delete(mediaFileId);
      set({ currentlyGeneratingProxyId: null });
      queueMicrotask(() => {
        (get() as MediaState & ProxyActions).startProxyGenerationQueue();
      });
    }
  },

  cancelProxyGeneration: (mediaFileId: string) => {
    const controller = activeProxyGenerations.get(mediaFileId);
    if (controller) {
      controller.cancelled = true;
      log.info('Cancelled:', mediaFileId);
    }

    const { currentlyGeneratingProxyId, files } = get();
    if (currentlyGeneratingProxyId === mediaFileId) {
      const mediaFile = files.find((f) => f.id === mediaFileId);
      const hasCompleteProxy = mediaFile ? isProxyComplete(mediaFile) : false;

      set((state) => ({
        currentlyGeneratingProxyId: null,
        files: state.files.map((f) =>
          f.id === mediaFileId
            ? {
                ...f,
                proxyStatus: (hasCompleteProxy ? 'ready' : 'none') as ProxyStatus,
                proxyProgress: hasCompleteProxy ? 100 : 0,
                proxyFps: hasCompleteProxy ? f.proxyFps : undefined,
                proxyFormat: hasCompleteProxy ? f.proxyFormat : undefined,
              }
            : f
        ),
      }));
    }
  },

  generateAudioProxy: async (mediaFileId: string, options: { force?: boolean } = {}) => {
    const mediaFile = get().files.find((f) => f.id === mediaFileId);
    if (!mediaFile) {
      log.warn('Invalid media file:', mediaFileId);
      return;
    }

    const { ensureAudioProxyForMediaFile, getAudioProxyStorageKey, shouldGenerateAudioProxy } =
      await import('../../../services/audio/AudioProxyService');

    if (!shouldGenerateAudioProxy(mediaFile)) {
      log.debug('Skipping audio proxy generation; source has no audio', {
        id: mediaFile.id,
        name: mediaFile.name,
      });
      return;
    }

    const storageKey = getAudioProxyStorageKey(mediaFile);

    try {
      await ensureAudioProxyForMediaFile(
        {
          ...mediaFile,
          audioProxyStorageKey: storageKey,
        },
        {
          force: options.force,
          onUpdate: (update) => {
            set((state) => ({
              files: state.files.map((file) => {
                if (file.id !== mediaFileId) return file;

                const nextUrl = update.url ?? file.audioProxyUrl;
                if (
                  update.url &&
                  file.audioProxyUrl &&
                  file.audioProxyUrl !== update.url &&
                  file.audioProxyUrl.startsWith('blob:')
                ) {
                  URL.revokeObjectURL(file.audioProxyUrl);
                }

                return {
                  ...file,
                  audioProxyStatus: update.status,
                  audioProxyProgress: update.progress,
                  audioProxyStorageKey: update.storageKey,
                  audioProxyUrl: nextUrl,
                  hasProxyAudio: update.status === 'ready'
                    ? true
                    : update.status === 'none'
                      ? false
                      : file.hasProxyAudio,
                };
              }),
            }));
          },
        },
      );
    } catch (error) {
      log.warn('Audio proxy generation failed:', error);
      set((state) => ({
        files: state.files.map((file) =>
          file.id === mediaFileId
            ? {
                ...file,
                audioProxyStatus: 'error' as ProxyStatus,
                audioProxyProgress: 0,
                audioProxyStorageKey: storageKey,
              }
            : file
        ),
      }));
    }
  },
});

async function generateVideoProxy(
  mediaFile: MediaFile,
  storageKey: string,
  controller: { cancelled: boolean },
  updateProgress: (progress: number) => void
): Promise<{ frameCount: number; fps: number } | null> {
  const { getProxyGenerator } = await import('../../../services/proxyGenerator');
  const generator = getProxyGenerator();

  const result = await generator.generateAllIntraVideo(
    mediaFile.file!,
    mediaFile.id,
    updateProgress,
    () => controller.cancelled
  );
  if (!result) return null;

  const saved = await projectFileService.saveProxyVideo(storageKey, result.blob);
  if (!saved) {
    throw new Error('Failed to save all-intra MP4 proxy');
  }

  return {
    frameCount: result.frameCount,
    fps: result.fps,
  };
}

async function extractAudioProxy(
  mediaFile: MediaFile,
  storageKey: string
): Promise<void> {
  try {
    log.debug('Preparing WAV audio proxy...');
    const { ensureAudioProxyForMediaFile } = await import('../../../services/audio/AudioProxyService');
    await ensureAudioProxyForMediaFile({
      ...mediaFile,
      audioProxyStorageKey: storageKey,
    });
  } catch (e) {
    log.warn('Audio extraction failed (non-fatal):', e);
  }
}
