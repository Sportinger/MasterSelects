import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { createDefaultKaleidoscopeGraph } from './mirrorRecipes';
import { createDefaultBulgeGraph, createDefaultTwirlGraph, createDefaultWaveGraph } from './uvDistortRecipes';

export type EditableUvDistortEffectType = 'wave' | 'twirl' | 'bulge' | 'kaleidoscope';

export function createDefaultUvDistortGraph(type: EditableUvDistortEffectType): EffectOperatorGraph {
  if (type !== 'kaleidoscope') return type === 'wave' ? createDefaultWaveGraph() : type === 'twirl' ? createDefaultTwirlGraph() : createDefaultBulgeGraph();
  return createDefaultKaleidoscopeGraph();
}
