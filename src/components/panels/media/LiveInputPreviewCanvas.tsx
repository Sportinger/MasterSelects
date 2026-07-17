import { useEffect, useRef, useSyncExternalStore } from 'react';

import { liveInputRuntime } from '../../../services/mediaRuntime/liveInputRuntime';

const MAX_PREVIEW_WIDTH = 320;
const MAX_PREVIEW_HEIGHT = 180;
const MIN_FRAME_INTERVAL_MS = 250;

interface LiveInputPreviewCanvasProps {
  className?: string;
  frameIntervalMs?: number;
  liveInputId: string;
}

const subscribeToLiveInputs = (listener: () => void) => liveInputRuntime.subscribe(listener);
const getLiveInputRevision = () => liveInputRuntime.getRevision();

/**
 * Paints low-rate, low-resolution snapshots from the runtime's existing video.
 * This deliberately creates neither another MediaStream nor another video decoder.
 */
export function LiveInputPreviewCanvas({
  className,
  frameIntervalMs = 1000,
  liveInputId,
}: LiveInputPreviewCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const revision = useSyncExternalStore(
    subscribeToLiveInputs,
    getLiveInputRevision,
    getLiveInputRevision,
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    canvas.width = 1;
    canvas.height = 1;

    const video = liveInputRuntime.getVideoElement(liveInputId);
    if (!video) return undefined;

    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!context) return undefined;
    context.imageSmoothingQuality = 'low';

    const intervalMs = Math.max(MIN_FRAME_INTERVAL_MS, frameIntervalMs);
    let timerId: number | null = null;
    let visible = true;
    let stopped = false;

    const clearTimer = () => {
      if (timerId === null) return;
      window.clearTimeout(timerId);
      timerId = null;
    };

    const draw = () => {
      clearTimer();
      if (stopped || !visible) return;

      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
        const scale = Math.min(
          1,
          MAX_PREVIEW_WIDTH / video.videoWidth,
          MAX_PREVIEW_HEIGHT / video.videoHeight,
        );
        const width = Math.max(1, Math.round(video.videoWidth * scale));
        const height = Math.max(1, Math.round(video.videoHeight * scale));
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        try {
          context.drawImage(video, 0, 0, width, height);
        } catch {
          // A capture can end between the readiness check and the draw call.
        }
      }

      timerId = window.setTimeout(draw, intervalMs);
    };

    const handleLoadedData = () => draw();
    video.addEventListener('loadeddata', handleLoadedData);

    const observer = typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver(([entry]) => {
          visible = entry?.isIntersecting ?? false;
          if (visible) draw();
          else clearTimer();
        });
    observer?.observe(canvas);
    draw();

    return () => {
      stopped = true;
      clearTimer();
      observer?.disconnect();
      video.removeEventListener('loadeddata', handleLoadedData);
    };
  }, [frameIntervalMs, liveInputId, revision]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
