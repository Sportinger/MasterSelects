export type BlendMode =
  // Normal
  | 'normal'
  | 'dissolve'
  | 'dancing-dissolve'
  // Darken
  | 'darken'
  | 'multiply'
  | 'color-burn'
  | 'classic-color-burn'
  | 'linear-burn'
  | 'darker-color'
  // Lighten
  | 'add'
  | 'lighten'
  | 'screen'
  | 'color-dodge'
  | 'classic-color-dodge'
  | 'linear-dodge'
  | 'lighter-color'
  // Contrast
  | 'overlay'
  | 'soft-light'
  | 'hard-light'
  | 'linear-light'
  | 'vivid-light'
  | 'pin-light'
  | 'hard-mix'
  // Inversion
  | 'difference'
  | 'classic-difference'
  | 'exclusion'
  | 'subtract'
  | 'divide'
  // Component
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'
  // Stencil
  | 'stencil-alpha'
  | 'stencil-luma'
  | 'silhouette-alpha'
  | 'silhouette-luma'
  | 'alpha-add';

export const BLEND_MODES = [
  'normal', 'dissolve', 'dancing-dissolve',
  'darken', 'multiply', 'color-burn', 'classic-color-burn', 'linear-burn', 'darker-color',
  'add', 'lighten', 'screen', 'color-dodge', 'classic-color-dodge', 'linear-dodge', 'lighter-color',
  'overlay', 'soft-light', 'hard-light', 'linear-light', 'vivid-light', 'pin-light', 'hard-mix',
  'difference', 'classic-difference', 'exclusion', 'subtract', 'divide',
  'hue', 'saturation', 'color', 'luminosity',
  'stencil-alpha', 'stencil-luma', 'silhouette-alpha', 'silhouette-luma', 'alpha-add',
] as const satisfies readonly BlendMode[];
