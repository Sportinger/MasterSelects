// Proxy generation slice

import type { MediaFile, MediaSliceCreator, ProxyStatus } from '../types';
import {
  getExpectedProxyFps,
  getExpectedProxyFrameCount,
  getProxyProgressFromFrameCount,
  getProxyProgressFromFrameIndices,
  isProxyFrameCountComplete,
  isProxyFrameIndexSetComplete,
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
  generateProxy: (mediaFileId: string) => Promise<void>;
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
    }
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

  generateProxy: async (mediaFileId: string) => {
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

    // Check existing frames on disk
    const storageKey = mediaFile.fileHash || mediaFileId;
    const proxyFps = getExpectedProxyFps(mediaFile.proxyFps ?? mediaFile.fps);
    let controller: { cancelled: boolean } | null = null;
    try {
      const existingIndices = await projectFileService.getProxyFrameIndices(storageKey);
      const existingCount = existingIndices.size;
      if (existingCount > 0 && isProxyFrameIndexSetComplete(existingIndices, mediaFile.duration, proxyFps)) {
        log.debug('Already complete:', mediaFile.name);
        set((s) => ({
          files: s.files.map((f) =>
            f.id === mediaFileId
              ? {
                  ...f,
                  proxyStatus: 'ready' as ProxyStatus,
                  proxyProgress: 100,
                  proxyFrameCount: existingCount,
                  proxyFps,
                }
              : f
          ),
        }));
        return;
      }

      // Log resume info if partial proxy exists
      if (existingCount > 0) {
        const expectedFrames = getExpectedProxyFrameCount(mediaFile.duration, proxyFps) ?? 0;
        log.info(`Resuming proxy for ${mediaFile.name}: ${existingCount}/${expectedFrames} frames on disk`);
      }

      // Set up cancellation
      controller = { cancelled: false };
      activeProxyGenerations.set(mediaFileId, controller);

      // Calculate initial progress for resume
      const initialProgress = existingCount > 0 && mediaFile.duration
        ? getProxyProgressFromFrameIndices(existingIndices, mediaFile.duration, proxyFps)
        : 0;

      // Inline setProxyStatus and updateProxyProgress
      set((state) => ({
        files: state.files.map((f) =>
          f.id === mediaFileId
            ? { ...f, proxyStatus: 'generating' as ProxyStatus, proxyProgress: initialProgress, proxyFps }
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
      let result = await generateVideoProxy(
        mediaFile,
        storageKey,
        controller,
        updateProgress,
        existingIndices
      );

      if (result && !controller.cancelled) {
        let resultComplete = isProxyFrameIndexSetComplete(result.frameIndices, mediaFile.duration, result.fps);
        if (!resultComplete && existingIndices.size > 0) {
          log.warn('Resume produced an incomplete proxy; rebuilding from source frames', {
            name: mediaFile.name,
            frameCount: result.frameCount,
            expected: getExpectedProxyFrameCount(mediaFile.duration, result.fps),
            fps: result.fps,
          });

          updateProgress(0);
          result = await generateVideoProxy(
            mediaFile,
            storageKey,
            controller,
            updateProgress,
            new Set<number>()
          );
          resultComplete = !!result && isProxyFrameIndexSetComplete(result.frameIndices, mediaFile.duration, result.fps);
        }

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
                }
              : f
          ),
        }));

        log.info(`Complete: ${completeResult.frameCount} frames for ${mediaFile.name}`);

        // Extract audio proxy in background (non-blocking)
        if (mediaFile.hasAudio === true || mediaFile.audioCodec) {
          extractAudioProxy(mediaFile, storageKey).then(async () => {
            const hasAudioProxy = await projectFileService.hasProxyAudio(storageKey);
            if (hasAudioProxy) {
              set((s) => ({
                files: s.files.map((f) =>
                  f.id === mediaFileId ? { ...f, hasProxyAudio: true } : f
                ),
              }));
              log.debug(`Audio proxy ready for ${mediaFile.name}`);
            }
          }).catch(() => {
            // Audio extraction errors are non-fatal
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
                proxyProgress: hasCompleteProxy ? 100 : getProxyProgressFromFrameCount(f.proxyFrameCount, f.duration, f.proxyFps ?? f.fps),
                proxyFps: hasCompleteProxy ? f.proxyFps : undefined,
              }
            : f
        ),
      }));
    }
  },
});

async function generateVideoProxy(
  mediaFile: MediaFile,
  storageKey: string,
  controller: { cancelled: boolean },
  updateProgress: (progress: number) => void,
  existingIndices: Set<number>
): Promise<{ frameCount: number; fps: number; frameIndices: Set<number> } | null> {
  const { getProxyGenerator } = await import('../../../services/proxyGenerator');
  const generator = getProxyGenerator();

  const saveFrame = async (frame: { frameIndex: number; blob: Blob }) => {
    await projectFileService.saveProxyFrame(storageKey, frame.frameIndex, frame.blob);
  };

  return generator.generate(
    mediaFile.file!,
    mediaFile.id,
    updateProgress,
    () => controller.cancelled,
    saveFrame,
    existingIndices.size > 0 ? existingIndices : undefined
  );
}

async function extractAudioProxy(
  mediaFile: MediaFile,
  storageKey: string
): Promise<void> {
  try {
    log.debug('Extracting audio...');
    const { extractAudioFromVideo } = await import('../../../services/audioExtractor');

    const result = await extractAudioFromVideo(mediaFile.file!, () => {});
    if (result && result.blob && result.blob.size > 0) {
      await projectFileService.saveProxyAudio(storageKey, result.blob);
      log.debug(`Audio saved (${(result.blob.size / 1024).toFixed(1)}KB)`);
    }
  } catch (e) {
    log.warn('Audio extraction failed (non-fatal):', e);
  }
}
