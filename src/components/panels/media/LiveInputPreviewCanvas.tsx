import { useEffect, useRef, useSyncExternalStore } from 'react';

import { liveInputRuntime } from '../../../services/mediaRuntime/liveInputRuntime';

interface LiveInputPreviewCanvasProps {
  className?: string;
  liveInputId: string;
  presentationRole?: 'media-panel' | 'composition-preview';
}

const subscribeToLiveInputs = (listener: () => void) => liveInputRuntime.subscribe(listener);
const getLiveInputRevision = () => liveInputRuntime.getRevision();

/**
 * Presents the existing capture stream in a visible native video element.
 * Sharing the MediaStream does not reacquire the camera, and unlike an
 * offscreen canvas timer it keeps iPad Safari delivering frames at the
 * camera's native cadence while the timeline is idle.
 */
export function LiveInputPreviewCanvas({
  className,
  liveInputId,
  presentationRole = 'media-panel',
}: LiveInputPreviewCanvasProps) {
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const revision = useSyncExternalStore(
    subscribeToLiveInputs,
    getLiveInputRevision,
    getLiveInputRevision,
  );

  useEffect(() => {
    const preview = previewRef.current;
    const source = liveInputRuntime.getVideoElement(liveInputId);
    const stream = source?.srcObject ?? null;
    if (!preview || !stream) return undefined;

    preview.srcObject = stream;
    const play = () => {
      if (document.visibilityState === 'visible') {
        void preview.play().catch(() => undefined);
      }
    };
    play();
    const unregisterPresentationVideo = liveInputRuntime.registerPresentationVideo(
      liveInputId,
      preview,
    );
    let orientationRefreshTimer: number | null = null;
    const refreshAfterOrientationChange = () => {
      if (orientationRefreshTimer !== null) window.clearTimeout(orientationRefreshTimer);
      orientationRefreshTimer = window.setTimeout(() => {
        orientationRefreshTimer = null;
        liveInputRuntime.refreshPresentationVideo(liveInputId, preview);
      }, 180);
    };
    const screenOrientation = window.screen.orientation;
    window.addEventListener('pageshow', play);
    window.addEventListener('orientationchange', refreshAfterOrientationChange);
    screenOrientation?.addEventListener?.('change', refreshAfterOrientationChange);
    document.addEventListener('visibilitychange', play);

    return () => {
      if (orientationRefreshTimer !== null) window.clearTimeout(orientationRefreshTimer);
      window.removeEventListener('pageshow', play);
      window.removeEventListener('orientationchange', refreshAfterOrientationChange);
      screenOrientation?.removeEventListener?.('change', refreshAfterOrientationChange);
      document.removeEventListener('visibilitychange', play);
      unregisterPresentationVideo();
      preview.pause();
      preview.srcObject = null;
    };
  }, [liveInputId, revision]);

  return (
    <video
      ref={previewRef}
      className={className}
      autoPlay
      muted
      playsInline
      disablePictureInPicture
      draggable={false}
      data-live-input-presentation-role={presentationRole}
      aria-hidden="true"
    />
  );
}
