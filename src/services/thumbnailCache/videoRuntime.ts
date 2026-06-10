export function createThumbnailGenerationVideoFromUrl(
  sourceUrl: string,
  crossOrigin = 'anonymous',
): HTMLVideoElement | null {
  if (!sourceUrl) {
    return null;
  }

  const video = document.createElement('video');
  video.src = sourceUrl;
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = crossOrigin || 'anonymous';
  video.load();
  return video;
}

export function createThumbnailGenerationVideo(sourceVideo: HTMLVideoElement): HTMLVideoElement | null {
  return createThumbnailGenerationVideoFromUrl(
    sourceVideo.currentSrc || sourceVideo.src,
    sourceVideo.crossOrigin || 'anonymous',
  );
}

export async function prepareThumbnailGenerationVideo(
  video: HTMLVideoElement,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    throw new Error('Thumbnail generation aborted');
  }

  if (video.readyState >= 2) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('Thumbnail video metadata timeout'));
    }, 4000);

    const cleanup = () => {
      clearTimeout(timeoutId);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };

    const onLoadedMetadata = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error('Thumbnail video failed to load metadata'));
    };

    const onAbort = () => {
      cleanup();
      reject(new Error('Thumbnail generation aborted'));
    };

    if (video.readyState >= 1) {
      cleanup();
      resolve();
      return;
    }

    video.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
    video.addEventListener('error', onError, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
  });

  if (signal?.aborted || video.readyState >= 2) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('Thumbnail video frame decode timeout'));
    }, 4000);

    const cleanup = () => {
      clearTimeout(timeoutId);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };

    const finish = () => {
      cleanup();
      video.pause?.();
      resolve();
    };

    const onReady = () => {
      finish();
    };

    const onError = () => {
      cleanup();
      reject(new Error('Thumbnail video failed during frame decode warmup'));
    };

    const onAbort = () => {
      cleanup();
      reject(new Error('Thumbnail generation aborted'));
    };

    if (video.readyState >= 2) {
      finish();
      return;
    }

    video.addEventListener('loadeddata', onReady, { once: true });
    video.addEventListener('canplay', onReady, { once: true });
    video.addEventListener('error', onError, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });

    const seekTarget = Number.isFinite(video.duration) && video.duration > 0
      ? Math.min(0.001, Math.max(0, video.duration - 0.001))
      : 0.001;

    try {
      video.currentTime = seekTarget;
    } catch {
      // Ignore seek failures until metadata settles.
    }

    video.play().then(() => {
      setTimeout(() => {
        if (video.readyState >= 2) {
          finish();
        }
      }, 60);
    }).catch(() => {
      // Fallback: rely on seek/load events or timeout.
    });
  });
}

export function cleanupThumbnailGenerationVideo(video: HTMLVideoElement): void {
  video.pause?.();
  video.removeAttribute?.('src');
  try {
    video.load?.();
  } catch {
    // Ignore teardown failures from test environments or detached elements.
  }
}

