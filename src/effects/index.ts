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
 * Get default parameters for an effect
 */
export function getDefaultParams(id: string): Record<string, number | boolean | string> {
  const effect = getEffect(id);
  if (!effect) return {};

  const defaults: Record<string, number | boolean | string> = {};
  Object.entries(effect.params).forEach(([key, param]) => {
    defaults[key] = param.default;
  });
  return defaults;
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
 * Get all non-empty categories with their effects
 */
export function getCategoriesWithEffects(): { category: EffectCategory; effects: EffectDefinition[] }[] {
  return Object.entries(EFFECT_CATEGORIES)
    .filter(([, effects]) => effects.length > 0)
    .map(([category, effects]) => ({
      category: category as EffectCategory,
      effects,
    }));
}

/**
 * Check if an effect type exists
 */
export function hasEffect(id: string): boolean {
  return EFFECT_REGISTRY.has(id) || INTERNAL_EFFECT_REGISTRY.has(id);
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
