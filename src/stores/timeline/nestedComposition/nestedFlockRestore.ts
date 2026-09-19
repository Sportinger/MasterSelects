import type { SerializableClip, TimelineClip } from '../../../types';
import { generateNestedClipId } from '../helpers/idGenerator';
import { createRestoredFlockClip } from '../nestedRestore';

/** Restores a nested flock clip into `target`; returns true when the serialized clip was a flock clip. */
export function pushRestoredNestedFlockClip(
  target: TimelineClip[],
  serializedClip: SerializableClip,
  parentClipId: string,
): boolean {
  if (serializedClip.sourceType !== 'flock' || !serializedClip.flock) return false;
  const clip = createRestoredFlockClip(serializedClip, generateNestedClipId(parentClipId, serializedClip.id));
  if (clip) target.push(clip);
  return true;
}
