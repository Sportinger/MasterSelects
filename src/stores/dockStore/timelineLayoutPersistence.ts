import type { SavedDockTimelineLayout, SavedDockTimelineTrackSlotLayout } from '../../types/dock';

const VALID_TIMELINE_AUDIO_DISPLAY_MODES = new Set(['compact', 'detailed', 'spectral']);
const VALID_TIMELINE_TRACK_FOCUS_MODES = new Set(['balanced', 'audio', 'video']);
export const TIMELINE_TRACK_TYPES = ['video', 'audio'] as const;
export type TimelineTrackType = (typeof TIMELINE_TRACK_TYPES)[number];
const MAX_SAVED_TIMELINE_TRACKS_PER_TYPE = 64;
function cleanupSavedTrackTypeCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.min(MAX_SAVED_TIMELINE_TRACKS_PER_TYPE, Math.floor(value)));
}

export function cleanupSavedTimelineLayout(timeline: SavedDockTimelineLayout | undefined): SavedDockTimelineLayout | undefined {
  if (!timeline || typeof timeline !== 'object') {
    return undefined;
  }

  const cleaned: SavedDockTimelineLayout = {};
  if (
    typeof timeline.audioDisplayMode === 'string'
    && VALID_TIMELINE_AUDIO_DISPLAY_MODES.has(timeline.audioDisplayMode)
  ) {
    cleaned.audioDisplayMode = timeline.audioDisplayMode;
  }
  if (typeof timeline.audioLayerAdvancedMode === 'boolean') {
    cleaned.audioLayerAdvancedMode = timeline.audioLayerAdvancedMode;
  }
  if (typeof timeline.audioFocusMode === 'boolean') {
    cleaned.audioFocusMode = timeline.audioFocusMode;
  }
  if (
    typeof timeline.trackFocusMode === 'string'
    && VALID_TIMELINE_TRACK_FOCUS_MODES.has(timeline.trackFocusMode)
  ) {
    cleaned.trackFocusMode = timeline.trackFocusMode;
  }
  if (typeof timeline.trackHeaderWidth === 'number' && Number.isFinite(timeline.trackHeaderWidth)) {
    cleaned.trackHeaderWidth = timeline.trackHeaderWidth;
  }
  if (timeline.timelineSplitRatio === null) {
    cleaned.timelineSplitRatio = null;
  } else if (typeof timeline.timelineSplitRatio === 'number' && Number.isFinite(timeline.timelineSplitRatio)) {
    cleaned.timelineSplitRatio = Math.max(0, Math.min(1, timeline.timelineSplitRatio));
  }

  if (
    timeline.trackHeights
    && typeof timeline.trackHeights === 'object'
    && !Array.isArray(timeline.trackHeights)
  ) {
    const trackHeights: Record<string, number> = {};
    for (const [trackId, height] of Object.entries(timeline.trackHeights)) {
      if (typeof height === 'number' && Number.isFinite(height)) {
        trackHeights[trackId] = height;
      }
    }
    if (Object.keys(trackHeights).length > 0) {
      cleaned.trackHeights = trackHeights;
    }
  }
  if (
    timeline.trackTypeHeights
    && typeof timeline.trackTypeHeights === 'object'
    && !Array.isArray(timeline.trackTypeHeights)
  ) {
    const trackTypeHeights: Partial<Record<'video' | 'audio', number>> = {};
    if (typeof timeline.trackTypeHeights.video === 'number' && Number.isFinite(timeline.trackTypeHeights.video)) {
      trackTypeHeights.video = timeline.trackTypeHeights.video;
    }
    if (typeof timeline.trackTypeHeights.audio === 'number' && Number.isFinite(timeline.trackTypeHeights.audio)) {
      trackTypeHeights.audio = timeline.trackTypeHeights.audio;
    }
    if (Object.keys(trackTypeHeights).length > 0) {
      cleaned.trackTypeHeights = trackTypeHeights;
    }
  }
  if (
    timeline.trackVisibility
    && typeof timeline.trackVisibility === 'object'
    && !Array.isArray(timeline.trackVisibility)
  ) {
    const trackVisibility: Record<string, boolean> = {};
    for (const [trackId, visible] of Object.entries(timeline.trackVisibility)) {
      if (typeof visible === 'boolean') {
        trackVisibility[trackId] = visible;
      }
    }
    if (Object.keys(trackVisibility).length > 0) {
      cleaned.trackVisibility = trackVisibility;
    }
  }
  if (
    timeline.trackTypeVisibility
    && typeof timeline.trackTypeVisibility === 'object'
    && !Array.isArray(timeline.trackTypeVisibility)
  ) {
    const trackTypeVisibility: Partial<Record<'video' | 'audio', boolean>> = {};
    if (typeof timeline.trackTypeVisibility.video === 'boolean') {
      trackTypeVisibility.video = timeline.trackTypeVisibility.video;
    }
    if (typeof timeline.trackTypeVisibility.audio === 'boolean') {
      trackTypeVisibility.audio = timeline.trackTypeVisibility.audio;
    }
    if (Object.keys(trackTypeVisibility).length > 0) {
      cleaned.trackTypeVisibility = trackTypeVisibility;
    }
  }
  if (
    timeline.trackTypeCounts
    && typeof timeline.trackTypeCounts === 'object'
    && !Array.isArray(timeline.trackTypeCounts)
  ) {
    const trackTypeCounts: Partial<Record<TimelineTrackType, number>> = {};
    for (const type of TIMELINE_TRACK_TYPES) {
      const count = cleanupSavedTrackTypeCount(timeline.trackTypeCounts[type]);
      if (count !== null) {
        trackTypeCounts[type] = count;
      }
    }
    if (Object.keys(trackTypeCounts).length > 0) {
      cleaned.trackTypeCounts = trackTypeCounts;
    }
  }
  if (
    timeline.trackTypeLayouts
    && typeof timeline.trackTypeLayouts === 'object'
    && !Array.isArray(timeline.trackTypeLayouts)
  ) {
    const trackTypeLayouts: Partial<Record<TimelineTrackType, SavedDockTimelineTrackSlotLayout[]>> = {};
    for (const type of TIMELINE_TRACK_TYPES) {
      const slots = timeline.trackTypeLayouts[type];
      if (!Array.isArray(slots)) {
        continue;
      }

      const cleanedSlots = slots
        .slice(0, MAX_SAVED_TIMELINE_TRACKS_PER_TYPE)
        .map((slot): SavedDockTimelineTrackSlotLayout => {
          const cleanedSlot: SavedDockTimelineTrackSlotLayout = {};
          if (!slot || typeof slot !== 'object' || Array.isArray(slot)) {
            return cleanedSlot;
          }
          if (typeof slot.height === 'number' && Number.isFinite(slot.height)) {
            cleanedSlot.height = slot.height;
          }
          if (typeof slot.visible === 'boolean') {
            cleanedSlot.visible = slot.visible;
          }
          return cleanedSlot;
        });

      if (cleanedSlots.length > 0) {
        trackTypeLayouts[type] = cleanedSlots;
      }
    }
    if (Object.keys(trackTypeLayouts).length > 0) {
      cleaned.trackTypeLayouts = trackTypeLayouts;
    }
  }

  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}
