import {
  paintStoryboardCardRenderPayload,
  type StoryboardCardCanvasContext,
} from './storyboardCardPainter';
import type { StoryboardCardRenderPayload } from './storyboardCardRenderPayload';

export function paintStoryboardCardMainThread(
  context: StoryboardCardCanvasContext,
  payload: StoryboardCardRenderPayload,
): void {
  paintStoryboardCardRenderPayload(context, payload);
}

export function paintStoryboardCardWorker(
  context: StoryboardCardCanvasContext,
  payload: StoryboardCardRenderPayload,
): void {
  paintStoryboardCardRenderPayload(context, payload);
}
