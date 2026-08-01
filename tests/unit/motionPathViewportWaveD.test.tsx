import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MotionPathOverlay } from '../../src/components/preview/MotionPathOverlay';
import {
  buildMotionPathSpatialHandles,
  resolveMotionPathHandleTemporalOffset,
  type MotionPathProjectionContext,
} from '../../src/components/preview/motionPathGeometry';
import {
  buildMotionPathBezierHandleOperations,
  useMotionPathEditing,
} from '../../src/components/preview/useMotionPathEditing';
import {
  getHistoryStateView,
  initHistoryStoreRefs,
  setHistoryCallbacks,
  useHistoryStore,
} from '../../src/stores/historyStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type { Keyframe } from '../../src/types/keyframes';
import type { TimelineClip } from '../../src/types/timeline';
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
        files: [], compositions: [], folders: [], selectedIds: [], expandedFolderIds: [],
        textItems: [], solidItems: [], mathSceneItems: [], motionShapeItems: [],
        signalAssets: [], signalArtifacts: [], signalGraphs: [], signalOperators: [],
      }),
      setState: () => undefined,
    },
    dock: {
      getState: () => ({ layout: null }),
      setState: () => undefined,
    },
  });
}

function pairedKeyframes(): Keyframe[] {
  return [
    createMockKeyframe({
      id: 'x-0', clipId: 'clip-motion', property: 'position.x', time: 0, value: 0.1,
      easing: 'bezier', handleOut: { x: 0.2, y: 0.1 },
    }),
    createMockKeyframe({
      id: 'y-0', clipId: 'clip-motion', property: 'position.y', time: 0, value: 0.2,
      easing: 'bezier', handleOut: { x: 0.4, y: 0.2 },
    }),
    createMockKeyframe({
      id: 'x-1', clipId: 'clip-motion', property: 'position.x', time: 1, value: 0.6,
      easing: 'linear',
    }),
    createMockKeyframe({
      id: 'y-1', clipId: 'clip-motion', property: 'position.y', time: 1, value: 0.7,
      easing: 'linear',
    }),
  ];
}

function getHandle(keyframes: readonly Keyframe[], id: string) {
  return keyframes.find((keyframe) => keyframe.id === id)?.handleOut;
}

describe('motion-path viewport spatial handles', () => {
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
        position: { x: 0, y: 0, z: 0 },
      },
    });
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video', locked: false })],
      clips: [clip],
      clipKeyframes: new Map([['clip-motion', pairedKeyframes()]]),
      selectedKeyframeIds: new Set(['x-0', 'y-0']),
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

  it('derives one selected spatial handle and canonicalizes disagreeing scalar times without mutation', () => {
    const keyframes = pairedKeyframes();
    const before = structuredClone(keyframes);
    const handles = buildMotionPathSpatialHandles(
      keyframes,
      { x: 0, y: 0 },
      new Set(['x-0', 'y-0']),
    );

    expect(handles).toHaveLength(1);
    expect(handles[0]).toMatchObject({
      direction: 'out',
      nodePosition: { x: 0.1, y: 0.2 },
      xKeyframeId: 'x-0',
      yKeyframeId: 'y-0',
    });
    const handle = handles[0]!;
    expect(handle.temporalOffset).toBeCloseTo(0.3);
    expect(handle.position.x).toBeCloseTo(0.25);
    expect(handle.position.y).toBeCloseTo(0.35);
    expect((handle.position.x - handle.nodePosition.x) / handle.temporalOffset)
      .toBeCloseTo(0.1 / 0.2);
    expect((handle.position.y - handle.nodePosition.y) / handle.temporalOffset)
      .toBeCloseTo(0.2 / 0.4);

    const [xAligned, yAligned] = buildMotionPathBezierHandleOperations(
      'clip-motion',
      handle,
      { x: handle.position.x + 0.0001, y: handle.position.y - 0.0001 },
    );
    expect(xAligned).toMatchObject({
      type: 'keyframe-update-bezier-handle',
      position: { x: handle.temporalOffset },
    });
    expect(yAligned).toMatchObject({
      type: 'keyframe-update-bezier-handle',
      position: { x: handle.temporalOffset },
    });
    if (xAligned.type !== 'keyframe-update-bezier-handle'
      || yAligned.type !== 'keyframe-update-bezier-handle') {
      throw new Error('Expected paired handle operations');
    }
    expect(xAligned.position.y).toBeCloseTo(0.1501);
    expect(yAligned.position.y).toBeCloseTo(0.1499);
    expect(keyframes).toEqual(before);
    expect(resolveMotionPathHandleTemporalOffset({
      direction: 'in',
      segmentDuration: 0.6,
      xHandle: { x: -2, y: 1 },
      yHandle: { x: -1, y: 1 },
    })).toBe(-0.6);
  });

  it('clamps each scalar time before combining opposite-sign, overlong, unequal durations', () => {
    expect(resolveMotionPathHandleTemporalOffset({
      direction: 'out',
      xSegmentDuration: 0.6,
      ySegmentDuration: 2,
      xHandle: { x: 2, y: 0.2 },
      yHandle: { x: -0.2, y: 0.2 },
    })).toBeCloseTo(0.3);
    expect(resolveMotionPathHandleTemporalOffset({
      direction: 'in',
      xSegmentDuration: 0.9,
      ySegmentDuration: 0.3,
      xHandle: { x: 0.4, y: -0.2 },
      yHandle: { x: -2, y: -0.2 },
    })).toBeCloseTo(-0.15);
  });

  it('does not expose a spatial handle until both scalar companions exist at the node', () => {
    const keyframes = pairedKeyframes().filter((keyframe) => keyframe.id !== 'y-0');
    expect(buildMotionPathSpatialHandles(
      keyframes,
      { x: 0, y: 0 },
      new Set(['x-0']),
    )).toEqual([]);
  });

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
      playheadPosition: 0,
      frameRate: 30,
      viewZoom: 1,
    });
    return <MotionPathOverlay width={100} height={100} {...motionPath.overlayProps} />;
  }

  it('leaves the exact prior selection intact when a begun node edit has no movement', () => {
    useTimelineStore.setState({ selectedKeyframeIds: new Set() });
    render(<Harness />);
    expect(screen.queryByLabelText('Outgoing position curve handle at 0.000 seconds')).toBeNull();

    const node = screen.getByLabelText('Position keyframe at 0.000 seconds');
    fireEvent.pointerDown(node, { button: 0, pointerId: 13, clientX: 50, clientY: 50 });
    fireEvent.pointerUp(document, { pointerId: 13, clientX: 50, clientY: 50 });

    expect(useTimelineStore.getState().selectedKeyframeIds).toEqual(new Set());
    expect(screen.queryByLabelText('Outgoing position curve handle at 0.000 seconds')).toBeNull();
  });

  it('commits paired scalar handles as one canonical transaction and one undo step', () => {
    useTimelineStore.setState({ selectedKeyframeIds: new Set(['x-0']) });
    render(<Harness />);
    const handle = screen.getByLabelText('Outgoing position curve handle at 0.000 seconds');
    const releasePointerCapture = vi.fn();
    Object.assign(handle, {
      hasPointerCapture: () => true,
      releasePointerCapture,
      setPointerCapture: vi.fn(),
    });
    fireEvent.pointerDown(handle, { button: 0, pointerId: 17, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(document, { pointerId: 17, clientX: 60, clientY: 40 });
    fireEvent.pointerUp(document, { pointerId: 17, clientX: 60, clientY: 40 });

    const changed = useTimelineStore.getState().clipKeyframes.get('clip-motion') ?? [];
    expect(getHandle(changed, 'x-0')?.x).toBeCloseTo(0.3);
    expect(getHandle(changed, 'x-0')?.y).toBeCloseTo(0.35);
    expect(getHandle(changed, 'y-0')?.x).toBeCloseTo(0.3);
    expect(getHandle(changed, 'y-0')?.y).toBeCloseTo(-0.05);
    expect(useTimelineStore.getState().selectedKeyframeIds).toEqual(new Set(['x-0', 'y-0']));
    expect(getHistoryStateView().undoStack).toHaveLength(1);
    expect(releasePointerCapture).toHaveBeenCalledWith(17);

    act(() => getHistoryStateView().undo());
    const restored = useTimelineStore.getState().clipKeyframes.get('clip-motion') ?? [];
    expect(getHandle(restored, 'x-0')).toEqual({ x: 0.2, y: 0.1 });
    expect(getHandle(restored, 'y-0')).toEqual({ x: 0.4, y: 0.2 });
    expect(useTimelineStore.getState().selectedKeyframeIds).toEqual(new Set(['x-0']));

    act(() => getHistoryStateView().redo());
    const redone = useTimelineStore.getState().clipKeyframes.get('clip-motion') ?? [];
    expect(getHandle(redone, 'x-0')?.x).toBeCloseTo(0.3);
    expect(getHandle(redone, 'x-0')?.y).toBeCloseTo(0.35);
    expect(getHandle(redone, 'y-0')?.x).toBeCloseTo(0.3);
    expect(getHandle(redone, 'y-0')?.y).toBeCloseTo(-0.05);
    expect(useTimelineStore.getState().selectedKeyframeIds).toEqual(new Set(['x-0', 'y-0']));
  });

  it('does not capture, select, or leak state when transaction begin fails', () => {
    useTimelineStore.setState({ selectedKeyframeIds: new Set(['x-0']) });
    const failedApply = vi.fn(() => ({
      success: false,
      operationId: 'failed-begin',
      changedClipIds: [],
      warnings: [],
    }));
    useTimelineStore.setState({ applyTimelineEditOperation: failedApply });
    render(<Harness />);
    const handle = screen.getByRole('button', {
      name: 'Outgoing position curve handle at 0.000 seconds',
    });
    const setPointerCapture = vi.fn();
    Object.assign(handle, { setPointerCapture });

    fireEvent.pointerDown(handle, { button: 0, pointerId: 19, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(document, { pointerId: 19, clientX: 70, clientY: 70 });
    fireEvent.pointerUp(document, { pointerId: 19, clientX: 70, clientY: 70 });

    expect(failedApply).toHaveBeenCalledOnce();
    expect(failedApply.mock.calls[0]![0]).toMatchObject({ type: 'keyframe-transaction-begin' });
    expect(setPointerCapture).not.toHaveBeenCalled();
    expect(handle).toHaveAttribute('aria-pressed', 'false');
    expect(useTimelineStore.getState().selectedKeyframeIds).toEqual(new Set(['x-0']));
    expect(useTimelineStore.getState().clipKeyframes.get('clip-motion')).toEqual(pairedKeyframes());
    expect(getHistoryStateView().batchId).toBeNull();
  });

  it('resolves a created companion to stable paired ids and restores it plus selection on undo', () => {
    useTimelineStore.setState({
      clipKeyframes: new Map([['clip-motion', pairedKeyframes().filter((keyframe) => keyframe.id !== 'y-0')]]),
      selectedKeyframeIds: new Set(['x-1']),
    });
    const rendered = render(<Harness />);
    const node = screen.getByLabelText('Position keyframe at 0.000 seconds');
    fireEvent.pointerDown(node, { button: 0, pointerId: 29, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(document, { pointerId: 29, clientX: 55, clientY: 55 });
    fireEvent.pointerMove(document, { pointerId: 29, clientX: 60, clientY: 60 });
    fireEvent.pointerUp(document, { pointerId: 29, clientX: 60, clientY: 60 });

    const changed = useTimelineStore.getState().clipKeyframes.get('clip-motion') ?? [];
    const createdCompanions = changed.filter((keyframe) => (
      keyframe.property === 'position.y' && keyframe.time === 0
    ));
    expect(createdCompanions).toHaveLength(1);
    const createdId = createdCompanions[0]!.id;
    expect(changed.find((keyframe) => keyframe.id === 'x-0')?.value).toBeCloseTo(0.3);
    expect(useTimelineStore.getState().selectedKeyframeIds).toEqual(new Set(['x-0', createdId]));
    expect(getHistoryStateView().undoStack).toHaveLength(1);

    rendered.unmount();
    act(() => getHistoryStateView().undo());
    const restored = useTimelineStore.getState().clipKeyframes.get('clip-motion') ?? [];
    expect(restored.some((keyframe) => keyframe.id === createdId)).toBe(false);
    expect(restored.find((keyframe) => keyframe.id === 'x-0')?.value).toBe(0.1);
    expect(useTimelineStore.getState().selectedKeyframeIds).toEqual(new Set(['x-1']));
  });

  it('provides a 24px focusable handle button with keyboard nudge, Enter, and Escape', () => {
    useTimelineStore.setState({ selectedKeyframeIds: new Set(['x-0']) });
    render(<Harness />);
    let handle = screen.getByRole('button', {
      name: 'Outgoing position curve handle at 0.000 seconds',
    });
    expect(handle).toHaveAttribute('data-motion-path-handle-hit-target', 'true');
    expect(handle).toHaveAttribute('r', '12');
    expect(handle).toHaveAttribute('tabindex', '0');
    expect(handle).toHaveAttribute('fill', 'transparent');
    fireEvent.focus(handle);
    expect(handle).toHaveAttribute('stroke', '#ffffff');

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle).toHaveAttribute('aria-pressed', 'true');
    expect(useTimelineStore.getState().selectedKeyframeIds).toEqual(new Set(['x-0', 'y-0']));
    fireEvent.keyDown(handle, { key: 'Escape' });
    expect(getHandle(
      useTimelineStore.getState().clipKeyframes.get('clip-motion') ?? [],
      'x-0',
    )).toEqual({ x: 0.2, y: 0.1 });
    expect(useTimelineStore.getState().selectedKeyframeIds).toEqual(new Set(['x-0']));
    expect(getHistoryStateView().undoStack).toHaveLength(0);

    handle = screen.getByRole('button', {
      name: 'Outgoing position curve handle at 0.000 seconds',
    });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.keyDown(handle, { key: 'Enter' });
    const committed = useTimelineStore.getState().clipKeyframes.get('clip-motion') ?? [];
    expect(getHandle(committed, 'x-0')?.x).toBeCloseTo(0.3);
    expect(getHandle(committed, 'x-0')?.y).toBeCloseTo(0.17);
    expect(getHandle(committed, 'y-0')?.x).toBeCloseTo(0.3);
    expect(getHandle(committed, 'y-0')?.y).toBeCloseTo(0.15);
    expect(getHistoryStateView().undoStack).toHaveLength(1);
  });

  it.each(['pointercancel', 'blur', 'unmount'] as const)(
    'restores both scalar handles exactly on %s',
    (cancelKind) => {
      useTimelineStore.setState({ selectedKeyframeIds: new Set(['x-0']) });
      const rendered = render(<Harness />);
      const handle = screen.getByLabelText('Outgoing position curve handle at 0.000 seconds');
      const releasePointerCapture = vi.fn();
      Object.assign(handle, {
        hasPointerCapture: () => true,
        releasePointerCapture,
        setPointerCapture: vi.fn(),
      });
      fireEvent.pointerDown(handle, { button: 0, pointerId: 23, clientX: 50, clientY: 50 });
      fireEvent.pointerMove(document, { pointerId: 23, clientX: 65, clientY: 35 });

      if (cancelKind === 'pointercancel') {
        fireEvent.pointerCancel(document, { pointerId: 23 });
      } else if (cancelKind === 'blur') {
        fireEvent.blur(window);
      } else {
        rendered.unmount();
      }

      const restored = useTimelineStore.getState().clipKeyframes.get('clip-motion') ?? [];
      expect(getHandle(restored, 'x-0')).toEqual({ x: 0.2, y: 0.1 });
      expect(getHandle(restored, 'y-0')).toEqual({ x: 0.4, y: 0.2 });
      expect(useTimelineStore.getState().selectedKeyframeIds).toEqual(new Set(['x-0']));
      expect(getHistoryStateView().undoStack).toHaveLength(0);
      expect(getHistoryStateView().batchId).toBeNull();
      expect(releasePointerCapture).toHaveBeenCalledWith(23);
    },
  );
});
