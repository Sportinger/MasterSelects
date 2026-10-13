import type { Layer, LayerRenderData } from '../../core/types';
import { getOrientedVideoDimensions } from '../../webcodecs/videoTrackOrientation';
import type { WebCodecsFrameProvider } from './collectionPredicates';

/** Keep the borrowed frame and its display orientation together for compositing/effects. */
export function providerFramePresentation(
  layer: Layer,
  frame: VideoFrame,
  provider: WebCodecsFrameProvider | null,
): Pick<LayerRenderData, 'layer' | 'sourceWidth' | 'sourceHeight'> {
  const rotation = provider?.getSourceRotationDegrees?.() ?? layer.source?.videoRotation ?? 0;
  const size = getOrientedVideoDimensions(frame.displayWidth, frame.displayHeight, rotation);
  return {
    layer: { ...layer, source: { ...layer.source!, videoFrame: frame, videoRotation: rotation } },
    sourceWidth: size.width,
    sourceHeight: size.height,
  };
}
