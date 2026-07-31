import type { TimelineClip } from '../../../stores/timeline/types';
import { useTimelineStore } from '../../../stores/timeline';
import { vectorAnimationRuntimeManager } from '../../../services/vectorAnimation/VectorAnimationRuntimeManager';
import { isVectorAnimationSourceType } from '../../../types/vectorAnimation';
import { mathSceneRenderer } from '../../../services/mathScene/MathSceneRenderer';
import { textRenderer } from '../../../services/textRenderer';
import type { Layer } from '../../../types/layers';
import type { BaseLayerPropsLike, FrameContextLike } from './contracts';
import { getVectorAnimationSettingsForExport } from './sourceLookup';
import { renderCaptionTextClipFrame } from '../../../services/captions/captionTextRuntime';
import { getClipSourceWindowTime } from './timing';

function hasTextBoundsKeyframes(clipId: string): boolean {
  const state = useTimelineStore.getState();
  return state.hasKeyframes(clipId, 'textBounds.path')
    || state.hasKeyframes(clipId, 'textBounds.position.x')
    || state.hasKeyframes(clipId, 'textBounds.position.y');
}

export function isTextLikeClipSource(clip: TimelineClip): boolean {
  return (
    clip.source?.type === 'text' ||
    clip.source?.type === 'solid' ||
    isVectorAnimationSourceType(clip.source?.type) ||
    clip.source?.type === 'math-scene' ||
    clip.source?.type === 'transition-overlay'
  );
}

export function buildTextLikeLayer(
  clip: TimelineClip,
  clipLocalTime: number,
  renderTime: number,
  baseLayerProps: BaseLayerPropsLike,
  options: {
    ctx?: FrameContextLike;
    interpolateTextBounds: boolean;
  },
): Layer | null {
  let textCanvas: HTMLCanvasElement | undefined;
  if (isVectorAnimationSourceType(clip.source?.type)) {
    textCanvas = vectorAnimationRuntimeManager.renderClipAtTime(
      clip,
      renderTime,
      getVectorAnimationSettingsForExport(clip, clipLocalTime, options.ctx),
    ) ?? undefined;
  } else if (clip.source?.type === 'math-scene') {
    mathSceneRenderer.renderClip(clip, clipLocalTime);
    textCanvas = clip.source.textCanvas;
  } else if (clip.captionProperties && clip.source?.textCanvas) {
    const interpolatedTextBounds = options.ctx?.getInterpolatedTextBounds(clip.id, clipLocalTime);
    const hasBoundsKeyframes = hasTextBoundsKeyframes(clip.id);
    textCanvas = renderCaptionTextClipFrame({
      captionClip: clip,
      clips: options.ctx?.renderClipsAtTime ?? options.ctx?.clipsAtTime ?? [clip],
      tracks: options.ctx ? [...options.ctx.trackMap.values()] : [],
      timelineTime: renderTime,
      resolveSourceTime: options.ctx
        ? sourceClip => getClipSourceWindowTime(
            sourceClip,
            renderTime - sourceClip.startTime,
            options.ctx!,
          )
        : undefined,
      textPropertiesOverride: hasBoundsKeyframes && interpolatedTextBounds && clip.textProperties
        ? { ...clip.textProperties, boxEnabled: true, textBounds: interpolatedTextBounds }
        : undefined,
    }).canvas ?? undefined;
  } else if (clip.source?.textCanvas) {
    textCanvas = clip.source.type === 'text' && options.interpolateTextBounds
      ? getTextCanvasForExport(clip, clipLocalTime, options.ctx)
      : clip.source.textCanvas;
  }

  if (!textCanvas) {
    return null;
  }

  return {
    ...baseLayerProps,
    source: { type: 'text', textCanvas },
  };
}

function getTextCanvasForExport(
  clip: TimelineClip,
  clipLocalTime: number,
  ctx?: FrameContextLike,
): HTMLCanvasElement | undefined {
  const sourceCanvas = clip.source?.textCanvas;
  if (!sourceCanvas || !clip.textProperties) {
    return sourceCanvas;
  }

  const hasBoundsKeyframes = hasTextBoundsKeyframes(clip.id);
  if (!hasBoundsKeyframes) {
    return sourceCanvas;
  }

  const interpolatedTextBounds = ctx?.getInterpolatedTextBounds(clip.id, clipLocalTime);
  if (!interpolatedTextBounds) {
    return sourceCanvas;
  }

  const runtimeCanvas = textRenderer.createCanvas(sourceCanvas.width, sourceCanvas.height);
  textRenderer.render({
    ...clip.textProperties,
    boxEnabled: true,
    textBounds: interpolatedTextBounds,
  }, runtimeCanvas);
  return runtimeCanvas;
}
