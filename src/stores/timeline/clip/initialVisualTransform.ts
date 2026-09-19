import type { TimelineClip } from '../../../types/timeline';
import {
  calculateFillToFrameScale,
  calculateFitToFrameScale,
  calculateStretchToFrameScale,
} from '../../../utils/sourcePixelScale';
import { DEFAULT_TRANSFORM } from '../constants';
import type { AddClipOptions } from '../types';

export function resolveInitialVisualTransform(
  options: AddClipOptions | undefined,
  source: { width?: number; height?: number } | undefined,
  composition: { width: number; height: number } | undefined,
): TimelineClip['transform'] {
  const mode = options?.visualScaleMode;
  let scale = { x: 1, y: 1 };
  if (mode && mode !== 'original' && source?.width && source.height && composition) {
    if (mode === 'stretch') {
      scale = calculateStretchToFrameScale(
        source.width,
        source.height,
        composition.width,
        composition.height,
      );
    } else {
      const uniformScale = mode === 'fill'
        ? calculateFillToFrameScale(source.width, source.height, composition.width, composition.height)
        : calculateFitToFrameScale(source.width, source.height, composition.width, composition.height);
      scale = { x: uniformScale, y: uniformScale };
    }
  }
  return {
    ...DEFAULT_TRANSFORM,
    position: { ...DEFAULT_TRANSFORM.position },
    scale,
    rotation: { ...DEFAULT_TRANSFORM.rotation },
  };
}
