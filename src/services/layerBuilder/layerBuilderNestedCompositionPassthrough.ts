import type { RuntimeColorGrade } from '../../types/colorCorrection';
import type { Effect } from '../../types/effects';
import type { Layer } from '../../types/layers';
import type { TimelineClip } from '../../types/timeline';
import type { evaluateTransitionMappedAnimation } from '../compositionRender/transitionMappedAnimation';
import type { TransformCache } from './TransformCache';
import type { FrameContext } from './types';

const IDENTITY_EPSILON = 0.000001;

function isIdentityNumber(value: number | undefined, identity: number): boolean {
  return Math.abs((value ?? identity) - identity) <= IDENTITY_EPSILON;
}

export function tryBuildNestedCompositionPassthroughLayer(input: {
  clip: TimelineClip;
  layerIndex: number;
  ctx: FrameContext;
  nestedLayers: Layer[];
  mappedAnimation: ReturnType<typeof evaluateTransitionMappedAnimation> | undefined;
  opacityOverride?: number;
  transform: ReturnType<TransformCache['getTransform']>;
  effects: Effect[];
  colorCorrection: RuntimeColorGrade | undefined;
}): Layer | null {
  const {
    clip,
    layerIndex,
    ctx,
    nestedLayers,
    mappedAnimation,
    opacityOverride,
    transform,
    effects,
    colorCorrection,
  } = input;
  const nestedLayer = nestedLayers.length === 1 ? nestedLayers[0] : undefined;
  const nestedComposition = ctx.compositionById.get(clip.compositionId || '');
  const activeComposition = ctx.compositionById.get(ctx.activeCompId);

  // A simple same-size video nested comp does not need a full-resolution
  // intermediate render. Keep every visual operation on the regular nested
  // renderer path so this optimization cannot change the composed result.
  if (
    !nestedLayer?.source ||
    nestedLayer.source.type !== 'video' ||
    nestedLayer.source.nestedComposition ||
    nestedLayer.is3D ||
    !nestedComposition ||
    !activeComposition ||
    nestedComposition.width !== activeComposition.width ||
    nestedComposition.height !== activeComposition.height ||
    mappedAnimation !== undefined ||
    opacityOverride !== undefined ||
    effects.length > 0 ||
    colorCorrection !== undefined ||
    clip.is3D ||
    clip.nodeGraph !== undefined ||
    clip.sourceRect !== undefined ||
    clip.transitionRender !== undefined ||
    clip.masks?.some(mask => mask.enabled !== false) ||
    !isIdentityNumber(transform.opacity, 1) ||
    transform.blendMode !== 'normal' ||
    !isIdentityNumber(transform.position.x, 0) ||
    !isIdentityNumber(transform.position.y, 0) ||
    !isIdentityNumber(transform.position.z, 0) ||
    !isIdentityNumber(transform.scale.x, 1) ||
    !isIdentityNumber(transform.scale.y, 1) ||
    !isIdentityNumber(transform.scale.z, 1) ||
    !isIdentityNumber(transform.rotation.x, 0) ||
    !isIdentityNumber(transform.rotation.y, 0) ||
    !isIdentityNumber(transform.rotation.z, 0)
  ) {
    return null;
  }

  return {
    ...nestedLayer,
    id: `${ctx.activeCompId}_layer_${layerIndex}_${clip.id}`,
    name: clip.name,
  };
}
