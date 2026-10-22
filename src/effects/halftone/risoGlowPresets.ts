// Riso Glow: its presets, each a real risograph shadow ink with a fluorescent glow ink (approximate sRGB of the press
// colours). The recipe is the editable graph in src/services/operators/risoPrintEffectGraph.ts (createRisoGlowGraph) and
// its shader twin risoGlowFragment; Dot Size and Registration count pixels of a 1080p frame, Speed paces the breathing glow.
import type { EffectPreset } from '../types';

export const RISO_GLOW_PRESETS: readonly EffectPreset[] = [
  // Medium Blue and Fluorescent Pink, breathing slowly: a poster under ultraviolet light.
  { id: 'blacklight', name: 'Blacklight', params: { dotSize: 6, scale: 3, glow: 1.6, speed: 0.6, amount: 1, colorA: '#3255a4', colorB: '#ff48b0' } },
  // Teal and Fluorescent Orange, fine dots, a steady hum: warm lights glow like neon tubes over a cool street.
  { id: 'neon-sign', name: 'Neon Sign', params: { dotSize: 5, scale: 2, glow: 1.5, speed: 1.2, amount: 1, colorA: '#00838a', colorB: '#ff7477' } },
  // Black and Fluorescent Orange, coarse dots, a slow strong glow: warm figures smoulder in a dark print.
  { id: 'embers', name: 'Embers', params: { dotSize: 8, scale: 4, glow: 1.8, speed: 0.4, amount: 1, colorA: '#1a1a1a', colorB: '#ff7477' } },
  // Midnight and Bright Red, the glow beating about 76 times a minute: a pulse for tension or a heart on stage.
  { id: 'heartbeat', name: 'Heartbeat', params: { dotSize: 6, scale: 3, glow: 2, speed: 4, amount: 1, colorA: '#435060', colorB: '#f15060' } },
];
