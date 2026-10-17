import { useMemo } from 'react';
import { getGuideSnapPoints } from '../../services/compositionGuides';
import { useMediaStore } from '../../stores/mediaStore';
import type { AxisSnapPoints } from './editModeSnapping';

/**
 * Guides of the shown composition as layer snap targets, converted from
 * composition pixels to the preview's canvas-size units. Hidden guides
 * (`compositionId` null) do not snap.
 */
export function usePreviewGuideSnapPoints(
  compositionId: string | null,
  canvasSize: { width: number; height: number },
  compositionSize: { width: number; height: number },
): AxisSnapPoints | undefined {
  const guides = useMediaStore((state) => (
    compositionId ? state.compositions.find((composition) => composition.id === compositionId)?.guides : undefined
  ));
  return useMemo(() => {
    if (!guides?.length || !(compositionSize.width > 0 && compositionSize.height > 0)) return undefined;
    const points = getGuideSnapPoints(guides);
    const scaleX = canvasSize.width / compositionSize.width;
    const scaleY = canvasSize.height / compositionSize.height;
    return { x: points.x.map((x) => x * scaleX), y: points.y.map((y) => y * scaleY) };
  }, [canvasSize.height, canvasSize.width, compositionSize.height, compositionSize.width, guides]);
}
