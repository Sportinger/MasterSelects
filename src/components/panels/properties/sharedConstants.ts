import type { BlendMode } from '../../../types';

// EQ band parameter names
export const EQ_BAND_PARAMS = ['band31', 'band62', 'band125', 'band250', 'band500', 'band1k', 'band2k', 'band4k', 'band8k', 'band16k'];

// Organized by category like After Effects
export const BLEND_MODE_GROUPS: { label: string; modes: BlendMode[] }[] = [
  { label: 'Normal', modes: ['normal', 'dissolve', 'dancing-dissolve'] },
  { label: 'Darken', modes: ['darken', 'multiply', 'color-burn', 'classic-color-burn', 'linear-burn', 'darker-color'] },
  { label: 'Lighten', modes: ['add', 'lighten', 'screen', 'color-dodge', 'classic-color-dodge', 'linear-dodge', 'lighter-color'] },
  { label: 'Contrast', modes: ['overlay', 'soft-light', 'hard-light', 'linear-light', 'vivid-light', 'pin-light', 'hard-mix'] },
  { label: 'Inversion', modes: ['difference', 'classic-difference', 'exclusion', 'subtract', 'divide'] },
  { label: 'Component', modes: ['hue', 'saturation', 'color', 'luminosity'] },
  { label: 'Stencil', modes: ['stencil-alpha', 'stencil-luma', 'silhouette-alpha', 'silhouette-luma', 'alpha-add'] },
];

export const formatBlendModeName = (mode: BlendMode): string => {
  return mode.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
};
