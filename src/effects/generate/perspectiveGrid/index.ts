// Perspective Grid Effect - scrolling vanishing-point floor grid generator

import shader from './shader.wgsl?raw';
import type { EffectDefinition, EffectParam } from '../../types';
import { colorToRgba } from '../../_shared/catalogColor';

const number = (label: string, defaultValue: number, min: number, max: number, step = 0.01, animatable = true): EffectParam => ({
  type: 'number', label, default: defaultValue, min, max, step, animatable,
});

export const PERSPECTIVE_GRID_PARAMS = {
  horizon: number('Horizon', 0.66, 0, 0.98, 0.001),
  columns: number('Columns', 14, 1, 200, 1),
  rows: number('Row Density', 6, 0.5, 60, 0.1),
  speed: number('Speed', 1.5, -20, 20, 0.1, false),
  offset: number('Scroll Offset', 0, -1000, 1000),
  lineWidth: number('Line Width', 1, 0, 8, 0.05),
  fade: number('Horizon Fade', 1.4, 0.05, 6, 0.05),
  opacity: number('Opacity', 0.16, 0, 1),
  color: { type: 'color', label: 'Line Color', default: '#2ee6ff' },
} satisfies Record<string, EffectParam>;

export const perspectiveGrid: EffectDefinition = {
  id: 'perspective-grid',
  name: 'Perspective Grid',
  category: 'generate',

  shader,
  entryPoint: 'perspectiveGridFragment',
  uniformSize: 64,

  params: PERSPECTIVE_GRID_PARAMS,

  packUniforms: (params, width, height, timelineTimeSeconds = 0) => {
    const [r, g, b, a] = colorToRgba(params.color, '#2ee6ff');
    return new Float32Array([
      params.horizon as number ?? 0.66,
      params.columns as number ?? 14,
      params.rows as number ?? 6,
      params.speed as number ?? 1.5,
      params.lineWidth as number ?? 1,
      params.fade as number ?? 1.4,
      params.opacity as number ?? 0.16,
      Number.isFinite(timelineTimeSeconds) ? timelineTimeSeconds : 0,
      r, g, b, a,
      params.offset as number ?? 0,
      width > 0 && height > 0 ? width / height : 1,
      0, 0,
    ]);
  },
};
