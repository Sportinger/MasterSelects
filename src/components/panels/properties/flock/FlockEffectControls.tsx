import type { EffectControlProps } from '../../../../effects/types';
import { FlockTab } from './FlockTab';

/** The Flocking effect's inspector: the same swarm controls as the Flock tab of an empty host clip. */
export default function FlockEffectControls({ clipId }: EffectControlProps) {
  return clipId ? <FlockTab clipId={clipId} /> : null;
}
