import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { createDefaultBlockifyGraph, createDefaultBlockMosaicGraph } from './cellGridRecipes';

export type EditableBlockEffectType = 'blockify' | 'block-mosaic';
export { createDefaultBlockifyGraph, createDefaultBlockMosaicGraph };

export function createDefaultBlockEffectGraph(type: EditableBlockEffectType): EffectOperatorGraph {
  return type === 'blockify' ? createDefaultBlockifyGraph() : createDefaultBlockMosaicGraph();
}
