import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { createDefaultMirrorGraph, createDefaultRgbSplitGraph } from './mirrorRecipes';
import { createDefaultPixelateGraph } from './cellGridRecipes';

export type EditableSamplingEffectType = 'pixelate' | 'mirror' | 'rgb-split';
export { createDefaultMirrorGraph, createDefaultPixelateGraph, createDefaultRgbSplitGraph };

export function createDefaultSamplingEffectGraph(type: EditableSamplingEffectType): EffectOperatorGraph {
  if (type === 'pixelate') return createDefaultPixelateGraph();
  if (type === 'mirror') return createDefaultMirrorGraph();
  return createDefaultRgbSplitGraph();
}
