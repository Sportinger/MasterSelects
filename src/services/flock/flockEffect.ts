import type { Effect } from '../../types/effects';
import type { TimelineClip } from '../../types/timeline';

/**
 * Flocking is an effect: any clip can carry one swarm simulation. The executable
 * definition stays on `clip.flock` (keyframes `flock.node.*`, history and runtime
 * are keyed by the clip); the effect entry places it in the stack and toggles it.
 * Legacy flock clips (`source.type === 'flock'`) are empty hosts for the same effect.
 */
export const FLOCKING_EFFECT_TYPE = 'flocking';

type FlockClip = { flock?: TimelineClip['flock']; effects?: readonly Effect[]; source?: { type?: string } | null };

export function flockingEffectOf(clip: { effects?: readonly Effect[] } | undefined | null): Effect | undefined {
  return clip?.effects?.find(effect => effect.type === FLOCKING_EFFECT_TYPE);
}

/** The clip owns a flock graph that can be edited (node workspace, Flock tab, AI tools). */
export function hasFlockGraph(clip: FlockClip | undefined | null): boolean {
  return !!clip?.flock && (clip.source?.type === 'flock' || !!flockingEffectOf(clip));
}

/** The swarm is simulated and drawn for this clip. */
export function rendersFlock(clip: FlockClip | undefined | null): boolean {
  if (!clip?.flock) return false;
  const effect = flockingEffectOf(clip);
  if (effect) return effect.enabled && !effect.detached;
  return clip.source?.type === 'flock';
}

/** Legacy flock clips gain the effect entry that now carries the swarm. */
export function withFlockingEffect(effects: Effect[], id: string): Effect[] {
  if (effects.some(effect => effect.type === FLOCKING_EFFECT_TYPE)) return effects;
  return [...effects, { id, name: 'Flocking', type: FLOCKING_EFFECT_TYPE as Effect['type'], enabled: true, params: {} }];
}
