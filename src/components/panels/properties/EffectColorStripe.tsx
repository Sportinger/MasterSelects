import { effectGroupColor } from '../../../services/nodeGraph/effectGroupColors';
import './EffectColorStripe.css';

/** Same identity as the owning frame on the node canvas. */
export function EffectColorStripe({ identity }: { identity: string }) {
  return <span className="effect-color-stripe" aria-hidden="true" style={{ backgroundColor: effectGroupColor(identity) }} />;
}
