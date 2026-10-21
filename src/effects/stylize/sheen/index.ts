// Sheen Effect - specular light sweep limited to the layer alpha (logos, text, shapes)

import shader from './shader.wgsl?raw';
import type { EffectDefinition, EffectParam } from '../../types';
import { colorToRgba } from '../../_shared/catalogColor';

const number = (label: string, defaultValue: number, min: number, max: number, step = 0.01): EffectParam => ({
  type: 'number', label, default: defaultValue, min, max, step, animatable: true,
});

export const SHEEN_PARAMS = {
  position: number('Position', 0.5, 0, 1, 0.001),
  angle: { ...number('Angle', 25, -180, 180, 1), suffix: '°' },
  width: number('Width', 0.18, 0.01, 1),
  softness: number('Softness', 0.7, 0, 1),
  intensity: number('Intensity', 0.9, 0, 3),
  color: { type: 'color', label: 'Color', default: '#ffffff' },
} satisfies Record<string, EffectParam>;

export const sheen: EffectDefinition = {
  id: 'sheen',
  name: 'Sheen',
  category: 'stylize',

  shader,
  entryPoint: 'sheenFragment',
  uniformSize: 48,

  params: SHEEN_PARAMS,
  paramWarnings: params => {
    const notes: string[] = [];
    const intensity = params.intensity, width = params.width, softness = params.softness;
    if (typeof intensity === 'number' && intensity < 0) notes.push(`intensity: ${intensity} is below 0; it renders as 0 (no sheen). Use a darker Color for a dim sweep.`);
    if (typeof width === 'number' && width <= 0) notes.push(`width: ${width} has no band; it renders as the thinnest line.`);
    if (typeof softness === 'number' && (softness < 0 || softness > 1)) notes.push(`softness: ${softness} is outside 0-1; it is clamped to ${softness < 0 ? 0 : 1}.`);
    return notes;
  },

  packUniforms: (params, width, height) => {
    const [r, g, b, a] = colorToRgba(params.color, '#ffffff');
    return new Float32Array([
      params.position as number ?? 0.5,
      params.angle as number ?? 25,
      params.width as number ?? 0.18,
      params.softness as number ?? 0.7,
      params.intensity as number ?? 0.9,
      width > 0 && height > 0 ? width / height : 1,
      // One pixel in the band's units (frame heights), for the anti-aliased hard edge.
      height > 0 ? 1 / height : 1 / 1080, 0,
      r, g, b, a,
    ]);
  },
};
