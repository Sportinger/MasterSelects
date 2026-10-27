// Demonstrative preview strengths of the phone Effects cards. Most effects change the picture at their
// default parameters, so their card renders the defaults (what tapping the card adds). Some effects are
// neutral at their defaults on purpose (Brightness 0, Contrast 1, Exposure 0 ...): rendered at the
// defaults their card would show the unprocessed frame. Those cards render at the fixed value below
// instead, so the card shows what the effect does. Adding the effect still uses the editor defaults;
// only the card picture uses these values. Unknown effects or parameters are logged and skipped.
//
// | Effect                      | Preview value                               | Default        |
// |-----------------------------|---------------------------------------------|----------------|
// | brightness                  | amount 0.35                                 | 0              |
// | contrast                    | amount 1.8                                  | 1              |
// | exposure                    | exposure 1 (EV)                             | 0              |
// | levels                      | inputBlack 0.2, inputWhite 0.8              | 0 / 1          |
// | saturation                  | amount 2                                    | 1              |
// | vibrance                    | amount 1.2                                  | 0              |
// | temperature                 | temperature 0.6 (warmer)                    | 0              |
// | hue-shift                   | shift 0.25 (quarter turn)                   | 0              |
// | lens-correction             | distortion 60                               | 0              |
// | pixel-particle-disintegrate | progress 0.5                                | 0              |

import { getDefaultParams, getEffect } from '../../../effects';
import { Logger } from '../../../services/logger';

const log = Logger.create('PhoneEffectPreview');

/** Fixed card-preview values per effect id (see the table above). */
export const PHONE_EFFECT_PREVIEW_PARAMS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  brightness: { amount: 0.35 },
  contrast: { amount: 1.8 },
  exposure: { exposure: 1 },
  levels: { inputBlack: 0.2, inputWhite: 0.8 },
  saturation: { amount: 2 },
  vibrance: { amount: 1.2 },
  temperature: { temperature: 0.6 },
  'hue-shift': { shift: 0.25 },
  'lens-correction': { distortion: 60 },
  'pixel-particle-disintegrate': { progress: 0.5 },
};

const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  log.warn(message);
}

export interface PhoneEffectPreviewParams {
  params: Record<string, number | boolean | string>;
  /** True when the card shows a demonstrative strength rather than the defaults. */
  demo: boolean;
}

/**
 * The parameters an Effects card renders: the editor defaults, with the fixed preview values of
 * PHONE_EFFECT_PREVIEW_PARAMS on top (clamped to each parameter's range).
 */
export function phoneEffectPreviewParams(effectId: string): PhoneEffectPreviewParams {
  const params: Record<string, number | boolean | string> = { ...getDefaultParams(effectId) };
  const overrides = PHONE_EFFECT_PREVIEW_PARAMS[effectId];
  const definition = getEffect(effectId);
  if (!overrides || !definition) return { params, demo: false };
  let demo = false;
  for (const [name, value] of Object.entries(overrides)) {
    const param = definition.params[name];
    if (!param || param.type !== 'number') {
      warnOnce(`${effectId}.${name}`, `Card preview value ${effectId}.${name} skipped: the effect has no number parameter "${name}".`);
      continue;
    }
    const clamped = Math.min(param.max ?? value, Math.max(param.min ?? value, value));
    if (clamped !== value) warnOnce(`${effectId}.${name}:range`, `Card preview value ${effectId}.${name}=${value} clamped to ${clamped}.`);
    params[name] = clamped;
    demo = true;
  }
  return { params, demo };
}
