// PlayheadState - High-frequency playhead position management
// Updated every frame by playback loop to avoid store update overhead

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
};

/**
 * Get current playhead position, preferring internal position during playback
 */
export function getPlayheadPosition(storePosition: number): number {
  return playheadState.isUsingInternalPosition
    ? playheadState.position
    : storePosition;
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
  playheadState.hasMasterAudio = true;
  playheadState.masterAudioElement = element;
  playheadState.masterClipStartTime = clipStartTime;
  playheadState.masterClipInPoint = clipInPoint;
  playheadState.masterClipSpeed = speed;
}

/**
 * Clear the master audio element
 */
export function clearMasterAudio(): void {
  playheadState.hasMasterAudio = false;
  playheadState.masterAudioElement = null;
}

/**
 * Start using internal position (called when playback starts)
 */
export function startInternalPosition(position: number): void {
  playheadState.position = position;
  playheadState.isUsingInternalPosition = true;
  playheadState.playbackJustStarted = true;
}

/**
 * Stop using internal position (called when playback stops)
 */
export function stopInternalPosition(): void {
  playheadState.isUsingInternalPosition = false;
  playheadState.playbackJustStarted = false;
  clearMasterAudio();
}

/**
 * Update internal position during playback
 */
export function updateInternalPosition(position: number): void {
  playheadState.position = position;
}
