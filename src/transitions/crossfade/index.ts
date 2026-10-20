// Crossfade Transition
// A true dissolve: the outgoing clip fades out while the incoming clip fades in.

import type { TransitionDefinition } from '../types';

export const crossfade: TransitionDefinition = {
  id: 'crossfade',
  name: 'Crossfade',
  category: 'dissolve',
  defaultDuration: 2,
  minDuration: 0.1,
  maxDuration: 5.0,
  description: 'Dissolve: the outgoing clip fades out while the incoming clip fades in',
  params: {
    includeAudio: {
      type: 'boolean',
      label: 'Include audio',
      defaultValue: false,
    },
  },
  // Outgoing·(1−t) + incoming·t. The 'plus' blend adds the two weighted clips
  // (premultiplied, alpha included) instead of stacking the incoming over a
  // fully visible outgoing clip, so titles, keyed or scaled clips dissolve
  // too. Opaque full-frame clips give the same pixels as the former recipe.
  recipe: [
    {
      kind: 'opacity',
      target: 'outgoing',
      from: 1,
      to: 0,
      curve: 'linear',
    },
    {
      kind: 'opacity',
      target: 'incoming',
      from: 0,
      to: 1,
      curve: 'linear',
    },
    {
      kind: 'blend',
      target: 'incoming',
      mode: 'plus',
    },
  ],
  recipeRevision: 1,
};

/**
 * Equal-power (constant power) audio crossfade gains for transition progress
 * 0..1. A linear fade dips about 3 dB at the midpoint when the two sounds are
 * different; this is the default curve of Premiere ("Constant Power") and
 * Resolve ("+3 dB").
 */
export function getCrossfadeAudioGains(progress: number): { outgoing: number; incoming: number } {
  const t = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  return {
    outgoing: Math.cos(t * Math.PI / 2),
    incoming: Math.sin(t * Math.PI / 2),
  };
}
