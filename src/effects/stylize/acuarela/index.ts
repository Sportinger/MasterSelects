// Acuarela - watercolour painting: pigment washes with pooled edges, bleeding, granulation and paper.
// It renders through its node graph (src/services/operators/acuarelaWatercolorGraph.ts). Effects
// saved with the original watery-smoke recipe keep it (acuarelaEffectGraph.ts): this registered
// shader and packUniforms are that legacy recipe's reference and read only its parameters.

import shader from './shader.wgsl?raw';
import type { EffectDefinition, EffectParam } from '../../types';
import { FEEDBACK_PARAMETERS } from '../../_shared/feedbackParameters';
import { acuarelaParamWarnings } from './warnings';

const LEGACY = 'Only Acuarela effects saved with the original watery-smoke recipe read it; the watercolour recipe ignores it.';
const legacy = (param: EffectParam): EffectParam => ({ ...param, deprecated: LEGACY });
const paint = (label: string, defaultValue: number, min: number, max: number, group: string, step = 0.01): EffectParam =>
  ({ type: 'number', label, default: defaultValue, min, max, step, animatable: true, group, graphOnly: true });

export const acuarela: EffectDefinition = {
  id: 'acuarela',
  name: 'Acuarela',
  category: 'stylize',

  shader,
  entryPoint: 'acuarelaFragment',
  uniformSize: 48,
  // Graph-owned: frame history comes from the graph (only the legacy recipe has it), and the
  // result depends on the timeline time only, so a paused frame needs no continuous rendering.
  usesFeedback: true,

  params: {
    opacity: {
      type: 'number',
      label: 'Mix',
      default: 1,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    wash: { ...paint('Wash', 5.5, 0, 12, 'Paint', 0.1), suffix: 'px' },
    bleed: { ...paint('Bleed', 8, 0, 30, 'Paint', 0.1), suffix: 'px' },
    edges: paint('Edges', 1.2, 0, 2, 'Paint'),
    simplify: paint('Simplify', 0.5, 0, 1, 'Paint'),
    blooms: paint('Blooms', 0.5, 0, 2, 'Paint'),
    shadows: paint('Shadow Pigment', 0.5, 0, 1, 'Paint'),
    granulation: paint('Granulation', 0.6, 0, 2, 'Paper'),
    paper: paint('Paper', 0.6, 0, 2, 'Paper'),
    // A scale factor of the paper grain (1 = the standard grain), not a pixel size.
    grainSize: { ...paint('Grain Size', 1, 0.25, 4, 'Paper'), suffix: '×' },
    lift: paint('Lift', 0.1, 0, 1, 'Paper'),
    flow: paint('Flow', 0, 0, 2, 'Motion'),
    historyLoop: legacy(FEEDBACK_PARAMETERS.historyLoop),
    gain: legacy({ type: 'number', label: 'Gain', default: 0.01, min: 0, max: 1, step: 0.001, animatable: true }),
    speed: legacy({ type: 'number', label: 'Speed', default: 4, min: 0, max: 40, step: 0.1, animatable: true }),
    detail: legacy({ type: 'number', label: 'Detail', default: 4, min: 0, max: 8, step: 0.1, animatable: true }),
    strength: legacy({ type: 'number', label: 'Strength', default: 0.32, min: 0, max: 1, step: 0.01, animatable: true }),
    density: legacy({ type: 'number', label: 'Density', default: 4, min: 0, max: 100, step: 0.1, animatable: true }),
    gainX: legacy({ type: 'number', label: 'Gain X', default: 0.3, min: 0, max: 1, step: 0.01, animatable: true }),
    gainY: legacy({ type: 'number', label: 'Gain Y', default: 0.3, min: 0, max: 1, step: 0.01, animatable: true }),
    reset: legacy({ type: 'boolean', label: 'Reset', default: false, animatable: false }),
  },

  paramWarnings: acuarelaParamWarnings,

  packUniforms: (params, width, height, timelineTimeSeconds = 0) => {
    return new Float32Array([
      params.opacity as number ?? 1,
      params.gain as number ?? 0.01,
      params.speed as number ?? 4,
      params.detail as number ?? 4,
      params.strength as number ?? 0.32,
      params.density as number ?? 4,
      params.gainX as number ?? 0.3,
      params.gainY as number ?? 0.3,
      width,
      height,
      Number.isFinite(timelineTimeSeconds) ? timelineTimeSeconds : 0,
      0,
    ]);
  },
};
