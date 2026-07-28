import { endBatch, startBatch } from '../../stores/historyStore';
import type { AnimatableProperty } from '../../types/animationProperties';
import type { Layer } from '../../types/layers';
import type { TimelineClip } from '../../types/timeline';

export type LayerTransformDragUpdate =
  | {
      mode: 'move';
      layerId: string;
      clipId?: string;
      position: { x: number; y: number; z: number };
    }
  | {
      mode: 'scale';
      layerId: string;
      clipId?: string;
      scale: { x: number; y: number };
    };

interface LayerTransformCommitDependencies {
  hasKeyframes: (clipId: string, property?: AnimatableProperty) => boolean;
  setPropertyValue: (clipId: string, property: AnimatableProperty, value: number) => void;
  updateClipTransform: (
    clipId: string,
    transform: Partial<Pick<TimelineClip['transform'], 'position' | 'scale'>>,
  ) => void;
  updateLayer: (layerId: string, updates: Partial<Layer>) => void;
}

function finiteNonZero(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) > 0.000001
    ? value
    : fallback;
}

export function resolveClipScaleFromLayerScale(
  layerScale: { x: number; y: number },
  clipScale: TimelineClip['transform']['scale'] | undefined,
): { x: number; y: number } {
  const all = finiteNonZero(clipScale?.all, 1);
  return {
    x: layerScale.x / all,
    y: layerScale.y / all,
  };
}

function hasAnyKeyframes(
  clipId: string,
  properties: readonly AnimatableProperty[],
  hasKeyframes: LayerTransformCommitDependencies['hasKeyframes'],
): boolean {
  return properties.some((property) => hasKeyframes(clipId, property));
}

export function commitLayerTransformDrag(
  update: LayerTransformDragUpdate,
  clip: TimelineClip,
  dependencies: LayerTransformCommitDependencies,
): void {
  const batch = startBatch(update.mode === 'move' ? 'Move layer' : 'Scale layer');

  try {
    if (update.mode === 'move') {
      dependencies.updateLayer(update.layerId, { position: update.position });
      const properties = ['position.x', 'position.y', 'position.z'] as const;
      if (hasAnyKeyframes(clip.id, properties, dependencies.hasKeyframes)) {
        dependencies.setPropertyValue(clip.id, 'position.x', update.position.x);
        dependencies.setPropertyValue(clip.id, 'position.y', update.position.y);
        dependencies.setPropertyValue(clip.id, 'position.z', update.position.z);
      } else {
        dependencies.updateClipTransform(clip.id, { position: update.position });
      }
      return;
    }

    dependencies.updateLayer(update.layerId, { scale: update.scale });
    const clipScale = resolveClipScaleFromLayerScale(update.scale, clip.transform.scale);
    const properties = ['scale.x', 'scale.y', 'scale.all'] as const;
    if (hasAnyKeyframes(clip.id, properties, dependencies.hasKeyframes)) {
      dependencies.setPropertyValue(clip.id, 'scale.x', clipScale.x);
      dependencies.setPropertyValue(clip.id, 'scale.y', clipScale.y);
    } else {
      dependencies.updateClipTransform(clip.id, { scale: clipScale });
    }
  } finally {
    if (batch.opened) {
      endBatch();
    }
  }
}
