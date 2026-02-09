/**
 * Store factory for testing timeline store slices in isolation.
 *
 * Instead of importing the real useTimelineStore (which pulls in engine, media store,
 * layer builder, etc.), we create a minimal Zustand store with only the state and
 * slice functions under test.
 */

import { createStore } from 'zustand';
import type { TimelineStore } from '../../src/stores/timeline/types';
import type { TimelineClip, TimelineTrack, Keyframe, Layer, AnimatableProperty } from '../../src/types';
import type { TimelineMarker } from '../../src/stores/timeline/types';

import { createSelectionSlice } from '../../src/stores/timeline/selectionSlice';
import { createTrackSlice } from '../../src/stores/timeline/trackSlice';
import { createKeyframeSlice } from '../../src/stores/timeline/keyframeSlice';
import { createMarkerSlice } from '../../src/stores/timeline/markerSlice';

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
    const selectionActions = createSelectionSlice(set as any, get as any);
    const trackActions = createTrackSlice(set as any, get as any);
    const keyframeActions = createKeyframeSlice(set as any, get as any);
    const markerActions = createMarkerSlice(set as any, get as any);

    // Simple playback actions (inlined to avoid importing playbackSlice which pulls in engine)
    const playbackActions = {
      setPlayheadPosition: (position: number) => {
        const { duration } = get();
        set({ playheadPosition: Math.max(0, Math.min(position, duration)) } as any);
      },
      setDraggingPlayhead: (dragging: boolean) => set({ isDraggingPlayhead: dragging } as any),
      play: async () => set({ isPlaying: true } as any),
      pause: () => set({ isPlaying: false, playbackSpeed: 1 } as any),
      stop: () => set({ isPlaying: false, playheadPosition: 0 } as any),
      setZoom: (zoom: number) => set({ zoom: Math.max(0.1, Math.min(200, zoom)) } as any),
      toggleSnapping: () => set((state: any) => ({ snappingEnabled: !state.snappingEnabled })),
      setScrollX: (scrollX: number) => set({ scrollX: Math.max(0, scrollX) } as any),
      setInPoint: (time: number | null) => {
        if (time === null) { set({ inPoint: null } as any); return; }
        const { outPoint, duration } = get();
        set({ inPoint: Math.max(0, Math.min(time, outPoint ?? duration)) } as any);
      },
      setOutPoint: (time: number | null) => {
        if (time === null) { set({ outPoint: null } as any); return; }
        const { inPoint, duration } = get();
        set({ outPoint: Math.max(inPoint ?? 0, Math.min(time, duration)) } as any);
      },
      clearInOut: () => set({ inPoint: null, outPoint: null } as any),
      setInPointAtPlayhead: () => {
        const { playheadPosition } = get();
        (get() as any).setInPoint(playheadPosition);
      },
      setOutPointAtPlayhead: () => {
        const { playheadPosition } = get();
        (get() as any).setOutPoint(playheadPosition);
      },
      setLoopPlayback: (loop: boolean) => set({ loopPlayback: loop } as any),
      toggleLoopPlayback: () => set({ loopPlayback: !get().loopPlayback } as any),
      setPlaybackSpeed: (speed: number) => set({ playbackSpeed: speed } as any),
      setToolMode: (mode: string) => set({ toolMode: mode } as any),
      toggleCutTool: () => {
        const { toolMode } = get();
        set({ toolMode: toolMode === 'cut' ? 'select' : 'cut' } as any);
      },
      setClipAnimationPhase: (phase: string) => set({ clipAnimationPhase: phase } as any),
      playForward: () => {},
      playReverse: () => {},
      setDuration: () => {},
    };

    // Stub actions that some slices call on others
    const stubActions = {
      updateClipTransform: (id: string, transform: any) => {
        const { clips } = get();
        set({
          clips: clips.map(c => c.id === id ? { ...c, transform: { ...c.transform, ...transform } } : c),
        } as any);
      },
      updateClipEffect: () => {},
      updateDuration: () => {},
    };

    return {
      ...getInitialState(),
      ...selectionActions,
      ...trackActions,
      ...keyframeActions,
      ...markerActions,
      ...playbackActions,
      ...stubActions,
      ...overrides,
    } as TimelineStore;
  });
}
