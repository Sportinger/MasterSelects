import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { MediaFile } from '../../../stores/mediaStore';
import type { TurboResSourceMonitorHandle } from './TurboResSourceMonitorCanvas';
import {
  clampTime,
  DEFAULT_STILL_DURATION,
  MIN_MARK_GAP_SECONDS,
  normalizeDuration,
} from './sourceMonitorTimecode';

interface SourceMonitorTransportOptions {
  autoplayRequestId: number;
  file: Pick<MediaFile, 'duration' | 'id' | 'type'>;
  inPoint: number | null;
  isImage: boolean;
  isPlayable: boolean;
  isScrubbing: boolean;
  outPoint: number | null;
  useTurboResVideo: boolean;
}

export function useSourceMonitorTransport({
  autoplayRequestId,
  file,
  inPoint,
  isImage,
  isPlayable,
  isScrubbing,
  outPoint,
  useTurboResVideo,
}: SourceMonitorTransportOptions) {
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const turboResMonitorRef = useRef<TurboResSourceMonitorHandle | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(
    normalizeDuration(file.duration, isImage ? DEFAULT_STILL_DURATION : 0),
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const currentTimeRef = useRef(currentTime);
  const timelineDuration = normalizeDuration(
    duration,
    normalizeDuration(file.duration, isImage ? DEFAULT_STILL_DURATION : 0),
  );

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      currentTimeRef.current = 0;
      setCurrentTime(0);
      setDuration(normalizeDuration(
        file.duration,
        file.type === 'image' ? DEFAULT_STILL_DURATION : 0,
      ));
      setIsPlaying(false);
    });
    return () => {
      cancelled = true;
    };
  }, [file.duration, file.id, file.type]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media || !isPlayable || useTurboResVideo) return undefined;
    let disposed = false;

    const onTimeUpdate = () => {
      const nextTime = media.currentTime;
      if (!media.paused && outPoint !== null && nextTime >= outPoint - 0.015) {
        media.pause();
        media.currentTime = outPoint;
        currentTimeRef.current = outPoint;
        setCurrentTime(outPoint);
        return;
      }
      if (!isScrubbing) {
        currentTimeRef.current = nextTime;
        setCurrentTime(nextTime);
      }
    };
    const onLoadedMetadata = () => {
      const mediaDuration = normalizeDuration(media.duration, file.duration || 0);
      setDuration(mediaDuration);
      const restoreTime = currentTimeRef.current;
      if (restoreTime > 0.01) {
        media.currentTime = Math.min(restoreTime, mediaDuration || restoreTime);
      }
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);

    media.addEventListener('timeupdate', onTimeUpdate);
    media.addEventListener('loadedmetadata', onLoadedMetadata);
    media.addEventListener('play', onPlay);
    media.addEventListener('pause', onPause);
    media.addEventListener('ended', onEnded);
    if (media.readyState >= 1) {
      queueMicrotask(() => {
        if (!disposed) setDuration(normalizeDuration(media.duration, file.duration || 0));
      });
    }

    return () => {
      disposed = true;
      media.removeEventListener('timeupdate', onTimeUpdate);
      media.removeEventListener('loadedmetadata', onLoadedMetadata);
      media.removeEventListener('play', onPlay);
      media.removeEventListener('pause', onPause);
      media.removeEventListener('ended', onEnded);
    };
  }, [file.duration, isPlayable, isScrubbing, outPoint, useTurboResVideo]);

  useEffect(() => {
    if (!isPlayable || !isPlaying || isScrubbing || useTurboResVideo) return undefined;

    let frameId = 0;
    const updatePlayhead = () => {
      const media = mediaRef.current;
      if (!media) return;
      const nextTime = media.currentTime;
      if (!media.paused && outPoint !== null && nextTime >= outPoint - 0.015) {
        media.pause();
        media.currentTime = outPoint;
        currentTimeRef.current = outPoint;
        setCurrentTime(outPoint);
        return;
      }
      currentTimeRef.current = nextTime;
      setCurrentTime(nextTime);
      frameId = window.requestAnimationFrame(updatePlayhead);
    };

    frameId = window.requestAnimationFrame(updatePlayhead);
    return () => window.cancelAnimationFrame(frameId);
  }, [isPlayable, isPlaying, isScrubbing, outPoint, useTurboResVideo]);

  // React reuses the media element for same-type source switches, so explicitly
  // reload after src changes instead of waiting for a new element mount.
  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    media.pause();
    media.load();
  }, [file.id]);

  // Release native media resources only when this monitor transport unmounts.
  useEffect(() => {
    const media = mediaRef.current;
    return () => {
      if (!media) return;
      media.pause();
      media.removeAttribute('src');
      media.load();
    };
  }, []);

  const seekSourceMonitor = useCallback((time: number) => {
    const clampedTime = clampTime(time, timelineDuration || time);
    currentTimeRef.current = clampedTime;
    setCurrentTime(clampedTime);
    if (useTurboResVideo) {
      turboResMonitorRef.current?.seek(clampedTime);
      return;
    }
    if (mediaRef.current) mediaRef.current.currentTime = clampedTime;
  }, [timelineDuration, useTurboResVideo]);

  const playSource = useCallback(() => {
    if (!isPlayable) return;
    if (useTurboResVideo) {
      turboResMonitorRef.current?.play(
        clampTime(inPoint ?? 0, timelineDuration),
        clampTime(outPoint ?? timelineDuration, timelineDuration),
      );
      return;
    }
    const media = mediaRef.current;
    if (!media) return;
    const playbackStart = inPoint ?? 0;
    const playbackEnd = outPoint ?? timelineDuration;
    const needsRewind = media.ended
      || media.currentTime >= playbackEnd - MIN_MARK_GAP_SECONDS
      || media.currentTime < playbackStart - MIN_MARK_GAP_SECONDS;
    if (needsRewind) {
      const start = clampTime(playbackStart, timelineDuration);
      media.currentTime = start;
      currentTimeRef.current = start;
      setCurrentTime(start);
    }
    void media.play().catch(() => {
      try {
        media.load();
        media.currentTime = clampTime(playbackStart, timelineDuration);
        void media.play();
      } catch {
        // The explicit transport button remains available after a native failure.
      }
    });
  }, [inPoint, isPlayable, outPoint, timelineDuration, useTurboResVideo]);

  const pauseSource = useCallback(() => {
    if (!isPlayable) return;
    if (useTurboResVideo) turboResMonitorRef.current?.pause();
    else mediaRef.current?.pause();
  }, [isPlayable, useTurboResVideo]);

  const stopSource = useCallback(() => {
    if (!isPlayable) return;
    if (useTurboResVideo) turboResMonitorRef.current?.pause();
    else mediaRef.current?.pause();
    seekSourceMonitor(inPoint ?? 0);
  }, [inPoint, isPlayable, seekSourceMonitor, useTurboResVideo]);

  const togglePlayback = useCallback(() => {
    if (!isPlayable) return;
    if (useTurboResVideo) {
      if (isPlaying) pauseSource();
      else playSource();
      return;
    }
    if (mediaRef.current?.paused) playSource();
    else pauseSource();
  }, [isPlayable, isPlaying, pauseSource, playSource, useTurboResVideo]);

  useEffect(() => {
    if (!isPlayable) return undefined;
    if (useTurboResVideo) {
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) playSource();
      });
      return () => { cancelled = true; };
    }
    const media = mediaRef.current;
    if (!media) return undefined;

    let cancelled = false;
    const playWhenReady = () => {
      if (!cancelled) void media.play().catch(() => undefined);
    };
    if (media.readyState >= 2) playWhenReady();
    else media.addEventListener('canplay', playWhenReady, { once: true });

    return () => {
      cancelled = true;
      media.removeEventListener('canplay', playWhenReady);
    };
  }, [autoplayRequestId, file.id, isPlayable, playSource, useTurboResVideo]);

  return {
    currentTime,
    currentTimeRef,
    isPlaying,
    mediaRef,
    pauseSource,
    playSource,
    seekSourceMonitor,
    setCurrentTime,
    setIsPlaying,
    stopSource,
    timelineDuration,
    togglePlayback,
    turboResMonitorRef,
  };
}
