import type { Layer } from '../../../types';
import { canvasPlacement, type CanvasPlacement } from '../../../utils/photoCanvasPlacement';
export { canvasPlacement, type CanvasPlacement } from '../../../utils/photoCanvasPlacement';

/** Expands only the render description; authored clip placement and bypass behavior remain intact. */
export function prepareCanvasEdgeFill(layer: Layer, effects: Layer['effects'], sourceWidth: number, sourceHeight: number,
  width: number, height: number, skipEffects: boolean) {
  const fill = !skipEffects && layer.source?.type === 'image' && effects.find(effect => effect.enabled
    && effect.type === 'ai-edge-fill' && effect.params.canvasSpace === true && effect.params.artifactId);
  if (!fill) return null;
  let matrix: CanvasPlacement;
  try { matrix = canvasPlacement(layer, sourceWidth, sourceHeight, width, height); } catch { return null; }
  return {
    layer: { ...layer, position: { x: 0, y: 0, z: 0 }, anchor: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: { x: 0, y: 0, z: 0 } },
    effects: effects.map(effect => effect === fill ? { ...effect, params: { ...effect.params, canvasWidth: width,
      ...Object.fromEntries(matrix.map((value, i) => [`placement${i}`, value])) } } : effect),
  };
}
