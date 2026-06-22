import type { AudioEffectParamValue } from './audio';

export interface Effect {
  id: string;
  name: string;
  type: EffectType;
  enabled: boolean;
  params: Record<string, AudioEffectParamValue>;
}

export type EffectType =
  | 'hue-shift'
  | 'saturation'
  | 'brightness'
  | 'contrast'
  | 'blur'
  | 'gaussian-blur'
  | 'box-blur'
  | 'radial-blur'
  | 'zoom-blur'
  | 'motion-blur'
  | 'exposure'
  | 'temperature'
  | 'vibrance'
  | 'pixelate'
  | 'kaleidoscope'
  | 'mirror'
  | 'invert'
  | 'rgb-split'
  | 'levels'
  | 'threshold'
  | 'posterize'
  | 'vignette'
  | 'grain'
  | 'sharpen'
  | 'glow'
  | 'edge-detect'
  | 'scanlines'
  | 'wave'
  | 'twirl'
  | 'bulge'
  | 'chroma-key'
  | 'acuarela'
  | 'rom1'
  | 'voxel-relief'
  | 'pixel-particle-disintegrate'
  // Audio effects
  | 'audio-eq'
  | 'audio-volume'
  | 'audio-pan'
  | 'audio-normalize'
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

// Helper to check if an effect type is an audio effect
export function isAudioEffect(type: EffectType): boolean {
  return type === 'audio-eq' ||
    type === 'audio-volume' ||
    type === 'audio-pan' ||
    type === 'audio-normalize' ||
    type === 'audio-parametric-eq' ||
    type === 'audio-high-pass' ||
    type === 'audio-low-pass' ||
    type === 'audio-hum-notch' ||
    type === 'audio-de-click' ||
    type === 'audio-noise-reduction' ||
    type === 'audio-spectral-gate' ||
    type === 'audio-compressor' ||
    type === 'audio-de-esser' ||
    type === 'audio-limiter' ||
    type === 'audio-noise-gate' ||
    type === 'audio-expander' ||
    type === 'audio-delay' ||
    type === 'audio-reverb' ||
    type === 'audio-saturation' ||
    type === 'audio-polarity-invert' ||
    type === 'audio-mono-sum' ||
    type === 'audio-channel-swap' ||
    type === 'audio-stereo-split';
}
