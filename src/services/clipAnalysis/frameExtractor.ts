import { Logger } from '../logger';

const log = Logger.create('ClipFrameExtractor');
const SEEK_TIMEOUT_MS = 8_000;
const READY_TIMEOUT_MS = 12_000;

function waitForVideoEvent(
  video: HTMLVideoElement,
  eventName: 'canplaythrough' | 'seeked',
  timeoutMs: number,
): Promise<void> {
  if (
    eventName === 'canplaythrough'
    && video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
  ) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const finish = (error?: Error) => {
      if (timeout) clearTimeout(timeout);
      video.removeEventListener(eventName, onEvent);
      video.removeEventListener('error', onError);
      if (error) reject(error);
      else resolve();
    };
    const onEvent = () => finish();
    const onError = () => finish(new Error(`Video emitted an error while waiting for ${eventName}.`));
    timeout = setTimeout(
      () => finish(new Error(`Video ${eventName} timed out.`)),
      timeoutMs,
    );
    video.addEventListener(eventName, onEvent, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}

async function seekVideo(video: HTMLVideoElement, timestampSec: number): Promise<void> {
  const duration = Number.isFinite(video.duration) ? video.duration : timestampSec;
  const target = Math.max(0, Math.min(Math.max(0, duration - 0.01), timestampSec));
  if (
    Math.abs(video.currentTime - target) < 0.01
    && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
  ) {
    return;
  }
  const waitForSeek = waitForVideoEvent(video, 'seeked', SEEK_TIMEOUT_MS);
  video.currentTime = target;
  await waitForSeek;
}

async function reloadVideoDecoder(video: HTMLVideoElement): Promise<void> {
  const source = video.currentSrc || video.src;
  if (!source) throw new Error('Video source is unavailable for seek recovery.');
  video.pause();
  video.removeAttribute('src');
  video.load();
  video.src = source;
  video.load();
  await waitForVideoEvent(video, 'canplaythrough', READY_TIMEOUT_MS);
}

/**
 * Draw a source frame with one decoder-reset retry. Long local videos can
 * occasionally stop emitting `seeked` at a keyframe; a fresh decoder avoids
 * abandoning an otherwise completed analysis run.
 */
export async function extractVideoFrame(
  video: HTMLVideoElement,
  timestampSec: number,
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
): Promise<ImageData> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await seekVideo(video, timestampSec);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      return context.getImageData(0, 0, canvas.width, canvas.height);
    } catch (error) {
      if (attempt > 0) {
        throw new Error(`Video seek failed at ${timestampSec.toFixed(3)}s after retry: ${String(error)}`);
      }
      log.warn('Video seek stalled; resetting decoder and retrying once', { timestampSec, error });
      await reloadVideoDecoder(video);
    }
  }
  throw new Error(`Video seek failed at ${timestampSec.toFixed(3)}s.`);
}
