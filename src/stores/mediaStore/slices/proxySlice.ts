// Proxy generation slice

import type { MediaFile, MediaSliceCreator, MediaState, ProxyStatus } from '../types';
import {
  getExpectedProxyFps,
  getExpectedProxyFrameCount,
  getProxyProgressFromFrameIndices,
  isProxyFrameCountComplete,
  isProxyFrameIndexSetComplete,
} from '../helpers/proxyCompleteness';
import { projectFileService } from '../../../services/projectFileService';
import { useTimelineStore } from '../../timeline';
import { Logger } from '../../../services/logger';
import { isCurrentSceneCutAnalysis } from '../../../services/sceneCutDetection/sceneCutDetector';
import type { SceneCutAnalysis } from '../../../types/sceneCutAnalysis';
import { createSceneCutAnalysisAction } from './proxy/sceneCutActions';
import {
  activeProxyGenerations,
  type ProxyJobController,
} from './proxy/jobRegistry';

const log = Logger.create('Proxy');

/** Check if a proxy is complete (>= 98% of expected frames) */
function isProxyComplete(file: MediaFile, frameCountOverride?: number): boolean {
  if (file.proxyFormat === 'mp4-all-intra') return false;
  return isProxyFrameCountComplete(frameCountOverride ?? file.proxyFrameCount, file.duration, file.proxyFps ?? file.fps);
}

export interface ProxyActions {
  proxyEnabled: boolean;
  setProxyEnabled: (enabled: boolean) => void;
  toggleProxyEnabled: () => void;
  startProxyGenerationQueue: () => void;
  generateProxy: (
    mediaFileId: string,
    options?: { force?: boolean },
  ) => Promise<void>;
  analyzeSceneCuts: (mediaFileId: string, options?: { force?: boolean }) => Promise<void>;
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

  generateProxy: async (
    mediaFileId: string,
    options: { force?: boolean } = {},
  ) => {
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

    const controller: ProxyJobController = {
      cancelled: false,
      kind: 'proxy',
    };
    activeProxyGenerations.set(mediaFileId, controller);
    set({ currentlyGeneratingProxyId: mediaFileId });
    log.info(`Starting generation for ${mediaFile.name}...`);

    const storageKey = mediaFile.fileHash || mediaFileId;
    const proxyFps = getExpectedProxyFps(mediaFile.proxyFps ?? mediaFile.fps);
    const shouldAnalyzeSceneCuts =
      options.force === true ||
      !isCurrentSceneCutAnalysis(mediaFile.sceneCutAnalysis, mediaFile.file);
    try {
      if (options.force) {
        await projectFileService.deleteEntry('PROXY', storageKey, { recursive: true });
      }

      const existingFrameIndices = options.force
        ? new Set<number>()
        : await projectFileService.getProxyFrameIndices(storageKey);
      if (controller.cancelled) return;
      if (
        !options.force &&
        isProxyFrameIndexSetComplete(existingFrameIndices, mediaFile.duration, proxyFps)
      ) {
        const frameCount = existingFrameIndices.size;
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
                  proxyFormat: 'jpeg-sequence' as const,
                  sceneCutStatus: isCurrentSceneCutAnalysis(f.sceneCutAnalysis, f.file)
                    ? 'ready' as const
                    : f.sceneCutStatus,
                  sceneCutProgress: isCurrentSceneCutAnalysis(f.sceneCutAnalysis, f.file)
                    ? 100
                    : f.sceneCutProgress,
                }
              : f
          ),
        }));
        return;
      }

      // Inline setProxyStatus and updateProxyProgress
      set((state) => ({
        files: state.files.map((f) =>
          f.id === mediaFileId
            ? {
                ...f,
                proxyStatus: 'generating' as ProxyStatus,
                proxyProgress: getProxyProgressFromFrameIndices(existingFrameIndices, mediaFile.duration, proxyFps),
                proxyFps,
                proxyFormat: 'jpeg-sequence' as const,
                sceneCutStatus: shouldAnalyzeSceneCuts ? 'analyzing' as const : f.sceneCutStatus,
                sceneCutProgress: shouldAnalyzeSceneCuts ? 0 : f.sceneCutProgress,
              }
            : f
        ),
      }));

      // Progress updater function
      const updateProgress = (progress: number) => {
        set((state) => ({
          files: state.files.map((f) =>
            f.id === mediaFileId
              ? {
                  ...f,
                  proxyProgress: progress,
                }
              : f
          ),
        }));
      };

      // Generate JPEG image sequence proxy
      const result = await generateImageProxy(
        mediaFile,
        storageKey,
        controller,
        updateProgress,
        existingFrameIndices,
        shouldAnalyzeSceneCuts,
        (progress) => {
          if (!shouldAnalyzeSceneCuts) return;
          set((state) => ({
            files: state.files.map((file) =>
              file.id === mediaFileId
                ? { ...file, sceneCutProgress: progress }
                : file
            ),
          }));
        },
      );

      if (result && !controller.cancelled) {
        if (shouldAnalyzeSceneCuts) {
          set((state) => ({
            files: state.files.map((file) => {
              if (file.id !== mediaFileId) return file;
              if (result.sceneCutAnalysis) {
                return {
                  ...file,
                  sceneCutStatus: 'ready' as const,
                  sceneCutProgress: 100,
                  sceneCutAnalysis: result.sceneCutAnalysis,
                };
              }
              return {
                ...file,
                sceneCutStatus: 'error' as const,
                sceneCutProgress: 0,
              };
            }),
          }));
          if (result.sceneCutError) {
            log.warn(`Scene-cut analysis failed for ${mediaFile.name}: ${result.sceneCutError}`);
          }
        }

        const resultComplete = isProxyFrameIndexSetComplete(result.frameIndices, mediaFile.duration, result.fps);
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
                  proxyFormat: 'jpeg-sequence' as const,
                  sceneCutStatus: completeResult.sceneCutAnalysis
                    ? 'ready' as const
                    : f.sceneCutStatus,
                  sceneCutProgress: completeResult.sceneCutAnalysis
                    ? 100
                    : f.sceneCutProgress,
                  sceneCutAnalysis: completeResult.sceneCutAnalysis ?? f.sceneCutAnalysis,
                }
              : f
          ),
        }));

        log.info(`Complete: ${completeResult.frameCount} JPEG proxy frames for ${mediaFile.name}`);

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
      if (controller.cancelled) return;
      log.error('Generation failed:', e);
      set((state) => ({
        files: state.files.map((f) =>
          f.id === mediaFileId
            ? {
                ...f,
                proxyStatus: 'error' as ProxyStatus,
                sceneCutStatus: shouldAnalyzeSceneCuts ? 'error' as const : f.sceneCutStatus,
                sceneCutProgress: shouldAnalyzeSceneCuts ? 0 : f.sceneCutProgress,
              }
            : f
        ),
      }));
    } finally {
      if (activeProxyGenerations.get(mediaFileId) === controller) {
        activeProxyGenerations.delete(mediaFileId);
        if (get().currentlyGeneratingProxyId === mediaFileId) {
          set({ currentlyGeneratingProxyId: null });
        }
        queueMicrotask(() => {
          (get() as MediaState & ProxyActions).startProxyGenerationQueue();
        });
      }
    }
  },

  cancelProxyGeneration: (mediaFileId: string) => {
    const controller = activeProxyGenerations.get(mediaFileId);
    if (!controller) return;

    controller.cancelled = true;
    log.info('Cancelled:', mediaFileId);

    set((state) => ({
      files: state.files.map((file) => {
        if (file.id !== mediaFileId) return file;
        const hasCurrentSceneCuts = isCurrentSceneCutAnalysis(
          file.sceneCutAnalysis,
          file.file,
        );
        if (controller.kind === 'scene-cuts') {
          return {
            ...file,
            sceneCutStatus: hasCurrentSceneCuts ? 'ready' as const : 'none' as const,
            sceneCutProgress: hasCurrentSceneCuts ? 100 : 0,
          };
        }

        const hasCompleteProxy = isProxyComplete(file);
        return {
          ...file,
          proxyStatus: (hasCompleteProxy ? 'ready' : 'none') as ProxyStatus,
          proxyProgress: hasCompleteProxy ? 100 : 0,
          proxyFps: hasCompleteProxy ? file.proxyFps : undefined,
          proxyFormat: hasCompleteProxy ? file.proxyFormat : undefined,
          sceneCutStatus: hasCurrentSceneCuts ? 'ready' as const : 'none' as const,
          sceneCutProgress: hasCurrentSceneCuts ? 100 : 0,
        };
      }),
    }));
  },

  analyzeSceneCuts: createSceneCutAnalysisAction(set, get),

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

async function generateImageProxy(
  mediaFile: MediaFile,
  storageKey: string,
  controller: { cancelled: boolean },
  updateProgress: (progress: number) => void,
  existingFrameIndices: Set<number>,
  analyzeSceneCuts: boolean,
  updateSceneCutProgress: (progress: number) => void,
): Promise<{
  frameCount: number;
  fps: number;
  frameIndices: Set<number>;
  sceneCutAnalysis?: SceneCutAnalysis;
  sceneCutError?: string;
} | null> {
  const { getProxyGenerator } = await import('../../../services/proxyGenerator');
  const generator = getProxyGenerator();
  const writer = await projectFileService.createProxyFrameWriter(storageKey);
  if (!writer) {
    throw new Error('Failed to create JPEG proxy frame writer');
  }

  const result = await generator.generate(
    mediaFile.file!,
    mediaFile.id,
    updateProgress,
    () => controller.cancelled,
    async (frame) => {
      const saved = await writer.saveFrame(frame.frameIndex, frame.blob);
      if (!saved) {
        throw new Error(`Failed to save JPEG proxy frame ${frame.frameIndex}`);
      }
    },
    existingFrameIndices,
    {
      analyzeSceneCuts,
      onSceneCutProgress: updateSceneCutProgress,
    },
  ).finally(async () => {
    try {
      await writer.close?.();
    } catch (error) {
      log.warn('Failed to close JPEG proxy frame writer:', error);
    }
  });
  if (!result) return null;

  return {
    frameCount: result.frameIndices.size,
    fps: result.fps,
    frameIndices: result.frameIndices,
    sceneCutAnalysis: result.sceneCutAnalysis,
    sceneCutError: result.sceneCutError,
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
