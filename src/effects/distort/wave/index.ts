// Wave: sine ripples across and down the picture, optionally travelling over time.
// The editable graph is the runtime; shader.wgsl is its WGSL reference.

import shader from './shader.wgsl?raw';
import type { EffectDefinition, EffectPreset } from '../../types';
import { EDGES_PARAM, UV_DISTORT_COMMON_WGSL, choiceWarnings, distortNumber, edgeIndex } from '../uvDistortParams';

// Labels: the waves that run across the picture lift it up and down (Wave Height, Wave Count); the waves that
// run down it push it sideways (Sway, Sway Count). The earlier 'Horizontal …' / 'Vertical …' labels were cut
// to the same 'Horizontal …' in the card. Keys stay, so saved projects and tool calls are unchanged.

/** Presets name both heights, both counts and Speed: together they make the look. */
export const WAVE_PRESETS: readonly EffectPreset[] = [
  // Fine, fast ripples, mostly sideways: air over a hot stage floor; the picture stays readable.
  { id: 'heat-shimmer', name: 'Heat Shimmer', params: { amplitudeX: 0.002, frequencyX: 9, amplitudeY: 0.005, frequencyY: 16, speed: 1.5 } },
  // Long, slow waves both ways: the picture breathes as if seen through deep water.
  { id: 'dream', name: 'Dream', params: { amplitudeX: 0.03, frequencyX: 2, amplitudeY: 0.03, frequencyY: 2, speed: 0.4 } },
  // One wave and a bit across the frame, up and down only: a banner in the wind.
  { id: 'flag', name: 'Flag', params: { amplitudeX: 0.035, frequencyX: 1.2, amplitudeY: 0, frequencyY: 4, speed: 0.5 } },
  // A single broad sideways bend that drifts slowly: a fairground mirror.
  { id: 'funhouse-mirror', name: 'Funhouse Mirror', params: { amplitudeX: 0, frequencyX: 4, amplitudeY: 0.06, frequencyY: 1, speed: 0.2 } },
];

export const wave: EffectDefinition = {
  id: 'wave',
  name: 'Wave',
  category: 'distort',

  shader: `${UV_DISTORT_COMMON_WGSL}\n${shader}`,
  entryPoint: 'waveFragment',
  uniformSize: 32,

  params: {
    amplitudeX: {
      type: 'number',
      label: 'Wave Height',
      default: 0.015,
      min: 0,
      max: 0.1,
      step: 0.001,
      animatable: true,
    },
    frequencyX: {
      type: 'number',
      label: 'Wave Count',
      default: 4,
      min: 0.5,
      max: 20,
      step: 0.1,
      animatable: true,
    },
    amplitudeY: {
      type: 'number',
      label: 'Sway',
      default: 0.015,
      min: 0,
      max: 0.1,
      step: 0.001,
      animatable: true,
    },
    frequencyY: {
      type: 'number',
      label: 'Sway Count',
      default: 4,
      min: 0.5,
      max: 20,
      step: 0.1,
      animatable: true,
    },
    edges: EDGES_PARAM,
    speed: {
      type: 'number',
      label: 'Speed',
      default: 0.5,
      min: -4,
      max: 4,
      step: 0.01,
      animatable: true,
      group: 'motion',
      graphOnly: true,
    },
    phase: {
      type: 'number',
      label: 'Phase',
      default: 0,
      min: 0,
      max: 360,
      step: 1,
      animatable: true,
      group: 'motion',
      graphOnly: true,
    },
  },

  presets: WAVE_PRESETS,
  // Speed × timeline time moves the waves: playback, scrubbing and export agree, a paused frame holds still.
  timelineAnimated: true,

  paramWarnings: params => choiceWarnings(params, ['edges']),
  packUniforms: (params, width, height, time = 0) => new Float32Array([
    distortNumber(params.amplitudeX, 0.015),
    distortNumber(params.amplitudeY, 0.015),
    distortNumber(params.frequencyX, 4),
    distortNumber(params.frequencyY, 4),
    distortNumber(params.phase, 0) * Math.PI / 180 + Math.PI * 2 * distortNumber(params.speed, 0.5) * time,
    edgeIndex(params.edges),
    Math.max(1, width),
    Math.max(1, height),
  ]),
};
