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
  masterClipStartTime: 0,
  masterClipInPoint: 0,
  masterClipSpeed: 1,
  hasMasterAudio: false,
  heldPlaybackPosition: null,
  heldPlaybackClipId: null,
};

export function sanitizePlayheadPosition(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Get current playhead position, preferring internal position during playback
 */
export function getPlayheadPosition(storePosition: number): number {
  const safeInternal = sanitizePlayheadPosition(playheadState.position, 0);
  const safeStore = sanitizePlayheadPosition(storePosition, safeInternal);

  return playheadState.isUsingInternalPosition
    ? safeInternal
    : safeStore;
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
 * Clear the master audio element
 */
export function clearMasterAudio(): void {
  playheadState.hasMasterAudio = false;
  playheadState.masterAudioElement = null;
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
export function startInternalPosition(position: number): void {
  playheadState.position = position;
  playheadState.isUsingInternalPosition = true;
  playheadState.playbackJustStarted = true;
  clearInternalPlaybackHold();
}

/**
 * Stop using internal position (called when playback stops)
 */
export function stopInternalPosition(): void {
  playheadState.isUsingInternalPosition = false;
  playheadState.playbackJustStarted = false;
  clearInternalPlaybackHold();
  clearMasterAudio();
}

/**
 * Align the render-path playhead to a paused store position.
 * Used by restore/reset paths that bypass the normal setPlayhead action.
 */
export function syncPausedPlayheadPosition(position: number): void {
  playheadState.position = sanitizePlayheadPosition(position, playheadState.position);
  playheadState.isUsingInternalPosition = false;
  playheadState.playbackJustStarted = false;
  clearInternalPlaybackHold();
  clearMasterAudio();
}

/**
 * Update internal position during playback
 */
export function updateInternalPosition(position: number): void {
  playheadState.position = position;
}
