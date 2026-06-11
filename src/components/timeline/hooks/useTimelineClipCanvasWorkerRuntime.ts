import { useCallback, useEffect, useReducer, useRef, useState, type RefObject } from 'react';
import { flags } from '../../../engine/featureFlags';
import { prefersSoftwareTimelineCanvas } from '../utils/timelineCanvasPlatform';
import { reportTimelineCanvasDrawDiagnostics } from '../../../services/timeline/timelineCanvasDiagnostics';
import type { TimelineAudioDisplayMode } from '../../../stores/timeline/types';
import type { TimelineClipCanvasWorkerThumbnailPreparation } from '../utils/timelineClipCanvasThumbnailPreparation';
import { createTimelineClipCanvasWorkerThumbnailResourcesByClipId } from '../utils/timelineClipCanvasThumbnailResource';
import {
  buildTimelineClipCanvasWorkerDrawMessage,
  type TimelineClipCanvasWorkerEligibility,
  type TimelineClipCanvasWorkerPaintClipInput,
  type TimelineClipCanvasWorkerPreparedClipResources,
  type TimelineClipCanvasWorkerInitMessage,
  type TimelineClipCanvasWorkerOutgoingMessage,
} from '../utils/timelineClipCanvasWorkerModel';
import {
  closeUnpostedTimelineClipCanvasWorkerDrawResources,
  getTimelineClipCanvasWorkerDrawThumbnailCounts,
  mergeTimelineClipCanvasWorkerPreparedResourcesByClipId,
  type PendingTimelineClipCanvasWorkerDraw,
} from '../utils/timelineClipCanvasWorkerDrawResources';

interface TimelineClipCanvasWorkerRuntimeInput {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  trackId: string;
  height: number;
  cssWidth: number;
  canvasOffsetX: number;
  timeToPixel: (time: number) => number;
  selectedClipIds: ReadonlySet<string>;
  hoveredClipId?: string | null;
  trackColor: string;
  waveformsEnabled?: boolean;
  audioDisplayMode?: TimelineAudioDisplayMode;
  workerEligibility: TimelineClipCanvasWorkerEligibility;
  workerPaintClips: readonly TimelineClipCanvasWorkerPaintClipInput[];
  workerPreparedResourcesByClipId?: ReadonlyMap<string, TimelineClipCanvasWorkerPreparedClipResources>;
  workerThumbnailPreparation: TimelineClipCanvasWorkerThumbnailPreparation;
  passiveDecorationClipIds: ReadonlySet<string>;
  hasPassiveDecorations: boolean;
  hasClipTrim: boolean;
  activeTrimClipId?: string | null;
}

interface TimelineClipCanvasWorkerRuntime {
  workerMode: boolean;
  workerCanvasGeneration: number;
  workerRuntimeFallbackReason: string | null;
  markMainThreadCanvasContextInitialized: () => void;
}

interface TimelineClipCanvasWorkerRuntimeFallback {
  key: string;
  reason: string;
}

export function useTimelineClipCanvasWorkerRuntime(
  input: TimelineClipCanvasWorkerRuntimeInput,
): TimelineClipCanvasWorkerRuntime {
  const {
    canvasRef,
    trackId,
    height,
    cssWidth,
    canvasOffsetX,
    timeToPixel,
    selectedClipIds,
    hoveredClipId,
    trackColor,
    waveformsEnabled,
    audioDisplayMode,
    workerEligibility,
    workerPaintClips,
    workerPreparedResourcesByClipId,
    workerThumbnailPreparation,
    passiveDecorationClipIds,
    hasPassiveDecorations,
    hasClipTrim,
    activeTrimClipId,
  } = input;
  const hasWorkerCanvasSupport = typeof Worker !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function' &&
    // Linux/Mesa silently fails to composite a worker-driven OffscreenCanvas for
    // taller lanes; the main-thread software path renders them reliably.
    // See docs/Features/Linux-Mesa-GPU.md (mode 2) and issue #259.
    !prefersSoftwareTimelineCanvas();
  const rawWorkerMode = flags.timelineCanvasWorker && hasWorkerCanvasSupport && workerEligibility.eligible;
  const workerEligibilityReasonKey = workerEligibility.reasons.join('|');
  const workerRuntimeKey = `${hasWorkerCanvasSupport}:${trackId}:${workerEligibility.eligible}:${workerEligibilityReasonKey}`;
  const [workerRuntimeFallback, setWorkerRuntimeFallback] = useState<TimelineClipCanvasWorkerRuntimeFallback | null>(null);
  const workerRuntimeFallbackReason = workerRuntimeFallback?.key === workerRuntimeKey ? workerRuntimeFallback.reason : null;
  const [workerCanvasGeneration, bumpWorkerCanvasGeneration] = useReducer((value: number) => value + 1, 0);
  const workerMode = rawWorkerMode && workerRuntimeFallbackReason === null;
  const workerRef = useRef<Worker | null>(null);
  const workerReadyRef = useRef(false);
  const workerTransferredCanvasRef = useRef(false);
  const mainThreadCanvasContextInitializedRef = useRef(false);
  const workerDrawRequestIdRef = useRef(0);
  const pendingWorkerDrawRef = useRef<PendingTimelineClipCanvasWorkerDraw | null>(null);

  const markMainThreadCanvasContextInitialized = useCallback(() => {
    mainThreadCanvasContextInitializedRef.current = true;
  }, []);

  const publishWorkerDrawDiagnostics = useCallback((
    pending: PendingTimelineClipCanvasWorkerDraw,
    runtime: {
      pendingDraw: boolean;
      drawnClipCount?: number;
      thumbnailClipCount?: number;
      thumbnailDrawCount?: number;
      drawMs?: number;
      resourceBytes?: number;
      error?: string;
    },
  ) => {
    reportTimelineCanvasDrawDiagnostics(pending.trackId, {
      inputClipCount: pending.inputClipCount,
      visibleClipCount: pending.visibleClipCount,
      drawnClipCount: runtime.drawnClipCount ?? pending.visibleClipCount,
      thumbnailClipCount: runtime.thumbnailClipCount ?? pending.thumbnailClipCount,
      thumbnailDrawCount: runtime.thumbnailDrawCount ?? pending.thumbnailDrawCount,
      waveformClipCount: 0,
      workerMode: runtime.error ? false : true,
      workerEligible: true,
      workerPendingDraw: runtime.pendingDraw,
      workerDrawMs: runtime.drawMs,
      workerResourceBytes: runtime.resourceBytes,
      workerError: runtime.error,
      workerFallbackReasons: runtime.error ? [runtime.error] : undefined,
    });
  }, []);

  const enterWorkerRuntimeFallback = useCallback((reason: string) => {
    const worker = workerRef.current;
    if (worker) {
      worker.terminate();
    }
    workerRef.current = null;
    workerReadyRef.current = false;

    const pending = pendingWorkerDrawRef.current;
    if (pending) {
      publishWorkerDrawDiagnostics(pending, {
        pendingDraw: false,
        error: reason,
      });
      closeUnpostedTimelineClipCanvasWorkerDrawResources(pending);
    }

    if (workerTransferredCanvasRef.current) {
      workerTransferredCanvasRef.current = false;
      bumpWorkerCanvasGeneration();
    }
    setWorkerRuntimeFallback((current) => (
      current?.key === workerRuntimeKey
        ? current
        : { key: workerRuntimeKey, reason }
    ));
  }, [publishWorkerDrawDiagnostics, workerRuntimeKey]);

  const postPendingWorkerDraw = useCallback(() => {
    const worker = workerRef.current;
    const pending = pendingWorkerDrawRef.current;
    if (!worker || !pending || !workerReadyRef.current) {
      return;
    }

    try {
      worker.postMessage(pending.message, pending.transferables);
      pending.posted = true;
      publishWorkerDrawDiagnostics(pending, {
        pendingDraw: true,
      });
    } catch (error) {
      enterWorkerRuntimeFallback(error instanceof Error
        ? `worker-post-failed:${error.message}`
        : `worker-post-failed:${String(error)}`);
    }
  }, [enterWorkerRuntimeFallback, publishWorkerDrawDiagnostics]);

  useEffect(() => {
    if (!workerMode && workerTransferredCanvasRef.current) {
      workerTransferredCanvasRef.current = false;
      bumpWorkerCanvasGeneration();
    }
  }, [workerMode]);

  useEffect(() => {
    if (!workerMode) return;
    const canvas = canvasRef.current;
    if (!canvas || workerRef.current) return;
    if (mainThreadCanvasContextInitializedRef.current) {
      mainThreadCanvasContextInitializedRef.current = false;
      bumpWorkerCanvasGeneration();
      return;
    }

    let disposed = false;
    let readyTimeoutId: number | null = null;
    const worker = new Worker(new URL('../workers/timelineClipCanvas.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    const fail = (reason: string) => {
      if (disposed) return;
      enterWorkerRuntimeFallback(reason);
    };

    worker.onmessage = (event: MessageEvent<TimelineClipCanvasWorkerOutgoingMessage>) => {
      const message = event.data;
      if (message.type === 'ready') {
        workerReadyRef.current = true;
        if (readyTimeoutId !== null) {
          window.clearTimeout(readyTimeoutId);
          readyTimeoutId = null;
        }
        postPendingWorkerDraw();
        return;
      }
      if (message.type === 'drawn') {
        const pending = pendingWorkerDrawRef.current;
        if (!pending || pending.requestId !== message.requestId) {
          return;
        }
        publishWorkerDrawDiagnostics(pending, {
          pendingDraw: false,
          drawnClipCount: message.drawnClipCount,
          thumbnailClipCount: message.thumbnailClipCount,
          thumbnailDrawCount: message.thumbnailDrawCount,
          drawMs: message.drawMs,
          resourceBytes: message.resourceBytes,
        });
        return;
      }
      if (message.type === 'error') {
        fail(`worker-runtime-error:${message.message}`);
      }
    };
    worker.onerror = (event) => {
      fail(event.message ? `worker-error:${event.message}` : 'worker-error');
    };
    worker.onmessageerror = () => {
      fail('worker-messageerror');
    };

    try {
      const offscreen = canvas.transferControlToOffscreen();
      workerTransferredCanvasRef.current = true;
      const initMessage: TimelineClipCanvasWorkerInitMessage = { type: 'init', canvas: offscreen };
      worker.postMessage(initMessage, [offscreen]);
    } catch (error) {
      fail(error instanceof Error
        ? `worker-init-failed:${error.message}`
        : `worker-init-failed:${String(error)}`);
      return;
    }

    readyTimeoutId = window.setTimeout(() => {
      if (!workerReadyRef.current) {
        fail('worker-ready-timeout');
      }
    }, 2000);

    return () => {
      disposed = true;
      if (readyTimeoutId !== null) {
        window.clearTimeout(readyTimeoutId);
      }
      if (workerRef.current === worker) {
        worker.terminate();
        workerRef.current = null;
        workerReadyRef.current = false;
      }
      closeUnpostedTimelineClipCanvasWorkerDrawResources(pendingWorkerDrawRef.current);
      pendingWorkerDrawRef.current = null;
    };
  }, [canvasRef, enterWorkerRuntimeFallback, postPendingWorkerDraw, publishWorkerDrawDiagnostics, workerMode, workerCanvasGeneration]);

  useEffect(() => {
    if (!workerMode) return;
    const canvas = canvasRef.current;
    const worker = workerRef.current;
    if (!canvas || !worker) return;
    canvas.style.left = `${canvasOffsetX}px`;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${height}px`;
    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    const transientThumbnailResourcesByClipId = createTimelineClipCanvasWorkerThumbnailResourcesByClipId(
      workerThumbnailPreparation.plansByClipId,
    );
    const preparedResourcesByClipId = mergeTimelineClipCanvasWorkerPreparedResourcesByClipId(
      workerPreparedResourcesByClipId,
      transientThumbnailResourcesByClipId,
    );
    const workerDraw = buildTimelineClipCanvasWorkerDrawMessage({
      clips: workerPaintClips,
      height,
      cssWidth,
      canvasOffsetX,
      dpr,
      timeToPixel,
      selectedClipIds,
      hoveredClipId,
      trackColor,
      waveformsEnabled,
      audioDisplayMode,
      preparedResourcesByClipId,
      preparedThumbnailClipIds: workerThumbnailPreparation.handledClipIds,
      passiveDecorationClipIds,
      hasPassiveDecorations,
      hasClipTrim,
      activeTrimClipId,
      requestId: workerDrawRequestIdRef.current + 1,
    });
    if (!workerDraw.message) {
      transientThumbnailResourcesByClipId?.forEach((resources) => {
        resources.thumbnailStrip?.bitmap.close();
      });
      return;
    }
    const thumbnailCounts = getTimelineClipCanvasWorkerDrawThumbnailCounts(workerDraw.message);
    workerDrawRequestIdRef.current = workerDraw.message.requestId;
    closeUnpostedTimelineClipCanvasWorkerDrawResources(pendingWorkerDrawRef.current);
    pendingWorkerDrawRef.current = {
      requestId: workerDraw.message.requestId,
      trackId,
      inputClipCount: workerDraw.inputClipCount,
      visibleClipCount: workerDraw.visibleClipCount,
      thumbnailClipCount: thumbnailCounts.thumbnailClipCount,
      thumbnailDrawCount: thumbnailCounts.thumbnailDrawCount,
      message: workerDraw.message,
      transferables: workerDraw.transferables,
      posted: false,
    };
    const postHandle = requestAnimationFrame(() => {
      postPendingWorkerDraw();
    });
    return () => {
      cancelAnimationFrame(postHandle);
    };
  }, [activeTrimClipId, audioDisplayMode, canvasOffsetX, canvasRef, cssWidth, hasClipTrim, hasPassiveDecorations, height, hoveredClipId, passiveDecorationClipIds, postPendingWorkerDraw, selectedClipIds, timeToPixel, trackColor, trackId, waveformsEnabled, workerMode, workerPaintClips, workerPreparedResourcesByClipId, workerThumbnailPreparation]);

  return {
    workerMode,
    workerCanvasGeneration,
    workerRuntimeFallbackReason,
    markMainThreadCanvasContextInitialized,
  };
}
