// Transition Registry System
// Modular system for timeline transitions - add new transitions as separate files.
// Mirrors the effect registry (src/effects/index.ts).

import type { TransitionDefinition, TransitionCategory, TransitionType } from './types';
import { Logger } from '../services/logger';

export * from './types';
export { applyEasing, hexToRgb } from './easing';

const log = Logger.create('Transitions');

// Import all transitions
import { crossfade } from './crossfade';
import { dipToBlack } from './dipToBlack';
import { dipToWhite } from './dipToWhite';
import { wipeLeft } from './wipeLeft';
import { wipeRight } from './wipeRight';

// Main transition registry
export const TRANSITION_REGISTRY = new Map<TransitionType, TransitionDefinition>();

// Transitions organized by category
export const TRANSITION_CATEGORIES: Record<TransitionCategory, TransitionDefinition[]> = {
  dissolve: [],
  wipe: [],
  slide: [],
  zoom: [],
};

/**
 * Register a transition definition
 */
function registerTransition(transition: TransitionDefinition) {
  TRANSITION_REGISTRY.set(transition.id, transition);
  TRANSITION_CATEGORIES[transition.category]?.push(transition);
}

// Register all transitions
registerTransition(crossfade);
registerTransition(dipToBlack);
registerTransition(dipToWhite);
registerTransition(wipeLeft);
registerTransition(wipeRight);

// ==================== Helper Functions ====================

/**
 * Get a transition definition by ID
 */
export function getTransition(id: TransitionType): TransitionDefinition | undefined {
  return TRANSITION_REGISTRY.get(id);
}

/**
 * Get all registered transitions
 */
export function getAllTransitions(): TransitionDefinition[] {
  return Array.from(TRANSITION_REGISTRY.values());
}

/**
 * Get transitions by category
 */
export function getTransitionsByCategory(category: TransitionCategory): TransitionDefinition[] {
  return TRANSITION_CATEGORIES[category] || [];
}

/**
 * Get all non-empty categories with their transitions
 */
export function getCategoriesWithTransitions(): { category: TransitionCategory; transitions: TransitionDefinition[] }[] {
  return Object.entries(TRANSITION_CATEGORIES)
    .filter(([, transitions]) => transitions.length > 0)
    .map(([category, transitions]) => ({
      category: category as TransitionCategory,
      transitions,
    }));
}

/**
 * Check if a transition type exists
 */
export function hasTransition(id: string): boolean {
  return TRANSITION_REGISTRY.has(id as TransitionType);
}

/**
 * Build the default parameter values for a transition type from its schema.
 * Used when a transition is first applied so every param has a concrete value.
 */
export function getDefaultTransitionParams(id: string): Record<string, number | boolean | string> {
  const def = TRANSITION_REGISTRY.get(id as TransitionType);
  if (!def) return {};
  const params: Record<string, number | boolean | string> = {};
  for (const [key, param] of Object.entries(def.params)) {
    params[key] = param.default;
  }
  return params;
}

// Log registered transitions in development
if (import.meta.env.DEV) {
  log.info(`Registered ${TRANSITION_REGISTRY.size} transitions: ${Array.from(TRANSITION_REGISTRY.keys()).join(', ')}`);
}
