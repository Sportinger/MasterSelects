import type { Effect } from '../../types/effects';
import type { Keyframe } from '../../types/keyframes';
import { compileRuntimeColorGrade, ensureColorCorrectionState, getActiveColorVersion } from '../../types/colorCorrection';
import { interpolateKeyframes } from '../../utils/keyframeInterpolation';
import { createParameterSourceEvaluator } from './parameterSourceEvaluation';
import type { ParameterSourceClip } from './parameterSourceTargets';
import { parameterSourceTime } from './parameterSourceTime';
import type { ClipTransform } from '../../types/timelineCore';
import { isTransformParameterPath, writeTransformParameter } from './transformParameterTargets';
import { Logger } from '../logger';
import { getEffect } from '../../effects';

const log = Logger.create('ParameterSources');

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
    for (const [path] of entries) {
      const name = path.slice(prefix.length);
      params[name] = evaluator.resolve(path).value;
      dropKeyedRateTravel(effect, name, params);
    }
    return { ...effect, params };
  });
}

/** A rate a source drives (Speed, Spin) moves at rate × time: the travel integrated from its keyframes
 * would otherwise win and the source would be ignored without a word (EffectParam.integratedAs). */
function dropKeyedRateTravel(effect: Effect, name: string, params: Effect['params']): void {
  const travel = getEffect(effect.type)?.params[name]?.integratedAs;
  if (!travel || !(travel in params)) return;
  delete params[travel];
  const key = `${effect.id}\0${name}`;
  if (reportedSourceRates.has(key)) return;
  if (reportedSourceRates.size > 256) reportedSourceRates.clear();
  reportedSourceRates.add(key);
  log.warn(`${effect.name} ${name} is driven by a source, so it runs at ${name} × time; its keyframes do not set the travelled distance.`);
}
const reportedSourceRates = new Set<string>();

/**
 * Final transform override, AFTER keyframe interpolation and BEFORE inspector bypass and parenting.
 * Without an active transform binding the input object is returned unchanged. Like the existing
 * transform evaluation in export, a failing source keeps the interpolated value for that property
 * and reports the error; the Transform inspector shows the same diagnosis.
 */
export function applyParameterSourcesToTransform(clip: ParameterSourceClip, keys: readonly Keyframe[], time: number,
  transform: ClipTransform, timelineTime?: number): ClipTransform {
  const bindings = clip.nodeGraph?.parameterSources?.targets;
  if (!bindings) return transform;
  const active = Object.entries(bindings).filter(([path, binding]) => isTransformParameterPath(path)
    && binding.source && binding.enabled !== false);
  if (!active.length) return transform;
  const evaluator = createParameterSourceEvaluator(clip, keys, time, timelineTime);
  const result: ClipTransform = { ...transform };
  for (const [path] of active) {
    try { writeTransformParameter(result, path, evaluator.resolve(path).value); }
    catch (error) { reportTransformSourceError(clip.id, path, error); }
  }
  return result;
}

const reportedTransformErrors = new Set<string>();
function reportTransformSourceError(clipId: string | undefined, path: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const key = `${clipId ?? '?'}\0${path}\0${message}`;
  if (reportedTransformErrors.has(key)) return;
  if (reportedTransformErrors.size > 256) reportedTransformErrors.clear();
  reportedTransformErrors.add(key);
  log.warn(`Transform source ${path} of clip ${clipId ?? '?'} failed; keeping the keyframe value. ${message}`);
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
