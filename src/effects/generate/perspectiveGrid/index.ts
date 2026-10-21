// Perspective Grid Effect - scrolling vanishing-point floor grid generator

import shader from './shader.wgsl?raw';
import type { EffectDefinition, EffectParam } from '../../types';
import { colorToRgba } from '../../_shared/catalogColor';
import { finiteParam, generatorChoiceWarnings } from '../generatorParams';

const number = (label: string, defaultValue: number, min: number, max: number, step = 0.01, animatable = true,
  extra: Partial<EffectParam> = {}): EffectParam => ({
  type: 'number', label, default: defaultValue, min, max, step, animatable, ...extra,
});

/** Line widths are stored as the half width in pixels of a 1080 px tall frame (the original unit). */
export const PERSPECTIVE_GRID_REFERENCE_HEIGHT = 1080;
export const PERSPECTIVE_GRID_MAX_HORIZON = 0.98;

export const PERSPECTIVE_GRID_PARAMS = {
  horizon: number('Horizon', 0.66, 0, PERSPECTIVE_GRID_MAX_HORIZON, 0.001, true,
    { group: 'Grid', displayScale: 100, unit: '%', renderMin: 0, renderMax: PERSPECTIVE_GRID_MAX_HORIZON }),
  columns: number('Columns', 14, 1, 200, 1, true, { group: 'Grid', renderMin: 0 }),
  rows: number('Row Density', 6, 0.5, 60, 0.1, true, { group: 'Grid', renderMin: 0 }),
  // Shown as the full width; the line thins with distance like a painted floor line.
  lineWidth: number('Line Width', 1.5, 0, 8, 0.05, true, { group: 'Grid', displayScale: 2, unit: ' px', renderMin: 0 }),
  speed: number('Speed (rows/s)', 1.5, -20, 20, 0.1, false, { group: 'Motion' }),
  offset: number('Scroll Offset', 0, -1000, 1000, 0.01, true, { group: 'Motion' }),
  color: { type: 'color', label: 'Line Color', default: '#2ee6ff', group: 'Look' },
  opacity: number('Opacity', 0.8, 0, 1, 0.01, true, { group: 'Look', renderMin: 0, renderMax: 1 }),
  fade: number('Horizon Fade', 1.4, 0.05, 6, 0.05, true, { group: 'Look', renderMin: 0 }),
  blend: {
    type: 'select', label: 'Blend', default: 'add', group: 'Look',
    options: [{ value: 'add', label: 'Add (glowing lines)' }, { value: 'normal', label: 'Normal (cover the image)' }],
  },
} satisfies Record<string, EffectParam>;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const perspectiveGrid: EffectDefinition = {
  id: 'perspective-grid',
  name: 'Perspective Grid',
  category: 'generate',

  shader,
  entryPoint: 'perspectiveGridFragment',
  uniformSize: 64,

  params: PERSPECTIVE_GRID_PARAMS,
  // Clamps of number params are reported from renderMin/renderMax (paramRangeNotes).
  paramWarnings: params => generatorChoiceWarnings(PERSPECTIVE_GRID_PARAMS, params, ['blend']),

  packUniforms: (params, width, height, timelineTimeSeconds = 0) => {
    const value = (key: keyof typeof PERSPECTIVE_GRID_PARAMS) => finiteParam(params, key, PERSPECTIVE_GRID_PARAMS[key].default as number);
    const [r, g, b, a] = colorToRgba(params.color, '#2ee6ff');
    const outputWidth = width > 0 ? width : 1920, outputHeight = height > 0 ? height : 1080;
    // Full width at the front edge in output pixels: the stored half width at 1080p, scaled.
    const linePixels = Math.max(0, value('lineWidth')) * 2 * outputHeight / PERSPECTIVE_GRID_REFERENCE_HEIGHT;
    // Lines sit at whole rows, so only the fraction of the scroll matters: wrap it here in double
    // precision instead of sending Speed × time to the GPU, where long timelines would jitter.
    const time = Number.isFinite(timelineTimeSeconds) ? timelineTimeSeconds : 0;
    const scroll = value('speed') * time + value('offset');
    return new Float32Array([
      clamp(value('horizon'), 0, PERSPECTIVE_GRID_MAX_HORIZON),
      Math.max(0, value('columns')),
      Math.max(0, value('rows')),
      Number.isFinite(scroll) ? scroll - Math.floor(scroll) : 0,
      linePixels,
      Math.max(0, value('fade')),
      clamp(value('opacity'), 0, 1),
      params.blend === 'normal' ? 1 : 0,
      r, g, b, a,
      outputWidth,
      outputHeight,
      0, 0,
    ]);
  },
};
