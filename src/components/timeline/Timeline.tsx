// Timeline component - Main orchestrator for video editing timeline
// Composes TimelineRuler, TimelineControls, TimelineHeader, TimelineTrack, TimelineClip, TimelineKeyframes

import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
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
import type { AnimatableProperty, Keyframe, TimelineClip as TimelineClipType, TimelineTrack as TimelineTrackType } from '../../types';
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
import { VerticalScrollbar } from './VerticalScrollbar';
import { SlotGrid } from './SlotGrid';
import { animateSlotGrid } from './slotGridAnimation';
import { useTimelineKeyboard } from './hooks/useTimelineKeyboard';
import { useTimelineZoom } from './hooks/useTimelineZoom';
import { usePlayheadDrag } from './hooks/usePlayheadDrag';
import { TimelineContextMenu } from './TimelineContextMenu';
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
import { MIN_ZOOM, MAX_ZOOM } from '../../stores/timeline/constants';
import type { ClipKeyframeTimeGroup, ContextMenuState } from './types';
import { isProxyFrameCountComplete } from '../../stores/mediaStore/helpers/proxyCompleteness';
import { parseVectorAnimationStateProperty } from '../../types/vectorAnimation';

const KEYFRAME_TIME_GROUP_PRECISION = 1000;
const RAM_PREVIEW_FEATURE_ENABLED = false;
const TRACK_HEADER_WIDTH = 150;

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
  const { zoom, scrollX } =
    useTimelineStore(useShallow(selectViewState));

  // Slot grid progress - direct selector for reliable reactivity
  const slotGridProgress = useTimelineStore(state => state.slotGridProgress);
  const timelineSessionId = useTimelineStore(state => state.timelineSessionId);

  // UI settings (rarely changes)
  const { snappingEnabled, inPoint, outPoint, loopPlayback, toolMode, thumbnailsEnabled, waveformsEnabled } =
    useTimelineStore(useShallow(selectUISettings));

  // Preview/export state
  const { ramPreviewEnabled, ramPreviewProgress, ramPreviewRange, isRamPreviewing, isExporting, exportProgress, exportRange } =
    useTimelineStore(useShallow(selectPreviewExportState));
  const effectiveRamPreviewEnabled = RAM_PREVIEW_FEATURE_ENABLED && ramPreviewEnabled;
  const effectiveRamPreviewProgress = RAM_PREVIEW_FEATURE_ENABLED ? ramPreviewProgress : null;
  const effectiveRamPreviewRange = RAM_PREVIEW_FEATURE_ENABLED ? ramPreviewRange : null;
  const effectiveIsRamPreviewing = RAM_PREVIEW_FEATURE_ENABLED && isRamPreviewing;

  // Keyframe state
  const { selectedKeyframeIds, clipKeyframes, expandedCurveProperties } =
    useTimelineStore(useShallow(selectKeyframeState));

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
  const { addTrack, isTrackExpanded, toggleTrackExpanded, getExpandedTrackHeight, trackHasKeyframes, setTrackParent } = store;

  // Clip actions
  const {
    addClip, addCompClip, addTextClip, addSolidClip, addMeshClip, addCameraClip, addSplatEffectorClip, moveClip, trimClip,
    removeClip, selectClip, unlinkGroup, splitClip, splitClipAtPlayhead,
    toggleClipReverse, updateClipTransform, setClipParent, generateWaveformForClip,
    addClipEffect, convertSolidToMotionShape,
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
  const { setZoom, setScrollX, setDuration, toggleSnapping } = store;

  // Preview actions
  const {
    toggleLoopPlayback, toggleRamPreviewEnabled, startRamPreview,
    cancelRamPreview, clearRamPreview, getCachedRanges, getProxyCachedRanges,
  } = store;

  // Tool actions
  const { setToolMode, toggleCutTool, toggleThumbnailsEnabled, toggleWaveformsEnabled } = store;

  // Marker actions
  const { addMarker, moveMarker, removeMarker, updateMarker } = store;

  // Clipboard actions
  const { copyClips, pasteClips, copyKeyframes, pasteKeyframes } = store;

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
  const contentRef = useRef<HTMLDivElement>(null);

  // Composition switch animation phase for tracks/ruler
  const clipAnimationPhase = useTimelineStore(s => s.clipAnimationPhase);
  const compositionSwitchDirection = useTimelineStore(s => s.compositionSwitchDirection);
  const compositionSwitchTargetTracks = useTimelineStore(s => s.compositionSwitchTargetTracks);
  const compositionSwitchSourceTracksRef = useRef<TimelineTrackType[] | null>(null);
  const isCompositionTrackMorphing = clipAnimationPhase !== 'idle' && compositionSwitchTargetTracks !== null;
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

  // Cut tool hover state (shared across linked clips)
  const [cutHoverInfo, setCutHoverInfo] = useState<{ clipId: string; time: number } | null>(null);
  const handleCutHover = useCallback((clipId: string | null, time: number | null) => {
    if (clipId && time !== null) {
      setCutHoverInfo({ clipId, time });
    } else {
      setCutHoverInfo(null);
    }
  }, []);

  // Cut at position handler - splits clip and returns to select mode
  const handleCutAtPosition = useCallback((clipId: string, time: number) => {
    splitClip(clipId, time);
    setToolMode('select');
  }, [splitClip, setToolMode]);

  // Stable callbacks for TimelineControls (avoids re-renders from inline arrows)
  const toggleProxyEnabled = useMediaStore(state => state.toggleProxyEnabled);
  const handleToggleSlotGrid = useCallback(() => {
    animateSlotGrid(slotGridProgress < 0.5 ? 1 : 0);
  }, [slotGridProgress]);
  useEffect(() => {
    if (RAM_PREVIEW_FEATURE_ENABLED) return;

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
    toggleRamPreviewEnabled,
    cancelRamPreview,
    clearRamPreview,
  ]);

  // Use store toggle directly (no useCallback needed - stable store reference)

  // Performance: Create lookup maps for O(1) clip/track access (must be before hooks that use them)
  const clipMap = useMemo(() => new Map(clips.map(c => [c.id, c])), [clips]);
  const trackMap = useMemo(() => new Map(tracks.map(t => [t.id, t])), [tracks]);

  // Time helpers - extracted to hook
  const {
    timeToPixel,
    pixelToTime,
    gridSize,
    formatTime,
    parseTime,
    getClipsAtTime,
    getSnapTargetTimes,
  } = useTimelineHelpers({ zoom, clips, getClipKeyframes });

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
    selectClip,
    moveClip,
    openCompositionTab,
    pixelToTime,
    getSnappedPosition,
    getPositionWithResistance,
  });

  // Clip trimming - extracted to hook
  const { clipTrim, handleTrimStart } = useClipTrim({
    clipMap,
    selectClip,
    trimClip,
    moveClip,
    pixelToTime,
  });

  // Clip fade (fade-in/out handles) - extracted to hook
  const { clipFade, handleFadeStart, getFadeInDuration, getFadeOutDuration } = useClipFade({
    clipMap,
    tracks,
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
    setPlayheadPosition,
    setDraggingPlayhead,
    setInPoint,
    setOutPoint,
    cancelRamPreview,
    pause,
    pixelToTime,
  });

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
    pixelToTime,
    addTrack,
    addClip,
    addCompClip,
    addTextClip,
    addSolidClip,
    addMeshClip,
    addCameraClip,
    addSplatEffectorClip,
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
  }, [isTransitionDrag, handleTransitionDragOver, handleTrackDragOver, scrollX, pixelToTime]);

  const handleCombinedDrop = useCallback((e: React.DragEvent, trackId: string) => {
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
  }, [isTransitionDrag, handleTransitionDrop, handleTrackDrop, scrollX, pixelToTime]);

  const handleCombinedDragLeave = useCallback((e: React.DragEvent) => {
    handleTransitionDragLeave();
    handleTrackDragLeave(e);
  }, [handleTransitionDragLeave, handleTrackDragLeave]);

  // Vertical scroll position (custom scrollbar)
  const [scrollY, setScrollY] = useState(0);
  const [hoveredKeyframeRow, setHoveredKeyframeRow] = useState<{
    trackId: string;
    property: AnimatableProperty;
  } | null>(null);

  // Context menu state for clip right-click
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const handleClipContextMenu = useClipContextMenu(selectedClipIds, selectClip, setContextMenu);

  // Context menu state for track header right-click
  const [trackContextMenu, setTrackContextMenu] = useState<TrackContextMenuState | null>(null);

  // Context menu state for marker right-click
  const [markerContextMenu, setMarkerContextMenu] = useState<MarkerContextMenuState | null>(null);

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
    handleMarkerButtonDragStart,
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
    clipDrag,
    clipTrim,
    markerDrag,
    isDraggingPlayhead,
    selectClip,
    selectKeyframe,
    deselectAllKeyframes,
    pixelToTime,
    isTrackExpanded,
    getExpandedTrackHeight,
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

  // Subscribe to curveEditorHeight for snap position recalculation
  const curveEditorHeight = useTimelineStore(s => s.curveEditorHeight);

  // Calculate total content height and track snap positions for vertical scrollbar
  // Dependencies: tracks, expansion state, curve editor state, selected clips (affects property rows)
  const { contentHeight, trackSnapPositions } = useMemo(() => {
    let totalHeight = 0;
    const snapPositions: number[] = [0];
    for (const track of timelineViewTracks) {
      const isExpanded = !isCompositionTrackMorphing && isTrackExpanded(track.id);
      totalHeight += isExpanded ? getExpandedTrackHeight(track.id, track.height) : track.height;
      snapPositions.push(totalHeight);
    }
    return { contentHeight: totalHeight, trackSnapPositions: snapPositions };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timelineViewTracks, isCompositionTrackMorphing, isTrackExpanded, getExpandedTrackHeight, expandedCurveProperties, curveEditorHeight, selectedClipIds, clipKeyframes]);

  // Track viewport height for scrollbar
  const [viewportHeight, setViewportHeight] = useState(300);

  // Update viewport height on resize
  useEffect(() => {
    const updateViewportHeight = () => {
      if (scrollWrapperRef.current) {
        setViewportHeight(scrollWrapperRef.current.clientHeight);
      }
    };
    updateViewportHeight();
    window.addEventListener('resize', updateViewportHeight);
    return () => window.removeEventListener('resize', updateViewportHeight);
  }, []);

  // Auto-scroll based on which track type is being hovered during drag
  useEffect(() => {
    if (!externalDrag) return;

    // Determine if we're hovering over an audio or video area
    const hoveredTrack = tracks.find((t) => t.id === externalDrag.trackId);
    const isOverAudio = hoveredTrack?.type === 'audio' ||
      externalDrag.newTrackType === 'audio' ||
      // For audio-only files, always scroll to bottom
      externalDrag.isAudio;
    const isOverVideo = hoveredTrack?.type === 'video' ||
      externalDrag.newTrackType === 'video';

    if (isOverAudio && contentRef.current) {
      // Scroll to bottom to show audio tracks / audio drop zone
      const actualHeight = contentRef.current.scrollHeight;
      const maxScroll = Math.max(0, actualHeight - viewportHeight);
      if (maxScroll > scrollY) {
        setScrollY(maxScroll);
      }
    } else if (isOverVideo) {
      // Scroll to top to show video tracks / video drop zone
      if (scrollY > 0) {
        setScrollY(0);
      }
    }
  }, [externalDrag, tracks, contentHeight, viewportHeight, scrollY]);

  // Performance: Memoize proxy-ready file count
  const mediaFilesWithProxyCount = useMemo(
    () => mediaFiles.filter((f) => f.proxyStatus === 'ready').length,
    [mediaFiles]
  );

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
    timelineRef,
    playheadPosition,
    clips,
    tracks,
    isPlaying,
    isDraggingPlayhead,
    ramPreviewRange: effectiveRamPreviewRange,
    isRamPreviewing: effectiveIsRamPreviewing,
    clipKeyframes,
    clipDrag,
    zoom,
    scrollX,
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

  // Handle shift+mousewheel on track header to resize height
  const handleTrackHeaderWheel = useCallback(
    (e: React.WheelEvent, trackId: string) => {
      const track = trackMap.get(trackId);
      if (!track) return;

      if (e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        // Smooth scaling: small multiplier so each wheel notch (~100 deltaY) = ~5px
        const delta = -e.deltaY * 0.05;
        useTimelineStore.getState().scaleTracksOfType(track.type, delta);
      } else if (e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        const delta = -e.deltaY * 0.05;
        useTimelineStore.getState().setTrackHeight(trackId, track.height + delta);
      }
    },
    [trackMap]
  );

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
    (clip: TimelineClipType, trackId: string) => {
      const track = trackMap.get(trackId);
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
          draggedClip.linkedClipId === clip.id);
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

      return (
        <TimelineClip
          key={`${timelineSessionId}:${clip.id}`}
          clip={clip}
          trackId={trackId}
          track={track}
          tracks={tracks}
          clips={clips}
          isSelected={selectedClipIds.has(clip.id)}
          isInLinkedGroup={!!clip.linkedGroupId}
          isDragging={isDragging}
          isTrimming={isTrimming}
          isFading={isFading}
          isLinkedToDragging={!!isLinkedToDragging}
          isLinkedToTrimming={!!isLinkedToTrimming}
          clipDrag={clipDrag}
          clipTrim={clipTrim}
          clipFade={clipFade}
          zoom={zoom}
          scrollX={scrollX}
          timelineRef={timelineRef}
          proxyEnabled={proxyEnabled}
          proxyStatus={proxyStatus}
          proxyProgress={mediaFile?.proxyProgress || 0}
          showTranscriptMarkers={showTranscriptMarkers}
          toolMode={toolMode}
          snappingEnabled={snappingEnabled}
          cutHoverInfo={cutHoverInfo}
          onCutHover={handleCutHover}
          onMouseDown={(e) => handleClipMouseDown(e, clip.id)}
          onDoubleClick={(e) => handleClipDoubleClick(e, clip.id)}
          onContextMenu={(e) => handleClipContextMenu(e, clip.id)}
          onTrimStart={(e, edge) => handleTrimStart(e, clip.id, edge)}
          onFadeStart={(e, edge) => handleFadeStart(e, clip.id, edge)}
          onCutAtPosition={handleCutAtPosition}
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
      clipMap,
      clips,
      selectedClipIds,
      clipDrag,
      clipTrim,
      clipFade,
      zoom,
      scrollX,
      proxyEnabled,
      mediaFiles,
      showTranscriptMarkers,
      toolMode,
      snappingEnabled,
      cutHoverInfo,
      handleCutHover,
      handleClipMouseDown,
      handleClipDoubleClick,
      handleClipContextMenu,
      handleTrimStart,
      handleFadeStart,
      handleCutAtPosition,
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

  const playheadLeft = timeToPixel(playheadPosition) - scrollX + TRACK_HEADER_WIDTH;
  const showPlayhead = playheadLeft >= TRACK_HEADER_WIDTH;
  const timelineSwitchMotionClass = clipAnimationPhase === 'exiting'
    ? (compositionSwitchDirection === 'backward' ? 'timeline-switch-exit-left' : 'timeline-switch-exit-right')
    : clipAnimationPhase === 'entering'
      ? (compositionSwitchDirection === 'backward' ? 'timeline-switch-enter-right' : 'timeline-switch-enter-left')
      : '';

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

  return (
    <div
      className={`timeline-container ${clipDrag || clipTrim ? 'is-dragging' : ''}`}
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
        <TimelineControls
          isPlaying={isPlaying}
          loopPlayback={loopPlayback}
          playheadPosition={playheadPosition}
          duration={duration}
          zoom={zoom}
          snappingEnabled={snappingEnabled}
          inPoint={inPoint}
          outPoint={outPoint}
          proxyEnabled={proxyEnabled}
          currentlyGeneratingProxyId={currentlyGeneratingProxyId}
          mediaFilesWithProxy={mediaFilesWithProxyCount}
          showTranscriptMarkers={showTranscriptMarkers}
          thumbnailsEnabled={thumbnailsEnabled}
          waveformsEnabled={waveformsEnabled}
          toolMode={toolMode}
          onPlay={play}
          onPause={pause}
          onStop={stop}
          onToggleLoop={toggleLoopPlayback}
          onSetZoom={handleSetZoom}
          onToggleSnapping={toggleSnapping}
          onSetInPoint={setInPointAtPlayhead}
          onSetOutPoint={setOutPointAtPlayhead}
          onClearInOut={clearInOut}
          onToggleProxy={toggleProxyEnabled}
          onToggleTranscriptMarkers={toggleTranscriptMarkers}
          onToggleThumbnails={toggleThumbnailsEnabled}
          onToggleWaveforms={toggleWaveformsEnabled}
          onToggleCutTool={toggleCutTool}
          onSetDuration={setDuration}
          onFitToWindow={handleFitToWindow}
          onToggleSlotGrid={handleToggleSlotGrid}
          slotGridActive={slotGridProgress > 0.5}
          formatTime={formatTime}
          parseTime={parseTime}
        />
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
        <div className="timeline-body-content" style={slotGridProgress > 0 ? {
          opacity: 1 - slotGridProgress,
          transform: `scale(${1 - slotGridProgress * 0.05})`,
          transformOrigin: 'center center',
          pointerEvents: (slotGridProgress >= 0.5 ? 'none' : 'auto') as React.CSSProperties['pointerEvents'],
          display: slotGridProgress >= 1 ? 'none' as const : undefined,
        } : undefined}>
          <div className="timeline-header-row">
            <div className="ruler-header">
              <span>Time</span>
              <button
                className={`add-marker-btn ${markerCreateDrag?.isDragging ? 'dragging' : ''}`}
                onMouseDown={handleMarkerButtonDragStart}
                title="Drag to place marker, or press M"
              >
                M
              </button>
            </div>
            <div className={`time-ruler-wrapper ${clipAnimationPhase !== 'idle' ? 'comp-switching' : ''}`}>
              <TimelineRuler
                duration={duration}
                zoom={zoom}
                scrollX={scrollX}
                onRulerMouseDown={handleRulerMouseDown}
                formatTime={formatTime}
              />
            </div>
          </div>
          <div className="timeline-scroll-wrapper" ref={scrollWrapperRef}>
            <div className="timeline-content-row" ref={contentRef} style={{ transform: `translateY(-${scrollY}px)` }}>
          <div className={`track-headers ${clipAnimationPhase === 'exiting' ? 'phase-exiting' : clipAnimationPhase === 'entering' ? 'phase-entering' : ''}`}>
            {/* New video track preview header - appears when dragging over new track zone */}
            {externalDrag && (
              <div
                className={`track-header-preview video ${externalDrag.newTrackType === 'video' ? 'active' : ''}`}
                style={{ height: 60 }}
              >
                <span className="track-header-preview-label">+ New Video Track</span>
              </div>
            )}
            {timelineViewTracks.map((track) => {
              const isDimmed =
                (track.type === 'video' && anyViewVideoSolo && !track.solo) ||
                (track.type === 'audio' && anyViewAudioSolo && !track.solo);
              const isExpanded = !isCompositionTrackMorphing && isTrackExpanded(track.id);
              const dynamicHeight = isExpanded ? getExpandedTrackHeight(track.id, track.height) : track.height;

              return (
                  <TimelineHeader
                    key={track.id}
                    track={track}
                    tracks={timelineViewTracks}
                    isDimmed={isDimmed}
                    isExpanded={isExpanded}
                    dynamicHeight={dynamicHeight}
                    hasKeyframes={!isCompositionTrackMorphing && trackHasKeyframes(track.id)}
                    selectedClipIds={selectedClipIds}
                    clips={isCompositionTrackMorphing ? [] : clips}
                    playheadPosition={playheadPosition}
                    onToggleExpand={() => toggleTrackExpanded(track.id)}
                    onToggleSolo={() =>
                      useTimelineStore.getState().setTrackSolo(track.id, !track.solo)
                    }
                    onToggleMuted={() =>
                      useTimelineStore.getState().setTrackMuted(track.id, !track.muted)
                    }
                    onToggleVisible={() =>
                      useTimelineStore.getState().setTrackVisible(track.id, !track.visible)
                    }
                    onRenameTrack={(name) =>
                      useTimelineStore.getState().renameTrack(track.id, name)
                    }
                    onWheel={(e) => handleTrackHeaderWheel(e, track.id)}
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
                    onSetTrackParent={setTrackParent}
                    onTrackPickWhipDragStart={handleTrackPickWhipDragStart}
                    onTrackPickWhipDragEnd={handleTrackPickWhipDragEnd}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
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
            {/* New audio track preview header - appears when dragging over new track zone or linked audio needs new track */}
            {/* Only show if the video has audio */}
            {externalDrag && externalDrag.hasAudio && (
              <div
                className={`track-header-preview audio ${
                  externalDrag.newTrackType === 'audio' ||
                  (externalDrag.newTrackType === 'video' && externalDrag.hasAudio) ||
                  (externalDrag.isVideo && externalDrag.audioTrackId === '__new_audio_track__')
                    ? 'active'
                    : ''
                }`}
                style={{ height: 40 }}
              >
                <span className="track-header-preview-label">+ New Audio Track</span>
              </div>
            )}
          </div>

          <div
            ref={(el) => {
              (timelineRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
              (trackLanesRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
            }}
            className={`timeline-tracks ${clipDrag ? 'dragging-clip' : ''} ${marquee ? 'marquee-selecting' : ''}`}
            data-ai-id="timeline-tracks"
            onMouseDown={handleMarqueeMouseDown}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={handleContainerDragLeave}
          >
            <div className={`track-lanes-scroll ${clipAnimationPhase === 'exiting' ? 'phase-exiting' : clipAnimationPhase === 'entering' ? 'phase-entering' : ''}`} style={{
              transform: `translateX(-${scrollX}px)`,
              minWidth: Math.max(duration * zoom + 500, 2000), // Ensure background extends beyond visible content
              ['--grid-size' as string]: `${gridSize}px`,
            }}>
              {/* New Video Track drop zone - at TOP above video tracks */}
              {externalDrag && !externalDrag.isAudio && (
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

              {timelineViewTracks.map((track) => {
                const isDimmed =
                  (track.type === 'video' && anyViewVideoSolo && !track.solo) ||
                  (track.type === 'audio' && anyViewAudioSolo && !track.solo);
                const isExpanded = !isCompositionTrackMorphing && isTrackExpanded(track.id);
                const dynamicHeight = isExpanded ? getExpandedTrackHeight(track.id, track.height) : track.height;

                return (
                  <TimelineTrack
                key={track.id}
                track={track}
                clips={isCompositionTrackMorphing ? [] : clips}
                isDimmed={isDimmed}
                isExpanded={isExpanded}
                dynamicHeight={dynamicHeight}
                isDragTarget={clipDrag?.currentTrackId === track.id}
                isExternalDragTarget={
                  externalDrag?.trackId === track.id ||
                  externalDrag?.audioTrackId === track.id ||
                  externalDrag?.videoTrackId === track.id
                }
                selectedClipIds={selectedClipIds}
                selectedKeyframeIds={selectedKeyframeIds}
                clipDrag={clipDrag}
                clipTrim={clipTrim}
                externalDrag={externalDrag}
                zoom={zoom}
                scrollX={scrollX}
                timelineRef={timelineRef}
                onClipMouseDown={handleClipMouseDown}
                onClipContextMenu={handleClipContextMenu}
                onTrimStart={handleTrimStart}
                onDrop={(e) => handleCombinedDrop(e, track.id)}
                onDragOver={(e) => handleCombinedDragOver(e, track.id)}
                onDragEnter={(e) => handleTrackDragEnter(e, track.id)}
                onDragLeave={handleCombinedDragLeave}
                renderClip={renderClip}
                clipKeyframes={clipKeyframes}
                renderKeyframeDiamonds={renderKeyframeDiamonds}
                timeToPixel={timeToPixel}
                pixelToTime={pixelToTime}
                expandedCurveProperties={expandedCurveProperties}
                onSelectKeyframe={selectKeyframe}
                onMoveKeyframe={moveKeyframe}
                onUpdateBezierHandle={updateBezierHandle}
              />
            );
          })}

          {isCompositionTrackMorphing && (
            <div className="composition-exit-clips-overlay">
              {tracks.map((track) => {
                const isExpanded = isTrackExpanded(track.id);
                const dynamicHeight = isExpanded ? getExpandedTrackHeight(track.id, track.height) : track.height;
                const trackClips = clips.filter((clip) => clip.trackId === track.id);

                return (
                  <div
                    key={`exit-${track.id}`}
                    className="composition-exit-track-row"
                    style={{ height: dynamicHeight }}
                  >
                    <div className="track-clip-row" style={{ height: track.height }}>
                      {trackClips.map((clip) => renderClip(clip, track.id))}
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
              tracks={tracks}
              timeToPixel={timeToPixel}
              isTrackExpanded={isTrackExpanded}
              getExpandedTrackHeight={getExpandedTrackHeight}
            />
          )}

          {!isCompositionTrackMorphing && (
            <AIActionOverlays
              tracks={tracks}
              timeToPixel={timeToPixel}
              isTrackExpanded={isTrackExpanded}
              getExpandedTrackHeight={getExpandedTrackHeight}
            />
          )}

          {/* New video track preview for linked audio-to-video */}
          {/* When hovering audio track, show linked video preview as new track */}
          {externalDrag &&
            externalDrag.videoTrackId === '__new_video_track__' && (
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

          {/* New audio track preview for linked video audio */}
          {/* Only show if video has audio (hasAudio !== false) */}
          {externalDrag &&
            externalDrag.audioTrackId === '__new_audio_track__' && (
              <div className="track-lane audio new-track-preview" style={{ height: 40 }}>
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

          {/* New Audio Track drop zone - at BOTTOM below audio tracks */}
          {/* Only show for audio files OR videos with audio (hasAudio !== false) */}
          {externalDrag && (externalDrag.newTrackType === 'audio' || externalDrag.hasAudio !== false) && (
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
              {/* Show audio preview when dropping audio OR when dropping video with audio */}
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

          <TimelineOverlays
            timeToPixel={timeToPixel}
            formatTime={formatTime}
            inPoint={inPoint}
            outPoint={outPoint}
            duration={duration}
            markerDrag={markerDrag}
            onMarkerMouseDown={handleMarkerMouseDown}
            switchMotionClass={timelineSwitchMotionClass}
            clipDrag={clipDrag}
            isRamPreviewing={effectiveIsRamPreviewing}
            ramPreviewProgress={effectiveRamPreviewProgress}
            playheadPosition={playheadPosition}
            isExporting={isExporting}
            exportProgress={exportProgress}
            exportRange={exportRange}
            getCachedRanges={getCachedRanges}
            getProxyCachedRanges={getProxyCachedRanges}
          />

              {/* Marquee selection rectangle */}
              {marquee && (
                <div
                  className="marquee-selection"
                  style={{
                    left: Math.min(marquee.startX, marquee.currentX),
                    top: Math.min(marquee.startY, marquee.currentY),
                    width: Math.abs(marquee.currentX - marquee.startX),
                    height: Math.abs(marquee.currentY - marquee.startY),
                  }}
                />
              )}

              {!isCompositionTrackMorphing && (
                <ParentChildLinksOverlay
                  clips={clips}
                  tracks={tracks}
                  clipDrag={clipDrag}
                  timelineRef={timelineRef}
                  scrollX={scrollX}
                  zoom={zoom}
                  getExpandedTrackHeight={getExpandedTrackHeight}
                />
              )}


            </div>{/* track-lanes-scroll */}
          </div>{/* timeline-tracks */}
            </div>{/* timeline-content-row */}
          </div>{/* timeline-scroll-wrapper */}

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
          {markers.map(marker => (
            <div
              key={marker.id}
              className={`timeline-marker ${timelineSwitchMotionClass} ${marker.stopPlayback ? 'is-stop-marker' : ''} ${timelineMarkerDrag?.markerId === marker.id ? 'dragging' : ''} ${aiAnimatedMarkers.get(marker.id) === 'add' ? 'ai-marker-added' : aiAnimatedMarkers.get(marker.id) === 'remove' ? 'ai-marker-removed' : ''}`}
              style={{
                left: timeToPixel(marker.time) - scrollX + TRACK_HEADER_WIDTH,
                '--marker-color': marker.color,
              } as React.CSSProperties}
              title={`${marker.stopPlayback ? 'Stop Marker' : (marker.label || 'Marker')}: ${formatTime(marker.time)} (drag to move, right-click for MIDI and transport actions)${marker.stopPlayback ? ' - playback stops automatically here' : ''}`}
              onMouseDown={(e) => handleTimelineMarkerMouseDown(e, marker.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
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
          ))}

          {/* Ghost marker for drag-to-create */}
          {markerCreateDrag && markerCreateDrag.isOverTimeline && (
            <div
              className={`timeline-marker ghost ${markerCreateDrag.dropAnimating ? 'drop-animation' : ''}`}
              style={{
                left: timeToPixel(markerCreateDrag.currentTime) - scrollX + 150,
                '--marker-color': '#2997E5',
              } as React.CSSProperties}
            >
              <div className="timeline-marker-head">M</div>
              <div className="timeline-marker-line" />
            </div>
          )}
        </div>{/* timeline-body-content */}

        {/* Vertical Scrollbar — hide when slot grid is active */}
        {slotGridProgress < 1 && (
          <VerticalScrollbar
            scrollY={scrollY}
            contentHeight={contentHeight}
            viewportHeight={viewportHeight}
            onScrollChange={setScrollY}
          />
        )}
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
        selectClip={selectClip}
        removeClip={removeClip}
        splitClipAtPlayhead={splitClipAtPlayhead}
        toggleClipReverse={toggleClipReverse}
        unlinkGroup={unlinkGroup}
        generateWaveformForClip={generateWaveformForClip}
        convertSolidToMotionShape={convertSolidToMotionShape}
        setMulticamDialogOpen={setMulticamDialogOpen}
        showInExplorer={showInExplorer}
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

      {/* Multicam Dialog */}
      <MulticamDialog
        open={multicamDialogOpen}
        onClose={() => setMulticamDialogOpen(false)}
        selectedClipIds={selectedClipIds}
      />
    </div>
  );
}
