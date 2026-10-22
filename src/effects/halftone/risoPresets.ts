// Riso: its presets, each a pair of real risograph inks (approximate sRGB of the press colours). The recipe is the
// editable graph in src/services/operators/risoPrintEffectGraph.ts (createRisoPrintGraph) and its shader twin
// risoFragment; Dot Size and Registration count pixels of a 1080p frame.
import type { EffectPreset } from '../types';

export const RISO_PRESETS: readonly EffectPreset[] = [
  // Medium Blue and Fluorescent Pink, coarse dots, clearly off register: a self-printed zine.
  { id: 'zine', name: 'Zine', params: { dotSize: 8, scale: 6, amount: 1, colorA: '#3255a4', colorB: '#ff48b0' } },
  // Teal and Bright Red, fine dots, almost in register: a holiday postcard.
  { id: 'postcard', name: 'Postcard', params: { dotSize: 5, scale: 2, amount: 1, colorA: '#00838a', colorB: '#f15060' } },
  // Hunter Green and Fluorescent Pink, very fine dots: a quiet, almost photographic art print.
  { id: 'art-print', name: 'Art Print', params: { dotSize: 4, scale: 1.5, amount: 1, colorA: '#407060', colorB: '#ff48b0' } },
  // Black and Bright Red, bold dots: a concert poster.
  { id: 'gig-poster', name: 'Gig Poster', params: { dotSize: 9, scale: 3, amount: 1, colorA: '#1a1a1a', colorB: '#f15060' } },
  // Burgundy and Aqua, large dots and far off register: the aqua ink glows beside every edge.
  { id: 'off-register', name: 'Off Register', params: { dotSize: 10, scale: 14, amount: 1, colorA: '#914e72', colorB: '#5ec8e5' } },
];
