import { Logger } from '../logger';

const log = Logger.create('ClipFrameExtractor');
const SEEK_TIMEOUT_MS = 8_000;
const READY_TIMEOUT_MS = 12_000;
const SEEK_POLL_INTERVAL_MS = 50;
const SEEK_TIME_TOLERANCE_SECONDS = 0.05;
const MAX_SEEK_ATTEMPTS = 3;

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

function hasDecodedSeekTarget(video: HTMLVideoElement, target: number): boolean {
  return (
    !video.seeking
    && Math.abs(video.currentTime - target) <= SEEK_TIME_TOLERANCE_SECONDS
    && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
  );
}

/**
 * Chromium can occasionally finish a local-file seek without dispatching the
 * `seeked` event. Observe the decoded media state as well so a review run does
 * not fail after the requested frame is already available.
 */
function waitForSeekCompletion(
  video: HTMLVideoElement,
  target: number,
  timeoutMs: number,
): Promise<void> {
  if (hasDecodedSeekTarget(video, target)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timeout !== null) clearTimeout(timeout);
      if (poll !== null) clearInterval(poll);
      timeout = null;
      poll = null;
      video.removeEventListener('seeked', onProgress);
      video.removeEventListener('error', onError);
      if (error) reject(error);
      else resolve();
    };
    const onProgress = () => {
      if (hasDecodedSeekTarget(video, target)) finish();
    };
    const onError = () => finish(new Error('Video emitted an error while waiting for seeked.'));
    poll = setInterval(onProgress, SEEK_POLL_INTERVAL_MS);
    timeout = setTimeout(() => {
      onProgress();
      if (!settled) finish(new Error('Video seeked timed out.'));
    }, timeoutMs);
    video.addEventListener('seeked', onProgress);
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
  const waitForSeek = waitForSeekCompletion(video, target, SEEK_TIMEOUT_MS);
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
  for (let attempt = 0; attempt < MAX_SEEK_ATTEMPTS; attempt += 1) {
    try {
      await seekVideo(video, timestampSec);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      return context.getImageData(0, 0, canvas.width, canvas.height);
    } catch (error) {
      if (attempt === MAX_SEEK_ATTEMPTS - 1) {
        throw new Error(`Video seek failed at ${timestampSec.toFixed(3)}s after retries: ${String(error)}`);
      }
      log.warn('Video seek stalled; resetting decoder and retrying', {
        attempt: attempt + 1,
        maxAttempts: MAX_SEEK_ATTEMPTS,
        timestampSec,
        error,
      });
      await reloadVideoDecoder(video);
    }
  }
  throw new Error(`Video seek failed at ${timestampSec.toFixed(3)}s.`);
}
