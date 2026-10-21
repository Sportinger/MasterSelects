// Effect Registry System
// Auto-discovers and registers all effects from category folders

import {
  isFullscreenEffectDefinition,
  isComputeEffectDefinition,
  isParticleRenderEffectDefinition,
  type EffectDefinition,
  type EffectCategory,
  type FullscreenEffectDefinition,
} from './types';
import { Logger } from '../services/logger';
import { EFFECT_GROUPS, EFFECTS_HIDDEN_FROM_CATALOG, effectGroup, type EffectGroupId } from './effectCatalogGroups';
export { effectGroup, effectEngine, effectEngineMembers, EFFECT_GROUPS, EFFECTS_HIDDEN_FROM_CATALOG } from './effectCatalogGroups';
export * from './types';

const log = Logger.create('Effects');

// Import all effects from each category
import * as colorEffects from './color';
import * as distortEffects from './distort';
import * as blurEffects from './blur';
import * as stylizeEffects from './stylize';
import * as generateEffects from './generate';
import * as keyingEffects from './keying';
import * as timeEffects from './time';
import * as transitionEffects from './transition';
import * as halftoneEffects from './halftone';
import * as analogEffects from './analog';
import * as pixelEffects from './pixel';
import * as glyphEffects from './glyph';
import * as geometryEffects from './geometry';
import * as trackingEffects from './tracking';

// Main effect registry
export const EFFECT_REGISTRY = new Map<string, EffectDefinition>();

// Render-only primitives remain addressable by the runtime without becoming
// public catalog entries. Keeping them separate preserves the registry/category
// invariant used by effect pickers, AI tools, and project property discovery.
const INTERNAL_EFFECT_REGISTRY = new Map<string, EffectDefinition>();

// Effects organized by category
export const EFFECT_CATEGORIES: Record<EffectCategory, EffectDefinition[]> = {
  color: [],
  blur: [],
  distort: [],
  stylize: [],
  generate: [],
  keying: [],
  time: [],
  transition: [],
  halftone: [],
  analog: [],
  pixel: [],
  glyph: [],
  geometry: [],
  tracking: [],
};

/**
 * Register effects from a module export
 */
function registerEffects(effects: Record<string, unknown>) {
  Object.values(effects).forEach(effect => {
    if (isEffectDefinition(effect)) {
      if ('internal' in effect && effect.internal) {
        INTERNAL_EFFECT_REGISTRY.set(effect.id, effect);
        return;
      }
      EFFECT_REGISTRY.set(effect.id, effect);
      EFFECT_CATEGORIES[effect.category]?.push(effect);
    }
  });
}

/**
 * Type guard to check if an object is an EffectDefinition
 */
function isEffectDefinition(obj: unknown): obj is EffectDefinition {
  if (
    typeof obj === 'object' &&
    obj !== null &&
    'id' in obj &&
    'name' in obj &&
    'category' in obj &&
    'params' in obj
  ) {
    return isFullscreenEffectDefinitionCandidate(obj)
      || isParticleRenderEffectDefinition(obj as EffectDefinition)
      || isComputeEffectDefinition(obj as EffectDefinition);
  }
  return false;
}

function isFullscreenEffectDefinitionCandidate(obj: object): obj is FullscreenEffectDefinition {
  return (
    (!('pipelineKind' in obj) || obj.pipelineKind === 'fullscreen') &&
    'shader' in obj &&
    'entryPoint' in obj &&
    'params' in obj &&
    'packUniforms' in obj
  );
}

// Register all effects
registerEffects(colorEffects);
registerEffects(distortEffects);
registerEffects(blurEffects);
registerEffects(stylizeEffects);
registerEffects(generateEffects);
registerEffects(keyingEffects);
registerEffects(timeEffects);
registerEffects(transitionEffects);
registerEffects(halftoneEffects);
registerEffects(analogEffects);
registerEffects(pixelEffects);
registerEffects(glyphEffects);
registerEffects(geometryEffects);
registerEffects(trackingEffects);

// ==================== Helper Functions ====================

/**
 * Get an effect definition by ID
 */
export function getEffect(id: string): EffectDefinition | undefined {
  return EFFECT_REGISTRY.get(id) ?? INTERNAL_EFFECT_REGISTRY.get(id);
}

/**
 * The name to show for an effect instance. New instances are named after their type id
 * (`gaussian-blur`); those show the registered name (Gaussian Blur), renamed ones their own.
 */
export function getEffectDisplayName(effect: { name: string; type: string }): string {
  return effect.name === effect.type ? getEffect(effect.type)?.name ?? effect.name : effect.name;
}

/**
 * Get default parameters for an effect
 */
export function getDefaultParams(id: string): Record<string, number | boolean | string> {
  const effect = getEffect(id);
  if (!effect) return {};

  // Retired (deprecated) parameters are still accepted from saved projects, but new instances
  // do not carry them: nothing reads them, and graphs fall back to the catalog default.
  const defaults: Record<string, number | boolean | string> = {};
  Object.entries(effect.params).forEach(([key, param]) => {
    if (!param.deprecated) defaults[key] = param.default;
  });
  return defaults;
}

/**
 * The values a stored instance renders for parameters it does not carry: `legacyDefault` (instances
 * saved before the parameter existed keep their look), otherwise `default`. Inspectors fill missing
 * parameters with these, so they show what renders; new instances store getDefaultParams.
 */
export function getRenderedDefaultParams(id: string): Record<string, number | boolean | string> {
  const effect = getEffect(id);
  if (!effect) return {};
  const defaults: Record<string, number | boolean | string> = {};
  Object.entries(effect.params).forEach(([key, param]) => {
    if (!param.deprecated) defaults[key] = param.legacyDefault ?? param.default;
  });
  return defaults;
}

/**
 * `params` with every parameter the instance does not carry set to its `legacyDefault`, the value it
 * renders with. Use it where stored params are copied into a new instance (Looks), which would
 * otherwise get the new `default`. Returns `params` itself when nothing is missing.
 */
export function withLegacyDefaultParams<T extends Record<string, unknown>>(id: string, params: T): T {
  const missing = Object.entries(getEffect(id)?.params ?? {})
    .filter(([key, param]) => param.legacyDefault !== undefined && !param.deprecated && params[key] === undefined);
  return missing.length ? { ...params, ...Object.fromEntries(missing.map(([key, param]) => [key, param.legacyDefault])) } : params;
}

type RateTravel = readonly [rate: string, travel: string];
const rateTravelCache = new Map<string, readonly RateTravel[]>();

/** Rate parameters of an effect type and the runtime-only parameter their travelled distance goes to (EffectParam.integratedAs). */
export function effectRateTravelParams(id: string): readonly RateTravel[] {
  let entries = rateTravelCache.get(id);
  if (!entries) {
    entries = Object.entries(getEffect(id)?.params ?? {})
      .flatMap(([name, definition]) => definition.integratedAs ? [[name, definition.integratedAs] as const] : []);
    if (getEffect(id)) rateTravelCache.set(id, entries);
  }
  return entries;
}

/**
 * `params` without runtime-only travel parameters (speedTravel, spinTravel). Rendering computes
 * them from a keyframed rate; a stored value (a tool call or a save before 2026-10-21) would freeze
 * the pattern. Returns `params` itself when it carries none.
 */
export function withoutRuntimeTravelParams<T extends Record<string, unknown>>(id: string, params: T): T {
  const stored = effectRateTravelParams(id).filter(([, travel]) => travel in params);
  if (!stored.length) return params;
  const kept = { ...params };
  for (const [, travel] of stored) delete kept[travel];
  return kept;
}

/**
 * Get all registered effects
 */
export function getAllEffects(): EffectDefinition[] {
  return Array.from(EFFECT_REGISTRY.values());
}

/**
 * Get effects by category
 */
export function getEffectsByCategory(category: EffectCategory): EffectDefinition[] {
  return EFFECT_CATEGORIES[category] || [];
}

/**
 * Effects offered for adding, grouped by look in catalog order (`category` is
 * the group's display name). Hidden styles such as Rom1 stay loadable.
 */
export function getCategoriesWithEffects(): { category: string; group: EffectGroupId | 'other'; effects: EffectDefinition[] }[] {
  const offered = [...EFFECT_REGISTRY.values()].filter(effect => !EFFECTS_HIDDEN_FROM_CATALOG.has(effect.id));
  const groups = [...EFFECT_GROUPS.map(group => ({ id: group.id as EffectGroupId | 'other', label: group.label as string })), { id: 'other' as const, label: 'Other' }];
  const curated = new Map<string, number>(EFFECT_GROUPS.flatMap(group => group.effects.map((id, index) => [id, index] as const)));
  return groups.map(group => ({ category: group.label, group: group.id,
    effects: offered.filter(effect => effectGroup(effect.id).id === group.id)
      .toSorted((a, b) => (curated.get(a.id) ?? Infinity) - (curated.get(b.id) ?? Infinity)) }))
    .filter(group => group.effects.length > 0);
}

/**
 * Check if an effect type exists
 */
export function hasEffect(id: string): boolean {
  return EFFECT_REGISTRY.has(id) || INTERNAL_EFFECT_REGISTRY.has(id);
}

/**
 * Accept node-catalog IDs (`effect:glow`) wherever an effect type is expected;
 * the catalog prefixes effect entries, the registry does not.
 */
export function resolveEffectTypeId(id: string): string {
  return id.startsWith('effect:') && hasEffect(id.slice(7)) ? id.slice(7) : id;
}

/**
 * Check if an active effect stack needs wall-clock driven re-rendering.
 */
export function effectStackNeedsContinuousRender(
  effects: Array<{ type: string; enabled?: boolean }> | undefined
): boolean {
  if (!effects || effects.length === 0) return false;

  return effects.some(effect =>
    effect.enabled !== false &&
    getEffect(effect.type)?.requiresContinuousRender === true
  );
}

/**
 * Get effect config for pipeline creation (compatibility layer)
 */
export function getEffectConfig(id: string): { entryPoint: string; needsUniform: boolean; uniformSize: number } | undefined {
  const effect = getEffect(id);
  if (!isFullscreenEffectDefinition(effect)) return undefined;

  return {
    entryPoint: effect.entryPoint,
    needsUniform: effect.uniformSize > 0,
    uniformSize: effect.uniformSize,
  };
}

// Log registered effects in development
if (import.meta.env.DEV) {
  log.info(
    `Registered ${EFFECT_REGISTRY.size} catalog effects and ${INTERNAL_EFFECT_REGISTRY.size} render primitives: ${Array.from(EFFECT_REGISTRY.keys()).join(', ')}`
  );
}
