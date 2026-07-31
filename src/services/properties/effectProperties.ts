
import type { Effect as TimelineEffect } from '../../types/effects';
import type { TimelineClip } from '../../types/timeline';
import type { EffectDefinition, EffectParam } from '../../effects/types';
import { getAllEffects, getEffect } from '../../effects';
import type { PropertyDescriptor, PropertyValueType } from '../../types/propertyRegistry';
import type { PropertyRegistry } from './PropertyRegistry';

function mapEffectParamType(param: EffectParam): PropertyValueType {
  if (param.type === 'boolean') return 'boolean';
  if (param.type === 'select') return 'enum';
  if (param.type === 'color') return 'color';
  if (param.type === 'point') return 'vector2';
  return 'number';
}

function isEffectParamAnimatable(param: EffectParam): boolean {
  if (param.animatable !== undefined) return param.animatable;
  return param.type === 'number' || param.type === 'color' || param.type === 'point';
}

function createEffectDescriptor(
  effectDefinition: EffectDefinition,
  effect: TimelineEffect | undefined,
  paramName: string,
  param: EffectParam,
): PropertyDescriptor {
  const effectId = effect?.id ?? effectDefinition.id;
  const effectName = effect?.name || effectDefinition.name;
  return {
    path: `effect.${effectId}.${paramName}`,
    label: param.label,
    group: `Effects / ${effectName}`,
    valueType: mapEffectParamType(param),
    animatable: isEffectParamAnimatable(param),
    defaultValue: param.default,
    catalogOnly: effect === undefined,
    ui: {
      min: param.min,
      max: param.max,
      step: param.step,
      aliases: [effectDefinition.name, effectDefinition.id, paramName],
      options: param.options,
    },
    read: (clip) => {
      const current = clip.effects.find((candidate) => candidate.id === effectId);
      return current?.params[paramName] ?? param.default;
    },
    write: (clip, value) => ({
      ...clip,
      effects: clip.effects.map((candidate) => (
        candidate.id === effectId
          ? { ...candidate, params: { ...candidate.params, [paramName]: value as number | boolean | string } }
          : candidate
      )),
    }),
  };
}

export function getEffectDescriptorForPath(path: string, clip?: TimelineClip): PropertyDescriptor | undefined {
  const parts = path.split('.');
  if (parts.length !== 3 || parts[0] !== 'effect' || !clip) return undefined;

  const [, effectId, paramName] = parts;
  const effect = clip.effects.find((candidate) => candidate.id === effectId);
  if (!effect) return undefined;

  const effectDefinition = getEffect(effect.type);
  const param = effectDefinition?.params[paramName];
  return effectDefinition && param
    ? createEffectDescriptor(effectDefinition, effect, paramName, param)
    : undefined;
}

export function getEffectDescriptorsForClip(clip: TimelineClip): PropertyDescriptor[] {
  return clip.effects.flatMap((effect) => {
    const effectDefinition = getEffect(effect.type);
    if (!effectDefinition) return [];

    return Object.entries(effectDefinition.params).map(([paramName, param]) =>
      createEffectDescriptor(effectDefinition, effect, paramName, param)
    );
  });
}

export function registerEffectTemplates(registry: PropertyRegistry): void {
  getAllEffects().forEach((effectDefinition) => {
    Object.entries(effectDefinition.params).forEach(([paramName, param]) => {
      registry.register(createEffectDescriptor(effectDefinition, undefined, paramName, param));
    });
  });
}
