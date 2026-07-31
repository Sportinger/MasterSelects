import { paintStoryboardAnimaticFramePayload, type StoryboardAnimaticCanvasContext } from './renderPayload';
import type { StoryboardAnimaticFramePayload } from './types';

export function renderStoryboardAnimaticExportFrame(
  context: StoryboardAnimaticCanvasContext,
  payload: StoryboardAnimaticFramePayload,
  image?: CanvasImageSource,
): void {
  paintStoryboardAnimaticFramePayload(context, payload, image);
}
