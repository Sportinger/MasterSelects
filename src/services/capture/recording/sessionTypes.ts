export type CapturePhase =
  | 'idle'
  | 'requesting-source'
  | 'previewing'
  | 'recording'
  | 'paused'
  | 'stopping'
  | 'complete'
  | 'error';

export type CaptureSurface = 'monitor' | 'window' | 'browser' | 'unknown';
export type CaptureTier = 'media-recorder' | 'webcodecs';

export interface CaptureDimensions {
  width: number;
  height: number;
}

export interface CaptureSourceSnapshot {
  surface: CaptureSurface;
  dimensions: CaptureDimensions;
  hasDisplayAudio: boolean;
  hasMicrophoneAudio?: boolean;
  cursorSupported: boolean;
}

export interface CaptureRecordingConfig {
  tier: CaptureTier;
  fps: 30 | 60;
  bitrateBitsPerSecond: number;
  audioBitrateBitsPerSecond?: number;
  crop?: { x: number; y: number; width: number; height: number };
  scale?: 1 | 0.75 | 0.5 | '1080p';
}

export type CaptureStorageWarningCode =
  | 'storage-estimate-unavailable'
  | 'storage-quota-low'
  | 'storage-persistence-denied'
  | 'storage-persistence-granted';

export interface CaptureStorageWarning {
  code: CaptureStorageWarningCode;
  severity: 'info' | 'warning';
  message: string;
  usageBytes?: number;
  quotaBytes?: number;
  availableBytes?: number;
  estimatedSessionBytes?: number;
  persistent?: boolean;
}

export interface CaptureRecordingResult {
  sessionId: string;
  mimeType: string;
  durationSeconds: number;
  bytes: number;
  artifactIds: string[];
}

export interface CaptureSessionSnapshot {
  phase: CapturePhase;
  sessionId?: string;
  selectedSurface?: CaptureSurface;
  activeTier?: CaptureTier;
  mimeType?: string;
  codec?: string;
  dimensions?: CaptureDimensions;
  hasDisplayAudio?: boolean;
  hasMicrophoneAudio?: boolean;
  cursorSupported?: boolean;
  elapsedSeconds: number;
  bytes: number;
  encoderQueueSize: number;
  droppedFrames: number;
  startedAt?: number;
  pausedAt?: number;
  pausedDurationMs: number;
  storageWarnings: CaptureStorageWarning[];
  sourceLost: boolean;
  lastError?: string;
  result?: CaptureRecordingResult;
}

export function createIdleCaptureSnapshot(): CaptureSessionSnapshot {
  return {
    phase: 'idle',
    elapsedSeconds: 0,
    bytes: 0,
    encoderQueueSize: 0,
    droppedFrames: 0,
    pausedDurationMs: 0,
    storageWarnings: [],
    sourceLost: false,
  };
}

export function createCaptureSessionId(now: number): string {
  return `capture-${Math.round(now)}-${Math.random().toString(36).slice(2, 8)}`;
}
