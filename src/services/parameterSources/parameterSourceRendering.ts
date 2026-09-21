import type { Effect } from '../../types/effects';
import type { Keyframe } from '../../types/keyframes';
import { compileRuntimeColorGrade, ensureColorCorrectionState, getActiveColorVersion } from '../../types/colorCorrection';
import { interpolateKeyframes } from '../../utils/keyframeInterpolation';
import { createParameterSourceEvaluator } from './parameterSourceEvaluation';
import type { ParameterSourceClip } from './parameterSourceTargets';
import { parameterSourceTime } from './parameterSourceTime';

/** Final parameter override, AFTER legacy interpolation and BEFORE packing/rendering. */
export function applyParameterSourcesToEffects(clip: ParameterSourceClip, keys: readonly Keyframe[], time: number,
  effects: Effect[], timelineTime?: number): Effect[] {
  const bindings = clip.nodeGraph?.parameterSources?.targets;
  if (!bindings || !Object.keys(bindings).some(path => path.startsWith('effect.'))) return effects;
  const evaluator = createParameterSourceEvaluator(clip, keys, time, timelineTime);
  return effects.map(effect => {
    if (effect.enabled === false) return effect;
    const prefix = `effect.${effect.id}.`;
    const entries = Object.entries(bindings).filter(([path, binding]) => path.startsWith(prefix)
      && ((binding.source && binding.enabled !== false) || binding.localMode === 'constant'));
    if (!entries.length) return effect;
    const params = { ...effect.params };
    for (const [path] of entries) params[path.slice(prefix.length)] = evaluator.resolve(path).value;
    return { ...effect, params };
  });
}

/** The same pure grade calculation serves timeline, nested compositions and export. */
export function evaluateParameterSourceColorState(clip: ParameterSourceClip, keys: readonly Keyframe[], time: number,
  timelineTime?: number) {
  if (!clip.colorCorrection) return undefined;
  const state = ensureColorCorrectionState(clip.colorCorrection);
  if (!state.enabled) return state;
  const version = getActiveColorVersion(state);
  if (!version) return state;
  const evaluator = createParameterSourceEvaluator(clip, keys, time, timelineTime);
  const bindings = clip.nodeGraph?.parameterSources?.targets;
  const clock = parameterSourceTime(clip, keys, time, timelineTime);
  for (const node of version.nodes) {
    if (node.enabled === false) continue;
    for (const [name, base] of Object.entries(node.params)) {
      if (typeof base !== 'number') continue;
      const path = `color.${version.id}.${node.id}.${name}`;
      const binding = bindings?.[path];
      node.params[name] = binding && ((binding.source && binding.enabled !== false) || binding.localMode === 'constant')
        ? evaluator.resolve(path).value
        : interpolateKeyframes(clock.keys as Keyframe[], path as Keyframe['property'], clock.localTime, base);
    }
  }
  return state;
}

export function evaluateParameterSourceColorGrade(clip: ParameterSourceClip, keys: readonly Keyframe[], time: number,
  timelineTime?: number) {
  return compileRuntimeColorGrade(evaluateParameterSourceColorState(clip, keys, time, timelineTime));
}
