import { endBatch, startBatch } from '../../stores/historyStore';
import { useTimelineStore } from '../../stores/timeline';
import type { TimelineStore } from '../../stores/timeline/types';
import { createMaskPathProperty } from '../../types/animationProperties';
import type { ClipMask, MaskPathKeyframeValue, MaskVertex } from '../../types/masks';

export type MaskVertexUpdate = {
  id: string;
  updates: Partial<MaskVertex>;
};

export type MaskPathDragBatch = ReturnType<typeof startBatch>;

type MaskPathCommitStore = Pick<
  TimelineStore,
  | 'addMaskPathKeyframe'
  | 'hasKeyframes'
  | 'invalidateCache'
  | 'isRecording'
  | 'updateVertices'
>;

export function applyMaskVertexUpdates(
  mask: ClipMask,
  vertexUpdates: MaskVertexUpdate[],
): ClipMask {
  const updatesById = new Map(vertexUpdates.map(({ id, updates }) => [id, updates]));
  return {
    ...mask,
    vertices: mask.vertices.map((vertex) => {
      const updates = updatesById.get(vertex.id);
      if (!updates) return vertex;
      return {
        ...vertex,
        ...updates,
        handleIn: updates.handleIn ? { ...updates.handleIn } : { ...vertex.handleIn },
        handleOut: updates.handleOut ? { ...updates.handleOut } : { ...vertex.handleOut },
      };
    }),
  };
}

function createMaskPathValue(mask: ClipMask): MaskPathKeyframeValue {
  return {
    closed: mask.closed,
    vertices: mask.vertices.map((vertex) => ({
      ...vertex,
      handleIn: { ...vertex.handleIn },
      handleOut: { ...vertex.handleOut },
    })),
  };
}

export function publishMaskPathDragPreview(
  ownerId: string,
  clipId: string,
  mask: ClipMask,
): void {
  useTimelineStore.setState({
    maskEditPreview: { ownerId, clipId, mask },
  });
}

export function clearMaskPathDragPreview(ownerId: string): void {
  useTimelineStore.setState((state) => state.maskEditPreview?.ownerId === ownerId
    ? { maskEditPreview: null }
    : {});
}

export function commitMaskPathDrag(
  store: MaskPathCommitStore,
  clipId: string,
  sourceMask: ClipMask,
  vertexUpdates: MaskVertexUpdate[],
  label: string,
  batch: MaskPathDragBatch,
): void {
  try {
    if (vertexUpdates.length === 0) return;

    const finalMask = applyMaskVertexUpdates(sourceMask, vertexUpdates);
    store.updateVertices(clipId, sourceMask.id, vertexUpdates, true);

    const property = createMaskPathProperty(sourceMask.id);
    if (store.isRecording(clipId, property) || store.hasKeyframes(clipId, property)) {
      // The owned history batch is the commit boundary. A single transaction
      // update writes the final path without the per-frame project churn.
      store.addMaskPathKeyframe(
        clipId,
        sourceMask.id,
        createMaskPathValue(finalMask),
        undefined,
        'linear',
        {
          phase: 'update',
          source: 'ui',
          historyLabel: label,
        },
      );
    } else {
      store.invalidateCache();
    }
  } finally {
    if (batch.opened) endBatch();
  }
}
