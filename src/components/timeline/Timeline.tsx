// Timeline component - Main orchestrator for video editing timeline
// Composes TimelineRuler, TimelineControls, TimelineHeader, TimelineTrack, TimelineClip, TimelineKeyframes

import { useRef, useState, useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import './Timeline.css';
import './TimelineTracks.css';
import { useShallow } from 'zustand/react/shallow';
import { useTimelineStore } from '../../stores/timeline';
import {
  // Grouped state selectors (6 subscriptions instead of 29)
  selectCoreData,
  selectPlaybackState,
  selectViewState,
  selectUISettings,
  selectPreviewExportState,
  selectKeyframeState,
} from '../../stores/timeline/selectors';
import type {
  AnimatableProperty,
  Keyframe,
  TimelineClip as TimelineClipType,
  TimelineTrack as TimelineTrackType,
  VideoBakeRegion,
} from '../../types';
import { useMediaStore } from '../../stores/mediaStore';

import { TimelineRuler } from './TimelineRuler';
import { TimelineControls } from './TimelineControls';
import { TimelineHeader } from './TimelineHeader';
import { TrackContextMenu, type TrackContextMenuState } from './TrackContextMenu';
import { MarkerContextMenu, type MarkerContextMenuState } from './MarkerContextMenu';
import { TimelineTrack } from './TimelineTrack';
import { TimelineClip } from './TimelineClip';
import { TimelineKeyframes } from './TimelineKeyframes';
import { MulticamDialog } from './MulticamDialog';
import { TimelineNavigator } from './TimelineNavigator';
import { TimelineOverlays } from './components/TimelineOverlays';
import { TransitionOverlays } from './components/TransitionOverlays';
import { AIActionOverlays } from './components/AIActionOverlays';
import { PickWhipCables } from './components/PickWhipCables';
import { ParentChildLinksOverlay } from './components/ParentChildLinksOverlay';
import { SlotGrid } from './SlotGrid';
import { animateSlotGrid } from './slotGridAnimation';
import { TimelineToolOverlayLayer } from './tools/TimelineToolOverlayLayer';
import { useTimelineKeyboard } from './hooks/useTimelineKeyboard';
import { useTimelineZoom } from './hooks/useTimelineZoom';
import { usePlayheadDrag } from './hooks/usePlayheadDrag';
import { TimelineContextMenu } from './TimelineContextMenu';
import { TimelineEmptyContextMenu } from './TimelineEmptyContextMenu';
import { InOutContextMenu, type InOutContextMenuState, type InOutPointType } from './InOutContextMenu';
import { useClipContextMenu } from './useClipContextMenu';
import { useMarqueeSelection } from './hooks/useMarqueeSelection';
import { useClipTrim } from './hooks/useClipTrim';
import { useClipDrag } from './hooks/useClipDrag';
import { useClipFade } from './hooks/useClipFade';
import { useLayerSync } from './hooks/useLayerSync';
import { usePlaybackLoop } from './hooks/usePlaybackLoop';
import { useAutoFeatures } from './hooks/useAutoFeatures';
import { useExternalDrop } from './hooks/useExternalDrop';
import { useTransitionDrop } from './hooks/useTransitionDrop';
import { usePickWhipDrag } from './hooks/usePickWhipDrag';
import { useTimelineHelpers } from './hooks/useTimelineHelpers';
import { usePlayheadSnap } from './hooks/usePlayheadSnap';
import { useMarkerDrag } from './hooks/useMarkerDrag';
import { getTimelineToolCursor } from './tools/pointer/timelineToolPointerDispatcher';
import {
  MIN_ZOOM,
  MAX_ZOOM,
  MIN_TRACK_HEIGHT,
  MAX_TRACK_HEIGHT,
  MIN_TRACK_HEADER_WIDTH,
  MAX_TRACK_HEADER_WIDTH,
} from '../../stores/timeline/constants';
import type { TimelineTrackFocusMode } from '../../stores/timeline/types';
import type { ClipDragState, ClipKeyframeTimeGroup, ContextMenuState, TimelineControlsProps, TimelineEmptyContextMenuState, TimelineRulerCacheRange } from './types';
import { isProxyFrameCountComplete } from '../../stores/mediaStore/helpers/proxyCompleteness';
import { parseVectorAnimationStateProperty } from '../../types/vectorAnimation';
import { createSubcompositionFromSelection } from '../../services/timelineSubcomposition';
import { getTimelineTrackBaseHeight } from './utils/timelineAudioLayout';
import { getTimelineTrackColor, TIMELINE_TRACK_COLOR_HIDDEN } from './trackColor';
import {
  CLIP_DRAG_NEW_AUDIO_TRACK_ID,
  CLIP_DRAG_NEW_VIDEO_TRACK_ID,
} from './utils/clipDragTrackTargeting';
import { isManualLinkedGroupId } from '../../stores/timeline/helpers/idGenerator';

const KEYFRAME_TIME_GROUP_PRECISION = 1000;
const RAM_PREVIEW_FEATURE_ENABLED = false;
const TIMELINE_END_PADDING_PX = 100;
const TIMELINE_VIEWPORT_FALLBACK_PX = 1600;
const SPLIT_DIVIDER_HEIGHT = 2;
const COLLAPSED_TRACK_HEIGHT = 32;
const FOCUS_CONTEXT_SECTION_HEIGHT = 24;
const MIN_SPLIT_SECTION_HEIGHT = 48;
const SPLIT_FOCUS_EDGE_THRESHOLD_PX = 44;
const SPLIT_FULL_CONTENT_SNAP_PX = 10;
const VIDEO_NEW_TRACK_PREVIEW_HEIGHT = 60;
const NEW_TRACK_PREVIEW_MARGIN_PX = 4;
const MIN_VIDEO_BAKE_DRAG_PX = 3;
const TRACK_SCROLL_SNAP_EPSILON_PX = 1;
const TRACK_SCROLL_SNAP_ANIMATION_MS = 70;
const TRACK_SCROLL_RELEASE_SETTLE_MS = 55;
const TRACK_SCROLL_GLIDE_MIN_MS = 110;
const TRACK_SCROLL_GLIDE_MAX_MS = 230;
const TRACK_SCROLL_GLIDE_PX_PER_MS = 1.35;
const TRACK_SCROLL_STEP_DELTA_PX = 160;
const TRACK_SCROLL_MAX_STEPS_PER_GESTURE = 8;
const TRACK_SCROLL_LIVE_TARGET_APPROACH = 0.68;
const TIMELINE_RIGHT_DRAG_SCRUB_THRESHOLD_PX = 4;
const TIMELINE_RIGHT_DRAG_CONTEXT_MENU_SUPPRESS_MS = 700;

type TrackSectionKind = 'video' | 'audio';

function clipDragAffectsTrack(
  drag: ClipDragState | null,
  trackId: string,
  clipMap: Map<string, TimelineClipType>,
): boolean {
  if (!drag) return false;
  if (drag.originalTrackId === trackId || drag.currentTrackId === trackId) return true;

  const draggedClip = clipMap.get(drag.clipId);
  if (draggedClip?.trackId === trackId) return true;
  if (draggedClip?.linkedClipId && clipMap.get(draggedClip.linkedClipId)?.trackId === trackId) return true;

  if (draggedClip?.linkedGroupId && isManualLinkedGroupId(draggedClip.linkedGroupId)) {
    for (const clip of clipMap.values()) {
      if (clip.linkedGroupId === draggedClip.linkedGroupId && clip.trackId === trackId) {
        return true;
      }
    }
  }

  if (drag.multiSelectClipIds?.some((clipId) => clipMap.get(clipId)?.trackId === trackId)) return true;
  if (drag.overlapClipIds?.some((clipId) => clipMap.get(clipId)?.trackId === trackId)) return true;
  return false;
}

type TrackSectionMetrics = {
  contentHeight: number;
};

type SectionScrollGestureState = {
  startScrollY: number;
  accumulatedDeltaY: number;
  settleTimerId: number | null;
  snapPositions: number[];
  contentHeight: number;
  viewportHeight: number;
};

type KeyframeAreaRevealSnapshot = {
  clipId: string;
  trackId: string;
  sectionKind: TrackSectionKind;
  keyframeCount: number;
  curveSignature: string;
  trackHeight: number;
  contentHeight: number;
  viewportHeight: number;
  keyframeAreaTop: number;
  keyframeAreaBottom: number;
};

type TrackResizeDragState = {
  trackId: string;
  startY: number;
  startHeight: number;
  pinVideoBottom: boolean;
};

type TrackHeaderWidthDragState = {
  startX: number;
  startWidth: number;
};

type TimelineSurfaceDragState = {
  pointerId: number;
  startClientX: number;
  startScrollX: number;
  maxScrollX: number;
};

type TimelineRightDragScrubState = {
  source: 'empty' | 'clip';
  trackId?: string;
  clipId?: string;
  startClientX: number;
  startClientY: number;
  startTime: number;
  dragging: boolean;
};

type VideoBakeRulerDragState = {
  startTime: number;
  startClientX: number;
};

type CompositionVideoBakeOverlayRegion = Pick<VideoBakeRegion, 'id' | 'startTime' | 'endTime' | 'status' | 'progress'> & {
  selection?: boolean;
};

function isVideoBakeModifierPressed(event: Pick<MouseEvent | React.MouseEvent, 'ctrlKey' | 'metaKey'>): boolean {
  return event.ctrlKey || event.metaKey;
}

function clampValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampScrollY(scrollY: number, contentHeight: number, viewportHeight: number): number {
  const maxScroll = Math.max(0, contentHeight - viewportHeight);
  return Math.max(0, Math.min(maxScroll, scrollY));
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function getSectionScrollGlideDuration(distancePx: number): number {
  return clampValue(
    Math.abs(distancePx) / TRACK_SCROLL_GLIDE_PX_PER_MS,
    TRACK_SCROLL_GLIDE_MIN_MS,
    TRACK_SCROLL_GLIDE_MAX_MS,
  );
}

function getSectionScrollGestureStepCount(accumulatedDeltaY: number): number {
  if (accumulatedDeltaY === 0) return 0;
  return clampValue(
    Math.ceil(Math.abs(accumulatedDeltaY) / TRACK_SCROLL_STEP_DELTA_PX),
    1,
    TRACK_SCROLL_MAX_STEPS_PER_GESTURE,
  );
}

function buildSectionScrollSnapPositions(
  tracks: TimelineTrackType[],
  sectionKind: TrackSectionKind,
  viewportHeight: number,
  contentHeight: number,
  getTrackHeight: (track: TimelineTrackType) => number,
): number[] {
  const maxScrollY = Math.max(0, contentHeight - viewportHeight);
  if (maxScrollY <= 0) return [0];

  const positions = [0, maxScrollY];
  let trackTop = 0;

  tracks.forEach((track) => {
    const trackHeight = Math.max(0, getTrackHeight(track));
    if (sectionKind === 'audio') {
      positions.push(trackTop);
    }

    trackTop += trackHeight;

    if (sectionKind === 'video') {
      positions.push(trackTop - viewportHeight);
    }
  });

  return Array.from(new Set(
    positions.map((position) => Math.round(clampScrollY(position, contentHeight, viewportHeight) * 100) / 100)
  )).sort((a, b) => a - b);
}

function getSettledSectionScrollSnapPosition(
  startScrollY: number,
  accumulatedDeltaY: number,
  snapPositions: number[],
  contentHeight: number,
  viewportHeight: number,
): number {
  const start = clampScrollY(startScrollY, contentHeight, viewportHeight);
  const stepCount = getSectionScrollGestureStepCount(accumulatedDeltaY);
  if (snapPositions.length <= 1 || stepCount === 0) return start;

  if (accumulatedDeltaY > 0) {
    let startIndex = 0;
    for (let index = snapPositions.length - 1; index >= 0; index--) {
      if (snapPositions[index] <= start + TRACK_SCROLL_SNAP_EPSILON_PX) {
        startIndex = index;
        break;
      }
    }

    return snapPositions[Math.min(snapPositions.length - 1, startIndex + stepCount)];
  }

  let startIndex = snapPositions.length - 1;
  for (let index = snapPositions.length - 1; index >= 0; index--) {
    if (snapPositions[index] < start - TRACK_SCROLL_SNAP_EPSILON_PX) {
      break;
    }
    startIndex = index;
  }

  return snapPositions[Math.max(0, startIndex - stepCount)];
}

function getLiveSectionScrollY(
  currentScrollY: number,
  rawNextScrollY: number,
  targetScrollY: number,
  direction: number,
): number {
  const targetDistance = targetScrollY - currentScrollY;
  if (direction > 0 && targetDistance > 0 && rawNextScrollY > targetScrollY) {
    return currentScrollY + Math.max(1, targetDistance * TRACK_SCROLL_LIVE_TARGET_APPROACH);
  }

  if (direction < 0 && targetDistance < 0 && rawNextScrollY < targetScrollY) {
    return currentScrollY - Math.max(1, Math.abs(targetDistance) * TRACK_SCROLL_LIVE_TARGET_APPROACH);
  }

  return rawNextScrollY;
}

function shouldIgnoreTimelineSurfaceToolTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest([
    'button',
    'input',
    'select',
    'textarea',
    '[role="button"]',
    '[role="menuitem"]',
    '.timeline-ruler-control-strip',
    '.timeline-layer-divider-resize-handle',
    '.track-header',
    '.timeline-split-divider',
    '.playhead',
    '.timeline-marker',
    '.in-out-marker',
    '.timeline-context-menu',
    '.timeline-tool-flyout',
  ].join(',')));
}

function getNormalizedWheelDeltaY(e: React.WheelEvent, viewportHeight: number): number {
  if (e.deltaMode === 1) return e.deltaY * 40;
  if (e.deltaMode === 2) return e.deltaY * viewportHeight;
  return e.deltaY;
}

function applyKeyframeAreaRevealScroll(
  currentScrollY: number,
  snapshot: KeyframeAreaRevealSnapshot,
): number {
  const viewportHeight = Math.max(0, snapshot.viewportHeight);
  if (viewportHeight <= 0 || snapshot.contentHeight <= viewportHeight) {
    return 0;
  }

  const padding = 10;
  const visibleTop = currentScrollY;
  const visibleBottom = currentScrollY + viewportHeight;
  const targetTop = Math.max(0, snapshot.keyframeAreaTop - padding);
  const targetBottom = Math.min(snapshot.contentHeight, snapshot.keyframeAreaBottom + padding);
  let nextScrollY = currentScrollY;

  if (targetBottom > visibleBottom) {
    nextScrollY = targetBottom - viewportHeight;
  }

  if (targetTop < visibleTop && targetBottom - targetTop <= viewportHeight) {
    nextScrollY = targetTop;
  }

  return clampScrollY(nextScrollY, snapshot.contentHeight, viewportHeight);
}

function getTrackFocusModeForSplitPosition(videoHeight: number, availableHeight: number): TimelineTrackFocusMode {
  const edgeThreshold = Math.min(
    Math.max(COLLAPSED_TRACK_HEIGHT + 8, availableHeight * 0.12),
    SPLIT_FOCUS_EDGE_THRESHOLD_PX,
  );
  if (videoHeight <= edgeThreshold) return 'audio';
  if (availableHeight - videoHeight <= edgeThreshold) return 'video';
  return 'balanced';
}

function buildCompositionSwitchTracks(
  currentTracks: TimelineTrackType[],
  targetTracks: TimelineTrackType[] | null
): TimelineTrackType[] {
  if (!targetTracks || targetTracks.length === 0) return currentTracks;

  const currentById = new Map(currentTracks.map((track) => [track.id, track]));
  const currentByType = {
    video: currentTracks.filter((track) => track.type === 'video'),
    audio: currentTracks.filter((track) => track.type === 'audio'),
  };
  const usedCurrentIds = new Set<string>();
  const typeCursor: Record<TimelineTrackType['type'], number> = { video: 0, audio: 0 };

  const mappedTargetTracks = targetTracks.map((targetTrack) => {
    const sameIdTrack = currentById.get(targetTrack.id);
    let matchedCurrent = sameIdTrack && !usedCurrentIds.has(sameIdTrack.id)
      ? sameIdTrack
      : undefined;

    if (!matchedCurrent) {
      const tracksOfType = currentByType[targetTrack.type];
      while (typeCursor[targetTrack.type] < tracksOfType.length) {
        const candidate = tracksOfType[typeCursor[targetTrack.type]];
        typeCursor[targetTrack.type] += 1;
        if (!usedCurrentIds.has(candidate.id)) {
          matchedCurrent = candidate;
          break;
        }
      }
    }

    if (!matchedCurrent) return { ...targetTrack };

    usedCurrentIds.add(matchedCurrent.id);
    return {
      ...targetTrack,
      id: matchedCurrent.id,
    };
  });

  const departingTracks = currentTracks
    .filter((track) => !usedCurrentIds.has(track.id))
    .map((track) => ({
      ...track,
      name: '',
      height: 0,
      muted: false,
      visible: false,
      solo: false,
    }));

  return [...mappedTargetTracks, ...departingTracks];
}

function getClipKeyframeTimeGroups(
  keyframes: Array<Pick<Keyframe, 'id' | 'time' | 'property'>>
): ClipKeyframeTimeGroup[] {
  const groups = new Map<number, ClipKeyframeTimeGroup>();

  keyframes.forEach((keyframe) => {
    const bucket = Math.round(keyframe.time * KEYFRAME_TIME_GROUP_PRECISION) / KEYFRAME_TIME_GROUP_PRECISION;
    const group = groups.get(bucket);
    if (group) {
      group.keyframeIds.push(keyframe.id);
      group.properties = [...(group.properties ?? []), keyframe.property];
      group.hasStateChange = group.hasStateChange || Boolean(parseVectorAnimationStateProperty(keyframe.property));
    } else {
      groups.set(bucket, {
        time: keyframe.time,
        keyframeIds: [keyframe.id],
        properties: [keyframe.property],
        hasStateChange: Boolean(parseVectorAnimationStateProperty(keyframe.property)),
      });
    }
  });

  return [...groups.values()].sort((a, b) => a.time - b.time);
}

export function Timeline() {
  // ===========================================
  // GROUPED STORE SUBSCRIPTIONS (6 instead of 29)
  // useShallow does shallow comparison on each key, so we only
  // re-render when an actual value changes within the group.
  // ===========================================

  // Core timeline structure (changes on edits)
  const { tracks, clips, duration, selectedClipIds, markers } =
    useTimelineStore(useShallow(selectCoreData));

  // Playback state (changes every frame during playback)
  const { playheadPosition, isPlaying, isDraggingPlayhead } =
    useTimelineStore(useShallow(selectPlaybackState));

  // View state (changes on zoom/scroll)
  const { zoom, scrollX, trackHeaderWidth, timelineSplitRatio } =
    useTimelineStore(useShallow(selectViewState));

  // Slot grid progress - direct selector for reliable reactivity
  const slotGridProgress = useTimelineStore(state => state.slotGridProgress);
  const timelineSessionId = useTimelineStore(state => state.timelineSessionId);
  const propertiesSelection = useTimelineStore(state => state.propertiesSelection);

  // UI settings (rarely changes)
  const { snappingEnabled, inPoint, outPoint, loopPlayback, toolMode, activeTimelineToolId, thumbnailsEnabled, waveformsEnabled, audioDisplayMode, audioLayerAdvancedMode, audioFocusMode, trackFocusMode, showAudioRegionEditMarkers } =
    useTimelineStore(useShallow(selectUISettings));
  const timelineRangeSelection = useTimelineStore(state => state.timelineRangeSelection);
  const timelineToolPreview = useTimelineStore(state => state.timelineToolPreview);
  const videoBakeRegions = useTimelineStore(state => state.videoBakeRegions);
  const videoBakeRegionSelection = useTimelineStore(state => state.videoBakeRegionSelection);
  const timelineToolCursor = getTimelineToolCursor(activeTimelineToolId);
  const effectiveAudioLayerAdvancedMode = audioLayerAdvancedMode !== false;
  const timelineTrackColorsVisible = effectiveAudioLayerAdvancedMode;

  // Preview/export state
  const { ramPreviewEnabled, ramPreviewProgress, ramPreviewRange, isRamPreviewing, isExporting, exportProgress, exportRange } =
    useTimelineStore(useShallow(selectPreviewExportState));
  const effectiveRamPreviewEnabled = RAM_PREVIEW_FEATURE_ENABLED && ramPreviewEnabled;
  const effectiveRamPreviewProgress = RAM_PREVIEW_FEATURE_ENABLED ? ramPreviewProgress : null;
  const effectiveRamPreviewRange = RAM_PREVIEW_FEATURE_ENABLED ? ramPreviewRange : null;
  const effectiveIsRamPreviewing = RAM_PREVIEW_FEATURE_ENABLED && isRamPreviewing;
  const hasActiveVideoBakeCache = useMemo(() => {
    const isActiveBakeRegion = (region: VideoBakeRegion) =>
      region.status === 'baking' || region.status === 'baked';

    return videoBakeRegions.some(isActiveBakeRegion) ||
      clips.some(clip => clip.videoState?.bakeRegions?.some(isActiveBakeRegion));
  }, [clips, videoBakeRegions]);

  // Keyframe state
  const { selectedKeyframeIds, clipKeyframes, expandedCurveProperties } =
    useTimelineStore(useShallow(selectKeyframeState));
  const expandedTracks = useTimelineStore(state => state.expandedTracks);
  const clipStemSeparationJobs = useTimelineStore(state => state.clipStemSeparationJobs);

  // ===========================================
  // STABLE ACTION REFERENCES
  // Actions are stable functions - get them once from getState() to avoid
  // creating new object references that would cause infinite re-renders.
  // ===========================================

  // Get actions once - they're stable and don't change
  const store = useTimelineStore.getState();

  // Playback actions
  const { play, pause, stop, playForward, playReverse, setPlayheadPosition, setDraggingPlayhead } = store;

  // Track actions
  const { addTrack, toggleTrackExpanded, getExpandedTrackHeight, trackHasKeyframes, setTrackParent } = store;

  // Clip actions
  const {
    addClip, addCompClip, addTextClip, addSolidClip, addMeshClip, addCameraClip, addSplatEffectorClip,
    addMathSceneClip, addMotionShapeClip, moveClip,
    updateClip, updateTextProperties, removeClip, selectClip, unlinkGroup, linkClips, unlinkClips, splitClipAtPlayhead,
    toggleClipReverse, updateClipTransform, setClipParent, generateWaveformForClip, generateSpectrogramForClip,
    addClipEffect, convertSolidToMotionShape, rippleDeleteSelection, deleteGapAtTime, deleteAllGaps,
    prepareTimelinePlacementRange, startClipStemSeparation,
  } = store;

  // Transform getters
  const {
    getInterpolatedTransform, getInterpolatedEffects, getInterpolatedSpeed,
    getInterpolatedVectorAnimationSettings,
    getSourceTimeForClip, getSnappedPosition, getPositionWithResistance,
  } = store;

  // Keyframe actions
  const {
    getClipKeyframes, selectKeyframe, deselectAllKeyframes, hasKeyframes,
    addKeyframe, moveKeyframe, moveKeyframes, updateKeyframe, removeKeyframe,
    setPropertyValue, toggleCurveExpanded, updateBezierHandle,
  } = store;

  // In/out point actions
  const { setInPoint, setOutPoint, setInPointAtPlayhead, setOutPointAtPlayhead, clearInOut } = store;

  // View actions
  const {
    setZoom,
    setScrollX,
    setDuration,
    setTrackHeaderWidth,
    setTimelineSplitRatio,
    toggleSnapping,
  } = store;

  // Preview actions
  const {
    toggleLoopPlayback, toggleRamPreviewEnabled, startRamPreview,
    cancelRamPreview, clearRamPreview, getCachedRanges, getProxyCachedRanges, getScrubCachedRanges,
  } = store;

  // Video bake region actions
  const {
    setVideoBakeRegionSelection,
    clearVideoBakeRegionSelection,
    addCompositionVideoBakeRegion,
    bakeCompositionVideoBakeRegion,
    unbakeCompositionVideoBakeRegion,
    removeCompositionVideoBakeRegion,
  } = store;

  // Tool actions
  const {
    toggleCutTool,
    toggleThumbnailsEnabled,
    toggleWaveformsEnabled,
    setAudioDisplayMode,
    toggleAudioLayerAdvancedMode,
    toggleAudioFocusMode,
    toggleAudioRegionEditMarkers,
    setTrackFocusMode,
    setTimelineRangeSelection,
    clearTimelineRangeSelection,
  } = store;

  // Marker actions
  const { addMarker, moveMarker, removeMarker, updateMarker } = store;

  // Clipboard actions
  const {
    copyClips,
    pasteClips,
    copyKeyframes,
    pasteKeyframes,
    copyClipEffects,
    pasteClipEffects,
    hasClipboardEffects,
    copyClipColor,
    pasteClipColor,
    hasClipboardColor,
  } = store;

  const getActiveComposition = useMediaStore(state => state.getActiveComposition);
  const getOpenCompositions = useMediaStore(state => state.getOpenCompositions);
  const openCompositionTab = useMediaStore(state => state.openCompositionTab);
  const proxyEnabled = useMediaStore(state => state.proxyEnabled);
  const mediaFiles = useMediaStore(state => state.files);
  const currentlyGeneratingProxyId = useMediaStore(state => state.currentlyGeneratingProxyId);
  const showInExplorer = useMediaStore(state => state.showInExplorer);
  const activeComposition = getActiveComposition() ?? null;
  const openCompositions = getOpenCompositions();

  const timelineRef = useRef<HTMLDivElement>(null);
  const timelineBodyRef = useRef<HTMLDivElement>(null);
  const trackLanesRef = useRef<HTMLDivElement>(null);
  const scrollWrapperRef = useRef<HTMLDivElement>(null);
  const [scrubCacheRevision, setScrubCacheRevision] = useState(0);
  const [timelineViewportWidth, setTimelineViewportWidth] = useState(TIMELINE_VIEWPORT_FALLBACK_PX);
  const [videoBakeRulerDrag, setVideoBakeRulerDrag] = useState<VideoBakeRulerDragState | null>(null);

  useEffect(() => {
    const handleScrubCacheUpdated = () => {
      setScrubCacheRevision((revision) => (revision + 1) % 1000000);
    };

    window.addEventListener('masterselects:scrub-cache-updated', handleScrubCacheUpdated);
    return () => {
      window.removeEventListener('masterselects:scrub-cache-updated', handleScrubCacheUpdated);
    };
  }, []);

  const getScrubCachedRangesForRuler = useCallback(() => {
    void scrubCacheRevision;
    return getScrubCachedRanges();
  }, [getScrubCachedRanges, scrubCacheRevision]);

  // Composition switch animation phase for tracks/ruler
  const clipAnimationPhase = useTimelineStore(s => s.clipAnimationPhase);
  const compositionSwitchDirection = useTimelineStore(s => s.compositionSwitchDirection);
  const compositionSwitchTargetTracks = useTimelineStore(s => s.compositionSwitchTargetTracks);
  const compositionSwitchSourceTracksRef = useRef<TimelineTrackType[] | null>(null);
  const isCompositionTrackMorphing = clipAnimationPhase !== 'idle' && compositionSwitchTargetTracks !== null;
  const isTrackExpandedFromState = useCallback(
    (trackId: string) => expandedTracks.has(trackId),
    [expandedTracks],
  );
  const isTrackExpandedForRender = useCallback(
    (trackId: string) => !isCompositionTrackMorphing && expandedTracks.has(trackId),
    [expandedTracks, isCompositionTrackMorphing],
  );
  const timelineViewTracks = useMemo(
    () => isCompositionTrackMorphing
      ? buildCompositionSwitchTracks(
          compositionSwitchSourceTracksRef.current ?? tracks,
          compositionSwitchTargetTracks
        )
      : tracks,
    [isCompositionTrackMorphing, tracks, compositionSwitchTargetTracks]
  );

  useEffect(() => {
    if (clipAnimationPhase === 'exiting' && compositionSwitchTargetTracks && !compositionSwitchSourceTracksRef.current) {
      compositionSwitchSourceTracksRef.current = tracks.map((track) => ({ ...track }));
    }
    if (clipAnimationPhase === 'idle') {
      compositionSwitchSourceTracksRef.current = null;
    }
  }, [clipAnimationPhase, compositionSwitchTargetTracks, tracks]);

  // Stable callbacks for TimelineControls (avoids re-renders from inline arrows)
  const toggleProxyEnabled = useMediaStore(state => state.toggleProxyEnabled);
  const handleToggleSlotGrid = useCallback(() => {
    animateSlotGrid(slotGridProgress < 0.5 ? 1 : 0);
  }, [slotGridProgress]);
  useEffect(() => {
    if (RAM_PREVIEW_FEATURE_ENABLED) return;
    if (hasActiveVideoBakeCache) return;

    if (isRamPreviewing) {
      cancelRamPreview();
    }
    if (ramPreviewEnabled) {
      toggleRamPreviewEnabled();
      return;
    }
    if (ramPreviewRange || ramPreviewProgress !== null) {
      clearRamPreview();
    }
  }, [
    ramPreviewEnabled,
    ramPreviewProgress,
    ramPreviewRange,
    isRamPreviewing,
    hasActiveVideoBakeCache,
    toggleRamPreviewEnabled,
    cancelRamPreview,
    clearRamPreview,
  ]);

  // Use store toggle directly (no useCallback needed - stable store reference)

  // Performance: Create lookup maps for O(1) clip/track access (must be before hooks that use them)
  const clipMap = useMemo(() => new Map(clips.map(c => [c.id, c])), [clips]);
  const trackMap = useMemo(() => new Map(tracks.map(t => [t.id, t])), [tracks]);
  const timelineViewTrackMap = useMemo(
    () => new Map(timelineViewTracks.map(t => [t.id, t])),
    [timelineViewTracks],
  );
  const keyframeLayoutInputs = useMemo(
    () => ({
      selectedClipIds,
      clipKeyframes,
      expandedCurveProperties,
    }),
    [clipKeyframes, expandedCurveProperties, selectedClipIds],
  );
  const getRenderedTrackBaseHeight = useCallback(
    (track: TimelineTrackType) => getTimelineTrackBaseHeight(track, audioDisplayMode, audioFocusMode),
    [audioDisplayMode, audioFocusMode],
  );
  const getRenderedTrackHeight = useCallback(
    (trackId: string, fallbackBaseHeight: number) => {
      // getExpandedTrackHeight reads keyframe UI state from the store; this keeps memoized layout users fresh.
      void keyframeLayoutInputs;
      const track = timelineViewTrackMap.get(trackId) ?? trackMap.get(trackId);
      const baseHeight = track ? getRenderedTrackBaseHeight(track) : fallbackBaseHeight;
      return isTrackExpandedForRender(trackId)
        ? getExpandedTrackHeight(trackId, baseHeight)
        : baseHeight;
    },
    [timelineViewTrackMap, trackMap, getRenderedTrackBaseHeight, isTrackExpandedForRender, getExpandedTrackHeight, keyframeLayoutInputs],
  );
  const getRenderedTrackHeightForTrack = useCallback(
    (track: TimelineTrackType) => getRenderedTrackHeight(track.id, track.height),
    [getRenderedTrackHeight],
  );
  const isClipLocked = useCallback((clipId: string) => {
    const clip = clipMap.get(clipId);
    return !!clip && trackMap.get(clip.trackId)?.locked === true;
  }, [clipMap, trackMap]);

  // Time helpers - extracted to hook
  const compositionFrameRate = activeComposition?.frameRate ?? 30;
  const {
    timeToPixel,
    pixelToTime,
    gridSize,
    gridPlan,
    formatTime,
    parseTime,
    getClipsAtTime,
    getSnapTargetTimes,
  } = useTimelineHelpers({ zoom, frameRate: compositionFrameRate, clips, getClipKeyframes });
  const [isEditingTimelineDuration, setIsEditingTimelineDuration] = useState(false);
  const [timelineDurationInputValue, setTimelineDurationInputValue] = useState('');
  const [timelineTimeDisplayMode, setTimelineTimeDisplayMode] = useState<'time' | 'frames'>('time');
  const timelineDurationInputRef = useRef<HTMLInputElement>(null);
  const hasInOutDisplayRange = inPoint !== null && outPoint !== null && outPoint > inPoint;
  const inOutDisplayDuration = hasInOutDisplayRange ? outPoint - inPoint : duration;
  const timelineRulerCurrentTime = hasInOutDisplayRange
    ? Math.max(0, Math.min(playheadPosition - inPoint, inOutDisplayDuration))
    : playheadPosition;
  const timelineFrameRate = Number.isFinite(compositionFrameRate) && compositionFrameRate > 0
    ? compositionFrameRate
    : 30;
  const timelineTotalFrames = Math.max(0, Math.round(inOutDisplayDuration * timelineFrameRate));
  const timelineCurrentFrame = Math.max(
    0,
    Math.min(timelineTotalFrames, Math.floor(timelineRulerCurrentTime * timelineFrameRate + Number.EPSILON)),
  );
  const timelineFpsValue = Number.isInteger(timelineFrameRate)
    ? timelineFrameRate.toString()
    : timelineFrameRate.toFixed(2).replace(/\.?0+$/, '');

  useEffect(() => {
    if (isEditingTimelineDuration && timelineDurationInputRef.current) {
      timelineDurationInputRef.current.focus();
      timelineDurationInputRef.current.select();
    }
  }, [isEditingTimelineDuration]);

  useEffect(() => {
    if (hasInOutDisplayRange && isEditingTimelineDuration) {
      setIsEditingTimelineDuration(false);
    }
  }, [hasInOutDisplayRange, isEditingTimelineDuration]);

  const handleTimelineDurationClick = useCallback(() => {
    setTimelineDurationInputValue(formatTime(duration));
    setIsEditingTimelineDuration(true);
  }, [duration, formatTime]);

  const handleTimelineTimeDoubleClick = useCallback((e: React.MouseEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setTimelineTimeDisplayMode(mode => mode === 'frames' ? 'time' : 'frames');
  }, []);

  const handleTimelineDurationSubmit = useCallback(() => {
    const nextDuration = parseTime(timelineDurationInputValue);
    if (nextDuration !== null && nextDuration > 0) {
      setDuration(nextDuration);
    }
    setIsEditingTimelineDuration(false);
  }, [parseTime, setDuration, timelineDurationInputValue]);

  useEffect(() => {
    if (!isEditingTimelineDuration) return;

    const handlePointerDown = (event: PointerEvent) => {
      const input = timelineDurationInputRef.current;
      if (input && event.target instanceof Node && input.contains(event.target)) {
        return;
      }

      handleTimelineDurationSubmit();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [handleTimelineDurationSubmit, isEditingTimelineDuration]);

  const handleTimelineDurationKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleTimelineDurationSubmit();
    } else if (e.key === 'Escape') {
      setIsEditingTimelineDuration(false);
    }
  }, [handleTimelineDurationSubmit]);

  // Clip dragging - extracted to hook
  const { clipDrag, handleClipMouseDown, handleClipDoubleClick } = useClipDrag({
    trackLanesRef,
    timelineRef,
    clips,
    tracks,
    clipMap,
    selectedClipIds,
    scrollX,
    snappingEnabled,
    isExporting,
    activeTimelineToolId,
    selectClip,
    addTrack,
    moveClip,
    applyTimelineEditOperation: store.applyTimelineEditOperation,
    openCompositionTab,
    pixelToTime,
    getRenderedTrackHeight: getRenderedTrackHeightForTrack,
    getSnappedPosition,
    getPositionWithResistance,
  });

  // Clip trimming - extracted to hook
  const { clipTrim, handleTrimStart } = useClipTrim({
    clipMap,
    tracks,
    isExporting,
    activeTimelineToolId,
    selectClip,
    applyTimelineEditOperation: store.applyTimelineEditOperation,
    setTimelineToolPreview: store.setTimelineToolPreview,
    pixelToTime,
  });

  // Clip fade (fade-in/out handles) - extracted to hook
  const { clipFade, handleFadeStart, getFadeInDuration, getFadeOutDuration } = useClipFade({
    clipMap,
    tracks,
    isExporting,
    addKeyframe,
    removeKeyframe,
    moveKeyframe,
    getClipKeyframes,
    addClipEffect,
    pixelToTime,
  });

  // Playhead and marker dragging - extracted to hook
  const { markerDrag, handleRulerMouseDown, handlePlayheadMouseDown, handleMarkerMouseDown } = usePlayheadDrag({
    timelineRef,
    scrollX,
    duration,
    inPoint,
    outPoint,
    isRamPreviewing: effectiveIsRamPreviewing,
    isPlaying,
    isExporting,
    setPlayheadPosition,
    setDraggingPlayhead,
    setInPoint,
    setOutPoint,
    cancelRamPreview,
    pause,
    pixelToTime,
  });

  const canMarkCompositionVideoBakeRegion =
    trackFocusMode === 'video' &&
    activeTimelineToolId === 'select' &&
    !isExporting;

  const getRulerTimeFromClientX = useCallback((clientX: number) => {
    if (!timelineRef.current) return null;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = clientX - rect.left + scrollX;
    return Math.max(0, Math.min(duration, pixelToTime(x)));
  }, [duration, pixelToTime, scrollX]);

  const handleTimelineRulerMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0 && canMarkCompositionVideoBakeRegion && isVideoBakeModifierPressed(e)) {
      e.preventDefault();
      e.stopPropagation();
      const startTime = getRulerTimeFromClientX(e.clientX);
      if (startTime === null) return;
      setVideoBakeRulerDrag({
        startTime,
        startClientX: e.clientX,
      });
      clearVideoBakeRegionSelection();
      return;
    }

    handleRulerMouseDown(e);
  }, [
    canMarkCompositionVideoBakeRegion,
    clearVideoBakeRegionSelection,
    getRulerTimeFromClientX,
    handleRulerMouseDown,
  ]);

  useEffect(() => {
    if (!videoBakeRulerDrag) return;

    const handleMouseMove = (event: MouseEvent) => {
      const currentTime = getRulerTimeFromClientX(event.clientX);
      if (currentTime === null) return;
      setVideoBakeRegionSelection({
        scope: 'composition',
        startTime: videoBakeRulerDrag.startTime,
        endTime: currentTime,
      });
    };

    const handleMouseUp = (event: MouseEvent) => {
      const currentTime = getRulerTimeFromClientX(event.clientX);
      const draggedFarEnough = Math.abs(event.clientX - videoBakeRulerDrag.startClientX) >= MIN_VIDEO_BAKE_DRAG_PX;
      if (currentTime !== null && draggedFarEnough) {
        addCompositionVideoBakeRegion(videoBakeRulerDrag.startTime, currentTime);
      }
      clearVideoBakeRegionSelection();
      setVideoBakeRulerDrag(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp, { once: true });
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    addCompositionVideoBakeRegion,
    clearVideoBakeRegionSelection,
    getRulerTimeFromClientX,
    setVideoBakeRegionSelection,
    videoBakeRulerDrag,
  ]);

  useEffect(() => {
    if (!videoBakeRegionSelection) return;

    const handleDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.clip-video-bake-region')) return;
      if (target.closest('.clip-video-bake-region-hitarea')) return;
      if (target.closest('.timeline-video-bake-region')) return;
      if (target.closest('.timeline-ruler-video-bake-region')) return;
      if (target.closest('.time-ruler')) return;

      clearVideoBakeRegionSelection();
    };

    document.addEventListener('mousedown', handleDocumentMouseDown, true);
    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDown, true);
    };
  }, [clearVideoBakeRegionSelection, videoBakeRegionSelection]);

  // External file drag & drop - extracted to hook
  const {
    externalDrag,
    dragCounterRef,
    handleTrackDragEnter,
    handleTrackDragOver,
    handleTrackDragLeave,
    handleTrackDrop,
    handleNewTrackDragOver,
    handleNewTrackDrop,
    handleContainerDragLeave,
  } = useExternalDrop({
    timelineRef,
    scrollX,
    tracks,
    clips,
    isExporting,
    activeTimelineToolId,
    pixelToTime,
    prepareTimelinePlacementRange,
    addTrack,
    addClip,
    addCompClip,
    addTextClip,
    updateTextProperties,
    updateClip,
    addSolidClip,
    addMeshClip,
    addCameraClip,
    addSplatEffectorClip,
    addMathSceneClip,
    addMotionShapeClip,
  });

  // Transition drop handling for drag-and-drop transitions between clips
  const {
    activeJunction,
    handleDragOver: handleTransitionDragOver,
    handleDrop: handleTransitionDrop,
    handleDragLeave: handleTransitionDragLeave,
    isTransitionDrag,
  } = useTransitionDrop();

  // Combined drag handlers that check for transition drops first
  const handleCombinedDragOver = useCallback((e: React.DragEvent, trackId: string) => {
    if (isExporting) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'none';
      return;
    }
    if (trackMap.get(trackId)?.locked) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'none';
      return;
    }
    if (isTransitionDrag(e)) {
      const rect = timelineRef.current?.getBoundingClientRect();
      if (rect) {
        const mouseX = e.clientX - rect.left + scrollX;
        const mouseTime = pixelToTime(mouseX);
        handleTransitionDragOver(e, trackId, mouseTime);
      }
    } else {
      handleTrackDragOver(e, trackId);
    }
  }, [isExporting, trackMap, isTransitionDrag, handleTransitionDragOver, handleTrackDragOver, scrollX, pixelToTime]);

  const handleCombinedDrop = useCallback((e: React.DragEvent, trackId: string) => {
    if (isExporting) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'none';
      return;
    }
    if (trackMap.get(trackId)?.locked) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'none';
      return;
    }
    if (isTransitionDrag(e)) {
      const rect = timelineRef.current?.getBoundingClientRect();
      if (rect) {
        const mouseX = e.clientX - rect.left + scrollX;
        const mouseTime = pixelToTime(mouseX);
        handleTransitionDrop(e, trackId, mouseTime);
      }
    } else {
      handleTrackDrop(e, trackId);
    }
  }, [isExporting, trackMap, isTransitionDrag, handleTransitionDrop, handleTrackDrop, scrollX, pixelToTime]);

  const handleCombinedDragLeave = useCallback((e: React.DragEvent) => {
    handleTransitionDragLeave();
    handleTrackDragLeave(e);
  }, [handleTransitionDragLeave, handleTrackDragLeave]);

  // Vertical scroll is split by media section so video and audio can be navigated independently.
  const [scrollY, setScrollY] = useState(0);
  const [videoScrollY, setVideoScrollY] = useState(0);
  const [audioScrollY, setAudioScrollY] = useState(0);
  const videoScrollYRef = useRef(videoScrollY);
  const audioScrollYRef = useRef(audioScrollY);
  const sectionScrollAnimationFrameRef = useRef<Record<TrackSectionKind, number | null>>({
    video: null,
    audio: null,
  });
  const sectionScrollAnimationTargetRef = useRef<Record<TrackSectionKind, number | null>>({
    video: null,
    audio: null,
  });
  const sectionScrollGestureRef = useRef<Record<TrackSectionKind, SectionScrollGestureState | null>>({
    video: null,
    audio: null,
  });
  const keyframeAreaRevealSnapshotRef = useRef<KeyframeAreaRevealSnapshot | null>(null);
  const splitDragAnchorVideoBottomRef = useRef(false);
  const splitDragStartedInAudioFocusRef = useRef(false);
  const splitDragStartedInVideoFocusRef = useRef(false);
  const splitDragAudioFocusJumpDoneRef = useRef(false);
  const videoSectionViewportRef = useRef<HTMLDivElement>(null);
  const audioSectionViewportRef = useRef<HTMLDivElement>(null);
  const [videoViewportHeight, setVideoViewportHeight] = useState(160);
  const [audioViewportHeight, setAudioViewportHeight] = useState(160);
  const [splitViewportHeight, setSplitViewportHeight] = useState(320);
  const [splitDragVideoHeight, setSplitDragVideoHeight] = useState<number | null>(null);
  const [splitDragSmoothing, setSplitDragSmoothing] = useState(false);
  const [splitDragPinVideoBottom, setSplitDragPinVideoBottom] = useState(false);
  const [forceVideoBottomScroll, setForceVideoBottomScroll] = useState(false);
  const splitDragSmoothingTimerRef = useRef<number | null>(null);
  const splitDragFrameRef = useRef<number | null>(null);
  const splitDragPendingClientYRef = useRef<number | null>(null);
  const trackResizeDragRef = useRef<TrackResizeDragState | null>(null);
  const trackResizeFrameRef = useRef<number | null>(null);
  const trackResizePendingClientYRef = useRef<number | null>(null);
  const [activeTrackResizeId, setActiveTrackResizeId] = useState<string | null>(null);
  const trackHeaderWidthDragRef = useRef<TrackHeaderWidthDragState | null>(null);
  const trackHeaderWidthFrameRef = useRef<number | null>(null);
  const trackHeaderWidthPendingClientXRef = useRef<number | null>(null);
  const [isTrackHeaderWidthResizing, setIsTrackHeaderWidthResizing] = useState(false);
  const timelineSurfaceDragRef = useRef<TimelineSurfaceDragState | null>(null);
  const [isTimelineSurfacePanning, setIsTimelineSurfacePanning] = useState(false);
  const [timelinePointerX, setTimelinePointerX] = useState<number | null>(null);
  const [hoveredKeyframeRow, setHoveredKeyframeRow] = useState<{
    trackId: string;
    property: AnimatableProperty;
  } | null>(null);

  useEffect(() => {
    videoScrollYRef.current = videoScrollY;
  }, [videoScrollY]);

  useEffect(() => {
    audioScrollYRef.current = audioScrollY;
  }, [audioScrollY]);

  const setSectionScrollY = useCallback((sectionKind: TrackSectionKind, scrollY: number) => {
    if (sectionKind === 'video') {
      videoScrollYRef.current = scrollY;
      setVideoScrollY(scrollY);
    } else {
      audioScrollYRef.current = scrollY;
      setAudioScrollY(scrollY);
    }
  }, []);

  const cancelSectionScrollAnimation = useCallback((sectionKind: TrackSectionKind, clearTarget = true) => {
    const frameId = sectionScrollAnimationFrameRef.current[sectionKind];
    if (frameId !== null) {
      window.cancelAnimationFrame(frameId);
      sectionScrollAnimationFrameRef.current[sectionKind] = null;
    }
    if (clearTarget) {
      sectionScrollAnimationTargetRef.current[sectionKind] = null;
    }
  }, []);

  const cancelSectionScrollGesture = useCallback((sectionKind: TrackSectionKind) => {
    const gesture = sectionScrollGestureRef.current[sectionKind];
    if (gesture?.settleTimerId !== null && gesture?.settleTimerId !== undefined) {
      window.clearTimeout(gesture.settleTimerId);
    }
    sectionScrollGestureRef.current[sectionKind] = null;
  }, []);

  const animateSectionScrollTo = useCallback((
    sectionKind: TrackSectionKind,
    targetScrollY: number,
    contentHeight: number,
    viewportHeight: number,
    durationMs = TRACK_SCROLL_SNAP_ANIMATION_MS,
  ) => {
    cancelSectionScrollGesture(sectionKind);

    const startScrollY = sectionKind === 'video'
      ? videoScrollYRef.current
      : audioScrollYRef.current;
    const target = clampScrollY(targetScrollY, contentHeight, viewportHeight);

    cancelSectionScrollAnimation(sectionKind, false);
    sectionScrollAnimationTargetRef.current[sectionKind] = target;

    if (Math.abs(startScrollY - target) < 0.5) {
      sectionScrollAnimationTargetRef.current[sectionKind] = null;
      setSectionScrollY(sectionKind, target);
      return;
    }

    const startTime = window.performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - startTime) / Math.max(1, durationMs));
      const easedProgress = easeOutCubic(progress);
      const nextScrollY = startScrollY + (target - startScrollY) * easedProgress;

      setSectionScrollY(sectionKind, nextScrollY);

      if (progress < 1) {
        sectionScrollAnimationFrameRef.current[sectionKind] = window.requestAnimationFrame(step);
        return;
      }

      sectionScrollAnimationFrameRef.current[sectionKind] = null;
      sectionScrollAnimationTargetRef.current[sectionKind] = null;
      setSectionScrollY(sectionKind, target);
    };

    sectionScrollAnimationFrameRef.current[sectionKind] = window.requestAnimationFrame(step);
  }, [cancelSectionScrollAnimation, cancelSectionScrollGesture, setSectionScrollY]);

  useEffect(() => () => {
    cancelSectionScrollGesture('video');
    cancelSectionScrollGesture('audio');
    cancelSectionScrollAnimation('video');
    cancelSectionScrollAnimation('audio');
  }, [cancelSectionScrollAnimation, cancelSectionScrollGesture]);

  // Context menu state for clip right-click
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [emptyContextMenu, setEmptyContextMenu] = useState<TimelineEmptyContextMenuState | null>(null);
  const timelineRightDragScrubRef = useRef<TimelineRightDragScrubState | null>(null);
  const timelineRightDragScrubCleanupRef = useRef<(() => void) | null>(null);
  const suppressTimelineContextMenuUntilRef = useRef(0);
  const setClipContextMenu = useCallback((menu: ContextMenuState | null) => {
    setEmptyContextMenu(null);
    setContextMenu(menu);
  }, []);
  const openClipContextMenu = useClipContextMenu(selectedClipIds, selectClip, setClipContextMenu);

  // Context menu state for track header right-click
  const [trackContextMenu, setTrackContextMenu] = useState<TrackContextMenuState | null>(null);

  // Context menu state for marker right-click
  const [markerContextMenu, setMarkerContextMenu] = useState<MarkerContextMenuState | null>(null);

  // Context menu state for in/out marker right-click
  const [inOutContextMenu, setInOutContextMenu] = useState<InOutContextMenuState | null>(null);

  const handleInOutMarkerContextMenu = useCallback((e: React.MouseEvent, type: InOutPointType) => {
    e.preventDefault();
    e.stopPropagation();
    if (isExporting) return;

    setContextMenu(null);
    setEmptyContextMenu(null);
    setTrackContextMenu(null);
    setMarkerContextMenu(null);
    setInOutContextMenu({
      x: e.clientX,
      y: e.clientY,
      type,
    });
  }, [isExporting]);

  const handleDeleteInOutPoint = useCallback((type: InOutPointType) => {
    if (type === 'in') {
      setInPoint(null);
    } else {
      setOutPoint(null);
    }
  }, [setInPoint, setOutPoint]);

  const getTimelineTimeFromClientX = useCallback((clientX: number) => {
    if (!timelineRef.current) return null;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = clientX - rect.left + scrollX;
    return Math.max(0, Math.min(duration, pixelToTime(x)));
  }, [duration, pixelToTime, scrollX]);

  const cleanupTimelineRightDragScrub = useCallback(() => {
    timelineRightDragScrubCleanupRef.current?.();
    timelineRightDragScrubCleanupRef.current = null;

    const drag = timelineRightDragScrubRef.current;
    timelineRightDragScrubRef.current = null;
    if (drag?.dragging) {
      setDraggingPlayhead(false);
    }
  }, [setDraggingPlayhead]);

  useEffect(() => cleanupTimelineRightDragScrub, [cleanupTimelineRightDragScrub]);

  const handleTimelineRightDragScrubMouseDown = useCallback((
    e: React.MouseEvent,
    startTime: number,
    source: Pick<TimelineRightDragScrubState, 'source' | 'trackId' | 'clipId'>,
  ) => {
    if (e.button !== 2 || isExporting) return;

    e.stopPropagation();
    cleanupTimelineRightDragScrub();
    timelineRightDragScrubRef.current = {
      ...source,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startTime,
      dragging: false,
    };

    const handleDocumentContextMenu = (event: MouseEvent) => {
      const drag = timelineRightDragScrubRef.current;
      if (!drag?.dragging && Date.now() >= suppressTimelineContextMenuUntilRef.current) return;

      event.preventDefault();
      event.stopPropagation();
    };

    const handleMouseMove = (event: MouseEvent) => {
      const drag = timelineRightDragScrubRef.current;
      if (!drag) return;

      const movedPx = Math.hypot(
        event.clientX - drag.startClientX,
        event.clientY - drag.startClientY,
      );
      if (!drag.dragging && movedPx < TIMELINE_RIGHT_DRAG_SCRUB_THRESHOLD_PX) return;

      if (!drag.dragging) {
        drag.dragging = true;
        setContextMenu(null);
        setEmptyContextMenu(null);
        setTrackContextMenu(null);
        setMarkerContextMenu(null);
        setInOutContextMenu(null);

        if (isPlaying) {
          pause();
        }
        if (effectiveIsRamPreviewing) {
          cancelRamPreview();
        }

        setDraggingPlayhead(true);
        setPlayheadPosition(drag.startTime);
      }

      event.preventDefault();
      const nextTime = getTimelineTimeFromClientX(event.clientX);
      if (nextTime !== null) {
        setPlayheadPosition(nextTime);
      }
    };

    const handleMouseUp = (event: MouseEvent) => {
      const drag = timelineRightDragScrubRef.current;
      if (drag?.dragging) {
        event.preventDefault();
        suppressTimelineContextMenuUntilRef.current = Date.now() + TIMELINE_RIGHT_DRAG_CONTEXT_MENU_SUPPRESS_MS;
        const suppressReleasedContextMenu = (contextMenuEvent: MouseEvent) => {
          if (Date.now() >= suppressTimelineContextMenuUntilRef.current) return;
          contextMenuEvent.preventDefault();
          contextMenuEvent.stopPropagation();
        };
        document.addEventListener('contextmenu', suppressReleasedContextMenu, true);
        window.setTimeout(() => {
          document.removeEventListener('contextmenu', suppressReleasedContextMenu, true);
        }, TIMELINE_RIGHT_DRAG_CONTEXT_MENU_SUPPRESS_MS);
      }
      cleanupTimelineRightDragScrub();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp, { once: true });
    document.addEventListener('contextmenu', handleDocumentContextMenu, true);
    timelineRightDragScrubCleanupRef.current = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('contextmenu', handleDocumentContextMenu, true);
    };
  }, [
    cancelRamPreview,
    cleanupTimelineRightDragScrub,
    effectiveIsRamPreviewing,
    getTimelineTimeFromClientX,
    isExporting,
    isPlaying,
    pause,
    setDraggingPlayhead,
    setPlayheadPosition,
  ]);

  const handleEmptyTimelineMouseDown = useCallback((e: React.MouseEvent, trackId: string, time: number) => {
    handleTimelineRightDragScrubMouseDown(e, time, { source: 'empty', trackId });
  }, [handleTimelineRightDragScrubMouseDown]);

  const handleEmptyTimelineContextMenu = useCallback((e: React.MouseEvent, trackId: string, time: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (
      timelineRightDragScrubRef.current?.dragging ||
      Date.now() < suppressTimelineContextMenuUntilRef.current
    ) {
      return;
    }
    if (isExporting) return;

    setContextMenu(null);
    setTrackContextMenu(null);
    setMarkerContextMenu(null);
    setInOutContextMenu(null);
    setEmptyContextMenu({
      x: e.clientX,
      y: e.clientY,
      time,
      trackId,
    });
  }, [isExporting]);

  const handleClipContextMenu = useCallback((e: React.MouseEvent, clipId: string) => {
    if (
      timelineRightDragScrubRef.current?.dragging ||
      Date.now() < suppressTimelineContextMenuUntilRef.current
    ) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    openClipContextMenu(e, clipId);
  }, [openClipContextMenu]);

  const handleTimelineClipMouseDown = useCallback((e: React.MouseEvent, clipId: string) => {
    if (e.button === 2) {
      const time = getTimelineTimeFromClientX(e.clientX);
      if (time !== null) {
        handleTimelineRightDragScrubMouseDown(e, time, { source: 'clip', clipId });
      }
      return;
    }

    handleClipMouseDown(e, clipId);
  }, [getTimelineTimeFromClientX, handleClipMouseDown, handleTimelineRightDragScrubMouseDown]);

  // Transcript markers visibility toggle (from store for persistence)
  const showTranscriptMarkers = useTimelineStore(s => s.showTranscriptMarkers);
  const toggleTranscriptMarkers = useTimelineStore(s => s.toggleTranscriptMarkers);

  // Multicam dialog state
  const [multicamDialogOpen, setMulticamDialogOpen] = useState(false);

  // Marker drag operations - extracted to hook
  const {
    timelineMarkerDrag,
    markerCreateDrag,
    handleTimelineMarkerMouseDown,
  } = useMarkerDrag({
    timelineRef,
    timelineBodyRef,
    markers,
    scrollX,
    snappingEnabled,
    duration,
    playheadPosition,
    inPoint,
    outPoint,
    pixelToTime,
    getSnapTargetTimes,
    moveMarker,
    addMarker,
  });

  // AI marker animation feedback (add/remove)
  const [aiAnimatedMarkers, setAiAnimatedMarkers] = useState<Map<string, 'add' | 'remove'>>(new Map());
  useEffect(() => {
    const handler = (e: Event) => {
      const { markerId, action } = (e as CustomEvent).detail;
      setAiAnimatedMarkers(prev => {
        const next = new Map(prev);
        next.set(markerId, action);
        return next;
      });
      // Auto-remove animation class
      setTimeout(() => {
        setAiAnimatedMarkers(prev => {
          const next = new Map(prev);
          next.delete(markerId);
          return next;
        });
      }, action === 'add' ? 400 : 300);
    };
    window.addEventListener('ai-marker-feedback', handler);
    return () => window.removeEventListener('ai-marker-feedback', handler);
  }, []);

  // Marquee selection - extracted to hook
  const { marquee, handleMarqueeMouseDown } = useMarqueeSelection({
    trackLanesRef,
    scrollX,
    clips,
    tracks,
    selectedClipIds,
    selectedKeyframeIds,
    clipKeyframes,
    activeTimelineToolId,
    clipDrag,
    clipTrim,
    markerDrag,
    isDraggingPlayhead,
    selectClip,
    selectKeyframe,
    deselectAllKeyframes,
    setTimelineRangeSelection,
    clearTimelineRangeSelection,
    pixelToTime,
    isTrackExpanded: isTrackExpandedForRender,
    getTrackBaseHeight: getRenderedTrackBaseHeight,
    getExpandedTrackHeight: getRenderedTrackHeight,
  });

  // Pick whip drag - extracted to hook
  const {
    pickWhipDrag,
    handlePickWhipDragStart,
    handlePickWhipDragEnd,
    trackPickWhipDrag,
    handleTrackPickWhipDragStart,
    handleTrackPickWhipDragEnd,
  } = usePickWhipDrag({ setClipParent, setTrackParent });

  // Performance: Memoize video/audio track filtering and solo state
  const { videoTracks, audioTracks, anyVideoSolo, anyAudioSolo } = useMemo(() => {
    const vTracks = tracks.filter(t => t.type === 'video');
    const aTracks = tracks.filter(t => t.type === 'audio');
    return {
      videoTracks: vTracks,
      audioTracks: aTracks,
      anyVideoSolo: vTracks.some(t => t.solo),
      anyAudioSolo: aTracks.some(t => t.solo),
    };
  }, [tracks]);

  const { anyViewVideoSolo, anyViewAudioSolo } = useMemo(() => {
    const vTracks = timelineViewTracks.filter(t => t.type === 'video');
    const aTracks = timelineViewTracks.filter(t => t.type === 'audio');
    return {
      anyViewVideoSolo: vTracks.some(t => t.solo),
      anyViewAudioSolo: aTracks.some(t => t.solo),
    };
  }, [timelineViewTracks]);

  // Performance: Memoize track visibility check functions
  const isVideoTrackVisible = useCallback((track: typeof tracks[0]) => {
    if (!track.visible) return false;
    if (anyVideoSolo) return track.solo;
    return true;
  }, [anyVideoSolo]);

  const isAudioTrackMuted = useCallback((track: typeof tracks[0]) => {
    if (track.muted) return true;
    if (anyAudioSolo) return !track.solo;
    return false;
  }, [anyAudioSolo]);

  const isVideoSectionCollapsed = trackFocusMode === 'audio';
  const isAudioSectionCollapsed = trackFocusMode === 'video';
  const timelineViewVideoTracks = useMemo(
    () => timelineViewTracks.filter(track => track.type === 'video'),
    [timelineViewTracks],
  );
  const timelineViewAudioTracks = useMemo(
    () => timelineViewTracks.filter(track => track.type === 'audio'),
    [timelineViewTracks],
  );
  const displayedVideoTracks = useMemo(
    () => timelineViewVideoTracks,
    [timelineViewVideoTracks],
  );
  const displayedAudioTracks = useMemo(
    () => timelineViewAudioTracks,
    [timelineViewAudioTracks],
  );

  const isSectionCollapsed = useCallback(
    (sectionKind: TrackSectionKind) =>
      sectionKind === 'video' ? isVideoSectionCollapsed : isAudioSectionCollapsed,
    [isAudioSectionCollapsed, isVideoSectionCollapsed],
  );

  const getFocusContextTrackHeight = useCallback(
    (sectionKind: TrackSectionKind) => {
      const trackCount = sectionKind === 'video'
        ? timelineViewVideoTracks.length
        : timelineViewAudioTracks.length;
      return trackCount > 0
        ? FOCUS_CONTEXT_SECTION_HEIGHT / trackCount
        : FOCUS_CONTEXT_SECTION_HEIGHT;
    },
    [timelineViewAudioTracks.length, timelineViewVideoTracks.length],
  );

  const getSectionTrackBaseHeight = useCallback(
    (track: TimelineTrackType, sectionKind: TrackSectionKind) =>
      isSectionCollapsed(sectionKind) ? getFocusContextTrackHeight(sectionKind) : getRenderedTrackBaseHeight(track),
    [getFocusContextTrackHeight, getRenderedTrackBaseHeight, isSectionCollapsed],
  );

  const getSectionTrackHeight = useCallback(
    (track: TimelineTrackType, sectionKind: TrackSectionKind) => {
      // getExpandedTrackHeight reads keyframe UI state from the store; this keeps section metrics fresh.
      void keyframeLayoutInputs;
      const baseHeight = getSectionTrackBaseHeight(track, sectionKind);
      if (isSectionCollapsed(sectionKind)) return baseHeight;
      return isTrackExpandedForRender(track.id)
        ? getExpandedTrackHeight(track.id, baseHeight)
        : baseHeight;
    },
    [getExpandedTrackHeight, getSectionTrackBaseHeight, isSectionCollapsed, isTrackExpandedForRender, keyframeLayoutInputs],
  );

  const buildSectionMetrics = useCallback(
    (sectionTracks: TimelineTrackType[], sectionKind: TrackSectionKind): TrackSectionMetrics => {
      let totalHeight = 0;

      for (const track of sectionTracks) {
        totalHeight += getSectionTrackHeight(track, sectionKind);
      }

      return { contentHeight: totalHeight };
    },
    [getSectionTrackHeight],
  );

  const videoSectionMetrics = useMemo(
    () => buildSectionMetrics(displayedVideoTracks, 'video'),
    [buildSectionMetrics, displayedVideoTracks],
  );
  const expandedVideoSectionContentHeight = useMemo(() => {
    void keyframeLayoutInputs;
    return timelineViewVideoTracks.reduce((total, track) => {
      const baseHeight = getTimelineTrackBaseHeight(track, audioDisplayMode, false);
      const trackHeight = isTrackExpandedForRender(track.id)
        ? getExpandedTrackHeight(track.id, baseHeight)
        : baseHeight;
      return total + trackHeight;
    }, 0);
  }, [
    audioDisplayMode,
    getExpandedTrackHeight,
    isTrackExpandedForRender,
    keyframeLayoutInputs,
    timelineViewVideoTracks,
  ]);
  const audioSectionMetrics = useMemo(
    () => buildSectionMetrics(displayedAudioTracks, 'audio'),
    [buildSectionMetrics, displayedAudioTracks],
  );
  const audioNewTrackPreviewHeight = useMemo(
    () => getTimelineTrackBaseHeight({ type: 'audio', height: 40 }, audioDisplayMode, audioFocusMode),
    [audioDisplayMode, audioFocusMode],
  );
  const clipDragNewTrackType = clipDrag?.newTrackType ?? null;
  const hasActiveAudioNewTrackPreview =
    clipDragNewTrackType === 'audio' ||
    externalDrag?.newTrackType === 'audio' ||
    externalDrag?.audioTrackId === '__new_audio_track__';
  const audioScrollableContentHeight = audioSectionMetrics.contentHeight + (
    hasActiveAudioNewTrackPreview
      ? audioNewTrackPreviewHeight + NEW_TRACK_PREVIEW_MARGIN_PX
      : 0
  );
  const videoScrollSnapPositions = useMemo(
    () => buildSectionScrollSnapPositions(
      displayedVideoTracks,
      'video',
      videoViewportHeight,
      videoSectionMetrics.contentHeight,
      (track) => getSectionTrackHeight(track, 'video'),
    ),
    [displayedVideoTracks, getSectionTrackHeight, videoSectionMetrics.contentHeight, videoViewportHeight],
  );
  const audioScrollSnapPositions = useMemo(
    () => buildSectionScrollSnapPositions(
      displayedAudioTracks,
      'audio',
      audioViewportHeight,
      audioScrollableContentHeight,
      (track) => getSectionTrackHeight(track, 'audio'),
    ),
    [audioScrollableContentHeight, audioViewportHeight, displayedAudioTracks, getSectionTrackHeight],
  );

  const clampSplitDragVideoHeight = useCallback((nextVideoHeight: number, availableHeight: number) => {
    const minVideoHeight = timelineViewVideoTracks.length > 0 ? COLLAPSED_TRACK_HEIGHT : 0;
    const minAudioHeight = timelineViewAudioTracks.length > 0 ? COLLAPSED_TRACK_HEIGHT : 0;
    const maxVideoHeight = Math.max(minVideoHeight, availableHeight - minAudioHeight);
    return Math.max(minVideoHeight, Math.min(maxVideoHeight, nextVideoHeight));
  }, [timelineViewAudioTracks.length, timelineViewVideoTracks.length]);

  const { videoSectionHeight, audioSectionHeight } = useMemo(() => {
    const availableHeight = Math.max(0, splitViewportHeight - SPLIT_DIVIDER_HEIGHT);
    const videoContentHeight = videoSectionMetrics.contentHeight;
    const audioContentHeight = audioSectionMetrics.contentHeight;

    if (splitDragVideoHeight !== null) {
      const videoHeight = clampSplitDragVideoHeight(splitDragVideoHeight, availableHeight);
      return {
        videoSectionHeight: videoHeight,
        audioSectionHeight: Math.max(0, availableHeight - videoHeight),
      };
    }

    if (trackFocusMode === 'balanced' && timelineSplitRatio !== null) {
      const videoHeight = clampSplitDragVideoHeight(availableHeight * timelineSplitRatio, availableHeight);
      return {
        videoSectionHeight: videoHeight,
        audioSectionHeight: Math.max(0, availableHeight - videoHeight),
      };
    }

    if (trackFocusMode === 'audio') {
      const videoHeight = videoContentHeight;
      return {
        videoSectionHeight: videoHeight,
        audioSectionHeight: Math.max(0, availableHeight - videoHeight),
      };
    }

    if (trackFocusMode === 'video') {
      const audioHeight = audioContentHeight;
      return {
        videoSectionHeight: Math.max(0, availableHeight - audioHeight),
        audioSectionHeight: audioHeight,
      };
    }

    const totalContentHeight = videoContentHeight + audioContentHeight;
    if (totalContentHeight <= 0) {
      return {
        videoSectionHeight: availableHeight / 2,
        audioSectionHeight: availableHeight / 2,
      };
    }

    if (totalContentHeight <= availableHeight) {
      return {
        videoSectionHeight: videoContentHeight,
        audioSectionHeight: Math.max(0, availableHeight - videoContentHeight),
      };
    }

    if (videoContentHeight <= 0) {
      return { videoSectionHeight: 0, audioSectionHeight: availableHeight };
    }
    if (audioContentHeight <= 0) {
      return { videoSectionHeight: availableHeight, audioSectionHeight: 0 };
    }

    const minSectionHeight = Math.min(MIN_SPLIT_SECTION_HEIGHT, availableHeight / 2);
    const proportionalVideoHeight = availableHeight * (videoContentHeight / totalContentHeight);
    const videoHeight = Math.max(
      minSectionHeight,
      Math.min(availableHeight - minSectionHeight, proportionalVideoHeight),
    );

    return {
      videoSectionHeight: videoHeight,
      audioSectionHeight: Math.max(0, availableHeight - videoHeight),
    };
  }, [
    audioSectionMetrics.contentHeight,
    clampSplitDragVideoHeight,
    splitDragVideoHeight,
    splitViewportHeight,
    timelineSplitRatio,
    trackFocusMode,
    videoSectionMetrics.contentHeight,
  ]);

  const selectedKeyframeAreaRevealSnapshot = useMemo<KeyframeAreaRevealSnapshot | null>(() => {
    const selectedClip = clips.find(clip => selectedClipIds.has(clip.id));
    if (!selectedClip) return null;

    const track = timelineViewTrackMap.get(selectedClip.trackId) ?? trackMap.get(selectedClip.trackId);
    if (!track || (track.type !== 'video' && track.type !== 'audio')) return null;

    const sectionKind: TrackSectionKind = track.type;
    if (isSectionCollapsed(sectionKind) || !isTrackExpandedForRender(track.id)) return null;

    const sectionTracks = sectionKind === 'video' ? displayedVideoTracks : displayedAudioTracks;
    const sectionTrackIndex = sectionTracks.findIndex(candidate => candidate.id === track.id);
    if (sectionTrackIndex < 0) return null;

    const trackOffsetTop = sectionTracks
      .slice(0, sectionTrackIndex)
      .reduce((sum, candidate) => sum + getSectionTrackHeight(candidate, sectionKind), 0);
    const baseHeight = getSectionTrackBaseHeight(track, sectionKind);
    const trackHeight = getSectionTrackHeight(track, sectionKind);
    const keyframes = clipKeyframes.get(selectedClip.id) ?? [];
    const curveSignature = Array.from(expandedCurveProperties.get(track.id) ?? new Set<AnimatableProperty>()).sort().join('|');

    return {
      clipId: selectedClip.id,
      trackId: track.id,
      sectionKind,
      keyframeCount: keyframes.length,
      curveSignature,
      trackHeight,
      contentHeight: sectionKind === 'video' ? videoSectionMetrics.contentHeight : audioSectionMetrics.contentHeight,
      viewportHeight: sectionKind === 'video' ? videoSectionHeight : audioSectionHeight,
      keyframeAreaTop: trackOffsetTop + baseHeight,
      keyframeAreaBottom: trackOffsetTop + trackHeight,
    };
  }, [
    audioSectionHeight,
    audioSectionMetrics.contentHeight,
    clipKeyframes,
    clips,
    displayedAudioTracks,
    displayedVideoTracks,
    expandedCurveProperties,
    getSectionTrackBaseHeight,
    getSectionTrackHeight,
    isSectionCollapsed,
    isTrackExpandedForRender,
    selectedClipIds,
    timelineViewTrackMap,
    trackMap,
    videoSectionHeight,
    videoSectionMetrics.contentHeight,
  ]);

  useLayoutEffect(() => {
    const previousSnapshot = keyframeAreaRevealSnapshotRef.current;
    keyframeAreaRevealSnapshotRef.current = selectedKeyframeAreaRevealSnapshot;

    if (!previousSnapshot || !selectedKeyframeAreaRevealSnapshot) {
      return;
    }

    const sameSelection =
      previousSnapshot.clipId === selectedKeyframeAreaRevealSnapshot.clipId &&
      previousSnapshot.trackId === selectedKeyframeAreaRevealSnapshot.trackId &&
      previousSnapshot.sectionKind === selectedKeyframeAreaRevealSnapshot.sectionKind;
    if (!sameSelection) {
      return;
    }

    const keyframeWasAdded = selectedKeyframeAreaRevealSnapshot.keyframeCount > previousSnapshot.keyframeCount;
    const curveWasOpened =
      previousSnapshot.curveSignature.length === 0 &&
      selectedKeyframeAreaRevealSnapshot.curveSignature.length > 0;
    const layoutGrew =
      selectedKeyframeAreaRevealSnapshot.trackHeight > previousSnapshot.trackHeight ||
      selectedKeyframeAreaRevealSnapshot.contentHeight > previousSnapshot.contentHeight;

    if (!keyframeWasAdded && !curveWasOpened && !layoutGrew) {
      return;
    }

    const applyReveal = (current: number) => {
      const next = applyKeyframeAreaRevealScroll(current, selectedKeyframeAreaRevealSnapshot);
      return Math.abs(next - current) > 0.5 ? next : current;
    };

    if (selectedKeyframeAreaRevealSnapshot.sectionKind === 'video') {
      setVideoScrollY(applyReveal);
    } else {
      setAudioScrollY(applyReveal);
    }
  }, [selectedKeyframeAreaRevealSnapshot]);

  // Legacy vertical values remain for zoom-hook compatibility; section wheel handlers own real Y scroll.
  const contentHeight = Math.max(videoSectionMetrics.contentHeight, audioSectionMetrics.contentHeight);
  const trackSnapPositions = useMemo(() => [0], []);
  const viewportHeight = Math.max(videoViewportHeight, audioViewportHeight, 1);

  // Update split viewport measurements on resize and during panel layout changes.
  useEffect(() => {
    const updateViewportHeights = () => {
      if (scrollWrapperRef.current) {
        setSplitViewportHeight(scrollWrapperRef.current.clientHeight);
      }
      if (videoSectionViewportRef.current) {
        setVideoViewportHeight(videoSectionViewportRef.current.clientHeight);
      }
      if (audioSectionViewportRef.current) {
        setAudioViewportHeight(audioSectionViewportRef.current.clientHeight);
      }
      const nextTimelineViewportWidth =
        timelineRef.current?.clientWidth ??
        (timelineBodyRef.current ? timelineBodyRef.current.clientWidth - trackHeaderWidth : null);
      if (nextTimelineViewportWidth && nextTimelineViewportWidth > 0) {
        setTimelineViewportWidth(Math.max(1, nextTimelineViewportWidth));
      }
    };

    updateViewportHeights();

    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(updateViewportHeights)
      : null;
    [scrollWrapperRef.current, timelineRef.current, videoSectionViewportRef.current, audioSectionViewportRef.current]
      .forEach((element) => {
        if (element) observer?.observe(element);
      });
    window.addEventListener('resize', updateViewportHeights);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateViewportHeights);
    };
  }, [trackHeaderWidth]);

  useEffect(() => {
    setVideoScrollY((current) => {
      const pinVideoBottomForTrackResize = trackResizeDragRef.current?.pinVideoBottom === true;
      if (splitDragPinVideoBottom || forceVideoBottomScroll || pinVideoBottomForTrackResize) {
        const viewportHeight = Math.max(0, splitDragVideoHeight ?? videoSectionHeight ?? videoViewportHeight);
        const contentHeight = pinVideoBottomForTrackResize && !splitDragPinVideoBottom && !forceVideoBottomScroll
          ? videoSectionMetrics.contentHeight
          : expandedVideoSectionContentHeight;
        return clampScrollY(
          contentHeight - viewportHeight,
          contentHeight,
          viewportHeight,
        );
      }

      if (isVideoSectionCollapsed) return 0;

      return clampScrollY(current, videoSectionMetrics.contentHeight, videoViewportHeight);
    });
  }, [
    expandedVideoSectionContentHeight,
    activeTrackResizeId,
    forceVideoBottomScroll,
    isVideoSectionCollapsed,
    splitDragPinVideoBottom,
    splitDragVideoHeight,
    videoSectionHeight,
    videoSectionMetrics.contentHeight,
    videoViewportHeight,
  ]);

  useEffect(() => {
    setAudioScrollY((current) => isAudioSectionCollapsed
      ? 0
      : clampScrollY(current, audioScrollableContentHeight, audioViewportHeight));
  }, [audioScrollableContentHeight, audioViewportHeight, isAudioSectionCollapsed]);

  useEffect(() => {
    if (trackFocusMode === 'audio' && splitDragVideoHeight === null) {
      setForceVideoBottomScroll(false);
    }
  }, [splitDragVideoHeight, trackFocusMode]);

  // Auto-scroll based on which track type is being hovered during drag.
  useEffect(() => {
    if (!externalDrag && !clipDrag) return;

    const hoveredTrack = externalDrag
      ? tracks.find((t) => t.id === externalDrag.trackId)
      : null;
    const isOverAudio = hoveredTrack?.type === 'audio' ||
      externalDrag?.newTrackType === 'audio' ||
      externalDrag?.isAudio ||
      clipDragNewTrackType === 'audio';
    const isOverVideo = hoveredTrack?.type === 'video' ||
      externalDrag?.newTrackType === 'video' ||
      clipDragNewTrackType === 'video';

    if (isOverAudio && !isAudioSectionCollapsed) {
      setAudioScrollY(Math.max(0, audioScrollableContentHeight - audioViewportHeight));
    } else if (isOverVideo && !isVideoSectionCollapsed) {
      setVideoScrollY(0);
    }
  }, [
    audioScrollableContentHeight,
    audioViewportHeight,
    clipDrag,
    clipDragNewTrackType,
    externalDrag,
    isAudioSectionCollapsed,
    isVideoSectionCollapsed,
    tracks,
  ]);

  const handleSectionWheel = useCallback((
    e: React.WheelEvent,
    sectionKind: TrackSectionKind,
  ) => {
    if (e.deltaY === 0 || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    if (isSectionCollapsed(sectionKind)) return;

    const metrics = sectionKind === 'video' ? videoSectionMetrics : audioSectionMetrics;
    const measuredViewportHeight = sectionKind === 'video' ? videoViewportHeight : audioViewportHeight;
    const scrollableContentHeight = sectionKind === 'audio'
      ? audioScrollableContentHeight
      : metrics.contentHeight;
    if (scrollableContentHeight <= measuredViewportHeight) return;

    e.preventDefault();
    e.stopPropagation();

    const deltaY = getNormalizedWheelDeltaY(e, measuredViewportHeight);
    const snapPositions = sectionKind === 'video'
      ? videoScrollSnapPositions
      : audioScrollSnapPositions;

    if (sectionKind === 'video') {
      setForceVideoBottomScroll(false);
    }

    const previousGesture = sectionScrollGestureRef.current[sectionKind];
    if (previousGesture?.settleTimerId !== null && previousGesture?.settleTimerId !== undefined) {
      window.clearTimeout(previousGesture.settleTimerId);
    }
    const previousDirection = previousGesture ? Math.sign(previousGesture.accumulatedDeltaY) : 0;
    const nextDirection = Math.sign(deltaY);
    const continuingGesture = previousGesture && previousDirection === nextDirection
      ? previousGesture
      : null;

    cancelSectionScrollAnimation(sectionKind);

    const currentScrollY = sectionKind === 'video'
      ? videoScrollYRef.current
      : audioScrollYRef.current;
    const rawNextScrollY = clampScrollY(
      currentScrollY + deltaY,
      scrollableContentHeight,
      measuredViewportHeight,
    );
    const startScrollY = continuingGesture?.startScrollY ?? currentScrollY;
    const accumulatedDeltaY = (continuingGesture?.accumulatedDeltaY ?? 0) + deltaY;
    const targetScrollY = getSettledSectionScrollSnapPosition(
      startScrollY,
      accumulatedDeltaY,
      snapPositions,
      scrollableContentHeight,
      measuredViewportHeight,
    );
    const nextScrollY = getLiveSectionScrollY(
      currentScrollY,
      rawNextScrollY,
      targetScrollY,
      nextDirection,
    );

    setSectionScrollY(sectionKind, nextScrollY);

    const settleTimerId = window.setTimeout(() => {
      const activeGesture = sectionScrollGestureRef.current[sectionKind];
      if (!activeGesture || activeGesture.settleTimerId !== settleTimerId) return;

      const latestScrollY = sectionKind === 'video'
        ? videoScrollYRef.current
        : audioScrollYRef.current;
      const settledScrollY = getSettledSectionScrollSnapPosition(
        activeGesture.startScrollY,
        activeGesture.accumulatedDeltaY,
        activeGesture.snapPositions,
        activeGesture.contentHeight,
        activeGesture.viewportHeight,
      );

      sectionScrollGestureRef.current[sectionKind] = null;
      const glideDurationMs = getSectionScrollGlideDuration(settledScrollY - latestScrollY);
      animateSectionScrollTo(
        sectionKind,
        settledScrollY,
        activeGesture.contentHeight,
        activeGesture.viewportHeight,
        glideDurationMs,
      );
    }, TRACK_SCROLL_RELEASE_SETTLE_MS);

    sectionScrollGestureRef.current[sectionKind] = {
      startScrollY,
      accumulatedDeltaY,
      settleTimerId,
      snapPositions,
      contentHeight: scrollableContentHeight,
      viewportHeight: measuredViewportHeight,
    };
  }, [
    animateSectionScrollTo,
    audioScrollSnapPositions,
    audioScrollableContentHeight,
    audioSectionMetrics,
    audioViewportHeight,
    cancelSectionScrollAnimation,
    isSectionCollapsed,
    setSectionScrollY,
    videoScrollSnapPositions,
    videoSectionMetrics,
    videoViewportHeight,
  ]);

  useEffect(() => {
    if (propertiesSelection?.kind !== 'track') return;
    if (isAudioSectionCollapsed || audioViewportHeight <= 1) return;

    const trackIndex = displayedAudioTracks.findIndex(track => track.id === propertiesSelection.trackId);
    if (trackIndex < 0) return;

    const trackTop = displayedAudioTracks
      .slice(0, trackIndex)
      .reduce((sum, track) => sum + getSectionTrackHeight(track, 'audio'), 0);
    const trackHeight = getSectionTrackHeight(displayedAudioTracks[trackIndex], 'audio');
    const trackBottom = trackTop + trackHeight;
    const currentScrollY = sectionScrollAnimationTargetRef.current.audio ?? audioScrollYRef.current;
    const revealPadding = 12;
    const viewportTop = currentScrollY + revealPadding;
    const viewportBottom = currentScrollY + audioViewportHeight - revealPadding;

    if (trackTop >= viewportTop && trackBottom <= viewportBottom) {
      return;
    }

    const nextScrollY = trackTop < viewportTop
      ? trackTop - revealPadding
      : trackBottom - audioViewportHeight + revealPadding;

    animateSectionScrollTo('audio', nextScrollY, audioScrollableContentHeight, audioViewportHeight);
  }, [
    animateSectionScrollTo,
    audioScrollableContentHeight,
    audioViewportHeight,
    displayedAudioTracks,
    getSectionTrackHeight,
    isAudioSectionCollapsed,
    propertiesSelection,
  ]);

  const handleTrackFocusStep = useCallback((direction: 'up' | 'down') => {
    const focusOrder: TimelineTrackFocusMode[] = ['audio', 'balanced', 'video'];
    const currentIndex = focusOrder.indexOf(trackFocusMode);
    const nextIndex = direction === 'up'
      ? Math.max(0, currentIndex - 1)
      : Math.min(focusOrder.length - 1, currentIndex + 1);
    setTrackFocusMode(focusOrder[nextIndex]);
  }, [setTrackFocusMode, trackFocusMode]);

  const isVideoBottomVisible = useCallback(() => {
    const videoContentHeight = videoSectionMetrics.contentHeight;
    if (isVideoSectionCollapsed || videoContentHeight <= 0 || timelineViewVideoTracks.length === 0) {
      return false;
    }

    return videoSectionHeight >= videoContentHeight - 1
      || videoScrollY + videoSectionHeight >= videoContentHeight - 1;
  }, [
    isVideoSectionCollapsed,
    timelineViewVideoTracks.length,
    videoScrollY,
    videoSectionHeight,
    videoSectionMetrics.contentHeight,
  ]);

  const applySplitDragPosition = useCallback((clientY: number) => {
    const wrapper = scrollWrapperRef.current;
    if (!wrapper) return;

    const rect = wrapper.getBoundingClientRect();
    const availableHeight = Math.max(0, rect.height - SPLIT_DIVIDER_HEIGHT);
    if (availableHeight <= 0) return;

    const rawVideoHeight = clientY - rect.top;
    const clampedRawVideoHeight = clampSplitDragVideoHeight(rawVideoHeight, availableHeight);
    const nextMode = getTrackFocusModeForSplitPosition(clampedRawVideoHeight, availableHeight);
    const videoFullContentHeight = videoSectionMetrics.contentHeight;
    const canShowAllVideoTracks =
      videoFullContentHeight > 0 &&
      videoFullContentHeight < availableHeight;
    const isLeavingVideoFocusDrag =
      splitDragStartedInVideoFocusRef.current &&
      nextMode !== 'video';
    const isLeavingAudioFocusDrag =
      splitDragStartedInAudioFocusRef.current &&
      nextMode !== 'audio';
    if (isLeavingAudioFocusDrag && !splitDragAudioFocusJumpDoneRef.current) {
      splitDragAudioFocusJumpDoneRef.current = true;
      setSplitDragPinVideoBottom(true);
      setForceVideoBottomScroll(true);
      setSplitDragSmoothing(true);
      if (splitDragSmoothingTimerRef.current !== null) {
        window.clearTimeout(splitDragSmoothingTimerRef.current);
      }
      splitDragSmoothingTimerRef.current = window.setTimeout(() => {
        splitDragSmoothingTimerRef.current = null;
        setSplitDragSmoothing(false);
      }, 200);
    } else if (isLeavingAudioFocusDrag) {
      setSplitDragPinVideoBottom(true);
      setForceVideoBottomScroll(true);
    }
    const shouldHoldAtFullVideoHeight =
      !isLeavingAudioFocusDrag &&
      isLeavingVideoFocusDrag &&
      canShowAllVideoTracks &&
      rawVideoHeight >= videoFullContentHeight - SPLIT_FULL_CONTENT_SNAP_PX;
    const nextVideoHeight = shouldHoldAtFullVideoHeight
      ? videoFullContentHeight
      : isLeavingAudioFocusDrag
        ? Math.max(clampedRawVideoHeight, availableHeight / 2)
        : clampedRawVideoHeight;

    setSplitDragVideoHeight(nextVideoHeight);
    if (splitDragAnchorVideoBottomRef.current || isLeavingVideoFocusDrag || isLeavingAudioFocusDrag) {
      const videoScrollContentHeight = isLeavingAudioFocusDrag
        ? expandedVideoSectionContentHeight
        : videoSectionMetrics.contentHeight;
      const nextVideoScrollY = clampScrollY(
        videoScrollContentHeight - nextVideoHeight,
        videoScrollContentHeight,
        nextVideoHeight,
      );
      setVideoScrollY((current) => Math.abs(current - nextVideoScrollY) > 0.5 ? nextVideoScrollY : current);
    }
    if (nextMode === 'balanced') {
      setTimelineSplitRatio(nextVideoHeight / availableHeight);
    }
    if (useTimelineStore.getState().trackFocusMode !== nextMode) {
      setTrackFocusMode(nextMode);
    }
  }, [clampSplitDragVideoHeight, expandedVideoSectionContentHeight, setTimelineSplitRatio, setTrackFocusMode, videoSectionMetrics.contentHeight]);

  const scheduleSplitDragPosition = useCallback((clientY: number) => {
    splitDragPendingClientYRef.current = clientY;
    if (splitDragFrameRef.current !== null) return;

    splitDragFrameRef.current = window.requestAnimationFrame(() => {
      splitDragFrameRef.current = null;
      const pendingClientY = splitDragPendingClientYRef.current;
      if (pendingClientY !== null) {
        applySplitDragPosition(pendingClientY);
      }
    });
  }, [applySplitDragPosition]);

  useEffect(() => () => {
    if (splitDragFrameRef.current !== null) {
      window.cancelAnimationFrame(splitDragFrameRef.current);
      splitDragFrameRef.current = null;
    }
    if (splitDragSmoothingTimerRef.current !== null) {
      window.clearTimeout(splitDragSmoothingTimerRef.current);
      splitDragSmoothingTimerRef.current = null;
    }
  }, []);

  const handleSplitDividerMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    splitDragStartedInAudioFocusRef.current = trackFocusMode === 'audio';
    splitDragStartedInVideoFocusRef.current = trackFocusMode === 'video';
    splitDragAudioFocusJumpDoneRef.current = false;
    setSplitDragSmoothing(false);
    setSplitDragPinVideoBottom(false);
    if (trackFocusMode !== 'audio') {
      setForceVideoBottomScroll(false);
    }
    if (splitDragSmoothingTimerRef.current !== null) {
      window.clearTimeout(splitDragSmoothingTimerRef.current);
      splitDragSmoothingTimerRef.current = null;
    }
    splitDragAnchorVideoBottomRef.current = isVideoBottomVisible() || splitDragStartedInVideoFocusRef.current;
    applySplitDragPosition(e.clientY);

    const handleMouseMove = (event: MouseEvent) => {
      event.preventDefault();
      scheduleSplitDragPosition(event.clientY);
    };

    const handleMouseUp = (event: MouseEvent) => {
      if (splitDragFrameRef.current !== null) {
        window.cancelAnimationFrame(splitDragFrameRef.current);
        splitDragFrameRef.current = null;
      }
      splitDragPendingClientYRef.current = null;
      applySplitDragPosition(event.clientY);
      const wrapper = scrollWrapperRef.current;
      let shouldSnapBalancedReleaseToVideoBottom = false;
      let releaseSnapVideoHeight = 0;
      let releaseAvailableHeight = 0;
      if (
        wrapper &&
        !splitDragStartedInAudioFocusRef.current &&
        !splitDragStartedInVideoFocusRef.current
      ) {
        const rect = wrapper.getBoundingClientRect();
        releaseAvailableHeight = Math.max(0, rect.height - SPLIT_DIVIDER_HEIGHT);
        if (releaseAvailableHeight > 0) {
          const rawVideoHeight = event.clientY - rect.top;
          const clampedRawVideoHeight = clampSplitDragVideoHeight(rawVideoHeight, releaseAvailableHeight);
          const releaseMode = getTrackFocusModeForSplitPosition(clampedRawVideoHeight, releaseAvailableHeight);
          const videoFullContentHeight = videoSectionMetrics.contentHeight;
          const canShowAllVideoTracks =
            videoFullContentHeight > 0 &&
            videoFullContentHeight < releaseAvailableHeight;
          shouldSnapBalancedReleaseToVideoBottom =
            releaseMode === 'balanced' &&
            canShowAllVideoTracks &&
            clampedRawVideoHeight > videoFullContentHeight + 1;
          releaseSnapVideoHeight = videoFullContentHeight;
        }
      }
      splitDragAnchorVideoBottomRef.current = false;
      splitDragStartedInAudioFocusRef.current = false;
      splitDragStartedInVideoFocusRef.current = false;
      splitDragAudioFocusJumpDoneRef.current = false;
      setSplitDragPinVideoBottom(false);
      if (splitDragSmoothingTimerRef.current !== null) {
        window.clearTimeout(splitDragSmoothingTimerRef.current);
        splitDragSmoothingTimerRef.current = null;
      }
      if (shouldSnapBalancedReleaseToVideoBottom) {
        setSplitDragSmoothing(true);
        setSplitDragVideoHeight(releaseSnapVideoHeight);
        setTimelineSplitRatio(releaseSnapVideoHeight / releaseAvailableHeight);
        if (useTimelineStore.getState().trackFocusMode !== 'balanced') {
          setTrackFocusMode('balanced');
        }
        splitDragSmoothingTimerRef.current = window.setTimeout(() => {
          splitDragSmoothingTimerRef.current = null;
          setSplitDragSmoothing(false);
          setSplitDragVideoHeight(null);
        }, 200);
      } else {
        setSplitDragSmoothing(false);
        setSplitDragVideoHeight(null);
      }
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [
    applySplitDragPosition,
    clampSplitDragVideoHeight,
    isVideoBottomVisible,
    scheduleSplitDragPosition,
    setTimelineSplitRatio,
    setTrackFocusMode,
    trackFocusMode,
    videoSectionMetrics.contentHeight,
  ]);

  // Performance: Memoize proxy batch status for the toolbar.
  const proxyBatchStatus = useMemo(() => {
    const proxyableFiles = mediaFiles.filter((file) => file.type === 'video' && Boolean(file.file));
    const readyCount = proxyableFiles.filter((file) =>
      file.proxyStatus === 'ready' &&
      isProxyFrameCountComplete(file.proxyFrameCount, file.duration, file.proxyFps ?? file.fps)
    ).length;
    const generatingIndex = currentlyGeneratingProxyId
      ? proxyableFiles.findIndex((file) => file.id === currentlyGeneratingProxyId) + 1
      : 0;

    return {
      readyCount,
      totalCount: proxyableFiles.length,
      generatingIndex: generatingIndex > 0 ? generatingIndex : 0,
    };
  }, [currentlyGeneratingProxyId, mediaFiles]);

  // Keyboard shortcuts - extracted to hook
  useTimelineKeyboard({
    isPlaying,
    play,
    pause,
    playForward,
    playReverse,
    setInPointAtPlayhead,
    setOutPointAtPlayhead,
    clearInOut,
    toggleLoopPlayback,
    selectedClipIds,
    selectedKeyframeIds,
    removeClip,
    removeKeyframe,
    splitClipAtPlayhead,
    updateClipTransform,
    copyClips,
    pasteClips,
    copyKeyframes,
    pasteKeyframes,
    toolMode,
    toggleCutTool,
    clipMap,
    activeComposition,
    playheadPosition,
    duration,
    setPlayheadPosition,
    addMarker,
  });

  // Auto-start RAM preview and proxy generation - extracted to hook
  useAutoFeatures({
    ramPreviewEnabled: effectiveRamPreviewEnabled,
    proxyEnabled,
    isPlaying,
    isDraggingPlayhead,
    isRamPreviewing: effectiveIsRamPreviewing,
    currentlyGeneratingProxyId,
    inPoint,
    outPoint,
    ramPreviewRange: effectiveRamPreviewRange,
    clips,
    startRamPreview,
    cancelRamPreview,
  });

  // Layer sync - extracted to hook
  useLayerSync({
    playheadPosition,
    clips,
    tracks,
    isPlaying,
    isDraggingPlayhead,
    ramPreviewRange: effectiveRamPreviewRange,
    isRamPreviewing: effectiveIsRamPreviewing,
    clipKeyframes,
    clipDrag,
    clipMap,
    videoTracks,
    audioTracks,
    getClipsAtTime,
    getInterpolatedTransform,
    getInterpolatedEffects,
    getInterpolatedVectorAnimationSettings,
    getInterpolatedSpeed,
    getSourceTimeForClip,
    isVideoTrackVisible,
    isAudioTrackMuted,
  });

  // Audio master clock playback loop - extracted to hook
  usePlaybackLoop({ isPlaying });

  // Shift/Alt + wheel resizes tracks from either the header or the lane under the cursor.
  const handleTrackHeightWheel = useCallback(
    (e: React.WheelEvent, trackId: string) => {
      const track = trackMap.get(trackId);
      if (!track) return;

      const wheelDelta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
      if (wheelDelta === 0) return;

      const timelineState = useTimelineStore.getState();
      const currentTrack = timelineState.tracks.find(candidate => candidate.id === trackId) ?? track;
      const visibleBaseHeight = getTimelineTrackBaseHeight(
        currentTrack,
        timelineState.audioDisplayMode,
        timelineState.audioFocusMode,
      );
      const resizeBaseHeight = Math.max(currentTrack.height, visibleBaseHeight);
      const scaleBaselineHeight = visibleBaseHeight > currentTrack.height ? visibleBaseHeight : undefined;

      if (e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        // Smooth scaling: each mouse-wheel notch is roughly 5px of track height.
        const delta = -wheelDelta * 0.05;
        timelineState.scaleTracksOfType(currentTrack.type, delta, scaleBaselineHeight);
      } else if (e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        const delta = -wheelDelta * 0.05;
        timelineState.setTrackHeight(trackId, resizeBaseHeight + delta);
      }
    },
    [trackMap]
  );

  const handleTrackResizeStart = useCallback((e: React.PointerEvent, trackId: string) => {
    if (isExporting) return;

    const currentTrack = useTimelineStore.getState().tracks.find(candidate => candidate.id === trackId)
      ?? trackMap.get(trackId);
    if (!currentTrack) return;

    e.preventDefault();
    e.stopPropagation();

    trackResizeDragRef.current = {
      trackId,
      startY: e.clientY,
      startHeight: currentTrack.height,
      pinVideoBottom: currentTrack.type === 'video' && isVideoBottomVisible(),
    };
    setActiveTrackResizeId(trackId);
  }, [isExporting, isVideoBottomVisible, trackMap]);

  useEffect(() => {
    if (!activeTrackResizeId) return undefined;

    const applyTrackResize = (clientY: number) => {
      const drag = trackResizeDragRef.current;
      if (!drag) return;

      const nextHeight = Math.max(
        MIN_TRACK_HEIGHT,
        Math.min(MAX_TRACK_HEIGHT, drag.startHeight + clientY - drag.startY),
      );
      useTimelineStore.getState().setTrackHeight(drag.trackId, nextHeight);
    };

    const handlePointerMove = (event: PointerEvent) => {
      trackResizePendingClientYRef.current = event.clientY;
      if (trackResizeFrameRef.current !== null) return;

      trackResizeFrameRef.current = window.requestAnimationFrame(() => {
        trackResizeFrameRef.current = null;
        const pendingClientY = trackResizePendingClientYRef.current;
        trackResizePendingClientYRef.current = null;
        if (pendingClientY !== null) {
          applyTrackResize(pendingClientY);
        }
      });
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (Number.isFinite(event.clientY)) {
        applyTrackResize(event.clientY);
      }
      if (trackResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(trackResizeFrameRef.current);
        trackResizeFrameRef.current = null;
      }
      trackResizePendingClientYRef.current = null;
      trackResizeDragRef.current = null;
      setActiveTrackResizeId(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
    window.addEventListener('pointercancel', handlePointerUp, { once: true });

    return () => {
      if (trackResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(trackResizeFrameRef.current);
        trackResizeFrameRef.current = null;
      }
      trackResizePendingClientYRef.current = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [activeTrackResizeId]);

  const handleTrackHeaderWidthResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    trackHeaderWidthDragRef.current = {
      startX: e.clientX,
      startWidth: trackHeaderWidth,
    };
    setIsTrackHeaderWidthResizing(true);
  }, [trackHeaderWidth]);

  useEffect(() => {
    if (!isTrackHeaderWidthResizing) return undefined;

    const applyTrackHeaderWidth = (clientX: number) => {
      const drag = trackHeaderWidthDragRef.current;
      if (!drag) return;

      setTrackHeaderWidth(Math.max(
        MIN_TRACK_HEADER_WIDTH,
        Math.min(MAX_TRACK_HEADER_WIDTH, drag.startWidth + clientX - drag.startX),
      ));
    };

    const handlePointerMove = (event: PointerEvent) => {
      trackHeaderWidthPendingClientXRef.current = event.clientX;
      if (trackHeaderWidthFrameRef.current !== null) return;

      trackHeaderWidthFrameRef.current = window.requestAnimationFrame(() => {
        trackHeaderWidthFrameRef.current = null;
        const pendingClientX = trackHeaderWidthPendingClientXRef.current;
        trackHeaderWidthPendingClientXRef.current = null;
        if (pendingClientX !== null) {
          applyTrackHeaderWidth(pendingClientX);
        }
      });
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (Number.isFinite(event.clientX)) {
        applyTrackHeaderWidth(event.clientX);
      }
      if (trackHeaderWidthFrameRef.current !== null) {
        window.cancelAnimationFrame(trackHeaderWidthFrameRef.current);
        trackHeaderWidthFrameRef.current = null;
      }
      trackHeaderWidthPendingClientXRef.current = null;
      trackHeaderWidthDragRef.current = null;
      setIsTrackHeaderWidthResizing(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
    window.addEventListener('pointercancel', handlePointerUp, { once: true });

    return () => {
      if (trackHeaderWidthFrameRef.current !== null) {
        window.cancelAnimationFrame(trackHeaderWidthFrameRef.current);
        trackHeaderWidthFrameRef.current = null;
      }
      trackHeaderWidthPendingClientXRef.current = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [isTrackHeaderWidthResizing, setTrackHeaderWidth]);

  // Zoom handling - extracted to hook
  const { handleSetZoom, handleFitToWindow } = useTimelineZoom({
    timelineBodyRef: timelineBodyRef,
    zoom,
    scrollX,
    scrollY,
    duration,
    playheadPosition,
    contentHeight,
    viewportHeight,
    trackSnapPositions,
    setZoom,
    setScrollX,
    setScrollY,
  });

  // Playhead snapping during drag - extracted to hook
  usePlayheadSnap({
    isDraggingPlayhead,
    timelineRef,
    scrollX,
    duration,
    snappingEnabled,
    pixelToTime,
    getSnapTargetTimes,
    setPlayheadPosition,
    setDraggingPlayhead,
  });

  const handleKeyframeRowHover = useCallback((trackId: string, property: AnimatableProperty, hovered: boolean) => {
    if (hovered) {
      setHoveredKeyframeRow({ trackId, property });
      return;
    }

    setHoveredKeyframeRow(current =>
      current?.trackId === trackId && current.property === property ? null : current
    );
  }, []);

  // Render keyframe diamonds
  const renderKeyframeDiamonds = useCallback(
    (trackId: string, property: AnimatableProperty) => {
      const isRowHovered =
        hoveredKeyframeRow?.trackId === trackId &&
        hoveredKeyframeRow.property === property;

      return (
        <TimelineKeyframes
          trackId={trackId}
          property={property}
          clips={clips}
          selectedKeyframeIds={selectedKeyframeIds}
          clipKeyframes={clipKeyframes}
          clipDrag={clipDrag}
          scrollX={scrollX}
          timelineRef={timelineRef}
          onSelectKeyframe={selectKeyframe}
          onMoveKeyframe={moveKeyframe}
          onUpdateKeyframe={updateKeyframe}
          onToggleCurveExpanded={toggleCurveExpanded}
          timeToPixel={timeToPixel}
          pixelToTime={pixelToTime}
          isRowHovered={isRowHovered}
          onKeyframeRowHover={handleKeyframeRowHover}
        />
      );
    },
    [clips, selectedKeyframeIds, clipKeyframes, clipDrag, scrollX, selectKeyframe, moveKeyframe, updateKeyframe, toggleCurveExpanded, timeToPixel, pixelToTime, hoveredKeyframeRow, handleKeyframeRowHover]
  );

  // Render a clip
  const renderClip = useCallback(
    (
      clip: TimelineClipType,
      trackId: string,
      trackBaseHeightOverride?: number,
      trackOverride?: TimelineTrackType,
    ) => {
      const track = trackMap.get(trackId) ?? trackOverride;
      if (!track) return null;

      const isDragging = clipDrag?.clipId === clip.id;
      const isTrimming = clipTrim?.clipId === clip.id;
      const isFading = clipFade?.clipId === clip.id;

      const draggedClip = clipDrag
        ? clipMap.get(clipDrag.clipId)
        : undefined;
      const trimmedClip = clipTrim
        ? clipMap.get(clipTrim.clipId)
        : undefined;

      const isLinkedToDragging =
        clipDrag &&
        draggedClip &&
        (clip.linkedClipId === clipDrag.clipId ||
          draggedClip.linkedClipId === clip.id ||
          (
            draggedClip.linkedGroupId &&
            isManualLinkedGroupId(draggedClip.linkedGroupId) &&
            clip.linkedGroupId === draggedClip.linkedGroupId &&
            clip.id !== draggedClip.id
          ));
      const isInMultiSelectDrag =
        !!clipDrag?.multiSelectClipIds?.includes(clip.id) &&
        clipDrag.multiSelectTimeDelta !== undefined;
      const isOverlapCollisionTarget = !!clipDrag?.overlapClipIds?.includes(clip.id);
      const clipDragForClip =
        clipDrag && (isDragging || isLinkedToDragging || isInMultiSelectDrag || isOverlapCollisionTarget)
          ? clipDrag
          : null;
      const isLinkedToTrimming =
        clipTrim &&
        !clipTrim.altKey &&
        trimmedClip &&
        (clip.linkedClipId === clipTrim.clipId ||
          trimmedClip.linkedClipId === clip.id);

      // Use mediaFiles from hook state instead of getState() for render-time lookups
      const mediaFile = mediaFiles.find(
        (f) =>
          f.id === clip.mediaFileId ||
          f.name === clip.name ||
          f.name === clip.name.replace(' (Audio)', '')
      );
      const proxyStatus =
        mediaFile?.proxyStatus === 'ready' &&
        !isProxyFrameCountComplete(mediaFile.proxyFrameCount, mediaFile.duration, mediaFile.proxyFps ?? mediaFile.fps)
          ? 'none'
          : mediaFile?.proxyStatus;
      const clipKeyframeList = getClipKeyframes(clip.id);
      const keyframeTimeGroups = getClipKeyframeTimeGroups(clipKeyframeList);
      const trackBaseHeight = trackBaseHeightOverride ?? getRenderedTrackBaseHeight(track);
      const renderTracks = trackOverride && !tracks.some(candidate => candidate.id === trackOverride.id)
        ? [...tracks, trackOverride]
        : tracks;

      return (
        <TimelineClip
          key={`${timelineSessionId}:${clip.id}`}
          clip={clip}
          trackId={trackId}
          track={track}
          trackBaseHeight={trackBaseHeight}
          tracks={renderTracks}
          clips={clips}
          isSelected={selectedClipIds.has(clip.id)}
          isInLinkedGroup={!!clip.linkedGroupId}
          isDragging={isDragging}
          isTrimming={isTrimming}
          isFading={isFading}
          isLinkedToDragging={!!isLinkedToDragging}
          isLinkedToTrimming={!!isLinkedToTrimming}
          isClipDragActive={clipDrag !== null}
          clipDrag={clipDragForClip}
          clipTrim={clipTrim}
          clipFade={clipFade}
          zoom={zoom}
          scrollX={scrollX}
          timelineViewportWidth={timelineViewportWidth}
          timelineRef={timelineRef}
          proxyEnabled={proxyEnabled}
          proxyStatus={proxyStatus}
          proxyProgress={mediaFile?.proxyProgress || 0}
          audioProxyStatus={mediaFile?.audioProxyStatus}
          audioProxyProgress={mediaFile?.audioProxyProgress || 0}
          showTranscriptMarkers={showTranscriptMarkers}
          snappingEnabled={snappingEnabled}
          onMouseDown={(e) => handleTimelineClipMouseDown(e, clip.id)}
          onDoubleClick={(e) => handleClipDoubleClick(e, clip.id)}
          onContextMenu={(e) => handleClipContextMenu(e, clip.id)}
          onTrimStart={(e, edge) => handleTrimStart(e, clip.id, edge)}
          onFadeStart={(e, edge) => handleFadeStart(e, clip.id, edge)}
          hasKeyframes={hasKeyframes}
          fadeInDuration={getFadeInDuration(clip.id)}
          fadeOutDuration={getFadeOutDuration(clip.id)}
          opacityKeyframes={clipKeyframeList.filter(k => k.property === 'opacity')}
          allKeyframeTimes={keyframeTimeGroups.map(group => group.time)}
          keyframeTimeGroups={keyframeTimeGroups}
          onMoveKeyframeGroup={moveKeyframes}
          timeToPixel={timeToPixel}
          pixelToTime={pixelToTime}
          formatTime={formatTime}
          onPickWhipDragStart={handlePickWhipDragStart}
          onPickWhipDragEnd={handlePickWhipDragEnd}
          onSetClipParent={setClipParent}
        />
      );
    },
    [
      trackMap,
      getRenderedTrackBaseHeight,
      clipMap,
      clips,
      selectedClipIds,
      clipDrag,
      clipTrim,
      clipFade,
      zoom,
      scrollX,
      timelineViewportWidth,
      proxyEnabled,
      mediaFiles,
      showTranscriptMarkers,
      snappingEnabled,
      handleTimelineClipMouseDown,
      handleClipDoubleClick,
      handleClipContextMenu,
      handleTrimStart,
      handleFadeStart,
      hasKeyframes,
      getFadeInDuration,
      getFadeOutDuration,
      getClipKeyframes,
      moveKeyframes,
      timeToPixel,
      pixelToTime,
      formatTime,
      tracks,
      timelineSessionId,
      handlePickWhipDragStart,
      handlePickWhipDragEnd,
      setClipParent,
    ]
  );

  const playheadLeft = timeToPixel(playheadPosition) - scrollX + trackHeaderWidth;
  const showPlayhead = playheadLeft >= trackHeaderWidth;
  const timelineSwitchMotionClass = clipAnimationPhase === 'exiting'
    ? (compositionSwitchDirection === 'backward' ? 'timeline-switch-exit-left' : 'timeline-switch-exit-right')
    : clipAnimationPhase === 'entering'
      ? (compositionSwitchDirection === 'backward' ? 'timeline-switch-enter-right' : 'timeline-switch-enter-left')
      : '';
  const getTimelineViewportWidth = useCallback(() => {
    const laneWidth = trackLanesRef.current?.clientWidth;
    if (laneWidth && laneWidth > 0) return laneWidth;

    const bodyWidth = timelineBodyRef.current?.clientWidth;
    if (bodyWidth && bodyWidth > 0) return Math.max(1, bodyWidth - trackHeaderWidth);

    return 800;
  }, [trackHeaderWidth]);

  const getTimelineMaxScrollX = useCallback((zoomValue: number) => {
    return Math.max(
      0,
      duration * zoomValue - getTimelineViewportWidth() + TIMELINE_END_PADDING_PX,
    );
  }, [duration, getTimelineViewportWidth]);

  const getTimelineSurfacePointerX = useCallback((clientX: number) => {
    const rect = trackLanesRef.current?.getBoundingClientRect() ??
      timelineBodyRef.current?.getBoundingClientRect();
    const viewportWidth = getTimelineViewportWidth();
    if (!rect) return 0;
    return clampValue(clientX - rect.left, 0, viewportWidth);
  }, [getTimelineViewportWidth]);

  const handleTimelinePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (activeTimelineToolId !== 'hand' && activeTimelineToolId !== 'zoom') return;
    if (shouldIgnoreTimelineSurfaceToolTarget(event.target)) return;

    event.preventDefault();
    event.stopPropagation();

    if (activeTimelineToolId === 'zoom') {
      const viewportWidth = getTimelineViewportWidth();
      const pointerX = getTimelineSurfacePointerX(event.clientX);
      const pointerTime = Math.max(0, (scrollX + pointerX) / Math.max(MIN_ZOOM, zoom));
      const dynamicMinZoom = Math.max(MIN_ZOOM, (viewportWidth - TIMELINE_END_PADDING_PX) / Math.max(0.001, duration));
      const zoomMultiplier = event.altKey || event.shiftKey ? 1 / 1.35 : 1.35;
      const nextZoom = clampValue(zoom * zoomMultiplier, dynamicMinZoom, MAX_ZOOM);
      const nextMaxScrollX = Math.max(0, duration * nextZoom - viewportWidth + TIMELINE_END_PADDING_PX);
      const nextScrollX = clampValue(pointerTime * nextZoom - pointerX, 0, nextMaxScrollX);

      setZoom(nextZoom);
      setScrollX(nextScrollX);
      return;
    }

    timelineSurfaceDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startScrollX: scrollX,
      maxScrollX: getTimelineMaxScrollX(zoom),
    };
    setIsTimelineSurfacePanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [
    activeTimelineToolId,
    duration,
    getTimelineMaxScrollX,
    getTimelineSurfacePointerX,
    getTimelineViewportWidth,
    scrollX,
    setScrollX,
    setZoom,
    zoom,
  ]);

  const handleTimelinePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = timelineSurfaceDragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      const deltaX = event.clientX - drag.startClientX;
      setScrollX(clampValue(drag.startScrollX - deltaX, 0, drag.maxScrollX));
      event.preventDefault();
    }

    if (clipDrag || clipTrim) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const nextPointerX = Math.round(event.clientX - rect.left);
    setTimelinePointerX(previousPointerX => previousPointerX === nextPointerX ? previousPointerX : nextPointerX);
  }, [clipDrag, clipTrim, setScrollX]);

  const handleTimelinePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = timelineSurfaceDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    timelineSurfaceDragRef.current = null;
    setIsTimelineSurfacePanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleTimelinePointerLeave = useCallback(() => {
    if (!timelineSurfaceDragRef.current) {
      setTimelinePointerX(null);
    }
  }, []);
  const timelineSurfaceCursor = isTimelineSurfacePanning ? 'grabbing' : timelineToolCursor;
  const getTimelineLineOpacity = useCallback((lineLeft: number) => {
    if (timelinePointerX === null) {
      return 0;
    }

    const distance = Math.abs(timelinePointerX - lineLeft);
    const fullOpacityDistance = 8;
    const hiddenDistance = 72;
    if (distance <= fullOpacityDistance) {
      return 1;
    }
    if (distance >= hiddenDistance) {
      return 0;
    }

    return 1 - ((distance - fullOpacityDistance) / (hiddenDistance - fullOpacityDistance));
  }, [timelinePointerX]);
  const getTimelineLineOpacityForTime = useCallback((time: number | null) => {
    if (time === null) {
      return 0;
    }
    return getTimelineLineOpacity(timeToPixel(time) - scrollX + trackHeaderWidth);
  }, [getTimelineLineOpacity, scrollX, timeToPixel, trackHeaderWidth]);

  useEffect(() => {
    if (!isPlaying || isDraggingPlayhead) return;

    const viewportWidth = timelineRef.current?.clientWidth;
    if (!viewportWidth || viewportWidth <= 0) return;

    const END_PADDING = 100;
    const playheadPixel = timeToPixel(playheadPosition);
    const viewportStart = scrollX;
    const viewportEnd = scrollX + viewportWidth;
    const maxScrollX = Math.max(0, duration * zoom - viewportWidth + END_PADDING);

    if (playheadPixel > viewportEnd) {
      const nextScrollX = Math.max(
        0,
        Math.min(maxScrollX, playheadPixel)
      );
      if (nextScrollX !== scrollX) {
        setScrollX(nextScrollX);
      }
      return;
    }

    if (playheadPixel < viewportStart) {
      const nextScrollX = Math.max(
        0,
        Math.min(maxScrollX, playheadPixel)
      );
      if (nextScrollX !== scrollX) {
        setScrollX(nextScrollX);
      }
    }
  }, [isPlaying, isDraggingPlayhead, playheadPosition, scrollX, zoom, duration, setScrollX, timeToPixel]);

  // No active composition - show empty state
  if (openCompositions.length === 0) {
    return (
      <div className="timeline-container timeline-empty">
        <div className="timeline-empty-message">
          <p>No composition open</p>
          <p className="hint">Double-click a composition in the Media panel to open it</p>
        </div>
      </div>
    );
  }

  // anyVideoSolo and anyAudioSolo are already memoized at the top of the component
  const timelineRulerCacheRanges: TimelineRulerCacheRange[] = proxyEnabled
    ? getProxyCachedRanges().map((range) => ({ ...range, type: 'proxy' as const }))
    : getScrubCachedRangesForRuler().map((range) => ({ ...range, type: 'cache' as const }));

  const renderTrackSection = (sectionKind: TrackSectionKind) => {
    const isVideoSection = sectionKind === 'video';
    const sectionTracks = isVideoSection ? displayedVideoTracks : displayedAudioTracks;
    const allSectionTracks = isVideoSection ? timelineViewVideoTracks : timelineViewAudioTracks;
    const sectionHeight = isVideoSection ? videoSectionHeight : audioSectionHeight;
    const sectionScrollY = isVideoSection && (splitDragPinVideoBottom || forceVideoBottomScroll)
      ? clampScrollY(
          expandedVideoSectionContentHeight - sectionHeight,
          expandedVideoSectionContentHeight,
          sectionHeight,
        )
      : isVideoSection
        ? videoScrollY
        : audioScrollY;
    const sectionViewportRef = isVideoSection ? videoSectionViewportRef : audioSectionViewportRef;
    const sectionCollapsed = isSectionCollapsed(sectionKind);
    const sectionContextTrackHeight = sectionCollapsed
      ? getFocusContextTrackHeight(sectionKind)
      : FOCUS_CONTEXT_SECTION_HEIGHT;
    const sectionPhaseClass = clipAnimationPhase === 'exiting'
      ? 'phase-exiting'
      : clipAnimationPhase === 'entering'
        ? 'phase-entering'
        : '';
    const audioPreviewHeight = audioNewTrackPreviewHeight;
    const draggedClipForNewTrack = clipDrag ? clipMap.get(clipDrag.clipId) : undefined;
    const renderClipDragNewTrackPreview = (type: 'video' | 'audio') => {
      if (!draggedClipForNewTrack || clipDragNewTrackType !== type) return null;

      const trackId = type === 'video'
        ? CLIP_DRAG_NEW_VIDEO_TRACK_ID
        : CLIP_DRAG_NEW_AUDIO_TRACK_ID;
      const baseHeight = type === 'video' ? VIDEO_NEW_TRACK_PREVIEW_HEIGHT : audioPreviewHeight;
      const ghostTrack: TimelineTrackType = {
        id: trackId,
        name: type === 'video' ? 'New Video Track' : 'New Audio Track',
        type,
        height: baseHeight,
        muted: false,
        visible: true,
        solo: false,
      };

      return (
        <div
          className={`track-lane ${type} new-track-preview clip-drag-new-track-preview drag-target`}
          style={{ height: baseHeight }}
        >
          <div className="track-clip-row" style={{ height: baseHeight }}>
            {renderClip(draggedClipForNewTrack, trackId, baseHeight, ghostTrack)}
          </div>
        </div>
      );
    };
    const videoBakeOverlayHeight = isVideoSection && !sectionCollapsed
      ? sectionTracks.reduce((total, track) => total + getSectionTrackHeight(track, sectionKind), 0)
      : 0;
    const compositionVideoBakeOverlayRegions: CompositionVideoBakeOverlayRegion[] = isVideoSection && !sectionCollapsed
      ? [
          ...videoBakeRegions
            .filter(region => region.scope === 'composition')
            .map(region => ({
              id: region.id,
              startTime: region.startTime,
              endTime: region.endTime,
              status: region.status,
              progress: region.progress,
            })),
          ...(videoBakeRegionSelection?.scope === 'composition'
            ? [{
                id: 'composition-video-bake-selection',
                startTime: videoBakeRegionSelection.startTime,
                endTime: videoBakeRegionSelection.endTime,
                status: 'marked' as const,
                progress: undefined,
                selection: true,
              }]
            : []),
        ]
      : [];

    const renderClipForSection = (clip: TimelineClipType, trackId: string) => {
      const track = allSectionTracks.find(candidate => candidate.id === trackId)
        ?? timelineViewTrackMap.get(trackId)
        ?? trackMap.get(trackId);
      return renderClip(
        clip,
        trackId,
        track ? getSectionTrackBaseHeight(track, sectionKind) : undefined,
      );
    };

    const getSectionTrackHeightById = (trackId: string, fallbackBaseHeight: number) => {
      const track = allSectionTracks.find(candidate => candidate.id === trackId)
        ?? timelineViewTrackMap.get(trackId)
        ?? trackMap.get(trackId);
      return track ? getSectionTrackHeight(track, sectionKind) : fallbackBaseHeight;
    };

    const getSectionTrackHeightForOverlay = (track: TimelineTrackType) =>
      getSectionTrackHeight(track, sectionKind);

    const renderCompositionVideoBakeRegion = (region: CompositionVideoBakeOverlayRegion) => {
      const start = Math.max(0, Math.min(duration, Math.min(region.startTime, region.endTime)));
      const end = Math.max(start, Math.min(duration, Math.max(region.startTime, region.endTime)));
      if (end <= start) return null;

      return (
        <div
          key={region.id}
          className={`timeline-video-bake-region status-${region.status ?? 'marked'} ${region.selection ? 'selection' : ''}`}
          style={{
            left: timeToPixel(start),
            width: Math.max(3, timeToPixel(end - start)),
            height: Math.max(1, videoBakeOverlayHeight),
          }}
          title={`Video bake: ${formatTime(start)} - ${formatTime(end)}${region.status === 'baking' && region.progress !== undefined ? ` (${Math.round(region.progress)}%)` : ''}`}
        >
          {region.status === 'baking' && region.progress !== undefined && (
            <div
              className="timeline-video-bake-region-progress"
              style={{ width: `${Math.max(0, Math.min(100, region.progress))}%` }}
            />
          )}
          {!region.selection && (
            <div className="timeline-video-bake-region-controls">
              <button
                type="button"
                className="timeline-video-bake-btn"
                disabled={region.status === 'baking'}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (region.status === 'baked') {
                    unbakeCompositionVideoBakeRegion(region.id);
                    return;
                  }
                  void bakeCompositionVideoBakeRegion(region.id);
                }}
                title={region.status === 'baked' ? 'Unbake video region' : 'Bake video region'}
              >
                {region.status === 'baked'
                  ? 'Unbake'
                  : region.status === 'baking'
                    ? `${Math.round(region.progress ?? 0)}%`
                    : 'Bake'}
              </button>
              <button
                type="button"
                className="timeline-video-bake-btn remove"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  removeCompositionVideoBakeRegion(region.id);
                }}
                title="Remove video bake region"
              >
                x
              </button>
            </div>
          )}
        </div>
      );
    };

    return (
      <div
        className={`timeline-track-section ${sectionKind} ${sectionCollapsed ? 'collapsed' : ''}`}
        data-section-kind={sectionKind}
        style={{
          height: sectionHeight,
          '--timeline-focus-context-track-height': `${sectionContextTrackHeight}px`,
        } as React.CSSProperties & { '--timeline-focus-context-track-height': string }}
      >
        <div
          className="timeline-section-viewport"
          ref={sectionViewportRef}
          onWheel={(e) => handleSectionWheel(e, sectionKind)}
        >
          <div
            className="timeline-content-row timeline-section-content-row"
            style={{ transform: `translateY(-${sectionScrollY}px)` }}
          >
            <div className={`track-headers ${sectionPhaseClass}`}>
              {isVideoSection && (externalDrag?.showVideoNewTrackZone || clipDragNewTrackType === 'video') && !sectionCollapsed && (
                <div
                  className={`track-header-preview video ${externalDrag?.newTrackType === 'video' || clipDragNewTrackType === 'video' ? 'active' : ''}`}
                  style={{ height: VIDEO_NEW_TRACK_PREVIEW_HEIGHT }}
                >
                  <span className="track-header-preview-label">+ New Video Track</span>
                </div>
              )}

              {sectionTracks.map((track) => {
                const isDimmed =
                  (track.type === 'video' && anyViewVideoSolo && !track.solo) ||
                  (track.type === 'audio' && anyViewAudioSolo && !track.solo);
                const isExpanded = !sectionCollapsed && isTrackExpandedForRender(track.id);
                const baseHeight = getSectionTrackBaseHeight(track, sectionKind);
                const dynamicHeight = getSectionTrackHeight(track, sectionKind);

                return (
                  <TimelineHeader
                    key={track.id}
                    track={track}
                    tracks={timelineViewTracks}
                    isDimmed={isDimmed}
                    isExpanded={isExpanded}
                    baseHeight={baseHeight}
                    dynamicHeight={dynamicHeight}
                    hasKeyframes={!sectionCollapsed && !isCompositionTrackMorphing && trackHasKeyframes(track.id)}
                    selectedClipIds={selectedClipIds}
                    clips={isCompositionTrackMorphing || sectionCollapsed ? [] : clips}
                    playheadPosition={playheadPosition}
                    onToggleExpand={() => {
                      if (!sectionCollapsed) toggleTrackExpanded(track.id);
                    }}
                    onToggleSolo={() =>
                      useTimelineStore.getState().setTrackSolo(track.id, !(track.audioState?.solo ?? track.solo))
                    }
                    onToggleLocked={() =>
                      useTimelineStore.getState().setTrackLocked(track.id, !track.locked)
                    }
                    onToggleMuted={() =>
                      useTimelineStore.getState().setTrackMuted(track.id, !(track.audioState?.muted ?? track.muted))
                    }
                    onToggleVisible={() =>
                      useTimelineStore.getState().setTrackVisible(track.id, !track.visible)
                    }
                    onRenameTrack={(name) =>
                      useTimelineStore.getState().renameTrack(track.id, name)
                    }
                    onWheel={(e) => handleTrackHeightWheel(e, track.id)}
                    onResizeStart={handleTrackResizeStart}
                    isResizeActive={activeTrackResizeId === track.id}
                    clipKeyframes={clipKeyframes}
                    getClipKeyframes={getClipKeyframes}
                    getInterpolatedTransform={getInterpolatedTransform}
                    getInterpolatedEffects={getInterpolatedEffects}
                    addKeyframe={addKeyframe}
                    setPlayheadPosition={setPlayheadPosition}
                    setPropertyValue={setPropertyValue}
                    expandedCurveProperties={expandedCurveProperties}
                    onToggleCurveExpanded={toggleCurveExpanded}
                    hoveredKeyframeRow={hoveredKeyframeRow}
                    onKeyframeRowHover={handleKeyframeRowHover}
                    audioLayerAdvancedMode={effectiveAudioLayerAdvancedMode}
                    showCollapsedAudioSummaryMeter={false}
                    onSetTrackParent={setTrackParent}
                    onTrackPickWhipDragStart={handleTrackPickWhipDragStart}
                    onTrackPickWhipDragEnd={handleTrackPickWhipDragEnd}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setContextMenu(null);
                      setEmptyContextMenu(null);
                      setMarkerContextMenu(null);
                      setInOutContextMenu(null);
                      setTrackContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        trackId: track.id,
                        trackType: track.type as 'video' | 'audio',
                        trackName: track.name,
                      });
                    }}
                  />
                );
              })}

              {!isVideoSection && ((externalDrag && externalDrag.hasAudio) || clipDragNewTrackType === 'audio') && !sectionCollapsed && (
                <div
                  className={`track-header-preview audio ${
                    clipDragNewTrackType === 'audio' ||
                    externalDrag?.newTrackType === 'audio' ||
                    (externalDrag?.newTrackType === 'video' && externalDrag?.hasAudio) ||
                    (externalDrag?.isVideo && externalDrag?.audioTrackId === '__new_audio_track__')
                      ? 'active'
                      : ''
                  }`}
                  style={{ height: audioPreviewHeight }}
                >
                  <span className="track-header-preview-label">+ New Audio Track</span>
                </div>
              )}
            </div>

            <div
              className={`timeline-section-tracks ${clipDrag ? 'dragging-clip' : ''} ${marquee ? 'marquee-selecting' : ''} ${isExporting ? 'export-locked' : ''}`}
              onMouseDown={handleMarqueeMouseDown}
            >
              <div
                className={`track-lanes-scroll ${sectionPhaseClass} timeline-grid-${gridPlan.mode}`}
                style={{
                  transform: `translateX(-${scrollX}px)`,
                  minWidth: Math.max(duration * zoom + 500, 2000),
                  ['--grid-size' as string]: `${gridSize}px`,
                  ['--frame-grid-size' as string]: `${gridPlan.frameIntervalPixels}px`,
                  ['--frame-grid-strength' as string]: `${Math.round(gridPlan.frameGridOpacity * 100)}%`,
                  ['--time-grid-strength' as string]: `${Math.round(gridPlan.timeGridOpacity * 100)}%`,
                  ['--time-grid-muted-strength' as string]: `${Math.round(gridPlan.timeGridOpacity * 22)}%`,
                }}
              >
                {isVideoSection && clipDragNewTrackType === 'video' && !sectionCollapsed && (
                  renderClipDragNewTrackPreview('video')
                )}

                {isVideoSection && externalDrag && !externalDrag.isAudio && externalDrag.showVideoNewTrackZone && !sectionCollapsed && (
                  <div
                    className={`new-track-drop-zone video ${externalDrag.newTrackType === 'video' ? 'active' : ''}`}
                    onDragOver={(e) => handleNewTrackDragOver(e, 'video')}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      dragCounterRef.current++;
                    }}
                    onDragLeave={handleTrackDragLeave}
                    onDrop={(e) => handleNewTrackDrop(e, 'video')}
                  >
                    <span className="drop-zone-label">+ Drop to create new Video Track</span>
                    {externalDrag.newTrackType === 'video' && (
                      <div
                        className="timeline-clip-preview video"
                        style={{
                          left: timeToPixel(externalDrag.startTime),
                          width: timeToPixel(externalDrag.duration ?? 5),
                        }}
                      >
                        <div className="clip-content">
                          <span className="clip-name">New clip</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {sectionTracks.map((track, trackIndex) => {
                  const isDimmed =
                    (track.type === 'video' && anyViewVideoSolo && !track.solo) ||
                    (track.type === 'audio' && anyViewAudioSolo && !track.solo);
                  const isExpanded = !sectionCollapsed && isTrackExpandedForRender(track.id);
                  const baseHeight = getSectionTrackBaseHeight(track, sectionKind);
                  const dynamicHeight = getSectionTrackHeight(track, sectionKind);
                  const trackClipDrag = clipDragAffectsTrack(clipDrag, track.id, clipMap)
                    ? clipDrag
                    : null;

                  return (
                    <TimelineTrack
                      key={track.id}
                      track={track}
                      trackColor={timelineTrackColorsVisible ? getTimelineTrackColor(track, trackIndex) : TIMELINE_TRACK_COLOR_HIDDEN}
                      clips={isCompositionTrackMorphing ? [] : clips}
                      isDimmed={isDimmed}
                      isExpanded={isExpanded}
                      baseHeight={baseHeight}
                      dynamicHeight={dynamicHeight}
                      isDragTarget={clipDrag?.currentTrackId === track.id}
                      isExternalDragTarget={
                        externalDrag?.trackId === track.id ||
                        externalDrag?.audioTrackId === track.id ||
                        externalDrag?.videoTrackId === track.id
                      }
                      selectedClipIds={selectedClipIds}
                      selectedKeyframeIds={selectedKeyframeIds}
                      activeTimelineToolId={activeTimelineToolId}
                      isClipDragActive={clipDrag !== null}
                      clipDrag={trackClipDrag}
                      clipTrim={clipTrim}
                      externalDrag={externalDrag}
                      zoom={zoom}
                      scrollX={scrollX}
                      timelineRef={timelineRef}
                      onClipMouseDown={handleTimelineClipMouseDown}
                      onClipContextMenu={handleClipContextMenu}
                      onEmptyMouseDown={handleEmptyTimelineMouseDown}
                      onEmptyContextMenu={handleEmptyTimelineContextMenu}
                      onTrimStart={handleTrimStart}
                      onDrop={(e) => handleCombinedDrop(e, track.id)}
                      onDragOver={(e) => handleCombinedDragOver(e, track.id)}
                      onDragEnter={(e) => handleTrackDragEnter(e, track.id)}
                      onDragLeave={handleCombinedDragLeave}
                      onResizeStart={handleTrackResizeStart}
                      isResizeActive={activeTrackResizeId === track.id}
                      renderClip={(clip, trackId) => renderClipForSection(clip, trackId)}
                      clipKeyframes={clipKeyframes}
                      renderKeyframeDiamonds={renderKeyframeDiamonds}
                      timeToPixel={timeToPixel}
                      pixelToTime={pixelToTime}
                      expandedCurveProperties={expandedCurveProperties}
                      onSelectKeyframe={selectKeyframe}
                      onMoveKeyframe={moveKeyframe}
                      onUpdateBezierHandle={updateBezierHandle}
                      addKeyframe={addKeyframe}
                    />
                  );
                })}

                {compositionVideoBakeOverlayRegions.length > 0 && (
                  <div
                    className="timeline-video-bake-region-layer"
                    style={{ height: Math.max(1, videoBakeOverlayHeight) }}
                  >
                    {compositionVideoBakeOverlayRegions.map(renderCompositionVideoBakeRegion)}
                  </div>
                )}

                {isCompositionTrackMorphing && (
                  <div className="composition-exit-clips-overlay">
                    {allSectionTracks.map((track) => {
                      const isExpanded = !sectionCollapsed && isTrackExpandedFromState(track.id);
                      const baseHeight = getSectionTrackBaseHeight(track, sectionKind);
                      const dynamicHeight = isExpanded ? getExpandedTrackHeight(track.id, baseHeight) : baseHeight;
                      const trackClips = clips.filter((clip) => clip.trackId === track.id);

                      return (
                        <div
                          key={`exit-${track.id}`}
                          className="composition-exit-track-row"
                          style={{ height: dynamicHeight }}
                        >
                          <div className="track-clip-row" style={{ height: baseHeight }}>
                            {trackClips.map((clip) => renderClipForSection(clip, track.id))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {!isCompositionTrackMorphing && (
                  <TransitionOverlays
                    activeJunction={activeJunction}
                    clips={clips}
                    tracks={allSectionTracks}
                    timeToPixel={timeToPixel}
                    isTrackExpanded={(trackId) => !sectionCollapsed && isTrackExpandedForRender(trackId)}
                    getExpandedTrackHeight={getSectionTrackHeightById}
                    getTrackHeight={getSectionTrackHeightForOverlay}
                  />
                )}

                {!isCompositionTrackMorphing && (
                  <AIActionOverlays
                    tracks={allSectionTracks}
                    timeToPixel={timeToPixel}
                    isTrackExpanded={(trackId) => !sectionCollapsed && isTrackExpandedForRender(trackId)}
                    getExpandedTrackHeight={getSectionTrackHeightById}
                    getTrackHeight={getSectionTrackHeightForOverlay}
                  />
                )}

                {!isCompositionTrackMorphing && (
                  <TimelineToolOverlayLayer
                    preview={timelineToolPreview}
                    tracks={sectionTracks}
                    clips={clips}
                    duration={duration}
                    timeToPixel={timeToPixel}
                    getTrackHeight={(track) => getSectionTrackHeight(track, sectionKind)}
                  />
                )}

                {isVideoSection && externalDrag?.videoTrackId === '__new_video_track__' && !sectionCollapsed && (
                  <div className="track-lane video new-track-preview" style={{ height: 60 }}>
                    <div
                      className="timeline-clip-preview video"
                      style={{
                        left: timeToPixel(externalDrag.startTime),
                        width: timeToPixel(externalDrag.duration ?? 5),
                      }}
                    >
                      <div className="clip-content">
                        <span className="clip-name">+ New Video Track</span>
                      </div>
                    </div>
                  </div>
                )}

                {!isVideoSection && externalDrag?.audioTrackId === '__new_audio_track__' && !sectionCollapsed && (
                  <div className="track-lane audio new-track-preview" style={{ height: audioPreviewHeight }}>
                    <div
                      className="timeline-clip-preview audio"
                      style={{
                        left: timeToPixel(externalDrag.startTime),
                        width: timeToPixel(externalDrag.duration ?? 5),
                      }}
                    >
                      <div className="clip-content">
                        <span className="clip-name">+ New Audio Track</span>
                      </div>
                    </div>
                  </div>
                )}

                {!isVideoSection && clipDragNewTrackType === 'audio' && !sectionCollapsed && (
                  renderClipDragNewTrackPreview('audio')
                )}

                {!isVideoSection && externalDrag && (externalDrag.newTrackType === 'audio' || externalDrag.hasAudio !== false) && !sectionCollapsed && (
                  <div
                    className={`new-track-drop-zone audio ${
                      externalDrag.newTrackType === 'audio' ||
                      (externalDrag.newTrackType === 'video' && externalDrag.hasAudio !== false)
                        ? 'active'
                        : ''
                    }`}
                    onDragOver={(e) => handleNewTrackDragOver(e, 'audio')}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      dragCounterRef.current++;
                    }}
                    onDragLeave={handleTrackDragLeave}
                    onDrop={(e) => handleNewTrackDrop(e, 'audio')}
                  >
                    <span className="drop-zone-label">+ Drop to create new Audio Track</span>
                    {(externalDrag.newTrackType === 'audio' ||
                      (externalDrag.newTrackType === 'video' && externalDrag.hasAudio !== false)) && (
                      <div
                        className="timeline-clip-preview audio"
                        style={{
                          left: timeToPixel(externalDrag.startTime),
                          width: timeToPixel(externalDrag.duration ?? 5),
                        }}
                      >
                        <div className="clip-content">
                          <span className="clip-name">
                            {externalDrag.newTrackType === 'video' ? 'Audio (linked)' : 'New clip'}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {!isCompositionTrackMorphing && (
                  <ParentChildLinksOverlay
                    clips={clips}
                    tracks={allSectionTracks}
                    clipDrag={clipDrag}
                    timelineRef={timelineRef}
                    scrollX={scrollX}
                    zoom={zoom}
                    getTrackBaseHeight={(track) => getSectionTrackBaseHeight(track, sectionKind)}
                    getExpandedTrackHeight={getSectionTrackHeightById}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const timelineControlsProps: Omit<TimelineControlsProps, 'variant'> = {
    isPlaying,
    loopPlayback,
    playheadPosition,
    duration,
    zoom,
    snappingEnabled,
    inPoint,
    outPoint,
    proxyEnabled,
    currentlyGeneratingProxyId,
    mediaFilesWithProxy: proxyBatchStatus.readyCount,
    mediaFilesProxyTotal: proxyBatchStatus.totalCount,
    generatingProxyIndex: proxyBatchStatus.generatingIndex,
    showTranscriptMarkers,
    thumbnailsEnabled,
    waveformsEnabled,
    audioDisplayMode,
    audioFocusMode,
    showAudioRegionEditMarkers,
    trackFocusMode,
    toolMode,
    onPlay: play,
    onPause: pause,
    onStop: stop,
    onToggleLoop: toggleLoopPlayback,
    onSetZoom: handleSetZoom,
    onToggleSnapping: toggleSnapping,
    onToggleProxy: toggleProxyEnabled,
    onToggleTranscriptMarkers: toggleTranscriptMarkers,
    onToggleThumbnails: toggleThumbnailsEnabled,
    onToggleWaveforms: toggleWaveformsEnabled,
    onSetAudioDisplayMode: setAudioDisplayMode,
    onToggleAudioFocusMode: toggleAudioFocusMode,
    onToggleAudioRegionEditMarkers: toggleAudioRegionEditMarkers,
    onSetTrackFocusMode: setTrackFocusMode,
    onToggleCutTool: toggleCutTool,
    onFitToWindow: handleFitToWindow,
    onToggleSlotGrid: handleToggleSlotGrid,
    slotGridActive: slotGridProgress > 0.5,
    formatTime,
  };

  return (
    <div
      className={`timeline-container audio-mode-${audioDisplayMode} audio-layer-${effectiveAudioLayerAdvancedMode ? 'advanced' : 'basic'} timeline-split-mode-${trackFocusMode} ${audioFocusMode ? 'audio-focus-mode' : ''} ${trackFocusMode === 'video' ? 'video-focus-mode' : ''} ${splitDragVideoHeight !== null ? 'is-split-dragging' : ''} ${splitDragSmoothing ? 'is-split-drag-smoothing' : ''} ${activeTrackResizeId !== null ? 'is-track-resizing' : ''} ${isTrackHeaderWidthResizing ? 'is-header-width-resizing' : ''} ${clipDrag || clipTrim ? 'is-dragging' : ''}`}
      style={{ '--track-header-width': `${trackHeaderWidth}px` } as React.CSSProperties}
      onMouseDown={() => {
        if (useMediaStore.getState().sourceMonitorFileId) {
          useMediaStore.getState().setSourceMonitorFile(null);
        }
      }}
    >
      {/* Timeline toolbar - slides up when entering slot view */}
      <div className="toolbar-slide-wrapper" style={slotGridProgress > 0 ? {
        height: `${Math.round((1 - slotGridProgress) * 36)}px`,
        opacity: 1 - slotGridProgress,
        overflow: 'hidden',
      } : undefined}>
        <div className="timeline-timebar">
          <div
            className={`timeline-ruler-timecode ${timelineTimeDisplayMode === 'frames' ? 'frames' : 'time'}`}
            title="Current time / composition duration"
          >
            {timelineTimeDisplayMode === 'frames' && (
              <span className="timeline-ruler-fps-value" title={`Composition frame rate: ${timelineFpsValue} fps`}>
                <span className="timeline-ruler-fps-number">{timelineFpsValue}</span>
                <span className="timeline-ruler-fps-unit">fps</span>
              </span>
            )}
            <span
              className="timeline-ruler-current-time"
              onDoubleClick={handleTimelineTimeDoubleClick}
              title={timelineTimeDisplayMode === 'frames'
                ? 'Double-click to show timecode'
                : hasInOutDisplayRange
                  ? 'Current time from In point - double-click to show frames'
                  : 'Current composition time - double-click to show frames'}
            >
              {timelineTimeDisplayMode === 'frames' ? timelineCurrentFrame : formatTime(timelineRulerCurrentTime)}
            </span>
            <span className="timeline-ruler-separator-wrap" aria-hidden="true">
              <span className="timeline-ruler-time-separator">/</span>
            </span>
            {isEditingTimelineDuration && !hasInOutDisplayRange ? (
              <input
                ref={timelineDurationInputRef}
                type="text"
                className="timeline-ruler-duration-input"
                value={timelineDurationInputValue}
                style={{ '--timeline-duration-input-ch': `${Math.max(timelineDurationInputValue.length, 8)}ch` } as React.CSSProperties}
                onChange={(e) => setTimelineDurationInputValue(e.target.value)}
                onKeyDown={handleTimelineDurationKeyDown}
                onBlur={handleTimelineDurationSubmit}
              />
            ) : hasInOutDisplayRange ? (
              <span
                className="timeline-ruler-duration range"
                title="In/Out range duration"
              >
                {timelineTimeDisplayMode === 'frames' ? timelineTotalFrames : formatTime(inOutDisplayDuration)}
              </span>
            ) : (
              <button
                className="timeline-ruler-duration"
                type="button"
                onClick={handleTimelineDurationClick}
                title="Click to edit composition duration"
              >
                {timelineTimeDisplayMode === 'frames' ? timelineTotalFrames : formatTime(duration)}
              </button>
            )}
          </div>
          <TimelineControls variant="transport" {...timelineControlsProps} />
          <TimelineControls variant="utility" {...timelineControlsProps} />
          <TimelineControls variant="zoom" {...timelineControlsProps} />
        </div>
      </div>

      {/* Slot Grid toolbar - slides in when entering slot view */}
      {slotGridProgress > 0 && (
        <div className="toolbar-slide-wrapper" style={{
          height: `${Math.round(slotGridProgress * 36)}px`,
          opacity: slotGridProgress,
          overflow: 'hidden',
        }}>
          <div className="slot-grid-toolbar">
            <div className="timeline-slot-toggle">
              <button
                className="btn btn-sm btn-icon btn-active"
                onClick={handleToggleSlotGrid}
                title="Back to Timeline (Ctrl+Shift+Scroll)"
              >
                <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><rect x="1" y="2" width="14" height="2" rx="0.5"/><rect x="1" y="7" width="14" height="2" rx="0.5"/><rect x="1" y="12" width="14" height="2" rx="0.5"/></svg>
              </button>
            </div>
            <span className="slot-grid-toolbar-title">Slot Grid</span>
          </div>
        </div>
      )}

      <div className="timeline-body" ref={timelineBodyRef}>
        {/* SlotGrid — fades in over timeline */}
        {slotGridProgress > 0 && (
          <SlotGrid opacity={slotGridProgress} />
        )}
        {/* Timeline content — fades out with subtle scale-back */}
        <div
          className={`timeline-body-content timeline-tool-active-${activeTimelineToolId}`}
          style={slotGridProgress > 0 ? {
            opacity: 1 - slotGridProgress,
            transform: `scale(${1 - slotGridProgress * 0.05})`,
            transformOrigin: 'center center',
            pointerEvents: (slotGridProgress >= 0.5 ? 'none' : 'auto') as React.CSSProperties['pointerEvents'],
            display: slotGridProgress >= 1 ? 'none' as const : undefined,
            cursor: timelineSurfaceCursor,
          } : timelineSurfaceCursor ? { cursor: timelineSurfaceCursor } : undefined}
          onPointerDown={handleTimelinePointerDown}
          onPointerMove={handleTimelinePointerMove}
          onPointerUp={handleTimelinePointerUp}
          onPointerCancel={handleTimelinePointerUp}
          onPointerLeave={handleTimelinePointerLeave}
        >
          <div className="timeline-header-row">
            <div className="ruler-header">
              <div className="timeline-ruler-control-strip">
                <TimelineControls variant="main" {...timelineControlsProps} />
              </div>
            </div>
            <div className={`time-ruler-wrapper ${clipAnimationPhase !== 'idle' ? 'comp-switching' : ''}`}>
              <TimelineRuler
                duration={duration}
                zoom={zoom}
                frameRate={compositionFrameRate}
                displayMode={timelineTimeDisplayMode}
                scrollX={scrollX}
                onRulerMouseDown={handleTimelineRulerMouseDown}
                formatTime={formatTime}
                cacheRanges={timelineRulerCacheRanges}
                videoBakeRegions={videoBakeRegions}
                videoBakeRegionSelection={videoBakeRegionSelection?.scope === 'composition' ? videoBakeRegionSelection : null}
              />
            </div>
          </div>
          <div
            className={`timeline-layer-divider-resize-handle ${isTrackHeaderWidthResizing ? 'active' : ''}`}
            role="separator"
            aria-orientation="vertical"
            title="Drag to resize layer column"
            onPointerDown={handleTrackHeaderWidthResizeStart}
          />
          <div className="timeline-scroll-wrapper" ref={scrollWrapperRef}>
            <div
              ref={(el) => {
                (trackLanesRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
              }}
              className={`timeline-track-stack timeline-tracks ${clipDrag ? 'dragging-clip' : ''} ${marquee ? 'marquee-selecting' : ''} ${isExporting ? 'export-locked' : ''}`}
              data-ai-id="timeline-tracks"
              data-guided-target="timeline-tracks"
              data-guided-timeline-origin-x={trackHeaderWidth}
              data-guided-timeline-scroll-x={scrollX}
              data-guided-timeline-zoom={zoom}
              onDragOver={(e) => e.preventDefault()}
              onDragLeave={handleContainerDragLeave}
            >
              <div
                ref={timelineRef}
                className="timeline-lane-reference"
                data-guided-target="timeline-lane-reference"
                style={{ left: trackHeaderWidth }}
                aria-hidden="true"
              />
              {renderTrackSection('video')}
              <div
                className={`timeline-split-divider ${splitDragVideoHeight !== null ? 'dragging' : ''}`}
                aria-label="Timeline split controls"
              >
                <div
                  className="timeline-split-divider-hitbox"
                  onMouseDown={handleSplitDividerMouseDown}
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label="Resize video and audio track sections"
                />
                <div className="timeline-split-divider-controls">
                  <button
                    type="button"
                    className="timeline-split-button"
                    onClick={() => handleTrackFocusStep('up')}
                    onMouseDown={(e) => e.stopPropagation()}
                    disabled={trackFocusMode === 'audio'}
                    title={trackFocusMode === 'audio' ? 'Already in audio focus' : 'Move track focus up'}
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                      <path d="M4 10l4-4 4 4" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="timeline-split-button"
                    onClick={() => handleTrackFocusStep('down')}
                    onMouseDown={(e) => e.stopPropagation()}
                    disabled={trackFocusMode === 'video'}
                    title={trackFocusMode === 'video' ? 'Already in video focus' : 'Move track focus down'}
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                      <path d="M4 6l4 4 4-4" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className={`timeline-split-button timeline-audio-layer-mode-button ${effectiveAudioLayerAdvancedMode ? 'active' : ''}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleAudioLayerAdvancedMode();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    aria-pressed={effectiveAudioLayerAdvancedMode}
                    title={effectiveAudioLayerAdvancedMode ? 'Hide advanced audio layer controls' : 'Show advanced audio layer controls'}
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                      <path d="M1.8 8s2.2-4 6.2-4 6.2 4 6.2 4-2.2 4-6.2 4-6.2-4-6.2-4z" />
                      <circle cx="8" cy="8" r="1.8" />
                      {!effectiveAudioLayerAdvancedMode && <path d="M3 3l10 10" />}
                    </svg>
                  </button>
                </div>
                <div className="timeline-split-divider-line" />
              </div>
              {renderTrackSection('audio')}
              {marquee && (
                <div
                  className={marquee.mode === 'range' ? 'range-selection-drag' : 'marquee-selection'}
                  style={{
                    left: Math.min(marquee.startX, marquee.currentX) - scrollX,
                    top: Math.min(marquee.startY, marquee.currentY),
                    width: Math.abs(marquee.currentX - marquee.startX),
                    height: Math.abs(marquee.currentY - marquee.startY),
                  }}
                />
              )}
              {timelineRangeSelection && timelineRangeSelection.endTime > timelineRangeSelection.startTime && (
                <div
                  className="timeline-range-selection-overlay"
                  data-track-count={timelineRangeSelection.trackIds.length}
                  style={{
                    left: trackHeaderWidth + timeToPixel(timelineRangeSelection.startTime) - scrollX,
                    width: Math.max(1, timeToPixel(timelineRangeSelection.endTime - timelineRangeSelection.startTime)),
                  }}
                />
              )}
              <div
                className="timeline-global-overlays"
                style={{ left: trackHeaderWidth }}
              >
                <TimelineOverlays
                  timeToPixel={timeToPixel}
                  formatTime={formatTime}
                  scrollX={scrollX}
                  inPoint={inPoint}
                  outPoint={outPoint}
                  duration={duration}
                  markerDrag={markerDrag}
                  onMarkerMouseDown={handleMarkerMouseDown}
                  onMarkerContextMenu={handleInOutMarkerContextMenu}
                  switchMotionClass={timelineSwitchMotionClass}
                  renderMode="trackOverlays"
                  clipDrag={clipDrag}
                  isRamPreviewing={effectiveIsRamPreviewing}
                  ramPreviewProgress={effectiveRamPreviewProgress}
                  playheadPosition={playheadPosition}
                  isExporting={isExporting}
                  exportProgress={exportProgress}
                  exportRange={exportRange}
                  getCachedRanges={getCachedRanges}
                />
              </div>
            </div>
          </div>{/* timeline-scroll-wrapper */}

          <div
            className="timeline-range-marker-overlays"
            style={{ left: trackHeaderWidth }}
          >
            <TimelineOverlays
              timeToPixel={timeToPixel}
              formatTime={formatTime}
              scrollX={scrollX}
              inPoint={inPoint}
              outPoint={outPoint}
              duration={duration}
              markerDrag={markerDrag}
              onMarkerMouseDown={handleMarkerMouseDown}
              onMarkerContextMenu={handleInOutMarkerContextMenu}
              switchMotionClass={timelineSwitchMotionClass}
              renderMode="rangeMarkers"
              inLineOpacity={getTimelineLineOpacityForTime(inPoint)}
              outLineOpacity={getTimelineLineOpacityForTime(outPoint)}
              clipDrag={clipDrag}
              isRamPreviewing={effectiveIsRamPreviewing}
              ramPreviewProgress={effectiveRamPreviewProgress}
              playheadPosition={playheadPosition}
              isExporting={isExporting}
              exportProgress={exportProgress}
              exportRange={exportRange}
              getCachedRanges={getCachedRanges}
            />
          </div>

          {/* Playhead - spans from ruler through all tracks */}
          {showPlayhead && (
            <div
              className={`playhead ${timelineSwitchMotionClass}`}
              data-ai-id="timeline-playhead"
              style={{ left: playheadLeft }}
              onMouseDown={handlePlayheadMouseDown}
            >
              <div className="playhead-head" />
              <div className="playhead-line" />
            </div>
          )}

          {/* Timeline markers - span from ruler through all tracks like playhead */}
          {markers.map(marker => {
            const markerLeft = timeToPixel(marker.time) - scrollX + trackHeaderWidth;
            const markerLineOpacity = timelineMarkerDrag?.markerId === marker.id
              ? 1
              : getTimelineLineOpacity(markerLeft);

            return (
              <div
                key={marker.id}
                className={`timeline-marker ${timelineSwitchMotionClass} ${marker.stopPlayback ? 'is-stop-marker' : ''} ${timelineMarkerDrag?.markerId === marker.id ? 'dragging' : ''} ${aiAnimatedMarkers.get(marker.id) === 'add' ? 'ai-marker-added' : aiAnimatedMarkers.get(marker.id) === 'remove' ? 'ai-marker-removed' : ''}`}
                style={{
                  left: markerLeft,
                  '--marker-color': marker.color,
                  '--timeline-line-opacity': markerLineOpacity,
                } as React.CSSProperties}
                title={`${marker.stopPlayback ? 'Stop Marker' : (marker.label || 'Marker')}: ${formatTime(marker.time)} (drag to move, right-click for MIDI and transport actions)${marker.stopPlayback ? ' - playback stops automatically here' : ''}`}
                onMouseDown={(e) => handleTimelineMarkerMouseDown(e, marker.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setContextMenu(null);
                  setEmptyContextMenu(null);
                  setTrackContextMenu(null);
                  setInOutContextMenu(null);
                  setMarkerContextMenu({
                    x: e.clientX,
                    y: e.clientY,
                    markerId: marker.id,
                  });
                }}
              >
                <div className="timeline-marker-head">{marker.stopPlayback ? 'S' : 'M'}</div>
                <div className="timeline-marker-line" />
              </div>
            );
          })}

          {/* Ghost marker for drag-to-create */}
          {markerCreateDrag && markerCreateDrag.isOverTimeline && (
            <div
              className={`timeline-marker ghost ${markerCreateDrag.dropAnimating ? 'drop-animation' : ''}`}
              style={{
                left: timeToPixel(markerCreateDrag.currentTime) - scrollX + trackHeaderWidth,
                '--marker-color': '#2997E5',
                '--timeline-line-opacity': 1,
              } as React.CSSProperties}
            >
              <div className="timeline-marker-head">M</div>
              <div className="timeline-marker-line" />
            </div>
          )}
        </div>{/* timeline-body-content */}

        {/* Vertical Scrollbar — hide when slot grid is active */}
      </div>{/* timeline-body */}

      {/* Timeline Navigator - horizontal scrollbar with zoom handles — hide when slot grid is active */}
      {slotGridProgress < 1 && (
        <TimelineNavigator
          duration={duration}
          scrollX={scrollX}
          zoom={zoom}
          viewportWidth={timelineBodyRef.current?.querySelector('.track-lanes-scroll')?.parentElement?.clientWidth ?? 800}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          onScrollChange={setScrollX}
          onZoomChange={handleSetZoom}
        />
      )}

      <PickWhipCables pickWhipDrag={pickWhipDrag} trackPickWhipDrag={trackPickWhipDrag} />

      <TimelineContextMenu
        contextMenu={contextMenu}
        setContextMenu={setContextMenu}
        clipMap={clipMap}
        selectedClipIds={selectedClipIds}
        isClipLocked={isClipLocked}
        thumbnailsEnabled={thumbnailsEnabled}
        waveformsEnabled={waveformsEnabled}
        audioDisplayMode={audioDisplayMode}
        clipStemSeparationJobs={clipStemSeparationJobs}
        selectClip={selectClip}
        removeClip={removeClip}
        splitClipAtPlayhead={splitClipAtPlayhead}
        rippleDeleteSelection={rippleDeleteSelection}
        deleteGapAtTime={deleteGapAtTime}
        toggleClipReverse={toggleClipReverse}
        unlinkGroup={unlinkGroup}
        linkClips={linkClips}
        unlinkClips={unlinkClips}
        generateWaveformForClip={generateWaveformForClip}
        generateSpectrogramForClip={generateSpectrogramForClip}
        startClipStemSeparation={startClipStemSeparation}
        toggleThumbnailsEnabled={toggleThumbnailsEnabled}
        toggleWaveformsEnabled={toggleWaveformsEnabled}
        setAudioDisplayMode={setAudioDisplayMode}
        convertSolidToMotionShape={convertSolidToMotionShape}
        createSubcompositionFromSelection={(clipId) => {
          void createSubcompositionFromSelection(clipId);
        }}
        copyClipEffects={copyClipEffects}
        pasteClipEffects={pasteClipEffects}
        hasClipboardEffects={hasClipboardEffects}
        copyClipColor={copyClipColor}
        pasteClipColor={pasteClipColor}
        hasClipboardColor={hasClipboardColor}
        setMulticamDialogOpen={setMulticamDialogOpen}
        showInExplorer={showInExplorer}
      />

      <TimelineEmptyContextMenu
        menu={emptyContextMenu}
        onClose={() => setEmptyContextMenu(null)}
        onEraseGap={(time, trackId) => {
          deleteGapAtTime(time, [trackId]);
        }}
        onEraseLayerGaps={(time, trackId) => {
          deleteAllGaps([trackId], time);
        }}
        onEraseAllGaps={() => {
          deleteAllGaps();
        }}
        onFitCompToWindow={handleFitToWindow}
      />

      <TrackContextMenu
        menu={trackContextMenu}
        onClose={() => setTrackContextMenu(null)}
      />

      <MarkerContextMenu
        menu={markerContextMenu}
        markers={markers}
        updateMarker={updateMarker}
        removeMarker={removeMarker}
        onClose={() => setMarkerContextMenu(null)}
      />

      <InOutContextMenu
        menu={inOutContextMenu}
        onDelete={handleDeleteInOutPoint}
        onClose={() => setInOutContextMenu(null)}
      />

      {/* Multicam Dialog */}
      <MulticamDialog
        open={multicamDialogOpen}
        onClose={() => setMulticamDialogOpen(false)}
        selectedClipIds={selectedClipIds}
      />
    </div>
  );
}
