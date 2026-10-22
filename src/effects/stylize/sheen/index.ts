// Sheen Effect - specular light sweep limited to the layer alpha (logos, text, shapes)

import shader from './shader.wgsl?raw';
import type { EffectDefinition, EffectParam, EffectPreset } from '../../types';
import { colorToRgba } from '../../_shared/catalogColor';
import { finiteUniform as finite } from '../../_shared/effectUniformParams';
import { sheenParamWarnings } from './warnings';

const number = (label: string, defaultValue: number, min: number, max: number, step = 0.01): EffectParam => ({
  type: 'number', label, default: defaultValue, min, max, step, animatable: true,
});

export const SHEEN_PARAMS = {
  position: number('Position', 0.5, 0, 1, 0.001),
  angle: { ...number('Angle', 25, -180, 180, 1), unit: '°' },
  width: number('Width', 0.18, 0.01, 1),
  softness: number('Softness', 0.7, 0, 1),
  intensity: number('Intensity', 0.9, 0, 3),
  // How much more the light catches bright surfaces than dark ones (0 = the same everywhere).
  highlights: number('Highlights', 0.6, 0, 1),
  color: { type: 'color', label: 'Color', default: '#ffffff' },
  // Band cross-section: 'falloff' peaks at the centre (Softness 1 is a Gaussian); 'plateau' is the
  // flat-topped band of effects saved before 2026-10 (set by the load migration, sheen/legacy.ts).
  profile: {
    type: 'select', label: 'Profile', default: 'falloff', animatable: false, hidden: true,
    options: [{ value: 'falloff', label: 'Falloff' }, { value: 'plateau', label: 'Plateau (saved before 2026-10)' }],
  },
} satisfies Record<string, EffectParam>;

export const SHEEN_PRESETS: readonly EffectPreset[] = [
  // A thin, bright streak: the classic glint over a logo or a title when Position is keyframed.
  { id: 'glint', name: 'Glint', params: { width: 0.05, softness: 0.8, intensity: 1.8, highlights: 0.4 } },
  // A warm, wide beam falling diagonally from the top left, like low sun through a window.
  { id: 'golden-beam', name: 'Golden Beam', params: { color: '#ffcc66', angle: -60, width: 0.16, intensity: 1.2 } },
  // A hard-edged band, like the reflection on a pane of glass or polished metal.
  { id: 'glass-streak', name: 'Glass Streak', params: { angle: 35, width: 0.07, softness: 0.15, intensity: 1.2, highlights: 0.5 } },
  // A broad, cool light across the middle that falls mainly on bright surfaces, like moonlight.
  { id: 'moon-wash', name: 'Moon Wash', params: { color: '#9cc4ff', angle: 90, width: 0.5, softness: 1, intensity: 1.5, highlights: 0.8 } },
];

export const sheen: EffectDefinition = {
  id: 'sheen',
  name: 'Sheen',
  category: 'stylize',

  shader,
  entryPoint: 'sheenFragment',
  uniformSize: 64,

  params: SHEEN_PARAMS,
  presets: SHEEN_PRESETS,
  paramWarnings: sheenParamWarnings,

  packUniforms: (params, width, height) => {
    const [r, g, b, a] = colorToRgba(params.color, '#ffffff');
    return new Float32Array([
      finite(params.position, 0.5),
      finite(params.angle, 25),
      finite(params.width, 0.18),
      finite(params.softness, 0.7),
      finite(params.intensity, 0.9),
      width > 0 && height > 0 ? width / height : 1,
      // One pixel in the band's units (frame heights), for the anti-aliased hard edge.
      height > 0 ? 1 / height : 1 / 1080,
      // Saved effects without Highlights keep an even light (0).
      finite(params.highlights, 0),
      r, g, b, a,
      params.profile === 'plateau' ? 1 : 0, 0, 0, 0,
    ]);
  },
};
