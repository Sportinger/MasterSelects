import type { AudioEffectParamValue } from '../../types/audio';

export type { AudioEffectParamValue };
export type AudioEffectId =
  | 'audio-volume'
  | 'audio-pan'
  | 'audio-normalize'
  | 'audio-eq'
  | 'audio-parametric-eq'
  | 'audio-high-pass'
  | 'audio-low-pass'
  | 'audio-hum-notch'
  | 'audio-de-click'
  | 'audio-noise-reduction'
  | 'audio-spectral-gate'
  | 'audio-compressor'
  | 'audio-de-esser'
  | 'audio-limiter'
  | 'audio-noise-gate'
  | 'audio-expander'
  | 'audio-delay'
  | 'audio-reverb'
  | 'audio-saturation'
  | 'audio-polarity-invert'
  | 'audio-mono-sum'
  | 'audio-channel-swap'
  | 'audio-stereo-split';

export interface AudioEffectParamDescriptor {
  name: string;
  default: AudioEffectParamValue;
  options?: readonly string[];
}

export interface AudioEffectDescriptor {
  id: AudioEffectId;
  name: string;
  category?: 'gain' | 'eq' | 'filter' | 'dynamics' | 'time' | 'distortion' | 'utility' | 'repair' | 'spectral';
  automation?: 'none' | 'clip' | 'track' | 'sample-accurate';
  latencySamples?: number;
  tailSeconds?: number;
  defaultAudible?: boolean;
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
  defaults: Record<string, AudioEffectParamValue>,
  options: Partial<Record<string, readonly string[]>> = {},
): Readonly<Record<string, AudioEffectParamDescriptor>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(defaults).map(([name, defaultValue]) => [
        name,
        Object.freeze({
          name,
          default: defaultValue,
          ...(options[name] ? { options: Object.freeze([...(options[name] ?? [])]) } : {}),
        }),
      ])
    )
  );
}

const AUDIO_VOLUME_DEFAULTS = {
  volume: 1,
} as const;

const AUDIO_PAN_DEFAULTS = {
  pan: 0,
} as const;

const AUDIO_NORMALIZE_MODE_OPTIONS = ['peak', 'rms', 'lufs'] as const;
const AUDIO_NORMALIZE_DEFAULTS = {
  mode: 'peak',
  targetPeakDb: -1,
  targetRmsDb: -18,
  targetLufs: -23,
  truePeakCeilingDb: -1,
  maxGainDb: 24,
  allowBoost: true,
} as const;

const AUDIO_EQ_DEFAULTS: Record<string, 0> = Object.fromEntries(
  AUDIO_EQ_BAND_PARAMS.map(paramName => [paramName, 0])
) as Record<string, 0>;

const AUDIO_PARAMETRIC_EQ_DEFAULTS = {
  frequencyHz: 1000,
  gainDb: 0,
  q: 1,
} as const;

const AUDIO_HIGH_PASS_DEFAULTS = {
  frequencyHz: 20,
  q: 0.707,
} as const;

const AUDIO_LOW_PASS_DEFAULTS = {
  frequencyHz: 22000,
  q: 0.707,
} as const;

const AUDIO_HUM_NOTCH_DEFAULTS = {
  frequencyHz: 50,
  q: 30,
  harmonics: 2,
  mix: 1,
} as const;

const AUDIO_DE_CLICK_DEFAULTS = {
  threshold: 0.35,
  ratio: 4,
  mix: 1,
} as const;

const AUDIO_NOISE_REDUCTION_DEFAULTS = {
  thresholdDb: -60,
  reductionDb: 0,
  sensitivity: 1,
  attackMs: 5,
  releaseMs: 160,
  mix: 0,
} as const;

const AUDIO_SPECTRAL_GATE_DEFAULTS = {
  thresholdDb: -60,
  reductionDb: 0,
  lowFrequencyHz: 250,
  highFrequencyHz: 5000,
  attackMs: 8,
  releaseMs: 180,
  mix: 1,
} as const;

const AUDIO_COMPRESSOR_DEFAULTS = {
  thresholdDb: 0,
  ratio: 1,
  kneeDb: 0,
  attackMs: 10,
  releaseMs: 120,
  makeupGainDb: 0,
} as const;

const AUDIO_DE_ESSER_DEFAULTS = {
  frequencyHz: 6500,
  thresholdDb: 0,
  ratio: 1,
  kneeDb: 6,
  attackMs: 1,
  releaseMs: 80,
  makeupGainDb: 0,
} as const;

const AUDIO_LIMITER_DEFAULTS = {
  ceilingDb: 0,
  inputGainDb: 0,
} as const;

const AUDIO_NOISE_GATE_DEFAULTS = {
  thresholdDb: -120,
  floorDb: -80,
  attackMs: 2,
  releaseMs: 80,
} as const;

const AUDIO_EXPANDER_DEFAULTS = {
  thresholdDb: 0,
  ratio: 1,
  rangeDb: 0,
  attackMs: 2,
  releaseMs: 120,
} as const;

const AUDIO_DELAY_DEFAULTS = {
  delayMs: 250,
  feedback: 0,
  mix: 0,
  toneHz: 12000,
} as const;

const AUDIO_REVERB_DEFAULTS = {
  roomSize: 0.35,
  decaySeconds: 1.2,
  damping: 0.35,
  mix: 0,
} as const;

const AUDIO_SATURATION_DEFAULTS = {
  driveDb: 0,
  toneHz: 16000,
  mix: 0,
} as const;

const AUDIO_POLARITY_INVERT_DEFAULTS = {
  channelMode: 'all',
} as const;

const AUDIO_MONO_SUM_DEFAULTS = {} as const;
const AUDIO_CHANNEL_SWAP_DEFAULTS = {} as const;
const AUDIO_STEREO_SPLIT_DEFAULTS = {
  sourceChannel: 0,
} as const;

const AUDIO_EFFECT_DESCRIPTORS = [
  Object.freeze({
    id: 'audio-volume',
    name: 'Volume',
    category: 'gain',
    automation: 'sample-accurate',
    latencySamples: 0,
    tailSeconds: 0,
    paramNames: Object.freeze(Object.keys(AUDIO_VOLUME_DEFAULTS)),
    params: createParamDescriptors(AUDIO_VOLUME_DEFAULTS),
  }),
  Object.freeze({
    id: 'audio-pan',
    name: 'Pan',
    category: 'gain',
    automation: 'sample-accurate',
    latencySamples: 0,
    tailSeconds: 0,
    paramNames: Object.freeze(Object.keys(AUDIO_PAN_DEFAULTS)),
    params: createParamDescriptors(AUDIO_PAN_DEFAULTS),
  }),
  Object.freeze({
    id: 'audio-normalize',
    name: 'Normalize',
    category: 'gain',
    automation: 'none',
    latencySamples: 0,
    tailSeconds: 0,
    defaultAudible: true,
    paramNames: Object.freeze(Object.keys(AUDIO_NORMALIZE_DEFAULTS)),
    params: createParamDescriptors(AUDIO_NORMALIZE_DEFAULTS, {
      mode: AUDIO_NORMALIZE_MODE_OPTIONS,
    }),
  }),
  Object.freeze({
    id: 'audio-eq',
    name: 'EQ',
    category: 'eq',
    automation: 'sample-accurate',
    latencySamples: 0,
    tailSeconds: 0,
    paramNames: AUDIO_EQ_BAND_PARAMS,
    params: createParamDescriptors(AUDIO_EQ_DEFAULTS),
  }),
  Object.freeze({
    id: 'audio-parametric-eq',
    name: 'Parametric EQ',
    category: 'eq',
    automation: 'sample-accurate',
    latencySamples: 0,
    tailSeconds: 0,
    paramNames: Object.freeze(Object.keys(AUDIO_PARAMETRIC_EQ_DEFAULTS)),
    params: createParamDescriptors(AUDIO_PARAMETRIC_EQ_DEFAULTS),
  }),
  Object.freeze({
    id: 'audio-high-pass',
    name: 'High Pass Filter',
    category: 'filter',
    automation: 'sample-accurate',
    latencySamples: 0,
    tailSeconds: 0,
    paramNames: Object.freeze(Object.keys(AUDIO_HIGH_PASS_DEFAULTS)),
    params: createParamDescriptors(AUDIO_HIGH_PASS_DEFAULTS),
  }),
  Object.freeze({
    id: 'audio-low-pass',
    name: 'Low Pass Filter',
    category: 'filter',
    automation: 'sample-accurate',
    latencySamples: 0,
    tailSeconds: 0,
    paramNames: Object.freeze(Object.keys(AUDIO_LOW_PASS_DEFAULTS)),
    params: createParamDescriptors(AUDIO_LOW_PASS_DEFAULTS),
  }),
  Object.freeze({
    id: 'audio-hum-notch',
    name: 'Hum Notch',
    category: 'repair',
    automation: 'clip',
    latencySamples: 0,
    tailSeconds: 0,
    defaultAudible: true,
    paramNames: Object.freeze(Object.keys(AUDIO_HUM_NOTCH_DEFAULTS)),
    params: createParamDescriptors(AUDIO_HUM_NOTCH_DEFAULTS),
  }),
  Object.freeze({
    id: 'audio-de-click',
    name: 'De-click',
    category: 'repair',
    automation: 'clip',
    latencySamples: 0,
    tailSeconds: 0,
    defaultAudible: true,
    paramNames: Object.freeze(Object.keys(AUDIO_DE_CLICK_DEFAULTS)),
    params: createParamDescriptors(AUDIO_DE_CLICK_DEFAULTS),
  }),
  Object.freeze({
    id: 'audio-noise-reduction',
    name: 'Noise Reduction',
    category: 'repair',
    automation: 'clip',
    latencySamples: 0,
    tailSeconds: 0,
    paramNames: Object.freeze(Object.keys(AUDIO_NOISE_REDUCTION_DEFAULTS)),
    params: createParamDescriptors(AUDIO_NOISE_REDUCTION_DEFAULTS),
  }),
  Object.freeze({
    id: 'audio-spectral-gate',
    name: 'Spectral Gate',
    category: 'spectral',
    automation: 'clip',
    latencySamples: 0,
    tailSeconds: 0,
    paramNames: Object.freeze(Object.keys(AUDIO_SPECTRAL_GATE_DEFAULTS)),
    params: createParamDescriptors(AUDIO_SPECTRAL_GATE_DEFAULTS),
  }),
  Object.freeze({
    id: 'audio-compressor',
    name: 'Compressor',
    category: 'dynamics',
    automation: 'sample-accurate',
    latencySamples: 0,
    tailSeconds: 0,
    paramNames: Object.freeze(Object.keys(AUDIO_COMPRESSOR_DEFAULTS)),
    params: createParamDescriptors(AUDIO_COMPRESSOR_DEFAULTS),
  }),
  Object.freeze({
    id: 'audio-de-esser',
    name: 'De-esser',
    category: 'dynamics',
    automation: 'sample-accurate',
    latencySamples: 0,
    tailSeconds: 0,
    paramNames: Object.freeze(Object.keys(AUDIO_DE_ESSER_DEFAULTS)),
    params: createParamDescriptors(AUDIO_DE_ESSER_DEFAULTS),
  }),
  Object.freeze({
    id: 'audio-limiter',
    name: 'Limiter',
    category: 'dynamics',
    automation: 'clip',
    latencySamples: 0,
    tailSeconds: 0,
    paramNames: Object.freeze(Object.keys(AUDIO_LIMITER_DEFAULTS)),
    params: createParamDescriptors(AUDIO_LIMITER_DEFAULTS),
  }),
  Object.freeze({
    id: 'audio-noise-gate',
    name: 'Noise Gate',
    category: 'dynamics',
    automation: 'clip',
    latencySamples: 0,
    tailSeconds: 0,
    paramNames: Object.freeze(Object.keys(AUDIO_NOISE_GATE_DEFAULTS)),
    params: createParamDescriptors(AUDIO_NOISE_GATE_DEFAULTS),
  }),
  Object.freeze({
    id: 'audio-expander',
    name: 'Expander',
    category: 'dynamics',
    automation: 'clip',
    latencySamples: 0,
    tailSeconds: 0,
    paramNames: Object.freeze(Object.keys(AUDIO_EXPANDER_DEFAULTS)),
    params: createParamDescriptors(AUDIO_EXPANDER_DEFAULTS),
  }),
  Object.freeze({
    id: 'audio-delay',
    name: 'Delay',
    category: 'time',
    automation: 'clip',
    latencySamples: 0,
    tailSeconds: 2,
    paramNames: Object.freeze(Object.keys(AUDIO_DELAY_DEFAULTS)),
    params: createParamDescriptors(AUDIO_DELAY_DEFAULTS),
  }),
  Object.freeze({
    id: 'audio-reverb',
    name: 'Reverb',
    category: 'time',
    automation: 'clip',
    latencySamples: 0,
    tailSeconds: 3,
    paramNames: Object.freeze(Object.keys(AUDIO_REVERB_DEFAULTS)),
    params: createParamDescriptors(AUDIO_REVERB_DEFAULTS),
  }),
  Object.freeze({
    id: 'audio-saturation',
    name: 'Saturation',
    category: 'distortion',
    automation: 'clip',
    latencySamples: 0,
    tailSeconds: 0,
    paramNames: Object.freeze(Object.keys(AUDIO_SATURATION_DEFAULTS)),
    params: createParamDescriptors(AUDIO_SATURATION_DEFAULTS),
  }),
  Object.freeze({
    id: 'audio-polarity-invert',
    name: 'Polarity Invert',
    category: 'utility',
    automation: 'none',
    latencySamples: 0,
    tailSeconds: 0,
    defaultAudible: true,
    paramNames: Object.freeze(Object.keys(AUDIO_POLARITY_INVERT_DEFAULTS)),
    params: createParamDescriptors(AUDIO_POLARITY_INVERT_DEFAULTS),
  }),
  Object.freeze({
    id: 'audio-mono-sum',
    name: 'Mono Sum',
    category: 'utility',
    automation: 'none',
    latencySamples: 0,
    tailSeconds: 0,
    defaultAudible: true,
    paramNames: Object.freeze(Object.keys(AUDIO_MONO_SUM_DEFAULTS)),
    params: createParamDescriptors(AUDIO_MONO_SUM_DEFAULTS),
  }),
  Object.freeze({
    id: 'audio-channel-swap',
    name: 'Channel Swap',
    category: 'utility',
    automation: 'none',
    latencySamples: 0,
    tailSeconds: 0,
    defaultAudible: true,
    paramNames: Object.freeze(Object.keys(AUDIO_CHANNEL_SWAP_DEFAULTS)),
    params: createParamDescriptors(AUDIO_CHANNEL_SWAP_DEFAULTS),
  }),
  Object.freeze({
    id: 'audio-stereo-split',
    name: 'Stereo Split',
    category: 'utility',
    automation: 'none',
    latencySamples: 0,
    tailSeconds: 0,
    defaultAudible: true,
    paramNames: Object.freeze(Object.keys(AUDIO_STEREO_SPLIT_DEFAULTS)),
    params: createParamDescriptors(AUDIO_STEREO_SPLIT_DEFAULTS),
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
