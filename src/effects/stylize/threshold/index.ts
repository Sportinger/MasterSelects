// Threshold Effect

import shader from './shader.wgsl?raw';
import type { EffectDefinition, EffectPreset } from '../../types';
import { THRESHOLD_PARAMS } from '../pointwiseParams';
import { thresholdParamNotes } from '../pointwiseModel';

/** From a hard photocopy to a soft charcoal look, and two mattes: the lights alone, or all but the shadows. */
export const THRESHOLD_PRESETS: readonly EffectPreset[] = [
  // A hard cut set a little dark, like a copy machine turned up too far: mid-tones drop into black.
  // (Not the defaults, Level 0.5: a fresh Threshold would otherwise already read "Photocopy".)
  { id: 'photocopy', name: 'Photocopy', params: { level: 0.6, softness: 0 } },
  // A wide soft edge: the cut keeps grey half-tones, like a charcoal drawing.
  { id: 'charcoal', name: 'Charcoal', params: { level: 0.45, softness: 0.35 } },
  // Only the brightest lights stay white: lamps, neon, highlights on skin and water.
  { id: 'highlights', name: 'Highlights', params: { level: 0.75, softness: 0.08 } },
  // Everything except the deepest shadows turns white: a matte of the dark parts.
  { id: 'shadow-matte', name: 'Shadow Matte', params: { level: 0.2, softness: 0.06 } },
];

export const threshold: EffectDefinition = {
  id: 'threshold',
  name: 'Threshold',
  category: 'stylize',

  shader,
  entryPoint: 'thresholdFragment',
  uniformSize: 16,

  params: THRESHOLD_PARAMS,

  presets: THRESHOLD_PRESETS,

  paramWarnings: (params) => thresholdParamNotes(params),

  packUniforms: (params) => {
    return new Float32Array([
      params.level as number ?? 0.5,
      0, 0, 0,
    ]);
  },
};
