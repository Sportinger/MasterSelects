/**
 * Store factory for testing timeline store slices in isolation.
 *
 * Instead of importing the real useTimelineStore (which pulls in engine, media store,
 * layer builder, etc.), we create a minimal Zustand store with only the state and
 * slice functions under test.
 */

import { createStore } from 'zustand';
import type { TimelineStore } from '../../src/stores/timeline/types';
import type { TimelineClip, Keyframe, Layer, AnimatableProperty } from '../../src/types';
import type { TimelineMarker } from '../../src/stores/timeline/types';

import { createSelectionSlice } from '../../src/stores/timeline/selectionSlice';
import { createTrackSlice } from '../../src/stores/timeline/trackSlice';
import { createKeyframeSlice } from '../../src/stores/timeline/keyframeSlice';
import { createMarkerSlice } from '../../src/stores/timeline/markerSlice';
import { createMaskSlice } from '../../src/stores/timeline/maskSlice';
import { createClipSlice } from '../../src/stores/timeline/clipSlice';
import { createTextClipSlice } from '../../src/stores/timeline/textClipSlice';
import { createSolidClipSlice } from '../../src/stores/timeline/solidClipSlice';
import { createClipEffectSlice } from '../../src/stores/timeline/clipEffectSlice';
import { createColorCorrectionSlice } from '../../src/stores/timeline/colorCorrectionSlice';
import { createLinkedGroupSlice } from '../../src/stores/timeline/linkedGroupSlice';
import { createDownloadClipSlice } from '../../src/stores/timeline/downloadClipSlice';
import { createPositioningUtils } from '../../src/stores/timeline/positioningUtils';
import { resolvePlaybackStartPosition } from '../../src/stores/timeline/playbackRange';

// Minimal initial state sufficient for testing slices
function getInitialState(): Partial<TimelineStore> {
  return {
    tracks: [
      { id: 'video-1', name: 'Video 1', type: 'video', height: 60, muted: false, visible: true, solo: false },
      { id: 'audio-1', name: 'Audio 1', type: 'audio', height: 40, muted: false, visible: true, solo: false },
    ],
    clips: [] as TimelineClip[],
    playheadPosition: 0,
    duration: 60,
    zoom: 50,
    scrollX: 0,
    snappingEnabled: true,
    isPlaying: false,
    isDraggingPlayhead: false,
    selectedClipIds: new Set<string>(),
    primarySelectedClipId: null,
    layers: [] as Layer[],
    selectedLayerId: null,
    inPoint: null,
    outPoint: null,
    loopPlayback: false,
    playbackSpeed: 1,
    durationLocked: false,
    clipKeyframes: new Map<string, Keyframe[]>(),
    keyframeRecordingEnabled: new Set<string>(),
    expandedTracks: new Set<string>(['video-1', 'audio-1']),
    expandedTrackPropertyGroups: new Map<string, Set<string>>(),
    selectedKeyframeIds: new Set<string>(),
    expandedCurveProperties: new Map<string, Set<AnimatableProperty>>(),
    curveEditorHeight: 250,
    markers: [] as TimelineMarker[],
    toolMode: 'select' as const,
    // Mask state
    maskEditMode: 'none' as const,
    activeMaskId: null,
    selectedVertexIds: new Set<string>(),
    maskDrawStart: null,
    maskDragging: false,
    // Performance toggles (needed by clipSlice)
    thumbnailsEnabled: false,
    waveformsEnabled: false,
    showTranscriptMarkers: false,
    // Clip animation / slot grid
    clipAnimationPhase: 'idle' as const,
    slotGridProgress: 0,
    timelineSessionId: 0,
    // RAM Preview state
    ramPreviewEnabled: false,
    ramPreviewProgress: null,
    ramPreviewRange: null,
    isRamPreviewing: false,
    cachedFrameTimes: new Set<number>(),
    // Proxy cache state
    isProxyCaching: false,
    proxyCacheProgress: null,
    // Stub functions that slices might call on other slices
    invalidateCache: () => {},
  };
}

/**
 * Creates an isolated Zustand store with selection, track, keyframe, and marker slices.
 * Pass overrides to set initial state for specific tests.
 */
export function createTestTimelineStore(overrides?: Partial<TimelineStore>) {
  return createStore<TimelineStore>()((set, get) => {
    const selectionActions = createSelectionSlice(set, get);
    const trackActions = createTrackSlice(set, get);
    const keyframeActions = createKeyframeSlice(set, get);
    const markerActions = createMarkerSlice(set, get);
    const maskActions = createMaskSlice(set, get);
    const clipActions = createClipSlice(set, get);
    const textClipActions = createTextClipSlice(set, get);
    const solidClipActions = createSolidClipSlice(set, get);
    const clipEffectActions = createClipEffectSlice(set, get);
    const colorCorrectionActions = createColorCorrectionSlice(set, get);
    const linkedGroupActions = createLinkedGroupSlice(set, get);
    const downloadClipActions = createDownloadClipSlice(set, get);
    const positioningUtils = createPositioningUtils(set, get);

    // Simple playback actions (inlined to avoid importing playbackSlice which pulls in engine)
    const playbackActions = {
      setPlayheadPosition: (position: number) => {
        const { duration } = get();
        set({ playheadPosition: Math.max(0, Math.min(position, duration)) });
      },
      setDraggingPlayhead: (dragging: boolean) => set({ isDraggingPlayhead: dragging }),
      play: async () => {
        const { playheadPosition, inPoint, outPoint, duration, playbackSpeed } = get();
        const playbackStartPosition = resolvePlaybackStartPosition(
          playheadPosition,
          inPoint,
          outPoint,
          duration,
          playbackSpeed,
        );
        set({ isPlaying: true, playheadPosition: playbackStartPosition });
      },
      pause: () => set({ isPlaying: false, playbackSpeed: 1 }),
      stop: () => set({ isPlaying: false, playheadPosition: 0 }),
      setZoom: (zoom: number) => set({ zoom: Math.max(0.1, Math.min(200, zoom)) }),
      toggleSnapping: () => set((state) => ({ snappingEnabled: !state.snappingEnabled })),
      setScrollX: (scrollX: number) => set({ scrollX: Math.max(0, scrollX) }),
      setInPoint: (time: number | null) => {
        if (time === null) { set({ inPoint: null }); return; }
        const { outPoint, duration } = get();
        set({ inPoint: Math.max(0, Math.min(time, outPoint ?? duration)) });
      },
      setOutPoint: (time: number | null) => {
        if (time === null) { set({ outPoint: null }); return; }
        const { inPoint, duration } = get();
        set({ outPoint: Math.max(inPoint ?? 0, Math.min(time, duration)) });
      },
      clearInOut: () => set({ inPoint: null, outPoint: null }),
      setInPointAtPlayhead: () => {
        const { playheadPosition } = get();
        get().setInPoint(playheadPosition);
      },
      setOutPointAtPlayhead: () => {
        const { playheadPosition } = get();
        get().setOutPoint(playheadPosition);
      },
      setLoopPlayback: (loop: boolean) => set({ loopPlayback: loop }),
      toggleLoopPlayback: () => set({ loopPlayback: !get().loopPlayback }),
      setPlaybackSpeed: (speed: number) => set({ playbackSpeed: speed }),
      setToolMode: (mode: TimelineStore['toolMode']) => set({ toolMode: mode }),
      toggleCutTool: () => {
        const { toolMode } = get();
        set({ toolMode: toolMode === 'cut' ? 'select' : 'cut' });
      },
      setClipAnimationPhase: (phase: TimelineStore['clipAnimationPhase']) => set({ clipAnimationPhase: phase }),
      setSlotGridProgress: (progress: number) => set({ slotGridProgress: Math.max(0, Math.min(1, progress)) }),
      playForward: () => {
        const { isPlaying, playbackSpeed, play } = get();
        if (!isPlaying) {
          set({ playbackSpeed: 1 });
          play();
        } else if (playbackSpeed < 0) {
          set({ playbackSpeed: 1 });
        } else {
          const newSpeed = playbackSpeed >= 8 ? 8 : playbackSpeed * 2;
          set({ playbackSpeed: newSpeed });
        }
      },
      playReverse: () => {
        const { isPlaying, playbackSpeed, play } = get();
        if (!isPlaying) {
          set({ playbackSpeed: -1 });
          play();
        } else if (playbackSpeed > 0) {
          set({ playbackSpeed: -1 });
        } else {
          const newSpeed = playbackSpeed <= -8 ? -8 : playbackSpeed * 2;
          set({ playbackSpeed: newSpeed });
        }
      },
      setDuration: (duration: number) => {
        const clampedDuration = Math.max(1, duration);
        set({ duration: clampedDuration, durationLocked: true });
        // Clamp playhead if beyond new duration
        const { playheadPosition, inPoint, outPoint } = get();
        if (playheadPosition > clampedDuration) {
          set({ playheadPosition: clampedDuration });
        }
        if (inPoint !== null && inPoint > clampedDuration) {
          set({ inPoint: clampedDuration });
        }
        if (outPoint !== null && outPoint > clampedDuration) {
          set({ outPoint: clampedDuration });
        }
      },
      // Performance toggles
      toggleThumbnailsEnabled: () => set({ thumbnailsEnabled: !get().thumbnailsEnabled }),
      toggleWaveformsEnabled: () => set({ waveformsEnabled: !get().waveformsEnabled }),
      setThumbnailsEnabled: (enabled: boolean) => set({ thumbnailsEnabled: enabled }),
      setWaveformsEnabled: (enabled: boolean) => set({ waveformsEnabled: enabled }),
      toggleTranscriptMarkers: () => set({ showTranscriptMarkers: !get().showTranscriptMarkers }),
      setShowTranscriptMarkers: (enabled: boolean) => set({ showTranscriptMarkers: enabled }),
      // RAM preview actions (simplified for testing)
      toggleRamPreviewEnabled: () => {
        const { ramPreviewEnabled } = get();
        if (ramPreviewEnabled) {
          set({ ramPreviewEnabled: false, isRamPreviewing: false, ramPreviewProgress: null, ramPreviewRange: null, cachedFrameTimes: new Set() });
        } else {
          set({ ramPreviewEnabled: true });
        }
      },
      cancelRamPreview: () => {
        set({ isRamPreviewing: false, ramPreviewProgress: null });
      },
      addCachedFrame: (time: number) => {
        const quantized = Math.round(time * 30) / 30;
        const { cachedFrameTimes } = get();
        if (!cachedFrameTimes.has(quantized)) {
          const newSet = new Set(cachedFrameTimes);
          newSet.add(quantized);
          set({ cachedFrameTimes: newSet });
        }
      },
      getCachedRanges: () => {
        const { cachedFrameTimes } = get();
        if (cachedFrameTimes.size === 0) return [];
        const times = Array.from(cachedFrameTimes as Set<number>).sort((a: number, b: number) => a - b);
        const ranges: Array<{ start: number; end: number }> = [];
        const frameInterval = 1 / 30;
        const gap = frameInterval * 2;
        let rangeStart = times[0];
        let rangeEnd = times[0];
        for (let i = 1; i < times.length; i++) {
          if ((times[i] as number) - rangeEnd <= gap) {
            rangeEnd = times[i] as number;
          } else {
            ranges.push({ start: rangeStart, end: rangeEnd + frameInterval });
            rangeStart = times[i] as number;
            rangeEnd = times[i] as number;
          }
        }
        ranges.push({ start: rangeStart, end: rangeEnd + frameInterval });
        return ranges;
      },
    };

    // Stub actions that some slices call on others
    // Note: updateClipTransform and updateClipEffect are now provided by clipSlice
    const stubActions = {
      updateDuration: () => {},
    };

    return {
      ...getInitialState(),
      ...selectionActions,
      ...trackActions,
      ...keyframeActions,
      ...markerActions,
      ...maskActions,
      ...clipActions,
      ...textClipActions,
      ...solidClipActions,
      ...clipEffectActions,
      ...colorCorrectionActions,
      ...linkedGroupActions,
      ...downloadClipActions,
      ...positioningUtils,
      ...playbackActions,
      ...stubActions,
      ...overrides,
    } as TimelineStore;
  });
}
