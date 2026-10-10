import type { EffectControlProps } from '../../types';
import { glowQualityNote, resolveGlowSampling } from './glowSampling';

/** Read-only note: Glow never clamps quality silently. Renders nothing at full quality. */
export default function GlowQualityNote({ params }: EffectControlProps) {
  const note = glowQualityNote(resolveGlowSampling(params));
  return note ? <p className="effect-info" role="status" aria-live="polite">{note}</p> : null;
}
