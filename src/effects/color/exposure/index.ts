// Exposure Effect

import shader from './shader.wgsl?raw';
import type { EffectDefinition, EffectPreset } from '../../types';
import { EXPOSURE_PARAMS } from '../remainingColorParams';

/** Camera-like starting points: a small correction, a deliberate overexposure, a stop down and a hazy lift. */
export const EXPOSURE_PRESETS: readonly EffectPreset[] = [
  // Half a stop more light: a slightly dark shot, corrected the way a camera would.
  { id: 'half-stop-up', name: 'Half Stop Up', params: { exposure: 0.5 } },
  // A deliberately overexposed camera: bright skin, the brightest parts of the costume burn out.
  { id: 'overexposed', name: 'Overexposed', params: { exposure: 1.5 } },
  // Half the light: a shot that is too bright, or a stage after the light has dimmed.
  { id: 'one-stop-down', name: 'One Stop Down', params: { exposure: -1 } },
  // Lifted blacks and open mid-tones, like haze in front of the lens or a faded print.
  { id: 'milky-haze', name: 'Milky Haze', params: { offset: 0.06, gamma: 1.25 } },
];

export const exposure: EffectDefinition = {
  id: 'exposure',
  name: 'Exposure',
  category: 'color',

  shader,
  entryPoint: 'exposureFragment',
  uniformSize: 16,

  params: EXPOSURE_PARAMS,

  presets: EXPOSURE_PRESETS,

  packUniforms: (params) => {
    return new Float32Array([
      params.exposure as number ?? 0,
      params.offset as number ?? 0,
      params.gamma as number ?? 1,
      0,
    ]);
  },
};
