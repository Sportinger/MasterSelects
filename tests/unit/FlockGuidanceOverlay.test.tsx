import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const history = vi.hoisted(() => ({
  startBatch: vi.fn(),
  endBatch: vi.fn(),
  cancelHistoryBatch: vi.fn(),
}));

vi.mock('../../src/stores/historyStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/stores/historyStore')>();
  return { ...actual, ...history };
});

import { DEFAULT_TRANSFORM } from '../../src/stores/timeline/constants';
import { useTimelineStore } from '../../src/stores/timeline';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';
import { createFlockPresetDefinition } from '../../src/services/flock/presets/flockPresets';
import { FlockGuidanceOverlay } from '../../src/components/preview/flock/FlockGuidanceOverlay';

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

function flockClip(): TimelineClip {
  return {
    id: 'clip-flock-1',
    trackId: track.id,
    name: 'Flock: Vortex',
    file: new File([], 'flock.json'),
    startTime: 0,
    duration: 10,
    inPoint: 0,
    outPoint: 10,
    source: { type: 'flock', naturalDuration: 10 },
    flock: createFlockPresetDefinition('vortex'),
    transform: structuredClone(DEFAULT_TRANSFORM),
    effects: [],
    is3D: true,
  };
}

describe('FlockGuidanceOverlay', () => {
  const setPropertyValue = vi.fn();
  let clip: TimelineClip;
  let originalSetPropertyValue: ReturnType<typeof useTimelineStore.getState>['setPropertyValue'];

  beforeEach(() => {
    vi.clearAllMocks();
    clip = flockClip();
    originalSetPropertyValue = useTimelineStore.getState().setPropertyValue;
    useTimelineStore.setState({
      clips: [clip],
      tracks: [track],
      clipKeyframes: new Map(),
      playheadPosition: 1,
      isPlaying: false,
      setPropertyValue,
    });
  });

  afterEach(() => {
    useTimelineStore.setState({ setPropertyValue: originalSetPropertyValue, clips: [], isPlaying: false });
  });

  function renderOverlay(overrides: Partial<Parameters<typeof FlockGuidanceOverlay>[0]> = {}) {
    return render(
      <FlockGuidanceOverlay
        clip={clip}
        canvasSize={{ width: 960, height: 540 }}
        viewport={{ width: 1920, height: 1080 }}
        enabled
        {...overrides}
      />,
    );
  }

  function vortexHandle() {
    return screen.getByRole('button', { name: /Vortex · Center/ });
  }

  it('commits one history batch per drag with per-component property writes', () => {
    renderOverlay();
    const vortex = clip.flock!.nodes.find((node) => node.operator === 'flock.vortex')!;
    const handle = vortexHandle();
    const x = Number(handle.getAttribute('data-screen-x'));
    const y = Number(handle.getAttribute('data-screen-y'));

    fireEvent.pointerDown(handle, { pointerId: 3, button: 0, clientX: x, clientY: y });
    fireEvent.pointerMove(handle, { pointerId: 3, clientX: x + 40, clientY: y });
    fireEvent.pointerMove(handle, { pointerId: 3, clientX: x + 80, clientY: y - 20 });
    fireEvent.pointerUp(handle, { pointerId: 3, clientX: x + 80, clientY: y - 20 });

    expect(history.startBatch).toHaveBeenCalledTimes(1);
    expect(history.endBatch).toHaveBeenCalledTimes(1);
    expect(history.cancelHistoryBatch).not.toHaveBeenCalled();
    const properties = setPropertyValue.mock.calls.map((call) => call[1]);
    expect(properties).toContain(`flock.node.${vortex.id}.center.x`);
    expect(properties).toContain(`flock.node.${vortex.id}.center.y`);
    expect(setPropertyValue.mock.calls.every((call) => call[0] === clip.id)).toBe(true);
    const lastX = setPropertyValue.mock.calls.filter((call) => call[1].endsWith('.center.x')).pop()![2];
    expect(lastX).toBeGreaterThan(0);
  });

  it('cancels the batch and restores the start value on Escape', () => {
    renderOverlay();
    const vortex = clip.flock!.nodes.find((node) => node.operator === 'flock.vortex')!;
    const handle = vortexHandle();
    const x = Number(handle.getAttribute('data-screen-x'));
    const y = Number(handle.getAttribute('data-screen-y'));
    fireEvent.pointerDown(handle, { pointerId: 4, button: 0, clientX: x, clientY: y });
    fireEvent.pointerMove(handle, { pointerId: 4, clientX: x + 50, clientY: y });
    fireEvent.keyDown(handle, { key: 'Escape' });

    expect(history.cancelHistoryBatch).toHaveBeenCalledTimes(1);
    expect(history.endBatch).not.toHaveBeenCalled();
    const restore = setPropertyValue.mock.calls.filter((call) => call[1] === `flock.node.${vortex.id}.center.x`).pop();
    expect(restore?.[2]).toBeCloseTo(0, 6);
  });

  it('nudges with arrow keys as one undo step each', () => {
    renderOverlay();
    const vortex = clip.flock!.nodes.find((node) => node.operator === 'flock.vortex')!;
    fireEvent.keyDown(vortexHandle(), { key: 'ArrowRight', shiftKey: true });
    expect(history.startBatch).toHaveBeenCalledTimes(1);
    expect(history.endBatch).toHaveBeenCalledTimes(1);
    expect(setPropertyValue).toHaveBeenCalledWith(clip.id, `flock.node.${vortex.id}.center.x`, 10);
  });

  it('hides handles during playback, on locked tracks and outside the clip', () => {
    useTimelineStore.setState({ isPlaying: true });
    const { rerender } = renderOverlay();
    expect(screen.queryByRole('button', { name: /Vortex/ })).toBeNull();
    useTimelineStore.setState({ isPlaying: false, tracks: [{ ...track, locked: true }] });
    rerender(<FlockGuidanceOverlay clip={clip} canvasSize={{ width: 960, height: 540 }} viewport={{ width: 1920, height: 1080 }} enabled />);
    expect(screen.queryByRole('button', { name: /Vortex/ })).toBeNull();
    useTimelineStore.setState({ tracks: [track], playheadPosition: 12 });
    rerender(<FlockGuidanceOverlay clip={clip} canvasSize={{ width: 960, height: 540 }} viewport={{ width: 1920, height: 1080 }} enabled />);
    expect(screen.queryByRole('button', { name: /Vortex/ })).toBeNull();
  });
});
