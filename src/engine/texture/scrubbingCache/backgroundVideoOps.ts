import type { BackgroundPreloadSession } from './backgroundSession';
import type { ScrubTextureCache } from './scrubTextureCache';

export interface BackgroundVideoSeekTimeouts {
  metadataTimeoutMs: number;
  seekTimeoutMs: number;
}

export function getFiniteDuration(duration: number): number | undefined {
  return Number.isFinite(duration) && duration > 0 ? duration : undefined;
}

export async function seekBackgroundVideo(
  session: BackgroundPreloadSession,
  targetTime: number,
  timeouts: BackgroundVideoSeekTimeouts
): Promise<boolean> {
  const video = session.video;
  if (video.readyState < 1) {
    const hasMetadata = await waitForVideoEvent(
      video,
      ['loadedmetadata', 'loadeddata', 'canplay'],
      timeouts.metadataTimeoutMs
    );
    if (!hasMetadata && video.readyState < 1) {
      return false;
    }
  }

  const duration = getFiniteDuration(video.duration) ?? session.duration;
  const safeTargetTime = duration > 0
    ? Math.max(0, Math.min(targetTime, Math.max(0, duration - 0.001)))
    : Math.max(0, targetTime);

  if (Math.abs(video.currentTime - safeTargetTime) > 0.012 || video.readyState < 2) {
    try {
      video.currentTime = safeTargetTime;
    } catch {
      return false;
    }

    const seeked = await waitForVideoEvent(
      video,
      ['seeked', 'loadeddata', 'canplay', 'timeupdate'],
      timeouts.seekTimeoutMs
    );
    if (!seeked && video.readyState < 2) {
      return false;
    }
  }

  if (video.readyState < 2) {
    await waitForVideoEvent(video, ['loadeddata', 'canplay'], timeouts.seekTimeoutMs);
  }

  if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
    return false;
  }

  return Math.abs(video.currentTime - safeTargetTime) <= 0.5;
}

export async function cacheBackgroundVideoFrame(
  session: BackgroundPreloadSession,
  targetTime: number,
  scrubCache: ScrubTextureCache
): Promise<boolean> {
  const video = session.video;
  if (video.videoWidth === 0 || video.videoHeight === 0 || video.readyState < 2) {
    return false;
  }

  if (typeof createImageBitmap === 'function') {
    let bitmap: ImageBitmap | null = null;
    try {
      const target = scrubCache.computeSize(video.videoWidth, video.videoHeight);
      bitmap = await createImageBitmap(video, {
        resizeWidth: target.width,
        resizeHeight: target.height,
        resizeQuality: 'medium',
      });
      if (session.disposed) return false;
      return scrubCache.addFrameFromSource(
        bitmap,
        session.videoSrc,
        targetTime,
        bitmap.width,
        bitmap.height
      );
    } catch {
      return false;
    } finally {
      bitmap?.close();
    }
  }

  return scrubCache.addFrameFromSource(
    video,
    session.videoSrc,
    targetTime,
    video.videoWidth,
    video.videoHeight
  );
}

export function yieldBackgroundPreload(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function waitForVideoEvent(
  video: HTMLVideoElement,
  events: string[],
  timeoutMs: number
): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const cleanup = () => {
      events.forEach((eventName) => video.removeEventListener(eventName, onDone));
      clearTimeout(timeout);
    };
    const finish = (result: boolean) => {
      if (done) return;
      done = true;
      cleanup();
      resolve(result);
    };
    const onDone = () => finish(true);
    events.forEach((eventName) => video.addEventListener(eventName, onDone, { once: true }));
    const timeout = window.setTimeout(() => finish(false), timeoutMs);
  });
}
