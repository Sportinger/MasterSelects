import { describe, expect, it } from 'vitest';
import {
  MOTION_PARENT_ERROR_CODES,
  MOTION_PARENT_GRAPH_BUDGETS,
} from '../../src/services/motionDesign/structure/contracts';
import { validateMotionParentGraph } from '../../src/services/motionDesign/structure/parentGraphPlanner';
import {
  sanitizeTimelineParentGraph,
  type TimelineParentGraphClipLike,
} from '../../src/services/motionDesign/structure/timelineParentGraphSanitizer';
import { sanitizeTimelineParentRestoreTree } from '../../src/services/motionDesign/structure/timelineParentRestoreAdapter';
import type { TimelineClip } from '../../src/types/timeline';

function clip(
  id: string,
  parentClipId?: string,
  is3D = false,
): TimelineParentGraphClipLike {
  return {
    id,
    ...(parentClipId ? { parentClipId } : {}),
    ...(is3D ? { is3D: true } : {}),
  };
}

describe('timeline parent graph sanitizer', () => {
  it('preserves valid same-composition 2D relationships without mutating input', () => {
    const clips = [clip('child', 'parent'), clip('parent'), clip('sibling')];
    const before = structuredClone(clips);
    const result = sanitizeTimelineParentGraph('comp-a', clips);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(clips).toEqual(before);
    expect(result.assignments).toEqual([
      { clipId: 'child', parentClipId: 'parent' },
      { clipId: 'parent' },
      { clipId: 'sibling' },
    ]);
    expect(result.clips[0]).not.toBe(clips[0]);
    expect(result.diagnostics).toEqual([]);
    expect(result.quarantinedAssignments).toEqual([]);
    expect(validateMotionParentGraph(result.graph)).toEqual([]);
  });

  it('removes missing, self, cyclic, and mixed 2D/3D edges with stable diagnostics', () => {
    const clips = [
      clip('valid-child', 'root'),
      clip('root'),
      clip('missing-child', 'absent'),
      clip('self-child', 'self-child'),
      clip('cycle-a', 'cycle-b'),
      clip('cycle-b', 'cycle-a'),
      clip('three-d-root', undefined, true),
      clip('mixed-child', 'three-d-root'),
      clip('three-d-child', 'root', true),
    ];
    const forward = sanitizeTimelineParentGraph('comp-a', clips);
    const reverse = sanitizeTimelineParentGraph('comp-a', [...clips].reverse());

    expect(forward).toEqual(reverse);
    expect(forward.ok).toBe(true);
    if (!forward.ok) return;
    expect(forward.assignments.find((item) => item.clipId === 'valid-child')?.parentClipId)
      .toBe('root');
    for (const clipId of [
      'missing-child',
      'self-child',
      'cycle-a',
      'cycle-b',
      'mixed-child',
      'three-d-child',
    ]) {
      expect(forward.assignments.find((item) => item.clipId === clipId)?.parentClipId)
        .toBeUndefined();
    }
    expect(new Set(forward.diagnostics.map((item) => item.code))).toEqual(new Set([
      MOTION_PARENT_ERROR_CODES.PARENT_MISSING,
      MOTION_PARENT_ERROR_CODES.SELF_PARENT,
      MOTION_PARENT_ERROR_CODES.CYCLE,
      MOTION_PARENT_ERROR_CODES.MIXED_3D_UNSUPPORTED,
    ]));
    expect(forward.quarantinedAssignments).toEqual([
      { clipId: 'cycle-a', parentClipId: 'cycle-b', blockedBy: MOTION_PARENT_ERROR_CODES.CYCLE },
      { clipId: 'cycle-b', parentClipId: 'cycle-a', blockedBy: MOTION_PARENT_ERROR_CODES.CYCLE },
      { clipId: 'missing-child', parentClipId: 'absent', blockedBy: MOTION_PARENT_ERROR_CODES.PARENT_MISSING },
      { clipId: 'mixed-child', parentClipId: 'three-d-root', blockedBy: MOTION_PARENT_ERROR_CODES.MIXED_3D_UNSUPPORTED },
      { clipId: 'self-child', parentClipId: 'self-child', blockedBy: MOTION_PARENT_ERROR_CODES.SELF_PARENT },
      { clipId: 'three-d-child', parentClipId: 'root', blockedBy: MOTION_PARENT_ERROR_CODES.MIXED_3D_UNSUPPORTED },
    ]);
    expect(validateMotionParentGraph(forward.graph)).toEqual([]);
  });

  it('does not execute unrelated runtime getters or a parent accessor', () => {
    let getterCalls = 0;
    const safeClip: Record<string, unknown> = { id: 'safe', parentClipId: 'root' };
    Object.defineProperties(safeClip, {
      source: {
        enumerable: true,
        get: () => {
          getterCalls += 1;
          throw new Error('Runtime source must not be read.');
        },
      },
      file: {
        enumerable: true,
        get: () => {
          getterCalls += 1;
          throw new Error('Runtime file must not be read.');
        },
      },
    });
    const accessorClip: Record<string, unknown> = { id: 'accessor-child' };
    Object.defineProperty(accessorClip, 'parentClipId', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error('Parent getter must not be read.');
      },
    });

    const result = sanitizeTimelineParentGraph('comp-a', [
      safeClip,
      { id: 'root' },
      accessorClip,
    ] as unknown as readonly TimelineParentGraphClipLike[]);

    expect(getterCalls).toBe(0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assignments).toContainEqual({ clipId: 'safe', parentClipId: 'root' });
    expect(result.assignments).toContainEqual({ clipId: 'accessor-child' });
    expect(result.diagnostics.map((item) => item.code))
      .toContain(MOTION_PARENT_ERROR_CODES.GRAPH_NODE_INVALID);
  });

  it('fails closed before inspecting entries above the frozen node budget', () => {
    let getterCalls = 0;
    const guardedClip: Record<string, unknown> = {};
    Object.defineProperty(guardedClip, 'id', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error('Over-budget input must not be inspected.');
      },
    });
    const clips = Array.from(
      { length: MOTION_PARENT_GRAPH_BUDGETS.maxNodes + 1 },
      () => guardedClip,
    ) as unknown as readonly TimelineParentGraphClipLike[];

    const result = sanitizeTimelineParentGraph('comp-a', clips);

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code)
      .toBe(MOTION_PARENT_ERROR_CODES.GRAPH_NODE_BUDGET_EXCEEDED);
    expect(result.clips).toEqual([]);
    expect(result.assignments).toEqual([]);
    expect(getterCalls).toBe(0);
  });

  it('cuts only edges that cross the frozen depth budget', () => {
    const clips = Array.from(
      { length: MOTION_PARENT_GRAPH_BUDGETS.maxDepth + 1 },
      (_, index) => clip(
        `node-${String(index).padStart(3, '0')}`,
        index === 0 ? undefined : `node-${String(index - 1).padStart(3, '0')}`,
      ),
    );
    const result = sanitizeTimelineParentGraph('comp-a', clips);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assignments.find((item) => item.clipId === 'node-255')?.parentClipId)
      .toBe('node-254');
    expect(result.assignments.find((item) => item.clipId === 'node-256')?.parentClipId)
      .toBeUndefined();
    expect(result.quarantinedAssignments).toContainEqual({
      clipId: 'node-256',
      parentClipId: 'node-255',
      blockedBy: MOTION_PARENT_ERROR_CODES.GRAPH_DEPTH_BUDGET_EXCEEDED,
    });
    expect(result.diagnostics.map((item) => item.code))
      .toContain(MOTION_PARENT_ERROR_CODES.GRAPH_DEPTH_BUDGET_EXCEEDED);
    expect(validateMotionParentGraph(result.graph)).toEqual([]);
  });

  it('sanitizes restored nested trees without treating source composition ids as owners', () => {
    const transform = {
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      opacity: 1,
      blendMode: 'normal' as const,
    };
    const makeTimelineClip = (
      id: string,
      parentClipId?: string,
      extra: Partial<TimelineClip> = {},
    ): TimelineClip => ({
      id,
      trackId: 'video-1',
      name: id,
      file: new File([], id),
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      source: { type: 'solid', naturalDuration: 5 },
      transform,
      effects: [],
      ...(parentClipId ? { parentClipId } : {}),
      ...extra,
    });
    const nestedParent = makeTimelineClip('wrapper::parent');
    const nestedChild = makeTimelineClip('wrapper::child', 'wrapper::parent');
    const nestedDangling = makeTimelineClip('wrapper::dangling', 'source-only-id');
    const wrapper = makeTimelineClip('wrapper', undefined, {
      isComposition: true,
      compositionId: 'nested-source-composition',
      nestedClips: [nestedChild, nestedParent, nestedDangling],
    });

    const restored = sanitizeTimelineParentRestoreTree('active-owner-composition', [wrapper]);

    expect(restored.clips[0].compositionId).toBe('nested-source-composition');
    expect(restored.clips[0].nestedClips?.find((item) => item.id === 'wrapper::child')?.parentClipId)
      .toBe('wrapper::parent');
    expect(restored.clips[0].nestedClips?.find((item) => item.id === 'wrapper::dangling')?.parentClipId)
      .toBeUndefined();
    expect(restored.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        compositionId: 'nested-source-composition',
        clipPath: ['wrapper'],
        failure: expect.objectContaining({ code: MOTION_PARENT_ERROR_CODES.PARENT_MISSING }),
      }),
    ]));
  });
});
