import {
  EFFECT_REGISTRY,
  isFullscreenEffectDefinition,
  type EffectDefinition,
} from '../../../effects';

/**
 * How one registry effect behaves on an adjustment layer. An adjustment layer has no pixels of its
 * own: its effects process the composite of the layers below it (the accumulated frame).
 *
 * - `accumulated-frame`: the effect reads only its input image (and its own parameters, time,
 *   fonts or byte textures), so it works on the composite below exactly as on a clip. Effects that
 *   make pixels transparent (Chroma Key, Pixel Particle Disintegrate, Fisheye edges) work too: the
 *   compositor replaces the frame below with an adjustment layer's result by its coverage instead
 *   of compositing over it (composite.wgsl, adjustment replace mix).
 * - `previous-output-feedback`: the effect also reads its own previous output frame (trails,
 *   feedback). That history is the effect's output on this layer, which an adjustment layer has.
 * - `unavailable`: the effect needs something an adjustment layer does not have. It is never
 *   admitted; the inspector, the log and tool results name the reason.
 */
export type AdjustmentEffectBehavior =
  | 'accumulated-frame'
  | 'previous-output-feedback'
  | 'unavailable';

export type AdjustmentEffectUnavailableCode =
  | 'unknown-effect'
  | 'audio-effect'
  | 'source-history'
  | 'tracked-source'
  | 'scene-only'
  | 'source-artifact';

export interface AdjustmentEffectClassification {
  readonly effectType: string;
  readonly behavior: AdjustmentEffectBehavior;
  readonly admitted: boolean;
  readonly unavailableCode?: AdjustmentEffectUnavailableCode;
  /** Plain sentence for the inspector, log and tool results; set for every unavailable effect. */
  readonly reason?: string;
}

const UNAVAILABLE_REASONS: Readonly<Record<AdjustmentEffectUnavailableCode, string>> = {
  'unknown-effect': 'it is not an effect of this editor version.',
  'audio-effect': 'it is an audio effect, and an adjustment layer only processes the picture.',
  'source-history':
    'it samples earlier frames of the clip\'s own source video, and an adjustment layer has no source video (only the composite below it).',
  'tracked-source':
    'it follows landmarks tracked in the clip\'s own video, and an adjustment layer has no tracked video of its own.',
  'scene-only':
    'it draws into the 3D scene of a 3D or splat layer and leaves the picture unchanged, so on an adjustment layer it would do nothing.',
  'source-artifact':
    'it extends the clip\'s own source image with a generated fill, and an adjustment layer has no source image.',
};

/**
 * Effects whose limitation the registry flags cannot express. Every id must stay a registry effect
 * (tests/unit/motionAdjustmentEffectClassification.test.ts checks it).
 */
export const EXPLICIT_UNAVAILABLE_ADJUSTMENT_EFFECTS: Readonly<Record<string, AdjustmentEffectUnavailableCode>> = Object.freeze({
  flocking: 'scene-only',
  weave: 'scene-only',
  'splat-exploration': 'scene-only',
  'ai-edge-fill': 'source-artifact',
  'face-cables': 'tracked-source',
});

const cache = new Map<string, AdjustmentEffectClassification>();

function unavailable(effectType: string, code: AdjustmentEffectUnavailableCode, name = effectType): AdjustmentEffectClassification {
  return Object.freeze({
    effectType,
    behavior: 'unavailable',
    admitted: false,
    unavailableCode: code,
    reason: `${name} cannot run on an adjustment layer: ${UNAVAILABLE_REASONS[code]}`,
  });
}

function classifyDefinition(effectType: string, definition: EffectDefinition): AdjustmentEffectClassification {
  const explicit = EXPLICIT_UNAVAILABLE_ADJUSTMENT_EFFECTS[effectType];
  if (explicit) return unavailable(effectType, explicit, definition.name);
  if (isFullscreenEffectDefinition(definition)) {
    if (definition.sourceTimeOwner) return unavailable(effectType, 'source-history', definition.name);
    if (definition.landmarkPoints) return unavailable(effectType, 'tracked-source', definition.name);
    if (definition.usesFeedback) {
      return Object.freeze({ effectType, behavior: 'previous-output-feedback', admitted: true });
    }
  }
  return Object.freeze({ effectType, behavior: 'accumulated-frame', admitted: true });
}

/** Classification of one effect type on an adjustment layer (cached per type). */
export function classifyAdjustmentEffect(effectType: string): AdjustmentEffectClassification {
  const cached = cache.get(effectType);
  if (cached) return cached;
  const definition = EFFECT_REGISTRY.get(effectType);
  const result = effectType.startsWith('audio-')
    ? unavailable(effectType, 'audio-effect')
    : definition
      ? classifyDefinition(effectType, definition)
      : unavailable(effectType, 'unknown-effect');
  if (definition || result.unavailableCode === 'audio-effect') cache.set(effectType, result);
  return result;
}

/** Every public registry effect with its adjustment-layer classification, registry order. */
export function listAdjustmentEffectClassifications(): AdjustmentEffectClassification[] {
  return [...EFFECT_REGISTRY.keys()].map(classifyAdjustmentEffect);
}

export function isAdjustmentEffectAdmitted(effectType: string): boolean {
  return classifyAdjustmentEffect(effectType).admitted;
}
