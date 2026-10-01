import type { SerializableClip, TimelineClip } from '../types';
import { Logger } from '../../../services/logger';
import { applyCommonRestoredClipFields } from './loadStateCommonClipRestore';
import { normalizeRestoredFlockDefinition } from './flockDefinitionRestore';

const log = Logger.create('Timeline');

/**
 * Top-level flock clip restore: data-only definition, GPU runtime state is rebuilt on demand. A host
 * whose Flocking effect was removed has no swarm left but still carries its other effects (Weave),
 * so it is restored as an empty host rather than treated as a missing media file.
 */
export function createLoadStateFlockClip(serializedClip: SerializableClip): TimelineClip | undefined {
  if (serializedClip.sourceType !== 'flock') return undefined;
  const flock = serializedClip.flock ? normalizeRestoredFlockDefinition(serializedClip.flock) : undefined;
  if (serializedClip.flock && !flock) return undefined;
  log.debug('Restored flock clip', { clip: serializedClip.name, nodes: flock?.nodes.length ?? 0 });
  return {
    id: serializedClip.id,
    trackId: serializedClip.trackId,
    name: serializedClip.name || 'Flock',
    file: new File([JSON.stringify({ kind: 'flock', presetId: flock?.presetId })], 'flock.json', { type: 'application/json' }),
    mediaFileId: serializedClip.mediaFileId || undefined,
    signalAssetId: serializedClip.signalAssetId,
    signalRefId: serializedClip.signalRefId,
    signalRenderAdapterId: serializedClip.signalRenderAdapterId,
    startTime: serializedClip.startTime,
    duration: serializedClip.duration,
    inPoint: serializedClip.inPoint,
    outPoint: serializedClip.outPoint,
    source: {
      type: 'flock',
      mediaFileId: serializedClip.mediaFileId || undefined,
      naturalDuration: serializedClip.naturalDuration ?? serializedClip.duration,
    },
    ...(flock ? { flock } : {}),
    ...applyCommonRestoredClipFields(serializedClip),
    is3D: true,
    isLoading: false,
  };
}
