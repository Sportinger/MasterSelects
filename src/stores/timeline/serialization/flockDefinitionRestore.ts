import { FLOCK_DEFINITION_VERSION, type FlockDefinition } from '../../../types/flock';
import { Logger } from '../../../services/logger';
import { flockingEffectOf, withFlockingEffect } from '../../../services/flock/flockEffect';

const log = Logger.create('FlockRestore');

/**
 * Light shape validation for persisted flock definitions. The definition is
 * never dropped: missing optional collections get defaults, unknown operators
 * and newer versions are kept verbatim so the graph stays inspectable (the
 * compiler reports them as errors instead of silently losing them).
 */
export function normalizeRestoredFlockDefinition(value: unknown): FlockDefinition | null {
  if (!value || typeof value !== 'object') return null;
  const raw = structuredClone(value) as Partial<FlockDefinition> & Record<string, unknown>;
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
    log.warn('Flock definition is missing nodes/edges; keeping an empty draft', { version: raw.version });
  }
  if (raw.version !== FLOCK_DEFINITION_VERSION) {
    log.warn('Flock definition version differs from supported version; kept for inspection', {
      version: raw.version,
      supported: FLOCK_DEFINITION_VERSION,
    });
  }
  return {
    ...raw,
    version: (typeof raw.version === 'number' ? raw.version : FLOCK_DEFINITION_VERSION) as typeof FLOCK_DEFINITION_VERSION,
    nodes: Array.isArray(raw.nodes) ? raw.nodes : [],
    edges: Array.isArray(raw.edges) ? raw.edges : [],
    exposed: Array.isArray(raw.exposed) ? raw.exposed : [],
    groups: Array.isArray(raw.groups) ? raw.groups : [],
    layout: raw.layout && typeof raw.layout === 'object' ? raw.layout : {},
    time: raw.time && typeof raw.time === 'object'
      ? { loop: raw.time.loop === 'reset' ? 'reset' : 'none', loopSeconds: Number(raw.time.loopSeconds) || 10 }
      : { loop: 'none', loopSeconds: 10 },
  };
}

type PersistedFlockClip = { id: string; sourceType?: string; flock?: unknown; effects?: import('../../../types/effects').Effect[] };


/** Flocking became an effect: legacy flock clips gain the effect entry that now carries their swarm. */
export function withPersistedFlockingEffect<T extends PersistedFlockClip>(clip: T): T {
  if (clip.sourceType !== 'flock' || !clip.flock || flockingEffectOf(clip)) return clip;
  return { ...clip, effects: withFlockingEffect(clip.effects ?? [], `${clip.id}-flocking`) };
}

/** The persisted swarm definition of any clip carrying a Flocking effect (or a legacy flock host). */
export function restoredFlockDefinitionOf(clip: PersistedFlockClip): FlockDefinition | undefined {
  if (!clip.flock || !(clip.sourceType === 'flock' || flockingEffectOf(clip))) return undefined;
  return normalizeRestoredFlockDefinition(clip.flock) ?? undefined;
}
