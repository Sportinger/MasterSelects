export type AudioEffectParamValue = number | boolean | string;
export type AudioEffectId = 'audio-volume' | 'audio-eq';

export interface AudioEffectParamDescriptor {
  name: string;
  default: AudioEffectParamValue;
}

export interface AudioEffectDescriptor {
  id: AudioEffectId;
  name: string;
  paramNames: readonly string[];
  params: Readonly<Record<string, AudioEffectParamDescriptor>>;
}

export const AUDIO_EQ_BAND_PARAMS = Object.freeze([
  'band31',
  'band62',
  'band125',
  'band250',
  'band500',
  'band1k',
  'band2k',
  'band4k',
  'band8k',
  'band16k',
]);

function createParamDescriptors(
  defaults: Record<string, AudioEffectParamValue>
): Readonly<Record<string, AudioEffectParamDescriptor>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(defaults).map(([name, defaultValue]) => [
        name,
        Object.freeze({ name, default: defaultValue }),
      ])
    )
  );
}

const AUDIO_VOLUME_DEFAULTS = {
  volume: 1,
} as const;

const AUDIO_EQ_DEFAULTS: Record<string, 0> = Object.fromEntries(
  AUDIO_EQ_BAND_PARAMS.map(paramName => [paramName, 0])
) as Record<string, 0>;

const AUDIO_EFFECT_DESCRIPTORS = [
  Object.freeze({
    id: 'audio-volume',
    name: 'Volume',
    paramNames: Object.freeze(Object.keys(AUDIO_VOLUME_DEFAULTS)),
    params: createParamDescriptors(AUDIO_VOLUME_DEFAULTS),
  }),
  Object.freeze({
    id: 'audio-eq',
    name: 'EQ',
    paramNames: AUDIO_EQ_BAND_PARAMS,
    params: createParamDescriptors(AUDIO_EQ_DEFAULTS),
  }),
] as const satisfies readonly AudioEffectDescriptor[];

export const AUDIO_EFFECT_REGISTRY: ReadonlyMap<AudioEffectId, AudioEffectDescriptor> = new Map(
  AUDIO_EFFECT_DESCRIPTORS.map(descriptor => [descriptor.id, descriptor])
);

export function getAudioEffect(id: string): AudioEffectDescriptor | undefined {
  return AUDIO_EFFECT_REGISTRY.get(id as AudioEffectId);
}

export function hasAudioEffect(id: string): id is AudioEffectId {
  return AUDIO_EFFECT_REGISTRY.has(id as AudioEffectId);
}

export function getAllAudioEffects(): AudioEffectDescriptor[] {
  return Array.from(AUDIO_EFFECT_REGISTRY.values());
}

export function getAudioEffectParamNames(id: string): string[] {
  return [...(getAudioEffect(id)?.paramNames ?? [])];
}

export function getAudioEffectDefaultParams(id: string): Record<string, AudioEffectParamValue> {
  const effect = getAudioEffect(id);
  if (!effect) return {};

  return Object.fromEntries(
    Object.entries(effect.params).map(([paramName, param]) => [paramName, param.default])
  );
}
