import type { Layer } from '../core/types';
import type { VideoRotationDegrees } from '../webcodecs/videoTrackOrientation';

export function getVideoFrameEffectSourceRotation(
  layer: Pick<Layer, 'source'>,
): VideoRotationDegrees {
  return layer.source?.videoFrame
    ? layer.source.videoRotation ?? 0
    : 0;
}
