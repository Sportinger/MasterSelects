import type { TimelineClip } from '../../types/timeline';
import { isColorGradeNode, parseColorProperty, RUNTIME_COLOR_PARAM_DEFS } from '../../types/colorCorrection';
import { HUE_SHIFT_PARAMS } from '../../effects/color/remainingColorParams';
import { GAUSSIAN_BLUR_PARAMS } from '../../effects/blur/gaussian/params';

export interface ParameterSourceTarget {
  path: string;
  label: string;
  group: string;
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  hardMin?: number;
  hardMax?: number;
}

export type ParameterSourceClip = Pick<TimelineClip, 'effects' | 'colorCorrection' | 'nodeGraph' | 'startTime'>
  & Partial<Pick<TimelineClip, 'transitionSourceMap'>>;

/** Explicit consumer capabilities, not a promise that every numeric property is drivable. */
export function parameterSourceTargets(clip: ParameterSourceClip): ParameterSourceTarget[] {
  const targets: ParameterSourceTarget[] = [];
  for (const version of clip.colorCorrection?.versions ?? []) {
    for (const node of version.nodes.filter(isColorGradeNode)) {
      for (const def of RUNTIME_COLOR_PARAM_DEFS) {
        const stored = node.params[def.key];
        targets.push({ ...def, path: `color.${version.id}.${node.id}.${def.key}`,
          group: `Color ${version.name} / ${node.name}`, value: typeof stored === 'number' ? stored : def.defaultValue,
          unit: def.key === 'hue' ? 'degrees' : def.key === 'exposure' ? 'stops' : 'number' });
      }
    }
  }
  for (const effect of clip.effects) {
    const entry = effect.type === 'hue-shift' ? { name: 'shift', def: HUE_SHIFT_PARAMS.shift, unit: 'turns' }
      : effect.type === 'gaussian-blur' ? { name: 'radius', def: GAUSSIAN_BLUR_PARAMS.radius, unit: 'pixels' } : undefined;
    if (!entry) continue;
    const { name, def, unit } = entry;
    const stored = effect.params[name];
    targets.push({ path: `effect.${effect.id}.${name}`, label: def.label, group: effect.name,
      value: typeof stored === 'number' ? stored : Number(def.default), defaultValue: Number(def.default),
      min: def.min ?? 0, max: def.max ?? 1, step: def.step ?? 0.01, unit,
      ...(effect.type === 'gaussian-blur' ? { hardMin: 0 } : {}) });
  }
  return targets;
}

export function getParameterSourceTarget(clip: ParameterSourceClip, property: string): ParameterSourceTarget | undefined {
  if (!parseColorProperty(property) && !property.startsWith('effect.')) return undefined;
  return parameterSourceTargets(clip).find(target => target.path === property);
}

export function isParameterNodeDriven(clip: ParameterSourceClip, property: string): boolean {
  const binding = clip.nodeGraph?.parameterSources?.targets[property];
  return Boolean(binding?.source && binding.enabled !== false);
}
