import { describe, expect, it, vi } from 'vitest';

import {
  commitWholeMaskDrag,
  type MaskPathDragBatch,
} from '../../src/components/preview/maskPathDragPreview';
import { createMaskNumericProperty } from '../../src/types/animationProperties';
import type { ClipMask } from '../../src/types/masks';

function createMask(): ClipMask {
  return {
    id: 'mask-1',
    name: 'Rectangle Mask',
    vertices: [
      vertex('v1', 0.1, 0.1),
      vertex('v2', 0.9, 0.1),
      vertex('v3', 0.9, 0.9),
      vertex('v4', 0.1, 0.9),
    ],
    closed: true,
    opacity: 1,
    feather: 0,
    featherQuality: 50,
    inverted: false,
    mode: 'add',
    expanded: true,
    position: { x: 0.05, y: -0.02 },
    enabled: true,
    visible: true,
  };
}

function vertex(id: string, x: number, y: number) {
  return {
    id,
    x,
    y,
    handleIn: { x: 0, y: 0 },
    handleOut: { x: 0, y: 0 },
    handleMode: 'none' as const,
  };
}

function createCommitStore(options: { recording: boolean; hasPathKeyframes: boolean }) {
  const spies = {
    addMaskPathKeyframe: vi.fn(),
    hasKeyframes: vi.fn(() => options.hasPathKeyframes),
    invalidateCache: vi.fn(),
    isRecording: vi.fn(() => options.recording),
    setPropertyValue: vi.fn(),
    updateVertices: vi.fn(),
  };
  return {
    spies,
    store: spies as unknown as Parameters<typeof commitWholeMaskDrag>[0],
  };
}

const nestedBatch: MaskPathDragBatch = { opened: false, batchId: 17 };

describe('whole mask drag commit', () => {
  it('writes a complete translated path when Mask Path recording is armed', () => {
    const mask = createMask();
    const { spies, store } = createCommitStore({ recording: true, hasPathKeyframes: false });

    const mode = commitWholeMaskDrag(
      store,
      'clip-1',
      mask,
      { x: 0.05, y: -0.02 },
      { x: 0.25, y: 0.08 },
      nestedBatch,
    );

    expect(mode).toBe('path');
    expect(spies.setPropertyValue).not.toHaveBeenCalled();
    expect(spies.updateVertices).toHaveBeenCalledOnce();
    const updateCall = spies.updateVertices.mock.calls[0];
    expect(updateCall?.[0]).toBe('clip-1');
    expect(updateCall?.[1]).toBe('mask-1');
    expect(updateCall?.[3]).toBe(true);
    const updates = updateCall?.[2] as Array<{ id: string; updates: { x: number; y: number } }>;
    const expectedPoints = [
      { id: 'v1', x: 0.3, y: 0.2 },
      { id: 'v2', x: 1.1, y: 0.2 },
      { id: 'v3', x: 1.1, y: 1 },
      { id: 'v4', x: 0.3, y: 1 },
    ];
    updates.forEach((update, index) => {
      expect(update.id).toBe(expectedPoints[index]?.id);
      expect(update.updates.x).toBeCloseTo(expectedPoints[index]!.x, 10);
      expect(update.updates.y).toBeCloseTo(expectedPoints[index]!.y, 10);
    });

    expect(spies.addMaskPathKeyframe).toHaveBeenCalledOnce();
    const keyframeCall = spies.addMaskPathKeyframe.mock.calls[0];
    expect(keyframeCall?.[0]).toBe('clip-1');
    expect(keyframeCall?.[1]).toBe('mask-1');
    expect(keyframeCall?.[3]).toBeUndefined();
    expect(keyframeCall?.[4]).toBe('linear');
    expect(keyframeCall?.[5]).toEqual(expect.objectContaining({ phase: 'update', source: 'ui' }));
    const pathValue = keyframeCall?.[2] as { closed: boolean; vertices: Array<{ id: string; x: number; y: number }> };
    expect(pathValue.closed).toBe(true);
    pathValue.vertices.forEach((pathVertex, index) => {
      expect(pathVertex.id).toBe(expectedPoints[index]?.id);
      expect(pathVertex.x).toBeCloseTo(expectedPoints[index]!.x, 10);
      expect(pathVertex.y).toBeCloseTo(expectedPoints[index]!.y, 10);
    });
  });

  it('uses the same path behavior when path keyframes already exist', () => {
    const { spies, store } = createCommitStore({ recording: false, hasPathKeyframes: true });

    expect(commitWholeMaskDrag(
      store,
      'clip-1',
      createMask(),
      { x: 0.05, y: -0.02 },
      { x: 0.15, y: -0.02 },
      nestedBatch,
    )).toBe('path');

    expect(spies.updateVertices).toHaveBeenCalledOnce();
    expect(spies.addMaskPathKeyframe).toHaveBeenCalledOnce();
    expect(spies.setPropertyValue).not.toHaveBeenCalled();
  });

  it('preserves the compact position offset for a static mask', () => {
    const { spies, store } = createCommitStore({ recording: false, hasPathKeyframes: false });

    const mode = commitWholeMaskDrag(
      store,
      'clip-1',
      createMask(),
      { x: 0.05, y: -0.02 },
      { x: 0.25, y: 0.08 },
      nestedBatch,
    );

    expect(mode).toBe('position');
    expect(spies.updateVertices).not.toHaveBeenCalled();
    expect(spies.addMaskPathKeyframe).not.toHaveBeenCalled();
    expect(spies.setPropertyValue).toHaveBeenNthCalledWith(
      1,
      'clip-1',
      createMaskNumericProperty('mask-1', 'position.x'),
      0.25,
    );
    expect(spies.setPropertyValue).toHaveBeenNthCalledWith(
      2,
      'clip-1',
      createMaskNumericProperty('mask-1', 'position.y'),
      0.08,
    );
    expect(spies.invalidateCache).toHaveBeenCalledOnce();
  });
});
