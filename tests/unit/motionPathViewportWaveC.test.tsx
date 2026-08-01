import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getHistoryStateView,
  initHistoryStoreRefs,
  setHistoryCallbacks,
  useHistoryStore,
} from '../../src/stores/historyStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type { TimelineClip } from '../../src/types/timeline';
import type { Layer } from '../../src/types/layers';
import {
  buildMotionPathNodes,
  findMotionPathLayer,
  getMotionPathNodeTimes,
  groupMotionPathPositionKeyframes,
  projectMotionPathPosition,
  resolveMotionPathEligibility,
  sampleMotionPath,
  sampleMotionPathOnionPositions,
  unprojectMotionPathPosition,
  type MotionPathProjectionContext,
} from '../../src/components/preview/motionPathGeometry';
import { MotionPathOverlay } from '../../src/components/preview/MotionPathOverlay';
import {
  buildMotionPathPositionUpsertOperations,
  useMotionPathEditing,
} from '../../src/components/preview/useMotionPathEditing';
import { createMockClip, createMockKeyframe, createMockTrack } from '../helpers/mockData';

const initialTimelineState = useTimelineStore.getState();
const projection: MotionPathProjectionContext = {
  sourceWidth: 100,
  sourceHeight: 100,
  outputWidth: 100,
  outputHeight: 100,
  canvasWidth: 100,
  canvasHeight: 100,
  scale: { x: 1, y: 1 },
  rotation: 0,
};

function initializeHistoryRefs(): void {
  initHistoryStoreRefs({
    timeline: {
      getState: useTimelineStore.getState,
      setState: useTimelineStore.setState,
    },
    media: {
      getState: () => ({
        files: [],
        compositions: [],
        folders: [],
        selectedIds: [],
        expandedFolderIds: [],
        textItems: [],
        solidItems: [],
        mathSceneItems: [],
        motionShapeItems: [],
        signalAssets: [],
        signalArtifacts: [],
        signalGraphs: [],
        signalOperators: [],
      }),
      setState: () => undefined,
    },
    dock: {
      getState: () => ({ layout: null }),
      setState: () => undefined,
    },
  });
}

function positionKeyframes() {
  return [
    createMockKeyframe({
      id: 'x-0',
      clipId: 'clip-motion',
      property: 'position.x',
      time: 0,
      value: 0,
      easing: 'ease-in',
    }),
    createMockKeyframe({
      id: 'y-1',
      clipId: 'clip-motion',
      property: 'position.y',
      time: 1,
      value: 1,
      easing: 'linear',
    }),
    createMockKeyframe({
      id: 'x-2',
      clipId: 'clip-motion',
      property: 'position.x',
      time: 2,
      value: 2,
      easing: 'linear',
    }),
    createMockKeyframe({
      id: 'opacity',
      clipId: 'clip-motion',
      property: 'opacity',
      time: 0.5,
      value: 0.5,
    }),
  ];
}

describe('motion-path viewport geometry', () => {
  it('resolves a clip layer safely while the preview layer array is sparse', () => {
    const other = { id: 'other-layer', sourceClipId: 'other-clip' } as unknown as Layer;
    const target = { id: 'target-layer', sourceClipId: 'clip-motion' } as unknown as Layer;

    expect(findMotionPathLayer(
      [undefined, other, null, target],
      'missing-selected-layer',
      'clip-motion',
    )).toBe(target);
    expect(findMotionPathLayer([undefined, null], null, 'clip-motion')).toBeNull();
  });

  it('groups only scalar X/Y keyframes, sorts copies, and unions node times without mutation', () => {
    const input = positionKeyframes().reverse();
    const originalIds = input.map((keyframe) => keyframe.id);
    const groups = groupMotionPathPositionKeyframes(input);

    expect(groups.x.map((keyframe) => keyframe.id)).toEqual(['x-0', 'x-2']);
    expect(groups.y.map((keyframe) => keyframe.id)).toEqual(['y-1']);
    expect(getMotionPathNodeTimes(groups)).toEqual([0, 1, 2]);
    expect(input.map((keyframe) => keyframe.id)).toEqual(originalIds);
  });

  it('samples every axis through the shared interpolation semantics', () => {
    const keyframes = [
      createMockKeyframe({
        id: 'x-start', clipId: 'clip-motion', property: 'position.x',
        time: 0, value: 0, easing: 'ease-in',
      }),
      createMockKeyframe({
        id: 'x-end', clipId: 'clip-motion', property: 'position.x',
        time: 2, value: 2, easing: 'linear',
      }),
      createMockKeyframe({
        id: 'y-start', clipId: 'clip-motion', property: 'position.y',
        time: 0, value: 2, easing: 'linear',
      }),
      createMockKeyframe({
        id: 'y-end', clipId: 'clip-motion', property: 'position.y',
        time: 2, value: 4, easing: 'linear',
      }),
    ];

    const samples = sampleMotionPath(keyframes, { x: 10, y: 20 }, 2);
    expect(samples.map((sample) => sample.time)).toEqual([0, 1, 2]);
    expect(samples[1]).toMatchObject({ x: 0.5, y: 3 });
    expect(buildMotionPathNodes(keyframes, { x: 10, y: 20 })).toHaveLength(2);
  });

  it('samples previous and next onion positions by FPS and leaves keyframes untouched', () => {
    const keyframes = positionKeyframes();
    const before = structuredClone(keyframes);
    const onions = sampleMotionPathOnionPositions({
      keyframes,
      basePosition: { x: 0, y: 0 },
      localTime: 1,
      frameRate: 24,
      frameOffset: 2,
      clipDuration: 2,
    });

    expect(onions).toHaveLength(2);
    expect(onions[0]).toMatchObject({ direction: 'previous', frameOffset: -2 });
    expect(onions[0]!.time).toBeCloseTo(1 - 2 / 24);
    expect(onions[1]!.time).toBeCloseTo(1 + 2 / 24);
    expect(keyframes).toEqual(before);
  });

  it('round-trips through aspect, rotation, and non-uniform scale in canvas-local coordinates', () => {
    const complexProjection: MotionPathProjectionContext = {
      sourceWidth: 1920,
      sourceHeight: 1080,
      outputWidth: 1080,
      outputHeight: 1080,
      canvasWidth: 540,
      canvasHeight: 540,
      scale: { x: 1.7, y: 0.55 },
      rotation: Math.PI / 5,
    };
    const target = { x: 0.37, y: -0.21 };
    const projected = projectMotionPathPosition(target, complexProjection);
    const restored = unprojectMotionPathPosition(
      projected,
      { x: -0.4, y: 0.6 },
      complexProjection,
    );

    expect(restored.x).toBeCloseTo(target.x, 8);
    expect(restored.y).toBeCloseTo(target.y, 8);
  });

  it.each([
    ['source monitor', { sourceMonitorActive: true }, 'source-monitor'],
    ['playback', { playbackActive: true }, 'playback'],
    ['mask mode', { maskModeActive: true }, 'mask-mode'],
    ['text mode', { textModeActive: true }, 'text-mode'],
  ])('rejects %s through the explicit eligibility contract', (_label, override, reason) => {
    const clip = createMockClip({ id: 'clip-motion' });
    expect(resolveMotionPathEligibility({
      enabled: true,
      clip,
      editableSource: true,
      sourceMonitorActive: false,
      playbackActive: false,
      maskModeActive: false,
      textModeActive: false,
      hasProjection: true,
      ...override,
    })).toEqual({ eligible: false, reason });
  });

  it('rejects camera and 3D clips while accepting an eligible 2D clip', () => {
    const base = createMockClip({ id: 'clip-motion' });
    const input = {
      enabled: true,
      editableSource: true,
      sourceMonitorActive: false,
      playbackActive: false,
      maskModeActive: false,
      textModeActive: false,
      hasProjection: true,
    };
    const camera = {
      ...base,
      source: { ...base.source, type: 'camera' as const },
    } satisfies TimelineClip;
    expect(resolveMotionPathEligibility({ ...input, clip: camera }).reason).toBe('camera-layer');
    expect(resolveMotionPathEligibility({ ...input, clip: { ...base, is3D: true } }).reason)
      .toBe('three-dimensional-layer');
    expect(resolveMotionPathEligibility({ ...input, clip: base })).toEqual({ eligible: true, reason: null });
  });
});

describe('motion-path viewport overlay and editing', () => {
  let clip: TimelineClip;

  beforeEach(() => {
    initializeHistoryRefs();
    setHistoryCallbacks({
      flushPendingCapture: () => undefined,
      suppressCaptures: () => undefined,
    });
    useHistoryStore.setState({ batchId: null, batchLabel: null });
    getHistoryStateView().clearHistory();
    clip = createMockClip({
      id: 'clip-motion',
      trackId: 'video-1',
      duration: 4,
      transform: {
        ...createMockClip().transform,
        position: { x: 0, y: 0.2, z: 0 },
      },
    });
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video', locked: false })],
      clips: [clip],
      clipKeyframes: new Map([['clip-motion', [
        createMockKeyframe({
          id: 'x-node',
          clipId: 'clip-motion',
          property: 'position.x',
          time: 1,
          value: 0.1,
          easing: 'ease-out',
        }),
      ]]]),
      selectedKeyframeIds: new Set(),
      isExporting: false,
    });
  });

  afterEach(() => {
    cleanup();
    if (getHistoryStateView().batchId !== null) {
      getHistoryStateView().cancelBatch();
    }
    getHistoryStateView().clearHistory();
    useTimelineStore.setState(initialTimelineState);
    vi.restoreAllMocks();
  });

  it('renders a separate SVG path and routes node pointer-down', () => {
    const onNodePointerDown = vi.fn();
    const { container } = render(
      <MotionPathOverlay
        width={100}
        height={100}
        visible
        samples={[{ x: 10, y: 20, time: 0 }, { x: 30, y: 40, time: 1 }]}
        nodes={[{ id: 'node-1', x: 10, y: 20, time: 0 }]}
        onionPositions={[{ x: 8, y: 18, time: -1 / 30, direction: 'previous', frameOffset: -1 }]}
        onNodePointerDown={onNodePointerDown}
      />,
    );

    const overlay = screen.getByLabelText('Motion path overlay');
    expect(overlay.tagName.toLowerCase()).toBe('svg');
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelector('path')?.getAttribute('d')).toBe('M 10 20 L 30 40');
    fireEvent.pointerDown(screen.getByLabelText('Position keyframe at 0.000 seconds'), {
      button: 0,
      pointerId: 7,
    });
    expect(onNodePointerDown).toHaveBeenCalledOnce();
  });

  it('builds paired scalar upserts and inherits easing for a missing axis', () => {
    const [xOperation, yOperation] = buildMotionPathPositionUpsertOperations('clip-motion', {
      time: 1,
      xKeyframeId: 'x-node',
      yKeyframeId: null,
      xEasing: 'ease-out',
      yEasing: null,
    }, { x: 0.4, y: 0.7 });

    expect(xOperation).toMatchObject({
      type: 'keyframe-update-value',
      keyframeId: 'x-node',
      property: 'position.x',
      value: { value: 0.4 },
    });
    expect(yOperation).toMatchObject({
      type: 'keyframe-create',
      property: 'position.y',
      time: 1,
      value: { value: 0.7 },
      easing: 'ease-out',
    });
  });

  it('drags a node through one viewport-motion-path transaction and upserts both axes', () => {
    function Harness() {
      const motionPath = useMotionPathEditing({
        enabled: true,
        clip,
        projection,
        editableSource: true,
        sourceMonitorActive: false,
        playbackActive: false,
        maskModeActive: false,
        textModeActive: false,
        trackLocked: false,
        playheadPosition: 1,
        frameRate: 30,
        viewZoom: 2,
      });
      return <MotionPathOverlay width={100} height={100} {...motionPath.overlayProps} />;
    }

    render(<Harness />);
    const node = screen.getByLabelText('Position keyframe at 1.000 seconds');
    fireEvent.pointerDown(node, { button: 0, pointerId: 11, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(document, { pointerId: 11, clientX: 70, clientY: 70 });
    fireEvent.pointerUp(document, { pointerId: 11, clientX: 70, clientY: 70 });

    const keyframes = useTimelineStore.getState().clipKeyframes.get('clip-motion') ?? [];
    const xKeyframe = keyframes.find((keyframe) => keyframe.property === 'position.x');
    expect(xKeyframe).toMatchObject({
      id: 'x-node',
      time: 1,
    });
    expect(xKeyframe?.value).toBeCloseTo(0.3);
    const yKeyframe = keyframes.find((keyframe) => keyframe.property === 'position.y');
    expect(yKeyframe).toMatchObject({
      time: 1,
      easing: 'ease-out',
    });
    expect(yKeyframe?.value).toBeCloseTo(0.4);
    expect(getHistoryStateView().batchId).toBeNull();
    expect(getHistoryStateView().undoStack).toHaveLength(1);

    act(() => getHistoryStateView().undo());
    const restored = useTimelineStore.getState().clipKeyframes.get('clip-motion') ?? [];
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ id: 'x-node', value: 0.1 });
  });
});
