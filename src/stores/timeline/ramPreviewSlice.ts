// RAM Preview actions slice

import type { RamPreviewActions, SliceCreator } from './types';
import { RAM_PREVIEW_FPS } from './constants';
import { quantizeTime } from './utils';
import { Logger } from '../../services/logger';
import { RamPreviewEngine } from '../../services/ramPreviewEngine';
import {
  canRetainRamPreviewRunJob,
  createRamPreviewRunId,
  releaseRamPreviewRunResources,
  reportRamPreviewRunJob,
} from '../../services/timeline/ramPreviewRuntimeReporting';
import { renderHostPort } from '../../services/render/renderHostPort';
import { useMediaStore } from '../mediaStore';

const log = Logger.create('RamPreviewSlice');

type RangeGenerationActivity = 'ram-preview' | 'clip-video-bake';

interface RangeGenerationOptions {
  publishRamPreviewRange?: boolean;
  activity?: RangeGenerationActivity;
}

export interface RamPreviewGenerationErrorInfo {
  message: string;
  stack?: string;
}

let lastRamPreviewGenerationError: RamPreviewGenerationErrorInfo | null = null;

function captureRamPreviewGenerationError(error: unknown): RamPreviewGenerationErrorInfo {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
    };
  }
  return {
    message: String(error),
  };
}

export function getLastRamPreviewGenerationError(): RamPreviewGenerationErrorInfo | null {
  return lastRamPreviewGenerationError;
}

export const createRamPreviewSlice: SliceCreator<RamPreviewActions> = (set, get) => {
  const generateRange = async (
    start: number,
    end: number,
    centerTime: number,
    label: string,
    options: RangeGenerationOptions = {},
  ): Promise<boolean> => {
    const {
      clips,
      tracks,
      isRamPreviewing,
      isClipVideoBakeRendering,
      addCachedFrame,
    } = get();
    if (isRamPreviewing || isClipVideoBakeRendering) return false;

    const isClipVideoBake = options.activity === 'clip-video-bake';
    const activityLabel = isClipVideoBake ? 'Clip video bake render' : 'RAM preview';

    const rangeStart = Math.max(0, Math.min(start, end));
    const rangeEnd = Math.max(rangeStart, Math.max(start, end));
    if (rangeEnd <= rangeStart) return false;

    log.debug(`${label} starting generation`, {
      start: rangeStart.toFixed(3),
      end: rangeEnd.toFixed(3),
    });
    lastRamPreviewGenerationError = null;

    let completed = false;
    const runId = createRamPreviewRunId();
    const runJobReport = {
      runId,
      start: rangeStart,
      end: rangeEnd,
      centerTime: Math.max(rangeStart, Math.min(rangeEnd, centerTime)),
      label,
      startedAtMs: Date.now(),
    };
    const admission = canRetainRamPreviewRunJob(runJobReport);
    if (!admission.admitted) {
      lastRamPreviewGenerationError = {
        message: `${activityLabel} skipped by runtime admission: ${admission.reason ?? 'not admitted'}`,
      };
      return false;
    }

    renderHostPort.setGeneratingRamPreview(true);
    set(isClipVideoBake
      ? { isClipVideoBakeRendering: true, clipVideoBakeProgress: 0 }
      : { isRamPreviewing: true, ramPreviewProgress: 0, ramPreviewRange: null });
    reportRamPreviewRunJob(runJobReport);

    try {
      const mediaState = useMediaStore.getState();
      const preview = new RamPreviewEngine(renderHostPort.getRamPreviewRenderEngine());
      const result = await preview.generate(
        {
          compositionId: mediaState.activeCompositionId ?? 'timeline:active',
          start: rangeStart,
          end: rangeEnd,
          centerTime: Math.max(rangeStart, Math.min(rangeEnd, centerTime)),
          clips,
          tracks,
          runId,
        },
        {
          isCancelled: () => {
            const cancelled = isClipVideoBake
              ? !get().isClipVideoBakeRendering
              : !get().isRamPreviewing;
            if (cancelled && !lastRamPreviewGenerationError) {
              lastRamPreviewGenerationError = {
                message: `${activityLabel} was cancelled because its render state became false`,
              };
            }
            return cancelled;
          },
          isFrameCached: (qt) => get().cachedFrameTimes.has(qt),
          getSourceTimeForClip: (id, t) => get().getSourceTimeForClip(id, t),
          getInterpolatedSpeed: (id, t) => get().getInterpolatedSpeed(id, t),
          getCompositionDimensions: (compId) => {
            const comp = mediaState.compositions.find(c => c.id === compId);
            return { width: comp?.width || 1920, height: comp?.height || 1080 };
          },
          onFrameCached: (time) => addCachedFrame(time),
          onProgress: (percent) => set(isClipVideoBake
            ? { clipVideoBakeProgress: percent }
            : { ramPreviewProgress: percent }),
        }
      );

      completed = result.completed;
      if (completed) {
        if (isClipVideoBake) {
          set({ clipVideoBakeProgress: null });
        } else {
          set({
            ...(options.publishRamPreviewRange === false
              ? {}
              : { ramPreviewRange: { start: rangeStart, end: rangeEnd } }),
            ramPreviewProgress: null,
          });
        }
        log.debug(`${label} complete`, {
          totalFrames: result.frameCount,
          start: rangeStart.toFixed(1),
          end: rangeEnd.toFixed(1),
        });
      } else {
        log.debug(`${label} cancelled`);
      }
    } catch (error) {
      lastRamPreviewGenerationError = captureRamPreviewGenerationError(error);
      log.error(`${label} error`, error);
      completed = false;
    } finally {
      renderHostPort.setGeneratingRamPreview(false);
      releaseRamPreviewRunResources(runId);
      set(isClipVideoBake
        ? { isClipVideoBakeRendering: false, clipVideoBakeProgress: null }
        : { isRamPreviewing: false, ramPreviewProgress: null });
    }

    return completed;
  };

  return {
  toggleRamPreviewEnabled: () => {
    const { ramPreviewEnabled, isClipVideoBakeRendering } = get();
    if (ramPreviewEnabled) {
      // Turning OFF - cancel any running preview and clear cache
      set({ ramPreviewEnabled: false, isRamPreviewing: false, ramPreviewProgress: null });
      if (!isClipVideoBakeRendering) {
        renderHostPort.setGeneratingRamPreview(false);
        renderHostPort.clearCompositeCache();
        set({ ramPreviewRange: null, cachedFrameTimes: new Set() });
      } else {
        set({ ramPreviewRange: null });
      }
    } else {
      // Turning ON - enable automatic RAM preview
      set({ ramPreviewEnabled: true });
    }
  },

  startRamPreview: async () => {
    const { inPoint, outPoint, duration, clips, playheadPosition, ramPreviewEnabled } = get();
    if (!ramPreviewEnabled) return;

    const start = inPoint ?? 0;
    const end = outPoint ?? (clips.length > 0
      ? Math.max(...clips.map(c => c.startTime + c.duration))
      : duration);
    if (end <= start) return;

    await generateRange(start, end, playheadPosition, 'RAM Preview');
  },

  startRamPreviewForRange: async (start, end, options = {}) => {
    return generateRange(
      start,
      end,
      options.centerTime ?? (start + end) / 2,
      options.label ?? 'RAM Preview range',
    );
  },

  startClipVideoBakeRenderRange: async (start, end, options = {}) => {
    return generateRange(
      start,
      end,
      options.centerTime ?? (start + end) / 2,
      options.label ?? 'Clip video bake render range',
      { activity: 'clip-video-bake', publishRamPreviewRange: false },
    );
  },

  cancelRamPreview: () => {
    // IMMEDIATELY set state to cancel the loop - this must be synchronous!
    // The RAM preview loop checks !get().isRamPreviewing to know when to stop
    set({ isRamPreviewing: false, ramPreviewProgress: null });
    // Then async cleanup the engine
    if (!get().isClipVideoBakeRendering) {
      renderHostPort.setGeneratingRamPreview(false);
    }
  },

  clearRamPreview: async () => {
    const { isClipVideoBakeRendering } = get();
    if (!isClipVideoBakeRendering) {
      renderHostPort.setGeneratingRamPreview(false);
      renderHostPort.clearCompositeCache();
    }
    set({
      isRamPreviewing: false,
      ramPreviewRange: null,
      ramPreviewProgress: null,
      ...(isClipVideoBakeRendering ? {} : { cachedFrameTimes: new Set() }),
    });
  },

  // Playback frame caching (green line like After Effects)
  addCachedFrame: (time: number) => {
    const quantized = quantizeTime(time);
    const { cachedFrameTimes } = get();
    if (!cachedFrameTimes.has(quantized)) {
      const newSet = new Set(cachedFrameTimes);
      newSet.add(quantized);
      set({ cachedFrameTimes: newSet });
    }
  },

  getCachedRanges: () => {
    const { cachedFrameTimes } = get();
    if (cachedFrameTimes.size === 0) return [];

    // Convert set to sorted array
    const times = Array.from(cachedFrameTimes).sort((a, b) => a - b);
    const ranges: Array<{ start: number; end: number }> = [];
    const frameInterval = 1 / RAM_PREVIEW_FPS;
    const gap = frameInterval * 2; // Allow gap of 2 frames

    let rangeStart = times[0];
    let rangeEnd = times[0];

    for (let i = 1; i < times.length; i++) {
      if (times[i] - rangeEnd <= gap) {
        // Continue range
        rangeEnd = times[i];
      } else {
        // End range and start new one
        ranges.push({ start: rangeStart, end: rangeEnd + frameInterval });
        rangeStart = times[i];
        rangeEnd = times[i];
      }
    }

    // Add final range
    ranges.push({ start: rangeStart, end: rangeEnd + frameInterval });

    return ranges;
  },
  };
};
