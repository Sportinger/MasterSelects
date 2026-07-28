import { Logger } from '../../../../services/logger';
import { isCurrentSceneCutAnalysis } from '../../../../services/sceneCutDetection/sceneCutDetector';
import type { SceneCutAnalysis } from '../../../../types/sceneCutAnalysis';
import type { MediaFile, MediaState } from '../../types';
import {
  activeProxyGenerations,
  type ProxyJobController,
} from './jobRegistry';

const log = Logger.create('SceneCuts');

type MediaStoreSet = (
  partial: Partial<MediaState> | ((state: MediaState) => Partial<MediaState>),
) => void;

interface SceneCutQueueActions {
  startProxyGenerationQueue: () => void;
}

export function createSceneCutAnalysisAction(
  set: MediaStoreSet,
  get: () => MediaState,
): (mediaFileId: string, options?: { force?: boolean }) => Promise<void> {
  return async (mediaFileId, options = {}) => {
    const { files, currentlyGeneratingProxyId } = get();
    if (currentlyGeneratingProxyId) {
      log.debug('Another proxy or scene-cut job is already active:', currentlyGeneratingProxyId);
      return;
    }

    const mediaFile = files.find((file) => file.id === mediaFileId);
    if (!mediaFile || mediaFile.type !== 'video' || !mediaFile.file) {
      log.warn('Scene-cut analysis requires an available video source:', mediaFileId);
      return;
    }
    if (
      !options.force &&
      isCurrentSceneCutAnalysis(mediaFile.sceneCutAnalysis, mediaFile.file)
    ) {
      return;
    }

    const controller: ProxyJobController = {
      cancelled: false,
      kind: 'scene-cuts',
    };
    activeProxyGenerations.set(mediaFileId, controller);
    set((state) => ({
      currentlyGeneratingProxyId: mediaFileId,
      files: state.files.map((file) =>
        file.id === mediaFileId
          ? {
              ...file,
              sceneCutStatus: 'analyzing' as const,
              sceneCutProgress: 0,
            }
          : file
      ),
    }));

    try {
      const result = await scanSourceSceneCuts(
        mediaFile,
        controller,
        (progress) => {
          set((state) => ({
            files: state.files.map((file) =>
              file.id === mediaFileId
                ? { ...file, sceneCutProgress: progress }
                : file
            ),
          }));
        },
      );

      if (result?.sceneCutAnalysis && !controller.cancelled) {
        set((state) => ({
          files: state.files.map((file) =>
            file.id === mediaFileId
              ? {
                  ...file,
                  sceneCutStatus: 'ready' as const,
                  sceneCutProgress: 100,
                  sceneCutAnalysis: result.sceneCutAnalysis,
                }
              : file
          ),
        }));
        log.info(`Found ${result.sceneCutAnalysis.cuts.length} scene cuts in ${mediaFile.name}`);
      } else if (!controller.cancelled) {
        set((state) => ({
          files: state.files.map((file) =>
            file.id === mediaFileId
              ? {
                  ...file,
                  sceneCutStatus: 'error' as const,
                  sceneCutProgress: 0,
                }
              : file
          ),
        }));
        if (result?.sceneCutError) {
          log.warn(`Scene-cut analysis failed for ${mediaFile.name}: ${result.sceneCutError}`);
        }
      }
    } catch (error) {
      if (controller.cancelled) return;
      log.warn(`Scene-cut analysis failed for ${mediaFile.name}`, error);
      set((state) => ({
        files: state.files.map((file) =>
          file.id === mediaFileId
            ? {
                ...file,
                sceneCutStatus: 'error' as const,
                sceneCutProgress: 0,
              }
            : file
        ),
      }));
    } finally {
      if (activeProxyGenerations.get(mediaFileId) === controller) {
        activeProxyGenerations.delete(mediaFileId);
        if (get().currentlyGeneratingProxyId === mediaFileId) {
          set({ currentlyGeneratingProxyId: null });
        }
        queueMicrotask(() => {
          (get() as MediaState & SceneCutQueueActions).startProxyGenerationQueue();
        });
      }
    }
  };
}

async function scanSourceSceneCuts(
  mediaFile: MediaFile,
  controller: ProxyJobController,
  updateProgress: (progress: number) => void,
): Promise<{
  sceneCutAnalysis?: SceneCutAnalysis;
  sceneCutError?: string;
} | null> {
  const { getProxyGenerator } = await import('../../../../services/proxyGenerator');
  return getProxyGenerator().generate(
    mediaFile.file!,
    mediaFile.id,
    () => {},
    () => controller.cancelled,
    async () => {
      throw new Error('Scene-cut-only scan attempted to write a proxy frame.');
    },
    undefined,
    {
      analyzeSceneCuts: true,
      sceneCutsOnly: true,
      onSceneCutProgress: updateProgress,
    },
  );
}
