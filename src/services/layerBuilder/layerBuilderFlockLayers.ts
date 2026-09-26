import type { BlendMode, Keyframe, Layer, TimelineClip } from '../../types';
import { useTimelineStore } from '../../stores/timeline';
import { compileFlockDefinitionCached } from '../flock/compiler/flockCompiler';
import type { FlockRenderConsumer } from '../flock/flockLayerSource';
import { nestedFlockSourceTime } from '../flock/time/flockTimeMapper';
import { getClipTimeInfo } from './FrameContext';
import type { TransformCache } from './TransformCache';
import type { FrameContext } from './types';
import { rendersFlock } from '../flock/flockEffect';

const flockKeyframeCache = new WeakMap<readonly Keyframe[], Keyframe[]>();

function flockKeyframesOf(keyframes: readonly Keyframe[] | undefined): Keyframe[] {
  if (!keyframes || keyframes.length === 0) return [];
  let filtered = flockKeyframeCache.get(keyframes);
  if (!filtered) {
    filtered = keyframes.filter((keyframe) => keyframe.property.startsWith('flock.node.'));
    flockKeyframeCache.set(keyframes, filtered);
  }
  return filtered;
}

/** Mirrors the reversed flag inside the source window (see FlockTimeMapper). */
export function flockSourceTimeFromClipTime(clip: Pick<TimelineClip, 'reversed' | 'inPoint' | 'outPoint'>, clipTime: number): number {
  return clip.reversed === true ? clip.inPoint + clip.outPoint - clipTime : clipTime;
}

/** Runtime-only flock layer source. Returns null unless the clip's Flocking effect renders. */
export function buildFlockLayerSource(
  clip: TimelineClip,
  sourceTime: number,
  keyframes: readonly Keyframe[] | undefined,
  consumer: FlockRenderConsumer,
): Layer['source'] {
  const definition = clip.flock;
  if (!definition || !rendersFlock(clip)) return null;
  const compiled = compileFlockDefinitionCached(definition);
  return {
    type: 'flock',
    flock: {
      clipId: clip.id,
      definition,
      program: compiled.ok ? compiled.program : null,
      diagnostics: compiled.diagnostics,
      keyframes: flockKeyframesOf(keyframes),
      sourceTime: Number.isFinite(sourceTime) ? Math.max(0, sourceTime) : 0,
      consumer,
    },
  };
}

/** Nested composition flock layer (nested clips have no FrameContext timing). */
export function buildNestedLayerBuilderFlockLayer(
  baseLayer: Omit<Layer, 'source'>,
  nestedClip: TimelineClip,
  nestedClipLocalTime: number,
  keyframes: readonly Keyframe[] | undefined,
): Layer | null {
  const source = buildFlockLayerSource(nestedClip, nestedFlockSourceTime(nestedClip, nestedClipLocalTime), keyframes, 'preview');
  return source ? { ...baseLayer, source, is3D: true } : null;
}

/** A Flocking effect on a nested image clip draws its swarm as an extra layer above the clip's image. */
export function buildNestedFlockOverlayLayer(
  nestedLayer: Layer,
  nestedClip: TimelineClip,
  nestedClipLocalTime: number,
  keyframes: readonly Keyframe[] | undefined,
): Layer | null {
  if (nestedClip.source?.type === 'flock') return null;
  const layer = buildNestedLayerBuilderFlockLayer(nestedLayer, nestedClip, nestedClipLocalTime, keyframes);
  return layer ? { ...layer, id: `${nestedLayer.id}_flock`, effects: [] } : null;
}

type BuildFlockLayerParams = {
  clip: TimelineClip;
  layerIndex: number;
  ctx: FrameContext;
  transformCache: TransformCache;
  opacityOverride?: number;
  /** Set for the swarm layer drawn above an image clip (the clip keeps its own layer). */
  overlay?: boolean;
};

export function buildLayerBuilderFlockLayer(params: BuildFlockLayerParams): Layer | null {
  const { clip, layerIndex, ctx, transformCache, opacityOverride } = params;
  if (!rendersFlock(clip)) return null;
  const suffix = params.overlay ? '_flock' : '';
  const timeInfo = getClipTimeInfo(ctx, clip);
  const transform = transformCache.getTransform(
    `${ctx.activeCompId}_${layerIndex}_${clip.id}${suffix}`,
    ctx.getInterpolatedTransform(clip.id, timeInfo.clipLocalTime),
  );
  const keyframes = useTimelineStore.getState().clipKeyframes.get(clip.id);
  return {
    id: `${ctx.activeCompId}_layer_${layerIndex}_${clip.id}${suffix}`,
    name: clip.name,
    sourceClipId: clip.id,
    visible: true,
    opacity: opacityOverride !== undefined ? transform.opacity * opacityOverride : transform.opacity,
    blendMode: transform.blendMode as BlendMode,
    source: buildFlockLayerSource(clip, flockSourceTimeFromClipTime(clip, timeInfo.clipTime), keyframes, 'preview'),
    effects: [],
    position: transform.position,
    anchor: transform.anchor,
    scale: transform.scale,
    rotation: transform.rotation,
    is3D: true,
  };
}
