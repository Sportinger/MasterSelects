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
  ): Promise<boolean> => {
    const { clips, tracks, isRamPreviewing, addCachedFrame } = get();
    if (isRamPreviewing) return false;

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
        message: `RAM preview skipped by runtime admission: ${admission.reason ?? 'not admitted'}`,
      };
      return false;
    }

    renderHostPort.setGeneratingRamPreview(true);
    set({ isRamPreviewing: true, ramPreviewProgress: 0, ramPreviewRange: null });
    reportRamPreviewRunJob(runJobReport);

    try {
      const preview = new RamPreviewEngine(renderHostPort.getRamPreviewRenderEngine());
      const result = await preview.generate(
        {
          start: rangeStart,
          end: rangeEnd,
          centerTime: Math.max(rangeStart, Math.min(rangeEnd, centerTime)),
          clips,
          tracks,
          runId,
        },
        {
          isCancelled: () => {
            const cancelled = !get().isRamPreviewing;
            if (cancelled && !lastRamPreviewGenerationError) {
              lastRamPreviewGenerationError = {
                message: 'RAM preview was cancelled because isRamPreviewing became false',
              };
            }
            return cancelled;
          },
          isFrameCached: (qt) => get().cachedFrameTimes.has(qt),
          getSourceTimeForClip: (id, t) => get().getSourceTimeForClip(id, t),
          getInterpolatedSpeed: (id, t) => get().getInterpolatedSpeed(id, t),
          getCompositionDimensions: (compId) => {
            const comp = useMediaStore.getState().compositions.find(c => c.id === compId);
            return { width: comp?.width || 1920, height: comp?.height || 1080 };
          },
          onFrameCached: (time) => addCachedFrame(time),
          onProgress: (percent) => set({ ramPreviewProgress: percent }),
        }
      );

      completed = result.completed;
      if (completed) {
        set({ ramPreviewRange: { start: rangeStart, end: rangeEnd }, ramPreviewProgress: null });
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
      set({ isRamPreviewing: false, ramPreviewProgress: null });
    }

    return completed;
  };

  return {
  toggleRamPreviewEnabled: () => {
    const { ramPreviewEnabled } = get();
    if (ramPreviewEnabled) {
      // Turning OFF - cancel any running preview and clear cache
      set({ ramPreviewEnabled: false, isRamPreviewing: false, ramPreviewProgress: null });
      renderHostPort.setGeneratingRamPreview(false);
      renderHostPort.clearCompositeCache();
      set({ ramPreviewRange: null, cachedFrameTimes: new Set() });
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

  cancelRamPreview: () => {
    // IMMEDIATELY set state to cancel the loop - this must be synchronous!
    // The RAM preview loop checks !get().isRamPreviewing to know when to stop
    set({ isRamPreviewing: false, ramPreviewProgress: null });
    // Then async cleanup the engine
    renderHostPort.setGeneratingRamPreview(false);
  },

  clearRamPreview: async () => {
    renderHostPort.setGeneratingRamPreview(false);
    renderHostPort.clearCompositeCache();
    set({
      isRamPreviewing: false,
      ramPreviewRange: null,
      ramPreviewProgress: null,
      cachedFrameTimes: new Set(),
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
