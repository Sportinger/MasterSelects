import { WebCodecsPlayer } from '../../engine/WebCodecsPlayer';
import { flags } from '../../engine/featureFlags';
import { renderHostPort } from '../render/renderHostPort';
import { layerBuilder } from '../layerBuilder';
import { Logger } from '../logger';
import type { RuntimeProviderDemand } from '../../timeline';
import type {
  TimelineRuntimeAdmissionDecision,
} from '../timeline/runtimeCoordinatorTypes';
import { reserveRuntimeProviderDemandResource } from '../timeline/runtimeProviderDemandBridge';

const log = Logger.create('WebCodecsHelpers');
let webCodecsHelperProviderSequence = 0;

type WebCodecsHelperAdmission =
  | {
      admitted: true;
      resourceId: string;
      release: () => void;
    }
  | {
      admitted: false;
      decision: TimelineRuntimeAdmissionDecision;
      release: () => void;
    };

type VideoFrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback: (callback: () => void) => number;
};

function hasVideoFrameCallback(video: HTMLVideoElement): video is VideoFrameCallbackVideo {
  return 'requestVideoFrameCallback' in video;
}

function reserveWebCodecsHelperProviderResource(params: {
  fileName: string;
  file?: File;
  fullMode: boolean;
}): WebCodecsHelperAdmission {
  webCodecsHelperProviderSequence += 1;
  const providerId = `webcodecs-helper:${webCodecsHelperProviderSequence}:${params.fileName}`;
  const sourceId = params.file
    ? `${params.file.name}:${params.file.size}:${params.file.lastModified}`
    : params.fileName;
  const demand: RuntimeProviderDemand = {
    id: `${providerId}:frame-provider`,
    facetId: providerId,
    resourceKind: 'video-frame-provider',
    policyId: 'interactive',
    leasePolicy: 'lease-visible',
    owner: {
      ownerId: providerId,
      ownerType: 'timeline',
    },
    source: {
      sourceId,
      previewPath: params.fileName,
    },
    priority: 'visible',
    tags: ['timeline-helper', 'webcodecs'],
  };
  const reservation = reserveRuntimeProviderDemandResource(demand, {
    resourceKind: 'video-frame-provider',
    providerId,
    providerKind: 'webcodecs',
    canSeek: params.fullMode,
    canProvideStaleFrame: !params.fullMode,
    frameFormat: params.fullMode ? 'video-frame' : 'canvas-image-source',
    memoryCost: params.file
      ? {
          heapBytes: params.file.size,
        }
      : undefined,
    label: 'Timeline helper WebCodecs provider',
  });
  if (!reservation.admitted) {
    return {
      admitted: false,
      decision: reservation.decision,
      release: () => undefined,
    };
  }
  return {
    admitted: true,
    resourceId: reservation.resource.id,
    release: reservation.release,
  };
}

function attachWebCodecsHelperAdmissionRelease(
  player: WebCodecsPlayer,
  admission: Extract<WebCodecsHelperAdmission, { admitted: true }>
): () => void {
  const originalDestroy = player.destroy?.bind(player);
  let released = false;
  const release = () => {
    if (released) {
      return;
    }
    released = true;
    admission.release();
  };
  player.destroy = (() => {
    release();
    originalDestroy?.();
  }) as WebCodecsPlayer['destroy'];
  return release;
}

async function waitForFullWebCodecsReady(
  webCodecsPlayer: WebCodecsPlayer,
  fileName: string,
  timeoutMs = 2000
): Promise<void> {
  if (webCodecsPlayer.ready) {
    return;
  }

  const startedAt = performance.now();

  await new Promise<void>((resolve) => {
    const poll = () => {
      if (webCodecsPlayer.ready) {
        resolve();
        return;
      }

      if (performance.now() - startedAt >= timeoutMs) {
        log.warn('WebCodecs ready wait timed out', { file: fileName, timeoutMs });
        resolve();
        return;
      }

      setTimeout(poll, 16);
    };

    poll();
  });
}

export function hasWebCodecsSupport(): boolean {
  return 'VideoDecoder' in window && 'VideoFrame' in window;
}

export async function initWebCodecsPlayer(
  video: HTMLVideoElement,
  fileName: string = 'video',
  file?: File
): Promise<WebCodecsPlayer | null> {
  if (!hasWebCodecsSupport()) {
    return null;
  }

  if (!flags.useFullWebCodecsPlayback) {
    log.info('WebCodecs preview disabled by flag', { file: fileName });
    return null;
  }

  const useFullMode = flags.useFullWebCodecsPlayback && !!file;
  const admission = reserveWebCodecsHelperProviderResource({
    fileName,
    file,
    fullMode: useFullMode,
  });
  if (!admission.admitted) {
    log.warn('WebCodecs provider admission denied', {
      file: fileName,
      reason: admission.decision.reason,
      rejectedUnits: admission.decision.rejectedUnits,
    });
    return null;
  }

  let releaseAdmission: (() => void) | null = null;
  let webCodecsPlayer: WebCodecsPlayer | null = null;
  try {
    log.debug('Initializing WebCodecs', { file: fileName, fullMode: useFullMode });

    webCodecsPlayer = new WebCodecsPlayer({
      loop: false,
      useSimpleMode: !useFullMode,
      onFrame: () => {
        renderHostPort.requestNewFrameRender();
        layerBuilder.invalidateCache();
      },
      onError: (error) => {
        log.warn('WebCodecs error', { error: error.message });
        renderHostPort.requestRender();
      },
    });
    releaseAdmission = attachWebCodecsHelperAdmissionRelease(webCodecsPlayer, admission);

    if (useFullMode) {
      await webCodecsPlayer.loadFile(file);
      await waitForFullWebCodecsReady(webCodecsPlayer, fileName);
      log.info('WebCodecs full mode ready', {
        file: fileName,
        ready: webCodecsPlayer.ready,
      });
    } else {
      webCodecsPlayer.attachToVideoElement(video);
      log.debug('WebCodecs simple mode ready', { file: fileName });
    }

    return webCodecsPlayer;
  } catch (err) {
    if (releaseAdmission) {
      releaseAdmission();
    } else {
      admission.release();
    }
    webCodecsPlayer?.destroy?.();
    log.warn('WebCodecs init failed, using HTMLVideoElement', err);
    return null;
  }
}

export function warmUpVideoDecoder(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    if (video.readyState >= 3) {
      resolve();
      return;
    }

    if (hasVideoFrameCallback(video)) {
      const warmUp = () => {
        video.currentTime = 0.001;
        video.requestVideoFrameCallback(() => {
          video.pause();
          resolve();
        });
        video.play().catch(() => resolve());
      };

      if (video.readyState >= 1) {
        warmUp();
      } else {
        video.addEventListener('loadedmetadata', warmUp, { once: true });
      }
    } else {
      const videoEl = video as HTMLVideoElement;
      if (videoEl.readyState >= 2) {
        resolve();
        return;
      }
      videoEl.addEventListener('canplay', () => resolve(), { once: true });
      videoEl.currentTime = 0.001;
    }

    setTimeout(resolve, 500);
  });
}

export function waitForVideoMetadata(video: HTMLVideoElement, timeout = 8000): Promise<void> {
  return new Promise((resolve) => {
    if (video.readyState >= 1) {
      resolve();
      return;
    }
    const timeoutId = setTimeout(() => {
      log.warn('Video metadata load timeout', { src: video.src?.substring(0, 50) });
      resolve();
    }, timeout);
    video.onloadedmetadata = () => {
      clearTimeout(timeoutId);
      resolve();
    };
    video.onerror = () => {
      clearTimeout(timeoutId);
      resolve();
    };
  });
}

export function waitForVideoReady(video: HTMLVideoElement, timeout = 2000): Promise<void> {
  return new Promise((resolve) => {
    if (video.readyState >= 4) {
      resolve();
      return;
    }
    const timeoutId = setTimeout(resolve, timeout);
    const handler = () => {
      clearTimeout(timeoutId);
      resolve();
    };
    video.addEventListener('canplaythrough', handler, { once: true });
  });
}
