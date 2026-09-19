import type { SerializableClip, TimelineClip } from '../types';
import { Logger } from '../../../services/logger';
import { applyCommonRestoredClipFields } from './loadStateCommonClipRestore';
import { normalizeRestoredFlockDefinition } from './flockDefinitionRestore';

const log = Logger.create('Timeline');

/** Top-level flock clip restore: data-only definition, GPU runtime state is rebuilt on demand. */
export function createLoadStateFlockClip(serializedClip: SerializableClip): TimelineClip | undefined {
  if (serializedClip.sourceType !== 'flock' || !serializedClip.flock) return undefined;
  const flock = normalizeRestoredFlockDefinition(serializedClip.flock);
  if (!flock) return undefined;
  log.debug('Restored flock clip', { clip: serializedClip.name, nodes: flock.nodes.length });
  return {
    id: serializedClip.id,
    trackId: serializedClip.trackId,
    name: serializedClip.name || 'Flock',
    file: new File([JSON.stringify({ kind: 'flock', presetId: flock.presetId })], 'flock.json', { type: 'application/json' }),
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
    flock,
    ...applyCommonRestoredClipFields(serializedClip),
    is3D: true,
    isLoading: false,
  };
}
