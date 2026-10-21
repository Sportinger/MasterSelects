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
// Far beyond any useful grid, but small enough that the shader's products stay finite in 32 bits.
export const PERSPECTIVE_GRID_MAX_COLUMNS = 2000;
export const PERSPECTIVE_GRID_MAX_ROWS = 1000;
export const PERSPECTIVE_GRID_MAX_LINE_WIDTH = 1000;
export const PERSPECTIVE_GRID_MAX_FADE = 100;
/** Runtime-only param: rows travelled under a keyframed Speed curve (EffectParam.integratedAs). */
export const PERSPECTIVE_GRID_SPEED_TRAVEL = 'speedTravel';

export const PERSPECTIVE_GRID_PARAMS = {
  horizon: number('Horizon', 0.66, 0, PERSPECTIVE_GRID_MAX_HORIZON, 0.001, true,
    { group: 'Grid', displayScale: 100, unit: '%', renderMin: 0, renderMax: PERSPECTIVE_GRID_MAX_HORIZON }),
  columns: number('Columns', 14, 1, 200, 1, true, { group: 'Grid', renderMin: 0, renderMax: PERSPECTIVE_GRID_MAX_COLUMNS }),
  rows: number('Row Density', 6, 0.5, 60, 0.1, true, { group: 'Grid', renderMin: 0, renderMax: PERSPECTIVE_GRID_MAX_ROWS }),
  // Shown as the full width; with Lines "Thin with depth" the line thins with distance like a painted floor line.
  lineWidth: number('Line Width', 1.5, 0, 8, 0.05, true,
    { group: 'Grid', displayScale: 2, unit: ' px', renderMin: 0, renderMax: PERSPECTIVE_GRID_MAX_LINE_WIDTH }),
  // Grids saved before this choice existed drew every line at the same screen width: they keep it.
  widthMode: {
    type: 'select', label: 'Lines', default: 'floor', legacyDefault: 'screen', group: 'Grid',
    options: [{ value: 'floor', label: 'Thin with depth' }, { value: 'screen', label: 'Even width' }],
  },
  // Keyframeable: a keyed ramp scrolls by the distance travelled (integratedAs), not Speed × time.
  speed: number('Speed', 1.5, -20, 20, 0.1, true, { group: 'Motion', unit: ' rows/s', integratedAs: PERSPECTIVE_GRID_SPEED_TRAVEL }),
  offset: number('Scroll Offset', 0, -1000, 1000, 0.01, true, { group: 'Motion' }),
  color: { type: 'color', label: 'Line Color', default: '#2ee6ff', group: 'Look' },
  opacity: number('Opacity', 0.8, 0, 1, 0.01, true, { group: 'Look', renderMin: 0, renderMax: 1 }),
  fade: number('Horizon Fade', 1.4, 0.05, 6, 0.05, true, { group: 'Look', renderMin: 0, renderMax: PERSPECTIVE_GRID_MAX_FADE }),
  blend: {
    type: 'select', label: 'Blend', default: 'add', group: 'Look',
    options: [{ value: 'add', label: 'Add (glow)' }, { value: 'normal', label: 'Normal (solid)' }],
  },
} satisfies Record<string, EffectParam>;

type Params = Record<string, number | boolean | string>;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const value = (params: Params, key: keyof typeof PERSPECTIVE_GRID_PARAMS) => finiteParam(params, key, PERSPECTIVE_GRID_PARAMS[key].default as number);

/** Even (screen) width for grids saved without the choice and when asked; otherwise the floor width. */
export const perspectiveGridScreenWidth = (params: Params) => (params.widthMode ?? PERSPECTIVE_GRID_PARAMS.widthMode.legacyDefault) === 'screen';

/** Settings that draw no lines at all (no silent failure); clamps come from renderMin/renderMax. */
function perspectiveGridWarnings(params: Params): string[] {
  const notes: string[] = [];
  if (!perspectiveGridScreenWidth(params) && value(params, 'lineWidth') <= 0) {
    notes.push('lineWidth: 0 draws no lines while Lines is "Thin with depth"; raise Line Width, or choose "Even width" for 1-px hairlines.');
  }
  if (value(params, 'columns') <= 0 && value(params, 'rows') <= 0) notes.push('columns and rows: both are 0, so no lines are drawn.');
  return notes;
}

export const perspectiveGrid: EffectDefinition = {
  id: 'perspective-grid',
  name: 'Perspective Grid',
  category: 'generate',

  shader,
  entryPoint: 'perspectiveGridFragment',
  uniformSize: 64,

  params: PERSPECTIVE_GRID_PARAMS,
  paramWarnings: params => [...generatorChoiceWarnings(PERSPECTIVE_GRID_PARAMS, params, ['widthMode', 'blend']), ...perspectiveGridWarnings(params)],

  packUniforms: (params, width, height, timelineTimeSeconds = 0) => {
    const [r, g, b, a] = colorToRgba(params.color, '#2ee6ff');
    const outputWidth = width > 0 ? width : 1920, outputHeight = height > 0 ? height : 1080;
    const screenWidth = perspectiveGridScreenWidth(params);
    const halfWidth = clamp(value(params, 'lineWidth'), 0, PERSPECTIVE_GRID_MAX_LINE_WIDTH);
    // Full width in output pixels, from the stored half width at 1080p. Even width keeps the
    // original line (full core plus a one-pixel soft rim, so Line Width 0 is a hairline); the
    // floor width applies at the front edge and thins with distance.
    const linePixels = (screenWidth ? 2 * halfWidth + 1 : 2 * halfWidth) * outputHeight / PERSPECTIVE_GRID_REFERENCE_HEIGHT;
    // Lines sit at whole rows, so only the fraction of the scroll matters: wrap it here in double
    // precision instead of sending Speed × time to the GPU, where long timelines would jitter.
    // A keyframed Speed arrives with the rows it has travelled since the clip start.
    const time = Number.isFinite(timelineTimeSeconds) ? timelineTimeSeconds : 0;
    const travel = finiteParam(params, PERSPECTIVE_GRID_SPEED_TRAVEL, Number.NaN);
    const scroll = (Number.isFinite(travel) ? travel : value(params, 'speed') * time) + value(params, 'offset');
    return new Float32Array([
      clamp(value(params, 'horizon'), 0, PERSPECTIVE_GRID_MAX_HORIZON),
      clamp(value(params, 'columns'), 0, PERSPECTIVE_GRID_MAX_COLUMNS),
      clamp(value(params, 'rows'), 0, PERSPECTIVE_GRID_MAX_ROWS),
      Number.isFinite(scroll) ? scroll - Math.floor(scroll) : 0,
      linePixels,
      clamp(value(params, 'fade'), 0, PERSPECTIVE_GRID_MAX_FADE),
      clamp(value(params, 'opacity'), 0, 1),
      params.blend === 'normal' ? 1 : 0,
      r, g, b, a,
      outputWidth,
      outputHeight,
      screenWidth ? 1 : 0,
      0,
    ]);
  },
};
