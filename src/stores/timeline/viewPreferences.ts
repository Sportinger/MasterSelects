import {
  TIMELINE_GRID_SUBDIVISIONS,
  type TimelineGridSubdivision,
} from '../../timeline/tempo/barsGrid';
import type { MetronomeMode } from '../../services/audio/metronomeScheduler';

const AUDIO_LAYER_ADVANCED_MODE_STORAGE_KEY = 'masterselects.audioLayerAdvancedMode';
const TIMELINE_TRACK_FOCUS_MODE_STORAGE_KEY = 'masterselects.timelineTrackFocusMode';
const TIMELINE_TRACK_HEADER_WIDTH_STORAGE_KEY = 'masterselects.timelineTrackHeaderWidth';
const TIMELINE_SPLIT_RATIO_STORAGE_KEY = 'masterselects.timelineSplitRatio';
const TIMELINE_SNAPPING_ENABLED_STORAGE_KEY = 'masterselects.timelineSnappingEnabled';
const TIMELINE_GRID_SUBDIVISION_STORAGE_KEY = 'masterselects.timelineGridSubdivision';
const METRONOME_ENABLED_STORAGE_KEY = 'masterselects.metronomeEnabled';
const METRONOME_VOLUME_STORAGE_KEY = 'masterselects.metronomeVolume';
const METRONOME_MODE_STORAGE_KEY = 'masterselects.metronomeMode';
const MOTION_PROPERTY_FAVORITES_STORAGE_KEY = 'masterselects.motionPropertyFavorites';
const TIMELINE_CURVE_MODE_STORAGE_KEY = 'masterselects.timelineCurveMode';
const MOTION_PATH_ONION_SKIN_VISIBLE_STORAGE_KEY = 'masterselects.motionPathOnionSkinVisible';
const MOTION_PATH_ONION_FRAME_DISTANCE_STORAGE_KEY = 'masterselects.motionPathOnionFrameDistance';

export const MOTION_PROPERTY_FAVORITES_CHANGED_EVENT = 'masterselects:motion-property-favorites-changed';

type TimelineTrackFocusModePreference = 'balanced' | 'audio' | 'video';
export type TimelineCurveMode = 'timeline' | 'graph';

export const MOTION_PROPERTY_FAVORITES_PREFERENCE_VERSION = 1 as const;
export const MIN_MOTION_PATH_ONION_FRAME_DISTANCE = 1;
export const MAX_MOTION_PATH_ONION_FRAME_DISTANCE = 120;

export interface MotionPropertyFavoritesPreferenceV1 {
  version: typeof MOTION_PROPERTY_FAVORITES_PREFERENCE_VERSION;
  favoritePropertyPaths: string[];
}

const VALID_TRACK_FOCUS_MODES = new Set<TimelineTrackFocusModePreference>(['balanced', 'audio', 'video']);
const VALID_TIMELINE_CURVE_MODES = new Set<TimelineCurveMode>(['timeline', 'graph']);

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

function normalizeMotionPropertyFavoritePaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const paths: string[] = [];
  for (const path of value) {
    if (typeof path !== 'string' || path.length === 0 || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}

export function parseMotionPropertyFavoritePathsPreference(
  serialized: string | null,
  fallback: readonly string[] = [],
): string[] {
  const normalizedFallback = normalizeMotionPropertyFavoritePaths(fallback);
  if (serialized === null) return normalizedFallback;

  try {
    const parsed: unknown = JSON.parse(serialized);
    // The unversioned array/object forms are accepted as a one-way legacy
    // adapter. Every subsequent write uses the current versioned envelope.
    if (Array.isArray(parsed)) {
      return normalizeMotionPropertyFavoritePaths(parsed);
    }
    if (!parsed || typeof parsed !== 'object') return normalizedFallback;

    const record = parsed as Record<string, unknown>;
    if (record.version !== undefined
      && record.version !== MOTION_PROPERTY_FAVORITES_PREFERENCE_VERSION) {
      return normalizedFallback;
    }
    if (!Array.isArray(record.favoritePropertyPaths)) return normalizedFallback;
    return normalizeMotionPropertyFavoritePaths(record.favoritePropertyPaths);
  } catch {
    return normalizedFallback;
  }
}

export function serializeMotionPropertyFavoritePathsPreference(
  favoritePropertyPaths: readonly string[],
): string {
  const preference: MotionPropertyFavoritesPreferenceV1 = {
    version: MOTION_PROPERTY_FAVORITES_PREFERENCE_VERSION,
    favoritePropertyPaths: normalizeMotionPropertyFavoritePaths(favoritePropertyPaths),
  };
  return JSON.stringify(preference);
}

export function readStoredMotionPropertyFavoritePaths(
  fallback: readonly string[] = [],
): string[] {
  if (!canUseLocalStorage()) return normalizeMotionPropertyFavoritePaths(fallback);

  try {
    return parseMotionPropertyFavoritePathsPreference(
      localStorage.getItem(MOTION_PROPERTY_FAVORITES_STORAGE_KEY),
      fallback,
    );
  } catch {
    return normalizeMotionPropertyFavoritePaths(fallback);
  }
}

export function persistStoredMotionPropertyFavoritePaths(
  favoritePropertyPaths: readonly string[],
): void {
  persistStoredValue(
    MOTION_PROPERTY_FAVORITES_STORAGE_KEY,
    serializeMotionPropertyFavoritePathsPreference(favoritePropertyPaths),
  );
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(MOTION_PROPERTY_FAVORITES_CHANGED_EVENT));
  }
}

export function readStoredTimelineCurveMode(fallback: TimelineCurveMode): TimelineCurveMode {
  if (!canUseLocalStorage()) return fallback;

  try {
    const stored = localStorage.getItem(TIMELINE_CURVE_MODE_STORAGE_KEY);
    return VALID_TIMELINE_CURVE_MODES.has(stored as TimelineCurveMode)
      ? stored as TimelineCurveMode
      : fallback;
  } catch {
    return fallback;
  }
}

export function persistStoredTimelineCurveMode(mode: TimelineCurveMode): void {
  if (!VALID_TIMELINE_CURVE_MODES.has(mode)) return;
  persistStoredValue(TIMELINE_CURVE_MODE_STORAGE_KEY, mode);
}

export function readStoredMotionPathOnionSkinVisible(fallback: boolean): boolean {
  if (!canUseLocalStorage()) return fallback;

  try {
    const stored = localStorage.getItem(MOTION_PATH_ONION_SKIN_VISIBLE_STORAGE_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }
  return fallback;
}

export function persistStoredMotionPathOnionSkinVisible(visible: boolean): void {
  persistStoredValue(MOTION_PATH_ONION_SKIN_VISIBLE_STORAGE_KEY, visible ? 'true' : 'false');
}

export function normalizeMotionPathOnionFrameDistance(distance: number): number | null {
  if (!Number.isFinite(distance)) return null;
  return Math.min(
    MAX_MOTION_PATH_ONION_FRAME_DISTANCE,
    Math.max(MIN_MOTION_PATH_ONION_FRAME_DISTANCE, Math.round(distance)),
  );
}

export function readStoredMotionPathOnionFrameDistance(fallback: number): number {
  if (!canUseLocalStorage()) return fallback;

  try {
    const stored = localStorage.getItem(MOTION_PATH_ONION_FRAME_DISTANCE_STORAGE_KEY);
    if (stored === null || stored.trim() === '') return fallback;
    return normalizeMotionPathOnionFrameDistance(Number(stored)) ?? fallback;
  } catch {
    return fallback;
  }
}

export function persistStoredMotionPathOnionFrameDistance(distance: number): void {
  const normalized = normalizeMotionPathOnionFrameDistance(distance);
  if (normalized === null) return;
  persistStoredValue(MOTION_PATH_ONION_FRAME_DISTANCE_STORAGE_KEY, String(normalized));
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

// Which musical division the bars grid and its snapping use (issue #299). A
// per-user view preference like snapping — never project content.
export function readStoredTimelineGridSubdivision(
  fallback: TimelineGridSubdivision,
): TimelineGridSubdivision {
  if (!canUseLocalStorage()) {
    return fallback;
  }

  try {
    const stored = localStorage.getItem(TIMELINE_GRID_SUBDIVISION_STORAGE_KEY);
    if (stored && (TIMELINE_GRID_SUBDIVISIONS as string[]).includes(stored)) {
      return stored as TimelineGridSubdivision;
    }
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }

  return fallback;
}

export function persistTimelineGridSubdivision(subdivision: TimelineGridSubdivision): void {
  persistStoredValue(TIMELINE_GRID_SUBDIVISION_STORAGE_KEY, subdivision);
}

// Metronome settings are per-USER view state, never project content (plan §3.6).
export function readStoredMetronomeEnabled(fallback: boolean): boolean {
  if (!canUseLocalStorage()) return fallback;
  try {
    const stored = localStorage.getItem(METRONOME_ENABLED_STORAGE_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }
  return fallback;
}

export function persistMetronomeEnabled(enabled: boolean): void {
  persistStoredValue(METRONOME_ENABLED_STORAGE_KEY, enabled ? 'true' : 'false');
}

export function readStoredMetronomeVolume(fallback: number): number {
  return readStoredFiniteNumber(
    METRONOME_VOLUME_STORAGE_KEY,
    fallback,
    (value) => Math.min(1, Math.max(0, value)),
  );
}

export function persistMetronomeVolume(volume: number): void {
  persistStoredValue(METRONOME_VOLUME_STORAGE_KEY, String(Math.min(1, Math.max(0, volume))));
}

export function readStoredMetronomeMode(fallback: MetronomeMode): MetronomeMode {
  if (!canUseLocalStorage()) return fallback;
  try {
    const stored = localStorage.getItem(METRONOME_MODE_STORAGE_KEY);
    if (stored === 'beats' || stored === 'bars') return stored;
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }
  return fallback;
}

export function persistMetronomeMode(mode: MetronomeMode): void {
  persistStoredValue(METRONOME_MODE_STORAGE_KEY, mode);
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
