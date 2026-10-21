import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { isNeutralBlurEffect } from './blurIdentity';
import { isNeutralUvDistortEffect } from './uvDistortIdentity';

/** Built-in effects whose current settings return the input unchanged; the pipeline skips them. */
export function isNeutralEffect(effect: { type: string; params: Record<string, unknown>; operatorGraph?: EffectOperatorGraph },
  width: number, height: number): boolean {
  return isNeutralBlurEffect(effect, width, height) || isNeutralUvDistortEffect(effect);
}
