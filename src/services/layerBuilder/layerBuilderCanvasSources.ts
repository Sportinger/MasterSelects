import type { Layer, TimelineClip } from '../../types';
import { isVectorAnimationSourceType } from '../../types/vectorAnimation';
import { mathSceneRenderer } from '../mathScene/MathSceneRenderer';
import { vectorAnimationRuntimeManager } from '../vectorAnimation/VectorAnimationRuntimeManager';
import { getClipTimeInfo } from './FrameContext';
import {
  buildLayerBuilderTextLayer,
  buildNestedTextSourceLayer,
} from './layerBuilder2dSources';
import type { TransformCache } from './TransformCache';
import type { FrameContext } from './types';

type BuildCanvasBackedLayerParams = {
  clip: TimelineClip;
  layerIndex: number;
  ctx: FrameContext;
  transformCache: TransformCache;
  opacityOverride?: number;
};

function collectKnownClipIds(clips: TimelineClip[]): string[] {
  const ids: string[] = [];
  const visit = (clip: TimelineClip) => {
    ids.push(clip.id);
    for (const nestedClip of clip.nestedClips ?? []) {
      visit(nestedClip);
    }
  };

  for (const clip of clips) {
    visit(clip);
  }

  return ids;
}

export function syncLayerBuilderCanvasRuntimeSources(ctx: FrameContext): void {
  for (const clip of ctx.clipsAtTime) {
    if (isVectorAnimationSourceType(clip.source?.type)) {
      vectorAnimationRuntimeManager.renderClipAtTime(
        clip,
        ctx.playheadPosition,
        ctx.getInterpolatedVectorAnimationSettings(clip.id, ctx.playheadPosition - clip.startTime),
      );
    }
  }

  vectorAnimationRuntimeManager.pruneClipRuntimes(collectKnownClipIds(ctx.clips));

  for (const clip of ctx.clipsAtTime) {
    if (clip.source?.type !== 'math-scene') continue;
    const timeInfo = getClipTimeInfo(ctx, clip);
    mathSceneRenderer.renderClip(clip, timeInfo.clipLocalTime);
  }
}

export function buildLayerBuilderCanvasBackedLayer(params: BuildCanvasBackedLayerParams): Layer | null {
  const { clip, ctx } = params;

  if (isVectorAnimationSourceType(clip.source?.type)) {
    const textCanvas = vectorAnimationRuntimeManager.renderClipAtTime(
      clip,
      ctx.playheadPosition,
      ctx.getInterpolatedVectorAnimationSettings(clip.id, ctx.playheadPosition - clip.startTime),
    );
    return textCanvas ? buildLayerBuilderTextLayer({ ...params, sourceTextCanvas: textCanvas }) : null;
  }

  if (clip.source?.type === 'math-scene') {
    const timeInfo = getClipTimeInfo(ctx, clip);
    mathSceneRenderer.renderClip(clip, timeInfo.clipLocalTime);
    const textCanvas = clip.source?.textCanvas;
    return textCanvas ? buildLayerBuilderTextLayer({ ...params, sourceTextCanvas: textCanvas }) : null;
  }

  const textCanvas = clip.source?.textCanvas;
  return textCanvas ? buildLayerBuilderTextLayer({ ...params, sourceTextCanvas: textCanvas }) : null;
}

export function buildNestedLayerBuilderCanvasBackedSourceLayer(
  baseLayer: Omit<Layer, 'source'>,
  nestedClip: TimelineClip,
  nestedClipLocalTime: number,
  ctx: FrameContext,
): Layer | null {
  if (nestedClip.source?.type === 'math-scene') {
    mathSceneRenderer.renderClip(nestedClip, nestedClipLocalTime);
    const textCanvas = nestedClip.source?.textCanvas;
    return textCanvas ? buildNestedTextSourceLayer(baseLayer, textCanvas) : null;
  }

  if (nestedClip.source?.type === 'transition-overlay') {
    return nestedClip.source.textCanvas ? buildNestedTextSourceLayer(baseLayer, nestedClip.source.textCanvas) : null;
  }

  if (!isVectorAnimationSourceType(nestedClip.source?.type)) {
    return null;
  }

  const textCanvas = vectorAnimationRuntimeManager.renderClipAtTime(
    nestedClip,
    nestedClip.startTime + nestedClipLocalTime,
    ctx.getInterpolatedVectorAnimationSettings(nestedClip.id, nestedClipLocalTime),
  );
  return textCanvas ? buildNestedTextSourceLayer(baseLayer, textCanvas) : null;
}
