import type { Effect } from '../../types/effects';
import { STICK_FIGURE_PARAMS } from '../../effects/generate/stickFigure/params';
import { isSkeletonAngleKey } from '../rig/skeletonRig';
import type { ParameterSourceTarget } from './parameterSourceTargets';

export const STICK_FIGURE_EFFECT_TYPE = 'stick-figure';

/**
 * Every numeric Stick Figure parameter can be driven: joint angles in degrees (so IK and Gait Cycle
 * outputs connect directly), lengths and offsets in figure pixels. No hard limits: lengths are
 * clamped by the rig, so a driven value never fails at render time.
 */
export function stickFigureParameterTargets(effect: Pick<Effect, 'id' | 'name' | 'params'>): ParameterSourceTarget[] {
  return Object.entries(STICK_FIGURE_PARAMS).flatMap(([name, definition]) => {
    if (definition.type !== 'number') return [];
    const stored = effect.params[name];
    const fallback = definition.default as number;
    return [{
      path: `effect.${effect.id}.${name}`, label: definition.label, group: effect.name,
      value: typeof stored === 'number' && Number.isFinite(stored) ? stored : fallback, defaultValue: fallback,
      min: definition.min ?? -1000, max: definition.max ?? 1000, step: definition.step ?? 1,
      unit: isSkeletonAngleKey(name) ? 'degrees' : name === 'opacity' ? 'number' : 'pixels',
    }];
  });
}
