const AUDIO_LAYER_ADVANCED_MODE_STORAGE_KEY = 'masterselects.audioLayerAdvancedMode';
const TIMELINE_TRACK_FOCUS_MODE_STORAGE_KEY = 'masterselects.timelineTrackFocusMode';
const TIMELINE_TRACK_HEADER_WIDTH_STORAGE_KEY = 'masterselects.timelineTrackHeaderWidth';
const TIMELINE_SPLIT_RATIO_STORAGE_KEY = 'masterselects.timelineSplitRatio';
const TIMELINE_SNAPPING_ENABLED_STORAGE_KEY = 'masterselects.timelineSnappingEnabled';

type TimelineTrackFocusModePreference = 'balanced' | 'audio' | 'video';

const VALID_TRACK_FOCUS_MODES = new Set<TimelineTrackFocusModePreference>(['balanced', 'audio', 'video']);

function canUseLocalStorage(): boolean {
  return typeof localStorage !== 'undefined';
}

function readStoredFiniteNumber(
  key: string,
  fallback: number,
  normalize: (value: number) => number,
): number {
  if (!canUseLocalStorage()) {
    return fallback;
  }

  try {
    const stored = localStorage.getItem(key);
    if (stored === null) return fallback;
    const parsed = Number(stored);
    return Number.isFinite(parsed) ? normalize(parsed) : fallback;
  } catch {
    return fallback;
  }
}

function persistStoredValue(key: string, value: string): void {
  if (!canUseLocalStorage()) {
    return;
  }

  try {
    localStorage.setItem(key, value);
  } catch {
    // Persisting view preferences is best-effort; the in-memory state still updates.
  }
}

export function readStoredAudioLayerAdvancedMode(fallback: boolean): boolean {
  if (!canUseLocalStorage()) {
    return fallback;
  }

  try {
    const stored = localStorage.getItem(AUDIO_LAYER_ADVANCED_MODE_STORAGE_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }

  return fallback;
}

export function persistAudioLayerAdvancedMode(enabled: boolean): void {
  persistStoredValue(AUDIO_LAYER_ADVANCED_MODE_STORAGE_KEY, enabled ? 'true' : 'false');
}

export function readStoredTimelineSnappingEnabled(fallback: boolean): boolean {
  if (!canUseLocalStorage()) {
    return fallback;
  }

  try {
    const stored = localStorage.getItem(TIMELINE_SNAPPING_ENABLED_STORAGE_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }

  return fallback;
}

export function persistTimelineSnappingEnabled(enabled: boolean): void {
  persistStoredValue(TIMELINE_SNAPPING_ENABLED_STORAGE_KEY, enabled ? 'true' : 'false');
}

export function readStoredTimelineTrackFocusMode(
  fallback: TimelineTrackFocusModePreference,
): TimelineTrackFocusModePreference {
  if (!canUseLocalStorage()) {
    return fallback;
  }

  try {
    const stored = localStorage.getItem(TIMELINE_TRACK_FOCUS_MODE_STORAGE_KEY);
    return VALID_TRACK_FOCUS_MODES.has(stored as TimelineTrackFocusModePreference)
      ? (stored as TimelineTrackFocusModePreference)
      : fallback;
  } catch {
    return fallback;
  }
}

export function persistTimelineTrackFocusMode(mode: TimelineTrackFocusModePreference): void {
  if (!VALID_TRACK_FOCUS_MODES.has(mode)) {
    return;
  }

  persistStoredValue(TIMELINE_TRACK_FOCUS_MODE_STORAGE_KEY, mode);
}

export function readStoredTimelineTrackHeaderWidth(
  fallback: number,
  minWidth: number,
  maxWidth: number,
): number {
  return readStoredFiniteNumber(
    TIMELINE_TRACK_HEADER_WIDTH_STORAGE_KEY,
    fallback,
    (value) => Math.max(minWidth, Math.min(maxWidth, value)),
  );
}

export function persistTimelineTrackHeaderWidth(width: number): void {
  if (!Number.isFinite(width)) {
    return;
  }

  persistStoredValue(TIMELINE_TRACK_HEADER_WIDTH_STORAGE_KEY, String(width));
}

export function readStoredTimelineSplitRatio(fallback: number | null): number | null {
  if (!canUseLocalStorage()) {
    return fallback;
  }

  try {
    const stored = localStorage.getItem(TIMELINE_SPLIT_RATIO_STORAGE_KEY);
    if (stored === null) return fallback;
    if (stored === 'null') return null;
    const parsed = Number(stored);
    return Number.isFinite(parsed)
      ? Math.max(0, Math.min(1, parsed))
      : fallback;
  } catch {
    return fallback;
  }
}

export function persistTimelineSplitRatio(ratio: number | null): void {
  if (ratio === null) {
    persistStoredValue(TIMELINE_SPLIT_RATIO_STORAGE_KEY, 'null');
    return;
  }

  if (!Number.isFinite(ratio)) {
    return;
  }

  persistStoredValue(TIMELINE_SPLIT_RATIO_STORAGE_KEY, String(Math.max(0, Math.min(1, ratio))));
}
