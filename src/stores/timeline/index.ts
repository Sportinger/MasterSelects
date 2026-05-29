// Timeline store - combines all slices into a single Zustand store

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

import type { TimelineStore, TimelineUtils, TimelineClip, Keyframe } from './types';
import { DEFAULT_TRACKS, DEFAULT_TRACK_HEADER_WIDTH, MIN_TRACK_HEADER_WIDTH, MAX_TRACK_HEADER_WIDTH } from './constants';

import { createTrackSlice } from './trackSlice';
import { createClipSlice } from './clipSlice';
import { createTextClipSlice } from './textClipSlice';
import { createSolidClipSlice } from './solidClipSlice';
import { createMidiClipSlice } from './midiClipSlice';
import { createMathSceneClipSlice } from './mathSceneClipSlice';
import { createMotionClipSlice } from './motionClipSlice';
import { createMeshClipSlice } from './meshClipSlice';
import { createCameraClipSlice } from './cameraClipSlice';
import { createSplatEffectorClipSlice } from './splatEffectorClipSlice';
import { createClipEffectSlice } from './clipEffectSlice';
import { createColorCorrectionSlice } from './colorCorrectionSlice';
import { createLinkedGroupSlice } from './linkedGroupSlice';
import { createDownloadClipSlice } from './downloadClipSlice';
import { createAudioEditSlice } from './audioEditSlice';
import { createStemSeparationSlice } from './stemSeparationSlice';
import { createVideoBakeSlice } from './videoBakeSlice';
import { createToolSlice, getDefaultLastTimelineToolByGroup } from './toolSlice';
import { createTimelineEditOperationSlice } from './editOperations';
import { createPlaybackSlice } from './playbackSlice';
import { createRamPreviewSlice } from './ramPreviewSlice';
import { createProxyCacheSlice } from './proxyCacheSlice';
import { createSelectionSlice } from './selectionSlice';
import { createKeyframeSlice } from './keyframeSlice';
import { createMaskSlice } from './maskSlice';
import { createMarkerSlice } from './markerSlice';
import { createTransitionSlice } from './transitionSlice';
import { createNodeGraphSlice } from './nodeGraphSlice';
import { createClipboardSlice } from './clipboardSlice';
import { createAIActionFeedbackSlice } from './aiActionFeedbackSlice';
import { createPositioningUtils } from './positioningUtils';
import { createSerializationUtils } from './serializationUtils';
import { Logger } from '../../services/logger';
import { lockTimelineEditActions } from './exportEditLock';
import {
  readStoredAudioLayerAdvancedMode,
  readStoredTimelineSplitRatio,
  readStoredTimelineTrackFocusMode,
  readStoredTimelineTrackHeaderWidth,
} from './viewPreferences';

const log = Logger.create('Timeline');

function closeExportPreviewFrame(frame: ImageBitmap | null): void {
  if (!frame) return;
  try {
    frame.close();
  } catch {
    // ImageBitmap.close() is best-effort cleanup; ignore if the browser already released it.
  }
}

// Re-export types for convenience
export type { TimelineStore, TimelineClip, Keyframe } from './types';
export { DEFAULT_TRANSFORM, DEFAULT_TRACKS, SNAP_THRESHOLD_SECONDS } from './constants';
export { seekVideo, getDefaultEffectParams } from './utils';
export { setClipStemSeparationRunner } from './stemSeparationSlice';

// Re-export selectors for optimized store subscriptions
export * from './selectors';

export const useTimelineStore = create<TimelineStore>()(
  subscribeWithSelector((set, get) => {
    // Create all slices
    const trackActions = createTrackSlice(set, get);
    const clipActions = createClipSlice(set, get);
    const textClipActions = createTextClipSlice(set, get);
    const solidClipActions = createSolidClipSlice(set, get);
    const midiClipActions = createMidiClipSlice(set, get);
    const mathSceneClipActions = createMathSceneClipSlice(set, get);
    const motionClipActions = createMotionClipSlice(set, get);
    const meshClipActions = createMeshClipSlice(set, get);
    const cameraClipActions = createCameraClipSlice(set, get);
    const splatEffectorClipActions = createSplatEffectorClipSlice(set, get);
    const clipEffectActions = createClipEffectSlice(set, get);
    const colorCorrectionActions = createColorCorrectionSlice(set, get);
    const linkedGroupActions = createLinkedGroupSlice(set, get);
    const downloadClipActions = createDownloadClipSlice(set, get);
    const audioEditActions = createAudioEditSlice(set, get);
    const stemSeparationActions = createStemSeparationSlice(set, get);
    const videoBakeActions = createVideoBakeSlice(set, get);
    const toolActions = createToolSlice(set, get);
    const timelineEditOperationActions = createTimelineEditOperationSlice(set, get);
    const playbackActions = createPlaybackSlice(set, get);
    const ramPreviewActions = createRamPreviewSlice(set, get);
    const proxyCacheActions = createProxyCacheSlice(set, get);
    const selectionActions = createSelectionSlice(set, get);
    const keyframeActions = createKeyframeSlice(set, get);
    const maskActions = createMaskSlice(set, get);
    const markerActions = createMarkerSlice(set, get);
    const transitionActions = createTransitionSlice(set, get);
    const nodeGraphActions = createNodeGraphSlice(set, get);
    const clipboardActions = createClipboardSlice(set, get);
    const aiActionFeedbackActions = createAIActionFeedbackSlice(set, get);

    // Extracted utils (positioning + serialization)
    const positioningUtils = createPositioningUtils(set, get);
    const serializationUtils = createSerializationUtils(set, get);

    // Small utils that stay inline
    const inlineUtils: Pick<TimelineUtils, 'getClipsAtTime' | 'updateDuration' | 'findAvailableAudioTrack'> = {
      getClipsAtTime: (time) => {
        const { clips } = get();
        return clips.filter(c => time >= c.startTime && time < c.startTime + c.duration);
      },

      updateDuration: () => {
        const { clips, durationLocked } = get();
        // Don't auto-update if duration is manually locked
        if (durationLocked) return;

        if (clips.length === 0) {
          set({ duration: 60 });
          return;
        }
        const maxEnd = Math.max(...clips.map(c => c.startTime + c.duration));
        set({ duration: Math.max(60, maxEnd + 10) }); // Add 10 seconds padding
      },

      findAvailableAudioTrack: (startTime: number, duration: number) => {
        const { tracks, clips, addTrack } = get();
        const audioTracks = tracks.filter(t => t.type === 'audio');
        const endTime = startTime + duration;

        // Check each audio track for availability
        for (const track of audioTracks) {
          const trackClips = clips.filter(c => c.trackId === track.id);
          const hasOverlap = trackClips.some(clip => {
            const clipEnd = clip.startTime + clip.duration;
            // Check if time ranges overlap
            return !(endTime <= clip.startTime || startTime >= clipEnd);
          });

          if (!hasOverlap) {
            return track.id; // This track is available
          }
        }

        // No available audio track found, create a new one
        addTrack('audio');
        const { tracks: updatedTracks } = get();
        const newTrack = updatedTracks[updatedTracks.length - 1];
        log.debug('Created new audio track', { name: newTrack.name });
        return newTrack.id;
      },
    };

    // Combine all utils
    const utils: TimelineUtils = {
      ...inlineUtils,
      ...positioningUtils,
      ...serializationUtils,
    };

    const initialTrackFocusMode = readStoredTimelineTrackFocusMode('balanced');

    // Initial state
    const initialState = {
      // Core state
      tracks: DEFAULT_TRACKS,
      clips: [] as TimelineClip[],
      playheadPosition: 0,
      duration: 60,
      zoom: 50,
      scrollX: 0,
      trackHeaderWidth: readStoredTimelineTrackHeaderWidth(
        DEFAULT_TRACK_HEADER_WIDTH,
        MIN_TRACK_HEADER_WIDTH,
        MAX_TRACK_HEADER_WIDTH,
      ),
      timelineSplitRatio: readStoredTimelineSplitRatio(null),
      snappingEnabled: true,
      isPlaying: false,
      isDraggingPlayhead: false,
      playbackWarmup: null,
      selectedClipIds: new Set<string>(),
      primarySelectedClipId: null,
      propertiesSelection: null,
      targetTrackIdByType: {},

      // Render layers (populated by useLayerSync, used by engine)
      layers: [] as import('../../types').Layer[],
      selectedLayerId: null as string | null,

      // In/Out markers
      inPoint: null as number | null,
      outPoint: null as number | null,
      loopPlayback: false,

      // Playback speed (1 = normal, 2 = 2x, -1 = reverse, etc.)
      playbackSpeed: 1,

      // Duration lock (when true, duration won't auto-update based on clips)
      durationLocked: false,

      // RAM Preview state
      ramPreviewEnabled: false,
      ramPreviewProgress: null as number | null,
      ramPreviewRange: null as { start: number; end: number } | null,
      isRamPreviewing: false,
      cachedFrameTimes: new Set<number>(),

      // Proxy cache preloading state
      isProxyCaching: false,
      proxyCacheProgress: null as number | null,

      // Export progress state
      isExporting: false,
      exportProgress: null as number | null,
      exportCurrentTime: null as number | null,
      exportRange: null as { start: number; end: number } | null,
      exportPreviewFrame: null as ImageBitmap | null,
      exportPreviewFrameTime: null as number | null,

      // Performance toggles (enabled by default)
      thumbnailsEnabled: true,
      waveformsEnabled: true,
      audioDisplayMode: 'detailed' as const,
      audioLayerAdvancedMode: readStoredAudioLayerAdvancedMode(true),
      audioFocusMode: initialTrackFocusMode === 'audio',
      trackFocusMode: initialTrackFocusMode,
      audioRegionSelection: null,
      videoBakeRegionSelection: null,
      videoBakeRegions: [] as import('../../types').VideoBakeRegion[],
      audioRegionGainPreview: null,
      audioSpectralRegionSelection: null,
      audioRegionClipboard: null,
      showAudioRegionEditMarkers: true,
      showTranscriptMarkers: true,
      clipStemSeparationJobs: {},
      expandedClipStemLayerIds: new Set<string>(),

      // Keyframe animation state
      clipKeyframes: new Map<string, Keyframe[]>(),
      keyframeRecordingEnabled: new Set<string>(),
      expandedTracks: new Set<string>(DEFAULT_TRACKS.map(t => t.id)),
      expandedTrackPropertyGroups: new Map<string, Set<string>>(),
      selectedKeyframeIds: new Set<string>(),
      expandedCurveProperties: new Map<string, Set<import('../../types').AnimatableProperty>>(),
      curveEditorHeight: 250,

      // Mask state
      maskEditMode: 'none' as const,
      maskPanelActive: false,
      activeMaskId: null as string | null,
      selectedVertexIds: new Set<string>(),
      maskDrawStart: null as { x: number; y: number } | null,
      maskDragging: false,

      // Tool mode
      toolMode: 'select' as const,
      activeTimelineToolId: 'select' as const,
      previousTimelineToolId: null as import('./types').TimelineToolId | null,
      lastTimelineToolByGroup: getDefaultLastTimelineToolByGroup(),
      openTimelineToolGroupId: null as import('./types').TimelineToolGroupId | null,
      momentaryTimelineToolId: null as import('./types').TimelineToolId | null,
      timelineRangeSelection: null as import('./types').TimelineRangeSelection | null,
      timelineToolPreview: null as import('./types').TimelineToolPreview | null,
      clipDragPreview: null as import('./types').TimelineClipDragPreview | null,

      // Timeline markers
      markers: [] as import('./types').TimelineMarker[],

      // Composition-level audio master bus state
      masterAudioState: undefined,
      runtimeAudioMeters: {
        trackMeters: {},
      },

      // Clip entrance animation key (increments on composition switch)
      clipEntranceAnimationKey: 0,

      // Clip animation phase for enter/exit transitions
      clipAnimationPhase: 'idle' as const,

      // Composition switch direction derived from tab positions
      compositionSwitchDirection: 'forward' as const,

      // Target track layout shown during composition switch exit
      compositionSwitchTargetTracks: null,

      // Slot grid view progress (0 = full timeline, 1 = full grid view)
      slotGridProgress: 0,

      // Clipboard state for copy/paste
      clipboardData: null as import('./types').ClipboardClipData[] | null,
      clipboardKeyframes: null as import('./types').ClipboardKeyframeData[] | null,
      clipboardEffects: null as import('./types').ClipboardClipEffectsData | null,
      clipboardColor: null as import('./types').ClipboardClipColorData | null,

      // AI action visual feedback (transient, not serialized)
      aiActionOverlays: [] as import('./types').AIActionOverlay[],
      aiMovingClips: new Map<string, import('./types').AIMovingClip>(),

      // Async session guard for composition switches / reloads
      timelineSessionId: 0,
    };

    // Layer actions (render layers for engine, moved from mixerStore)
    const layerActions = {
      setLayers: (layers: import('../../types').Layer[]) => {
        set({ layers });
      },
      updateLayer: (id: string, updates: Partial<import('../../types').Layer>) => {
        const { layers } = get();
        set({
          layers: layers.map((l) => (l?.id === id ? { ...l, ...updates } : l)),
        });
      },
      selectLayer: (id: string | null) => {
        set({ selectedLayerId: id });
      },
    };

    // Export actions (inline since they're simple)
    const exportActions = {
      setExportProgress: (progress: number | null, currentTime: number | null) => {
        set({ exportProgress: progress, exportCurrentTime: currentTime });
      },
      setExportPreviewFrame: (frame: ImageBitmap | null, currentTime: number | null) => {
        const previousFrame = get().exportPreviewFrame;
        if (previousFrame && previousFrame !== frame) {
          closeExportPreviewFrame(previousFrame);
        }
        set({ exportPreviewFrame: frame, exportPreviewFrameTime: currentTime });
      },
      startExport: (start: number, end: number) => {
        closeExportPreviewFrame(get().exportPreviewFrame);
        set({
          isExporting: true,
          exportProgress: 0,
          exportCurrentTime: start,
          exportRange: { start, end },
          exportPreviewFrame: null,
          exportPreviewFrameTime: null,
        });
      },
      endExport: () => {
        closeExportPreviewFrame(get().exportPreviewFrame);
        set({
          isExporting: false,
          exportProgress: null,
          exportCurrentTime: null,
          exportRange: null,
          exportPreviewFrame: null,
          exportPreviewFrameTime: null,
        });
      },
    };

    const actions = lockTimelineEditActions({
      ...trackActions,
      ...clipActions,
      ...textClipActions,
      ...solidClipActions,
      ...midiClipActions,
      ...mathSceneClipActions,
      ...motionClipActions,
      ...meshClipActions,
      ...cameraClipActions,
      ...splatEffectorClipActions,
      ...clipEffectActions,
      ...colorCorrectionActions,
      ...linkedGroupActions,
      ...downloadClipActions,
      ...audioEditActions,
      ...stemSeparationActions,
      ...videoBakeActions,
      ...toolActions,
      ...timelineEditOperationActions,
      ...playbackActions,
      ...ramPreviewActions,
      ...proxyCacheActions,
      ...exportActions,
      ...selectionActions,
      ...keyframeActions,
      ...layerActions,
      ...maskActions,
      ...markerActions,
      ...transitionActions,
      ...nodeGraphActions,
      ...clipboardActions,
      ...aiActionFeedbackActions,
      ...utils,
    }, get);

    return {
      ...initialState,
      ...actions,
    };
  })
);
