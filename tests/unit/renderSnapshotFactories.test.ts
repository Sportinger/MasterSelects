import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Composition, MediaFile } from '../../src/stores/mediaStore';
import type { RenderTarget } from '../../src/types/renderTarget';
import type { OutputSlice } from '../../src/types/outputSlice';
import type { ClipTransform, TimelineClip, TimelineTrack } from '../../src/types';

type FixtureStores = Record<'media' | 'timeline' | 'engine' | 'renderTarget' | 'slice', Record<string, unknown>>;

const mockStores = vi.hoisted(() => {
  const state: FixtureStores = {
    media: {},
    timeline: {},
    engine: {},
    renderTarget: {},
    slice: {},
  };

  return {
    state,
    useMediaStore: { getState: vi.fn(() => state.media) },
    useTimelineStore: { getState: vi.fn(() => state.timeline) },
    useEngineStore: { getState: vi.fn(() => state.engine) },
    useRenderTargetStore: { getState: vi.fn(() => state.renderTarget) },
    useSliceStore: { getState: vi.fn(() => state.slice) },
  };
});

vi.mock('../../src/stores/mediaStore', () => ({ useMediaStore: mockStores.useMediaStore }));
vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: mockStores.useTimelineStore }));
vi.mock('../../src/stores/engineStore', () => ({ useEngineStore: mockStores.useEngineStore }));
vi.mock('../../src/stores/renderTargetStore', () => ({ useRenderTargetStore: mockStores.useRenderTargetStore }));
vi.mock('../../src/stores/sliceStore', () => ({ useSliceStore: mockStores.useSliceStore }));

import { validatePersistedStateRuntimeFree } from '../../src/services/mediaRuntime/persistedStateGuard';
import { captureRenderFrameSnapshot } from '../../src/services/render/renderFrameSnapshotFactory';
import { captureRenderTargetSnapshot } from '../../src/services/render/renderTargetSnapshotFactory';

const transform: ClipTransform = {
  opacity: 1, blendMode: 'normal',
  position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, rotation: { x: 0, y: 0, z: 0 },
};

function renderableCanvas() {
  return { isConnected: true, ownerDocument: { visibilityState: 'visible' }, getBoundingClientRect: () => ({ width: 320, height: 180 }) } as unknown as HTMLCanvasElement;
}

function target(overrides: Partial<RenderTarget>): RenderTarget {
  return {
    id: 'target-active',
    name: 'Program',
    source: { type: 'activeComp' },
    destinationType: 'canvas',
    enabled: true,
    showTransparencyGrid: true,
    canvas: renderableCanvas(),
    context: {} as GPUCanvasContext,
    window: null,
    isFullscreen: false,
    ...overrides,
  };
}

function makeTrack(id: string, type: TimelineTrack['type']): TimelineTrack {
  return { id, name: id, type, height: 64, muted: false, visible: true, solo: false };
}

function makeClip(overrides: Partial<TimelineClip>): TimelineClip {
  return {
    id: 'clip-a',
    trackId: 'video-1',
    name: 'Clip A',
    file: new File(['clip'], 'clip-a.mp4', { type: 'video/mp4' }),
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: { type: 'video', mediaFileId: 'media-video', naturalDuration: 12 },
    mediaFileId: 'media-video',
    transform,
    effects: [],
    ...overrides,
  };
}

function activeComposition(): Composition {
  return {
    id: 'comp-main', name: 'Main', type: 'composition', parentId: null, createdAt: 1,
    width: 1280, height: 720, frameRate: 24, duration: 60, backgroundColor: '#000000',
  };
}

function mediaFile(): MediaFile {
  return {
    id: 'media-video', name: 'clip-a.mp4', type: 'video', parentId: null, createdAt: 2,
    url: 'blob:runtime-url', fileHash: 'hash-a', fileSize: 1234, projectPath: 'media/clip-a.mp4',
    duration: 12, width: 1920, height: 1080, fps: 30, hasAudio: true,
  };
}

function isActiveCompRoute(targetEntry: RenderTarget, activeCompositionId: string | null): boolean {
  return targetEntry.source.type === 'activeComp' ||
    targetEntry.source.type === 'program' ||
    (targetEntry.source.type === 'composition' && targetEntry.source.compositionId === activeCompositionId);
}

function setBaseFixtures(): void {
  const files = [mediaFile()];
  const compositions = [activeComposition()];
  const tracks = [makeTrack('video-1', 'video')];
  const activeCompositionId = 'comp-main';

  mockStores.state.media = {
    files,
    compositions,
    activeCompositionId,
    activeLayerSlots: { 0: 'comp-main' },
    layerOpacities: { 0: 0.5 },
    slotClipSettings: { 'comp-main': { trimIn: 1, trimOut: 9, endBehavior: 'loop' } },
  };
  mockStores.state.timeline = {
    tracks,
    clips: [],
    playheadPosition: 0,
    isPlaying: false,
    isDraggingPlayhead: false,
    isExporting: false,
    selectedClipIds: new Set<string>(),
    primarySelectedClipId: null,
    selectedKeyframeIds: new Set<string>(),
    clipKeyframes: new Map(),
    getInterpolatedTransform: vi.fn((clipId: string) => (mockStores.state.timeline.clips as TimelineClip[]).find((clip) => clip.id === clipId)?.transform ?? transform),
    getInterpolatedEffects: vi.fn((clipId: string) => (mockStores.state.timeline.clips as TimelineClip[]).find((clip) => clip.id === clipId)?.effects ?? []),
    getInterpolatedColorCorrection: vi.fn(() => undefined),
    getInterpolatedVectorAnimationSettings: vi.fn(() => ({})),
    getInterpolatedTextBounds: vi.fn(() => undefined),
    getSourceTimeForClip: vi.fn((_clipId: string, localTime: number) => localTime),
    getInterpolatedSpeed: vi.fn((clipId: string) => (mockStores.state.timeline.clips as TimelineClip[]).find((clip) => clip.id === clipId)?.speed ?? 1),
  };
  mockStores.state.engine = {
    previewCameraOverride: null,
    sceneGizmoVisible: true,
    sceneGizmoMode: 'move',
    sceneGizmoHoveredAxis: null,
    sceneGizmoClipIdOverride: null,
  };
  mockStores.state.renderTarget = {
    targets: new Map<string, RenderTarget>(),
    selectedTargetId: null,
    getActiveCompTargets: vi.fn(() => {
      const currentTargets = mockStores.state.renderTarget.targets as Map<string, RenderTarget>;
      const currentActiveCompositionId = mockStores.state.media.activeCompositionId as string | null;
      return [...currentTargets.values()].filter((entry) => entry.enabled && isActiveCompRoute(entry, currentActiveCompositionId));
    }),
    getIndependentTargets: vi.fn(() => {
      const currentTargets = mockStores.state.renderTarget.targets as Map<string, RenderTarget>;
      const currentActiveCompositionId = mockStores.state.media.activeCompositionId as string | null;
      return [...currentTargets.values()].filter((entry) => entry.enabled && !isActiveCompRoute(entry, currentActiveCompositionId));
    }),
  };
  mockStores.state.slice = {
    configs: new Map(),
    activeTab: 'output',
    previewingTargetId: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setBaseFixtures();
});

describe('render snapshot factories', () => {
  it('captures runtime-free target descriptors, route ids, slices, and output preview state', () => {
    const slice: OutputSlice = {
      id: 'slice-a',
      name: 'Slice A',
      type: 'slice',
      inverted: false,
      enabled: true,
      inputCorners: [
        { x: 0, y: 0 },
        { x: 0.5, y: 0 },
        { x: 0.5, y: 0.5 },
        { x: 0, y: 0.5 },
      ],
      warp: {
        mode: 'meshGrid',
        cols: 1,
        rows: 1,
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
          { x: 1, y: 1 },
        ],
      },
    };
    const activeTarget = target({});
    const layerTarget = target({
      id: 'target-layer',
      name: 'Layer Window',
      source: { type: 'layer', compositionId: 'comp-main', layerIds: ['clip-a', 'clip-b'] },
      destinationType: 'window',
      showTransparencyGrid: false,
      window: { closed: false, document: { visibilityState: 'visible' } } as Window,
      isFullscreen: true,
    });

    mockStores.state.renderTarget = {
      ...mockStores.state.renderTarget,
      targets: new Map([
        [activeTarget.id, activeTarget],
        [layerTarget.id, layerTarget],
      ]),
    };
    mockStores.state.slice = {
      activeTab: 'output',
      previewingTargetId: 'target-layer',
      configs: new Map([
        ['target-layer', { targetId: 'target-layer', slices: [slice], selectedSliceId: 'slice-a' }],
      ]),
    };

    const snapshot = captureRenderTargetSnapshot();
    const guard = validatePersistedStateRuntimeFree(snapshot);

    expect(guard.serializable).toBe(true);
    expect(snapshot.resolution).toEqual({ width: 1280, height: 720 });
    expect(snapshot.targets).toContainEqual({
      id: 'target-layer',
      name: 'Layer Window',
      source: { type: 'layer', compositionId: 'comp-main', layerIds: ['clip-a', 'clip-b'] },
      destinationType: 'window',
      enabled: true,
      showTransparencyGrid: false,
      isFullscreen: true,
    });
    expect(snapshot.activeCompositionTargetIds).toEqual(['target-active']);
    expect(snapshot.independentTargetIds).toEqual(['target-layer']);
    expect(snapshot.sliceConfigs['target-layer'].slices[0]).toMatchObject({
      id: 'slice-a',
      warp: { mode: 'meshGrid', cols: 1, rows: 1 },
    });
    expect(snapshot.outputPreview).toEqual({ activeTab: 'output', previewingTargetId: 'target-layer' });
    expect(JSON.stringify(snapshot)).not.toContain('blob:runtime-url');
  });

  it('captures frame timeline/media/scene fields and playback flags from store state', () => {
    const clipA = makeClip({ id: 'clip-a', name: 'A', startTime: 0, duration: 5 });
    const clipB = makeClip({
      id: 'clip-b',
      name: 'B',
      startTime: 5,
      duration: 4,
      inPoint: 2,
      outPoint: 6,
      source: { type: 'image', mediaFileId: 'media-video', naturalDuration: 8 },
    });

    mockStores.state.timeline = {
      ...mockStores.state.timeline,
      clips: [clipA, clipB],
      playheadPosition: 5,
      isPlaying: true,
      isDraggingPlayhead: true,
      isExporting: true,
      selectedClipIds: new Set(['clip-b']),
      primarySelectedClipId: 'clip-b',
      selectedKeyframeIds: new Set(['kf-1']),
      clipKeyframes: new Map([
        ['clip-b', [{ id: 'kf-1', clipId: 'clip-b', property: 'position.x', time: 0, value: 10, easing: 'linear' }]],
      ]),
    };
    mockStores.state.engine = {
      ...mockStores.state.engine,
      sceneGizmoMode: 'rotate',
      sceneGizmoHoveredAxis: 'y',
      sceneGizmoClipIdOverride: 'clip-b',
      previewCameraOverride: {
        position: { x: 1, y: 2, z: 3 },
        target: { x: 0, y: 0, z: 0 },
        up: { x: 0, y: 1, z: 0 },
        fov: 45,
        near: 0.1,
        far: 100,
      },
    };

    const snapshot = captureRenderFrameSnapshot({ time: 5 });

    expect(snapshot.playback).toEqual({
      isPlaying: true,
      isDraggingPlayhead: true,
      isExporting: true,
    });
    expect(snapshot.resolution).toEqual({ width: 1280, height: 720 });
    expect(snapshot.fps).toBe(24);
    expect(snapshot.timeline.primarySelectedClipId).toBe('clip-b');
    expect([...snapshot.timeline.selectedClipIds]).toEqual(['clip-b']);
    expect(snapshot.timeline.clips.map((clip) => clip.id)).toEqual(['clip-a', 'clip-b']);
    expect(snapshot.timeline.getClipsAtTime(5).map((clip) => clip.id)).toEqual(['clip-b']);
    expect(snapshot.timeline.clips[0].source?.assetRef).toMatchObject({
      mediaFileId: 'media-video',
      fileName: 'clip-a.mp4',
      fileHash: 'hash-a',
      projectPath: 'media/clip-a.mp4',
    });
    expect(snapshot.media.files[0].assetRef).toMatchObject({ mediaFileId: 'media-video', fileSize: 1234 });
    expect(snapshot.media.activeLayerSlots).toEqual({ 0: 'comp-main' });
    expect(snapshot.media.slotClipSettings['comp-main']).toEqual({ trimIn: 1, trimOut: 9, endBehavior: 'loop' });
    expect(snapshot.scene.gizmo).toEqual({
      visible: true,
      mode: 'rotate',
      hoveredAxis: 'y',
      clipIdOverride: 'clip-b',
    });
    expect(snapshot.scene.previewCameraOverride?.fov).toBe(45);
  });
});
