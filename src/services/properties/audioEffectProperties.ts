import {
  getAudioEffect,
  type AudioEffectDescriptor,
  type AudioEffectParamDescriptor,
} from '../../engine/audio/AudioEffectRegistry';
import type { AudioEffectInstance, AudioEffectParamValue } from '../../types/audio';
import type { Effect } from '../../types/effects';
import type { TimelineClip } from '../../types/timeline';
import type {
  PropertyDescriptor,
  PropertyValue,
  PropertyValueType,
} from '../../types/propertyRegistry';

type ClipAudioEffect = Effect | AudioEffectInstance;

function getDescriptorId(effect: ClipAudioEffect): string {
  return 'descriptorId' in effect ? effect.descriptorId : effect.type;
}

function getClipAudioEffects(clip: TimelineClip): ClipAudioEffect[] {
  const effects: ClipAudioEffect[] = [...clip.effects];
  const seenIds = new Set(effects.map((effect) => effect.id));
  for (const effect of clip.audioState?.effectStack ?? []) {
    if (!seenIds.has(effect.id)) effects.push(effect);
  }
  return effects;
}

function isAudioEffectParamValue(value: unknown): value is AudioEffectParamValue {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.every(isAudioEffectParamValue);
  if (typeof value === 'object') return Object.values(value).every(isAudioEffectParamValue);
  return false;
}

function mapAudioParamType(param: AudioEffectParamDescriptor): PropertyValueType {
  if (param.options?.length) return 'enum';
  if (typeof param.default === 'number') return 'number';
  if (typeof param.default === 'boolean') return 'boolean';
  return 'enum';
}

function humanizeParamName(paramName: string): string {
  return paramName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (first) => first.toUpperCase());
}

function getNumericUi(
  descriptor: AudioEffectDescriptor,
  paramName: string,
): PropertyDescriptor['ui'] {
  if (descriptor.id === 'audio-volume' && paramName === 'volume') {
    return { min: 0, max: 2, step: 0.01, unit: '%', aliases: ['gain', 'level'] };
  }
  if (descriptor.id === 'audio-pan' && paramName === 'pan') {
    return { min: -1, max: 1, step: 0.01, aliases: ['balance'] };
  }
  return { aliases: [descriptor.name, descriptor.id, paramName] };
}

function updateAudioEffectParams(
  clip: TimelineClip,
  effectId: string,
  paramName: string,
  value: PropertyValue,
): TimelineClip {
  if (!isAudioEffectParamValue(value)) return clip;

  const legacyIndex = clip.effects.findIndex((effect) => effect.id === effectId);
  if (legacyIndex >= 0) {
    return {
      ...clip,
      effects: clip.effects.map((effect, index) => index === legacyIndex
        ? { ...effect, params: { ...effect.params, [paramName]: value } }
        : effect),
    };
  }

  const effectStack = clip.audioState?.effectStack;
  if (!effectStack?.some((effect) => effect.id === effectId)) return clip;
  return {
    ...clip,
    audioState: {
      ...clip.audioState,
      effectStack: effectStack.map((effect) => effect.id === effectId
        ? { ...effect, params: { ...effect.params, [paramName]: value } }
        : effect),
    },
  };
}

function createAudioEffectDescriptor(
  descriptor: AudioEffectDescriptor,
  effect: ClipAudioEffect,
  paramName: string,
  param: AudioEffectParamDescriptor,
): PropertyDescriptor {
  const valueType = mapAudioParamType(param);
  const aliases = getNumericUi(descriptor, paramName)?.aliases ?? [];
  return {
    path: `effect.${effect.id}.${paramName}`,
    label: descriptor.id === 'audio-volume' && paramName === 'volume'
      ? 'Volume'
      : humanizeParamName(paramName),
    group: `Audio / ${descriptor.name}`,
    valueType,
    animatable: descriptor.automation !== 'none' && valueType === 'number',
    defaultValue: param.default,
    ui: {
      ...getNumericUi(descriptor, paramName),
      aliases: [...new Set([descriptor.name, descriptor.id, paramName, ...aliases])],
      ...(param.options?.length
        ? { options: param.options.map((value) => ({ value, label: value })) }
        : {}),
    },
    read: (clip) => getClipAudioEffects(clip)
      .find((candidate) => candidate.id === effect.id)
      ?.params[paramName] ?? param.default,
    write: (clip, value) => updateAudioEffectParams(clip, effect.id, paramName, value),
  };
}

function resolveAudioEffect(
  clip: TimelineClip,
  effectId: string,
): { effect: ClipAudioEffect; descriptor: AudioEffectDescriptor } | null {
  const effect = getClipAudioEffects(clip).find((candidate) => candidate.id === effectId);
  if (!effect) return null;
  const descriptor = getAudioEffect(getDescriptorId(effect));
  return descriptor ? { effect, descriptor } : null;
}

export function getAudioEffectDescriptorForPath(
  path: string,
  clip?: TimelineClip,
): PropertyDescriptor | undefined {
  const parts = path.split('.');
  if (parts.length !== 3 || parts[0] !== 'effect' || !clip) return undefined;
  const [, effectId, paramName] = parts;
  const resolved = resolveAudioEffect(clip, effectId);
  const param = resolved?.descriptor.params[paramName];
  return resolved && param
    ? createAudioEffectDescriptor(resolved.descriptor, resolved.effect, paramName, param)
    : undefined;
}

export function getAudioEffectDescriptorsForClip(clip: TimelineClip): PropertyDescriptor[] {
  return getClipAudioEffects(clip).flatMap((effect) => {
    const descriptor = getAudioEffect(getDescriptorId(effect));
    if (!descriptor) return [];
    return descriptor.paramNames.flatMap((paramName) => {
      const param = descriptor.params[paramName];
      return param
        ? [createAudioEffectDescriptor(descriptor, effect, paramName, param)]
        : [];
    });
  });
}
