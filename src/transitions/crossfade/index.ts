// Crossfade Transition
// A true dissolve: the outgoing clip fades out while the incoming clip fades in.

import type { TransitionDefinition } from '../types';

export const crossfade: TransitionDefinition = {
  id: 'crossfade',
  name: 'Crossfade',
  category: 'dissolve',
  // About one second, like the default dissolve in other editors: a centred
  // transition then needs only half a second of extra footage on each side.
  defaultDuration: 1,
  minDuration: 0.1,
  maxDuration: 5.0,
  description: 'Dissolve: the outgoing clip fades out while the incoming clip fades in',
  params: {
    includeAudio: {
      type: 'boolean',
      label: 'Include audio',
      defaultValue: false,
      affectsPicture: false,
    },
    audioCurve: {
      type: 'select',
      label: 'Audio curve',
      defaultValue: 'equal-power',
      options: [
        { label: 'Equal power', value: 'equal-power' },
        { label: 'Equal gain', value: 'equal-gain' },
      ],
      affectsPicture: false,
      audioOnly: true,
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

export type CrossfadeAudioCurve = 'equal-power' | 'equal-gain';

export function getCrossfadeAudioCurve(value: unknown): CrossfadeAudioCurve {
  return value === 'equal-gain' ? 'equal-gain' : 'equal-power';
}

/**
 * Audio crossfade gains for fade progress 0..1.
 * - 'equal-power' (default; Premiere "Constant Power", Resolve "+3 dB"): keeps
 *   the loudness of two different sounds steady, where a linear fade dips
 *   about 3 dB at the midpoint.
 * - 'equal-gain' (Premiere "Constant Gain", Resolve "0 dB"): the gains add up
 *   to 1, for a fade within one continuous recording (a word removed from
 *   dialogue, room tone), where equal power would bump about 3 dB.
 */
export function getCrossfadeAudioGains(
  progress: number,
  curve: CrossfadeAudioCurve = 'equal-power',
): { outgoing: number; incoming: number } {
  const t = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  if (curve === 'equal-gain') return { outgoing: 1 - t, incoming: t };
  return {
    outgoing: Math.cos(t * Math.PI / 2),
    incoming: Math.sin(t * Math.PI / 2),
  };
}
