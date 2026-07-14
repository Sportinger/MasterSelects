import type { BlendMode } from '../../types/blendMode';
import type { Layer } from '../../types/layers';
import type { TimelineClip } from '../../types/timeline';
import { mergeLightClipSettings } from '../../types/light';
import { getClipTimeInfo } from './FrameContext';
import type { TransformCache } from './TransformCache';
import type { FrameContext } from './types';

type BuildLayerLightParams = {
  clip: TimelineClip;
  layerIndex: number;
  ctx: FrameContext;
  transformCache: TransformCache;
  opacityOverride?: number;
};

export function buildLayerBuilderLightLayer({
  clip,
  layerIndex,
  ctx,
  transformCache,
  opacityOverride,
}: BuildLayerLightParams): Layer {
  const timeInfo = getClipTimeInfo(ctx, clip);
  const transform = transformCache.getTransform(
    `${ctx.activeCompId}_${layerIndex}`,
    ctx.getInterpolatedTransform(clip.id, timeInfo.clipLocalTime),
  );

  return {
    id: `${ctx.activeCompId}_layer_${layerIndex}`,
    name: clip.name,
    sourceClipId: clip.id,
    visible: true,
    opacity: opacityOverride !== undefined ? transform.opacity * opacityOverride : transform.opacity,
    blendMode: transform.blendMode as BlendMode,
    source: {
      type: 'light',
      lightSettings: mergeLightClipSettings(
        ctx.getInterpolatedLightSettings(clip.id, timeInfo.clipLocalTime),
      ),
    },
    effects: [],
    position: transform.position,
    scale: transform.scale,
    rotation: transform.rotation,
    is3D: true,
  };
}
