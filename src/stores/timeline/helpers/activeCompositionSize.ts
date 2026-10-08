import { useMediaStore } from '../../mediaStore';
import {
  compositionPixelSizeOf,
  type CompositionPixelSize,
} from '../../../utils/parentPositionFrame';

/**
 * Pixel size of the composition the live timeline edits. Live-timeline 2D
 * positions are normalized against it, so parent rotation needs it to turn
 * children rigidly on non-square compositions.
 */
export function getActiveCompositionPixelSize(): CompositionPixelSize | undefined {
  const { compositions, activeCompositionId } = useMediaStore.getState();
  return compositionPixelSizeOf(
    compositions.find((candidate) => candidate.id === activeCompositionId),
  );
}
