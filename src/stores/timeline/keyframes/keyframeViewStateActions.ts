import type { AnimatableProperty, KeyframeActions, SliceCreator } from '../types';
import {
  MAX_CURVE_EDITOR_HEIGHT,
  MIN_CURVE_EDITOR_HEIGHT,
  PROPERTY_ROW_HEIGHT,
} from '../constants';

type KeyframeViewStateActions = Pick<
  KeyframeActions,
  | 'toggleTrackExpanded'
  | 'isTrackExpanded'
  | 'toggleTrackPropertyGroupExpanded'
  | 'isTrackPropertyGroupExpanded'
  | 'getExpandedTrackHeight'
  | 'trackHasKeyframes'
  | 'toggleCurveExpanded'
  | 'isCurveExpanded'
  | 'setCurveEditorHeight'
>;

export const createKeyframeViewStateActions: SliceCreator<KeyframeViewStateActions> = (set, get) => ({
  toggleTrackExpanded: (trackId) => {
    const { expandedTracks } = get();
    const newSet = new Set(expandedTracks);

    if (newSet.has(trackId)) {
      newSet.delete(trackId);
    } else {
      newSet.add(trackId);
    }

    set({ expandedTracks: newSet });
  },

  isTrackExpanded: (trackId) => {
    const { expandedTracks } = get();
    return expandedTracks.has(trackId);
  },

  toggleTrackPropertyGroupExpanded: (trackId, groupName) => {
    const { expandedTrackPropertyGroups } = get();
    const newMap = new Map(expandedTrackPropertyGroups);
    const trackGroups = newMap.get(trackId) || new Set<string>();
    const newTrackGroups = new Set(trackGroups);

    if (newTrackGroups.has(groupName)) {
      newTrackGroups.delete(groupName);
    } else {
      newTrackGroups.add(groupName);
    }

    newMap.set(trackId, newTrackGroups);
    set({ expandedTrackPropertyGroups: newMap });
  },

  isTrackPropertyGroupExpanded: (trackId, groupName) => {
    const { expandedTrackPropertyGroups } = get();
    const trackGroups = expandedTrackPropertyGroups.get(trackId);
    return trackGroups?.has(groupName) ?? false;
  },

  getExpandedTrackHeight: (trackId, baseHeight) => {
    const {
      expandedTracks,
      clips,
      selectedClipIds,
      clipKeyframes,
    } = get();

    if (!expandedTracks.has(trackId)) {
      return baseHeight;
    }

    const trackClips = clips.filter(c => c.trackId === trackId);
    const selectedTrackClips = trackClips.filter(c => selectedClipIds.has(c.id));
    const selectedTrackClip = selectedTrackClips[0];
    if (!selectedTrackClip) {
      return baseHeight;
    }

    const keyframes = clipKeyframes.get(selectedTrackClip.id) || [];
    if (keyframes.length === 0) {
      return baseHeight;
    }

    const uniqueProperties = new Set(keyframes.map(k => k.property));
    const showsCamera3DProps = selectedTrackClip.source?.type === 'camera';
    if (!selectedTrackClip.is3D && !showsCamera3DProps) {
      uniqueProperties.delete('rotation.x');
      uniqueProperties.delete('rotation.y');
      uniqueProperties.delete('position.z');
      uniqueProperties.delete('scale.z');
    }

    return baseHeight + uniqueProperties.size * PROPERTY_ROW_HEIGHT;
  },

  trackHasKeyframes: (trackId) => {
    const { clips, clipKeyframes } = get();
    const trackClips = clips.filter(c => c.trackId === trackId);
    return trackClips.some(clip => {
      const kfs = clipKeyframes.get(clip.id);
      return kfs && kfs.length > 0;
    });
  },

  toggleCurveExpanded: (trackId, property) => {
    const { expandedCurveProperties } = get();
    const isCurrentlyExpanded = expandedCurveProperties.get(trackId)?.has(property) ?? false;
    const newMap = new Map<string, Set<AnimatableProperty>>();

    if (!isCurrentlyExpanded) {
      newMap.set(trackId, new Set([property]));
    }

    set({ expandedCurveProperties: newMap });
  },

  isCurveExpanded: (trackId, property) => {
    const { expandedCurveProperties } = get();
    const trackProps = expandedCurveProperties.get(trackId);
    return trackProps?.has(property) ?? false;
  },

  setCurveEditorHeight: (height) => {
    set({ curveEditorHeight: Math.round(Math.max(MIN_CURVE_EDITOR_HEIGHT, Math.min(MAX_CURVE_EDITOR_HEIGHT, height))) });
  },
});
