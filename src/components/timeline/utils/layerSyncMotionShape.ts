import type { ClipTransform, Effect, Keyframe, Layer, TimelineClip } from '../../../types';
import { getInterpolatedMotionLayer } from '../../../utils/motionInterpolation';
import { getEffectiveScale } from '../../../utils/transformScale';

export interface BuildLayerSyncMotionShapeParams {
  clip: TimelineClip;
  clipLocalTime: number;
  effects: Effect[];
  keyframes: readonly Keyframe[];
  layerIndex: number;
  trackVisible: boolean;
  transform: ClipTransform;
}

/**
 * Builds the paused-preview layer consumed by edit overlays. The render loop
 * has its own LayerBuilder path, but the timeline layer-sync state must expose
 * the same motion source so viewport editing can resolve source dimensions and
 * project motion paths.
 */
export function buildLayerSyncMotionShape(
  params: BuildLayerSyncMotionShapeParams,
): Layer | null {
  const { clip, clipLocalTime, effects, keyframes, layerIndex, trackVisible, transform } = params;
  if (clip.source?.type !== 'motion-shape' || clip.motion?.kind !== 'shape') return null;

  return {
    id: `timeline_layer_${layerIndex}`,
    name: clip.name,
    sourceClipId: clip.id,
    visible: trackVisible,
    opacity: transform.opacity,
    blendMode: transform.blendMode,
    source: {
      type: 'motion',
      motion: getInterpolatedMotionLayer(clip, [...keyframes], clipLocalTime) ?? clip.motion,
    },
    effects,
    position: {
      x: transform.position.x,
      y: transform.position.y,
      z: transform.position.z,
    },
    scale: getEffectiveScale(transform.scale),
    rotation: {
      x: (transform.rotation.x * Math.PI) / 180,
      y: (transform.rotation.y * Math.PI) / 180,
      z: (transform.rotation.z * Math.PI) / 180,
    },
  };
}
