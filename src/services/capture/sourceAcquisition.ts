import type { CaptureSourceRuntime } from './ScreenCaptureService';
import type { CaptureSourceSnapshot, CaptureSurface } from './recording/sessionTypes';

export type PreferredCaptureSurface = 'monitor' | 'window' | 'browser';
export type CaptureAcquisitionErrorCode =
  | 'not-supported'
  | 'insecure-context'
  | 'permission-denied'
  | 'permissions-policy'
  | 'invalid-state'
  | 'no-video-track'
  | 'unknown';

export class CaptureAcquisitionError extends Error {
  readonly code: CaptureAcquisitionErrorCode;

  constructor(code: CaptureAcquisitionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CaptureAcquisitionError';
    this.code = code;
  }
}

export interface AcquireDisplaySourceOptions {
  preferredSurface: PreferredCaptureSurface;
  includeAudio: boolean;
  includeCursor: boolean;
  muteCapturedTab: boolean;
}

export interface AcquiredDisplaySource {
  runtime: CaptureSourceRuntime;
  snapshot: CaptureSourceSnapshot;
}

interface CaptureControllerLike {
  setFocusBehavior(behavior: 'no-focus-change'): void;
}

interface CaptureControllerConstructor {
  new(): CaptureControllerLike;
}

interface DisplayMediaDevices {
  getDisplayMedia(constraints?: DisplayCaptureConstraints): Promise<MediaStream>;
}

type DisplayCaptureConstraints = Omit<DisplayMediaStreamOptions, 'audio' | 'video'> & {
  audio?: boolean | (MediaTrackConstraints & { suppressLocalAudioPlayback?: boolean });
  video?: boolean | MediaTrackConstraints;
  controller?: CaptureControllerLike;
  selfBrowserSurface?: 'include' | 'exclude';
  surfaceSwitching?: 'include' | 'exclude';
  systemAudio?: 'include' | 'exclude';
  windowAudio?: 'exclude' | 'window' | 'system';
};

export interface SourceAcquisitionDependencies {
  mediaDevices?: DisplayMediaDevices;
  CaptureController?: CaptureControllerConstructor;
  secureContext?: boolean;
}

function actualSurface(value: MediaTrackSettings['displaySurface']): CaptureSurface {
  return value === 'monitor' || value === 'window' || value === 'browser' ? value : 'unknown';
}

export function mapCaptureAcquisitionError(error: unknown): CaptureAcquisitionError {
  if (error instanceof CaptureAcquisitionError) return error;
  const name = error instanceof DOMException ? error.name : error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  if (name === 'NotAllowedError') {
    const policy = /policy|permissions/i.test(message);
    return new CaptureAcquisitionError(
      policy ? 'permissions-policy' : 'permission-denied',
      policy
        ? 'Screen capture is blocked by this page permissions policy.'
        : 'Screen sharing was canceled or permission was denied.',
      { cause: error },
    );
  }
  if (name === 'InvalidStateError') {
    return new CaptureAcquisitionError(
      'invalid-state',
      'Screen capture must be started from an active browser tab and a direct button click.',
      { cause: error },
    );
  }
  if (name === 'AbortError') {
    return new CaptureAcquisitionError('permission-denied', 'Screen sharing was canceled.', { cause: error });
  }
  if (name === 'NotFoundError' || name === 'NotReadableError') {
    return new CaptureAcquisitionError('no-video-track', 'No readable screen capture source is available.', { cause: error });
  }
  if (name === 'SecurityError') {
    return new CaptureAcquisitionError('insecure-context', 'Screen capture is blocked by browser security settings.', { cause: error });
  }
  return new CaptureAcquisitionError('unknown', 'The screen capture source could not be opened.', { cause: error });
}

export function buildDisplayMediaConstraints(
  options: AcquireDisplaySourceOptions,
  controller?: CaptureControllerLike,
): DisplayCaptureConstraints {
  return {
    video: {
      displaySurface: options.preferredSurface,
      cursor: options.includeCursor ? 'always' : 'never',
    } as MediaTrackConstraints,
    audio: options.includeAudio ? {
      suppressLocalAudioPlayback: options.muteCapturedTab,
    } : false,
    surfaceSwitching: 'include',
    systemAudio: options.includeAudio ? 'include' : 'exclude',
    windowAudio: options.includeAudio ? 'window' : 'exclude',
    ...(controller ? { controller } : {}),
  };
}

export async function acquireDisplaySource(
  options: AcquireDisplaySourceOptions,
  dependencies: SourceAcquisitionDependencies = {},
): Promise<AcquiredDisplaySource> {
  if ((dependencies.secureContext ?? globalThis.isSecureContext) === false) {
    throw new CaptureAcquisitionError('insecure-context', 'Screen capture requires a secure browser context.');
  }
  const mediaDevices = dependencies.mediaDevices
    ?? globalThis.navigator?.mediaDevices as unknown as DisplayMediaDevices | undefined;
  if (!mediaDevices?.getDisplayMedia) {
    throw new CaptureAcquisitionError('not-supported', 'Screen capture is not available in this browser.');
  }

  const Controller = dependencies.CaptureController
    ?? (globalThis as typeof globalThis & { CaptureController?: CaptureControllerConstructor }).CaptureController;
  const controller = Controller ? new Controller() : undefined;
  const capturePromise = mediaDevices.getDisplayMedia(buildDisplayMediaConstraints(options, controller));

  let stream: MediaStream;
  try {
    stream = await capturePromise;
  } catch (error) {
    throw mapCaptureAcquisitionError(error);
  }

  const videoTrack = stream.getVideoTracks()[0];
  if (!videoTrack) {
    stream.getTracks().forEach(track => track.stop());
    throw new CaptureAcquisitionError('no-video-track', 'The selected source did not provide a video track.');
  }

  try {
    controller?.setFocusBehavior('no-focus-change');
  } catch {
    // The focus hint is optional and browser-controlled.
  }
  const settings = videoTrack.getSettings();
  const capabilities = videoTrack.getCapabilities() as MediaTrackCapabilities & { cursor?: string[] };
  return {
    runtime: { stream },
    snapshot: {
      surface: actualSurface(settings.displaySurface),
      dimensions: { width: settings.width ?? 0, height: settings.height ?? 0 },
      hasDisplayAudio: stream.getAudioTracks().length > 0,
      cursorSupported: Array.isArray(capabilities.cursor) && capabilities.cursor.length > 0,
    },
  };
}

export function watchDisplaySourceEnded(stream: MediaStream, onEnded: () => void): () => void {
  const track = stream.getVideoTracks()[0];
  if (!track) return () => undefined;
  track.addEventListener('ended', onEnded, { once: true });
  return () => track.removeEventListener('ended', onEnded);
}
