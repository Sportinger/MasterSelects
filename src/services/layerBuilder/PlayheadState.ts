// PlayheadState - High-frequency playhead position management
// Updated every frame by playback loop to avoid store update overhead

import { vfPipelineMonitor } from '../vfPipelineMonitor';

/**
 * Playhead state data structure
 * Accessed directly without React/Zustand overhead for performance
 */
export interface PlayheadStateData {
  /** Current playhead position in seconds */
  position: number;

  /** True during playback, false when paused */
  isUsingInternalPosition: boolean;

  /** True for first few frames after playback starts */
  playbackJustStarted: boolean;

  // Audio Master Clock - audio runs freely, playhead follows
  /** The audio/video element driving the playhead */
  masterAudioElement: HTMLAudioElement | HTMLVideoElement | null;

  /** Optional WebAudio/source clock driving the playhead. Returns source time in seconds. */
  masterAudioClock: (() => number | null) | null;

  /** clip.startTime in timeline */
  masterClipStartTime: number;

  /** clip.inPoint in source */
  masterClipInPoint: number;

  /** Playback speed of master clip */
  masterClipSpeed: number;

  /** True if we have an active audio master */
  hasMasterAudio: boolean;

  /** Optional held playback position during scrub-release settle */
  heldPlaybackPosition: number | null;

  /** Clip that currently owns the held playback position */
  heldPlaybackClipId: string | null;

  /** Wall-clock anchor for playback before/around React UI commits */
  clockStartTimeMs: number | null;

  /** Timeline position at clockStartTimeMs */
  clockStartPosition: number;

  /** Playback speed used by the wall-clock fallback */
  clockPlaybackSpeed: number;
}

/**
 * Global playhead state - updated every frame during playback
 * This avoids store updates which trigger subscriber cascades
 */
export const playheadState: PlayheadStateData = {
  position: 0,
  isUsingInternalPosition: false,
  playbackJustStarted: false,
  masterAudioElement: null,
  masterAudioClock: null,
  masterClipStartTime: 0,
  masterClipInPoint: 0,
  masterClipSpeed: 1,
  hasMasterAudio: false,
  heldPlaybackPosition: null,
  heldPlaybackClipId: null,
  clockStartTimeMs: null,
  clockStartPosition: 0,
  clockPlaybackSpeed: 1,
};

function getNowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function sanitizePlayheadPosition(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function sanitizeClockDrivenPosition(value: unknown, fallback = playheadState.position): number {
  const safePosition = sanitizePlayheadPosition(value, fallback);
  const safeFallback = sanitizePlayheadPosition(fallback, safePosition);
  const speed = sanitizePlayheadPosition(playheadState.clockPlaybackSpeed, 1);

  if (speed >= 0 && safePosition < safeFallback) {
    return safeFallback;
  }
  if (speed < 0 && safePosition > safeFallback) {
    return safeFallback;
  }
  return safePosition;
}

/**
 * Get current playhead position, preferring internal position during playback
 */
export function getPlayheadPosition(storePosition: number): number {
  const safeInternal = sanitizePlayheadPosition(playheadState.position, 0);
  const safeStore = sanitizePlayheadPosition(storePosition, safeInternal);

  return playheadState.isUsingInternalPosition
    ? getInternalPlaybackPosition(safeInternal)
    : safeStore;
}

export function getInternalPlaybackPosition(fallback = playheadState.position): number {
  const held = playheadState.heldPlaybackPosition;
  if (held !== null) {
    return sanitizePlayheadPosition(held, fallback);
  }

  if (playheadState.hasMasterAudio) {
    const speed = playheadState.masterClipSpeed || 1;
    const audio = playheadState.masterAudioElement;
    if (audio && !audio.paused && audio.readyState >= 2) {
      return sanitizeClockDrivenPosition(
        playheadState.masterClipStartTime +
          (audio.currentTime - playheadState.masterClipInPoint) / speed,
        fallback
      );
    }

    const audioTime = playheadState.masterAudioClock?.();
    if (audioTime !== null && audioTime !== undefined && Number.isFinite(audioTime)) {
      return sanitizeClockDrivenPosition(
        playheadState.masterClipStartTime +
          (audioTime - playheadState.masterClipInPoint) / speed,
        fallback
      );
    }
  }

  if (playheadState.clockStartTimeMs !== null) {
    const elapsedSeconds = Math.max(0, (getNowMs() - playheadState.clockStartTimeMs) / 1000);
    return sanitizePlayheadPosition(
      playheadState.clockStartPosition + elapsedSeconds * playheadState.clockPlaybackSpeed,
      fallback
    );
  }

  return sanitizePlayheadPosition(playheadState.position, fallback);
}

/**
 * Set the master audio element for playhead sync
 */
export function setMasterAudio(
  element: HTMLAudioElement | HTMLVideoElement,
  clipStartTime: number,
  clipInPoint: number,
  speed: number
): void {
  const prevElement = playheadState.masterAudioElement;
  playheadState.hasMasterAudio = true;
  playheadState.masterAudioElement = element;
  playheadState.masterAudioClock = null;
  playheadState.masterClipStartTime = clipStartTime;
  playheadState.masterClipInPoint = clipInPoint;
  playheadState.masterClipSpeed = speed;
  if (prevElement !== element) {
    vfPipelineMonitor.record('audio_master_change', {
      clipStartTime: Math.round(clipStartTime * 1000) / 1000,
      speed: Math.round(speed * 100) / 100,
    });
  }
}

/**
 * Set a custom source-time clock for WebAudio playback paths.
 */
export function setMasterAudioClock(
  getSourceTime: () => number | null,
  clipStartTime: number,
  clipInPoint: number,
  speed: number
): void {
  const prevClock = playheadState.masterAudioClock;
  playheadState.hasMasterAudio = true;
  playheadState.masterAudioElement = null;
  playheadState.masterAudioClock = getSourceTime;
  playheadState.masterClipStartTime = clipStartTime;
  playheadState.masterClipInPoint = clipInPoint;
  playheadState.masterClipSpeed = speed;
  if (prevClock !== getSourceTime) {
    vfPipelineMonitor.record('audio_master_change', {
      clipStartTime: Math.round(clipStartTime * 1000) / 1000,
      speed: Math.round(speed * 100) / 100,
      source: 'webaudio',
    });
  }
}

/**
 * Clear the master audio element
 */
export function clearMasterAudio(): void {
  playheadState.hasMasterAudio = false;
  playheadState.masterAudioElement = null;
  playheadState.masterAudioClock = null;
}

export function holdInternalPlaybackPosition(position: number, clipId?: string): void {
  playheadState.heldPlaybackPosition = sanitizePlayheadPosition(
    position,
    playheadState.position
  );
  playheadState.heldPlaybackClipId = clipId ?? null;
}

export function clearInternalPlaybackHold(clipId?: string): void {
  if (
    clipId !== undefined &&
    playheadState.heldPlaybackClipId !== null &&
    playheadState.heldPlaybackClipId !== clipId
  ) {
    return;
  }
  playheadState.heldPlaybackPosition = null;
  playheadState.heldPlaybackClipId = null;
}

/**
 * Start using internal position (called when playback starts)
 */
export function startInternalPosition(position: number, playbackSpeed = playheadState.clockPlaybackSpeed || 1): void {
  playheadState.position = position;
  playheadState.isUsingInternalPosition = true;
  playheadState.playbackJustStarted = true;
  playheadState.clockStartTimeMs = getNowMs();
  playheadState.clockStartPosition = position;
  playheadState.clockPlaybackSpeed = playbackSpeed;
  clearInternalPlaybackHold();
}

/**
 * Stop using internal position (called when playback stops)
 */
export function stopInternalPosition(): void {
  playheadState.isUsingInternalPosition = false;
  playheadState.playbackJustStarted = false;
  playheadState.clockStartTimeMs = null;
  playheadState.clockStartPosition = playheadState.position;
  clearInternalPlaybackHold();
  clearMasterAudio();
}

/**
 * Update internal position during playback
 */
export function updateInternalPosition(position: number): void {
  playheadState.position = position;
  playheadState.clockStartTimeMs = getNowMs();
  playheadState.clockStartPosition = position;
}

export function updateInternalPlaybackSpeed(playbackSpeed: number): void {
  const currentPosition = getInternalPlaybackPosition(playheadState.position);
  playheadState.position = currentPosition;
  playheadState.clockStartTimeMs = getNowMs();
  playheadState.clockStartPosition = currentPosition;
  playheadState.clockPlaybackSpeed = playbackSpeed;
}
