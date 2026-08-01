import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TRANSFORM } from '../../src/stores/timeline/constants';
import { useTimelineStore } from '../../src/stores/timeline';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';
import { MotionNullViewportOverlay } from '../../src/components/preview/MotionNullViewportOverlay';
import { useMotionNullViewportEditing } from '../../src/components/preview/useMotionNullViewportEditing';

const track: TimelineTrack = {
  id: 'video-1',
  name: 'Video 1',
  type: 'video',
  height: 64,
  muted: false,
  visible: true,
  solo: false,
  locked: false,
};

function motionNull(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'null-1',
    trackId: track.id,
    name: 'Rig Null',
    file: new File([], 'motion-null.msmotion'),
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: { type: 'motion-null', naturalDuration: 5 },
    transform: structuredClone(DEFAULT_TRANSFORM),
    effects: [],
    ...overrides,
  };
}

function Harness({ setPropertyValue }: {
  readonly setPropertyValue: ReturnType<typeof vi.fn>;
}) {
  const clip = motionNull();
  const result = useMotionNullViewportEditing({
    enabled: true,
    clip,
    clips: [clip],
    clipKeyframes: new Map(),
    tracks: [track],
    compositionId: 'comp-1',
    timelineTime: 1,
    compositionSize: { width: 1920, height: 1080 },
    canvasSize: { width: 960, height: 540 },
    viewZoom: 1,
    editableSource: true,
    sourceMonitorActive: false,
    playbackActive: false,
    conflictingModeActive: false,
    setPropertyValueAtTime: setPropertyValue,
  });
  return (
    <MotionNullViewportOverlay
      width={960}
      height={540}
      {...result.overlayProps}
    />
  );
}

describe('MD6 Motion Null viewport overlay integration', () => {
  beforeEach(() => {
    useTimelineStore.setState({ layerTransformPreview: null });
  });

  it('renders an accessible exact-frame handle and commits one local position edit', () => {
    const setPropertyValue = vi.fn();
    render(<Harness setPropertyValue={setPropertyValue} />);

    const handle = screen.getByRole('button', { name: 'Move Rig Null' });
    expect(handle).toHaveAttribute('data-motion-null-interactive', 'true');
    expect(handle).toHaveAttribute('data-motion-null-clip-id', 'null-1');

    fireEvent.pointerDown(handle, { pointerId: 7, button: 0, clientX: 480, clientY: 270 });
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 576, clientY: 324 });
    expect(useTimelineStore.getState().layerTransformPreview).toMatchObject({
      clipId: 'null-1',
      transform: { position: { x: 0.2, y: 0.2, z: 0 } },
    });
    fireEvent.pointerUp(handle, { pointerId: 7, clientX: 576, clientY: 324 });

    expect(setPropertyValue).toHaveBeenNthCalledWith(1, 'null-1', 'position.x', 0.2, 1);
    expect(setPropertyValue).toHaveBeenNthCalledWith(2, 'null-1', 'position.y', 0.2, 1);
    expect(useTimelineStore.getState().layerTransformPreview).toBeNull();
  });

  it('supports keyboard nudging and hides outside the clip active range', () => {
    const setPropertyValue = vi.fn();
    const { rerender } = render(<Harness setPropertyValue={setPropertyValue} />);
    const handle = screen.getByRole('button', { name: 'Move Rig Null' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(setPropertyValue).toHaveBeenNthCalledWith(1, 'null-1', 'position.x', 10 / 480, 1);
    expect(setPropertyValue).toHaveBeenCalledTimes(1);

    function HiddenHarness() {
      const clip = motionNull();
      const result = useMotionNullViewportEditing({
        enabled: true,
        clip,
        clips: [clip],
        clipKeyframes: new Map(),
        tracks: [track],
        compositionId: 'comp-1',
        timelineTime: 6,
        compositionSize: { width: 1920, height: 1080 },
        canvasSize: { width: 960, height: 540 },
        viewZoom: 1,
        editableSource: true,
        sourceMonitorActive: false,
        playbackActive: false,
        conflictingModeActive: false,
        setPropertyValueAtTime: setPropertyValue,
      });
      return <MotionNullViewportOverlay width={960} height={540} {...result.overlayProps} />;
    }
    rerender(<HiddenHarness />);
    expect(screen.queryByRole('button', { name: 'Move Rig Null' })).toBeNull();
  });

  it('evaluates parented Nulls from local transforms exactly once', () => {
    const setPropertyValueAtTime = vi.fn();
    function ParentedHarness() {
      const parent = motionNull({
        id: 'parent-null',
        name: 'Parent Null',
        transform: {
          ...structuredClone(DEFAULT_TRANSFORM),
          position: { x: 0.25, y: 0, z: 0 },
        },
      });
      const child = motionNull({
        id: 'child-null',
        name: 'Child Null',
        parentClipId: parent.id,
        transform: {
          ...structuredClone(DEFAULT_TRANSFORM),
          position: { x: 0.1, y: 0, z: 0 },
        },
      });
      const result = useMotionNullViewportEditing({
        enabled: true,
        clip: child,
        clips: [parent, child],
        clipKeyframes: new Map(),
        tracks: [track],
        compositionId: 'comp-1',
        timelineTime: 1,
        compositionSize: { width: 1920, height: 1080 },
        canvasSize: { width: 960, height: 540 },
        viewZoom: 1,
        editableSource: true,
        sourceMonitorActive: false,
        playbackActive: false,
        conflictingModeActive: false,
        setPropertyValueAtTime,
      });
      return <MotionNullViewportOverlay width={960} height={540} {...result.overlayProps} />;
    }

    render(<ParentedHarness />);
    const handle = screen.getByRole('button', { name: 'Move Child Null' });
    expect(handle.querySelector('circle')?.getAttribute('cx')).toBe('648');
  });

  it('cancels no-op, stale-frame, and lost-capture edits without committing', () => {
    const setPropertyValueAtTime = vi.fn();
    function TimedHarness({ timelineTime }: { readonly timelineTime: number }) {
      const clip = motionNull();
      const result = useMotionNullViewportEditing({
        enabled: true,
        clip,
        clips: [clip],
        clipKeyframes: new Map(),
        tracks: [track],
        compositionId: 'comp-1',
        timelineTime,
        compositionSize: { width: 1920, height: 1080 },
        canvasSize: { width: 960, height: 540 },
        viewZoom: 1,
        editableSource: true,
        sourceMonitorActive: false,
        playbackActive: false,
        conflictingModeActive: false,
        setPropertyValueAtTime,
      });
      return <MotionNullViewportOverlay width={960} height={540} {...result.overlayProps} />;
    }

    const rendered = render(<TimedHarness timelineTime={1} />);
    let handle = screen.getByRole('button', { name: 'Move Rig Null' });
    fireEvent.pointerDown(handle, { pointerId: 2, button: 0, clientX: 480, clientY: 270 });
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 480, clientY: 270 });
    fireEvent.pointerUp(handle, { pointerId: 2, clientX: 480, clientY: 270 });
    expect(setPropertyValueAtTime).not.toHaveBeenCalled();

    handle = screen.getByRole('button', { name: 'Move Rig Null' });
    fireEvent.pointerDown(handle, { pointerId: 3, button: 0, clientX: 480, clientY: 270 });
    fireEvent.pointerMove(handle, { pointerId: 3, clientX: 500, clientY: 270 });
    expect(useTimelineStore.getState().layerTransformPreview).not.toBeNull();
    fireEvent.lostPointerCapture(handle, { pointerId: 3 });
    expect(useTimelineStore.getState().layerTransformPreview).toBeNull();

    fireEvent.pointerDown(handle, { pointerId: 4, button: 0, clientX: 480, clientY: 270 });
    fireEvent.pointerMove(handle, { pointerId: 4, clientX: 520, clientY: 270 });
    rendered.rerender(<TimedHarness timelineTime={2} />);
    expect(useTimelineStore.getState().layerTransformPreview).toBeNull();
    fireEvent.pointerUp(handle, { pointerId: 4, clientX: 520, clientY: 270 });
    expect(setPropertyValueAtTime).not.toHaveBeenCalled();
  });

  it('shows a visible keyboard focus ring', () => {
    render(<Harness setPropertyValue={vi.fn()} />);
    const handle = screen.getByRole('button', { name: 'Move Rig Null' });
    fireEvent.focus(handle);
    expect(handle.querySelector('circle[stroke="#ffffff"]')).not.toBeNull();
  });
});
