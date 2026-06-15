// Transition Registry System
// Modular system for timeline transitions - add new transitions as separate files

import type {
  TransitionCapabilityOptions,
  TransitionDefinition,
  TransitionCategory,
  TransitionParamValue,
  TransitionType,
} from './types';
import {
  isTransitionRuntimeEnabled,
  isTransitionVisibleInRegistry,
  normalizeTransitionParamsForDefinition,
} from './types';
import { Logger } from '../services/logger';

export * from './types';

const log = Logger.create('Transitions');

// Import all transitions
import { additiveDissolve } from './additiveDissolve';
import { barnDoorHorizontal } from './barnDoorHorizontal';
import { barnDoorVertical } from './barnDoorVertical';
import { blurDissolve } from './blurDissolve';
import { blockGlitch } from './blockGlitch';
import { checkerWipe } from './checkerWipe';
import { chromaLeak } from './chromaLeak';
import { crossfade } from './crossfade';
import { centerWipe } from './centerWipe';
import { circleIris } from './circleIris';
import { clockWipe } from './clockWipe';
import { crossIris } from './crossIris';
import { crtCollapse } from './crtCollapse';
import { diamondIris } from './diamondIris';
import { doomBars } from './doomBars';
import { dipToColor } from './dipToColor';
import { dipToBlack } from './dipToBlack';
import { dipToWhite } from './dipToWhite';
import { directionalBlur } from './directionalBlur';
import { cardSpin } from './cardSpin';
import { filmRoll } from './filmRoll';
import { filmBurn } from './filmBurn';
import { flash } from './flash';
import { flipHorizontal } from './flipHorizontal';
import { flipVertical } from './flipVertical';
import { kaleidoscope } from './kaleidoscope';
import { lightLeak } from './lightLeak';
import { lightSweep } from './lightSweep';
import { lensFlare } from './lensFlare';
import { magneticTiles } from './magneticTiles';
import { mosaicGlitch } from './mosaicGlitch';
import { noiseDissolve } from './noiseDissolve';
import { nonAdditiveDissolve } from './nonAdditiveDissolve';
import { ovalIris } from './ovalIris';
import { paintSplatter } from './paintSplatter';
import { plannedTransitions } from './planned';
import { polkaDotCurtain } from './polkaDotCurtain';
import { projectorFlicker } from './projectorFlicker';
import { puzzlePush } from './puzzlePush';
import { pushLeft } from './pushLeft';
import { pushRight } from './pushRight';
import { pushUp } from './pushUp';
import { pushDown } from './pushDown';
import { randomBlocks } from './randomBlocks';
import { roll3d } from './roll3d';
import { rotate90 } from './rotate90';
import { rotateLeft } from './rotateLeft';
import { rotateRight } from './rotateRight';
import { rgbSplitGlitch } from './rgbSplitGlitch';
import { scanlineGlitch } from './scanlineGlitch';
import { slideLeft } from './slideLeft';
import { slideRight } from './slideRight';
import { slideUp } from './slideUp';
import { slideDown } from './slideDown';
import { spinZoom } from './spinZoom';
import { spinback3d } from './spinback3d';
import { squareIris } from './squareIris';
import { starIris } from './starIris';
import { swirl } from './swirl';
import { triangleIris } from './triangleIris';
import { tumbleAway } from './tumbleAway';
import { venetianBlindsHorizontal } from './venetianBlindsHorizontal';
import { venetianBlindsVertical } from './venetianBlindsVertical';
import { vignetteBloom } from './vignetteBloom';
import { waterDrop } from './waterDrop';
import { wipeLeft } from './wipeLeft';
import { wipeRight } from './wipeRight';
import { wipeUp } from './wipeUp';
import { wipeDown } from './wipeDown';
import { whipPan } from './whipPan';
import { zoomBlur } from './zoomBlur';
import { zoomIn } from './zoomIn';
import { zoomOut } from './zoomOut';
import { zigZagBlocks } from './zigZagBlocks';

export * from './groups';

// Main transition registry
export const TRANSITION_REGISTRY = new Map<TransitionType, TransitionDefinition>();

// Transitions organized by category
export const TRANSITION_CATEGORIES: Record<TransitionCategory, TransitionDefinition[]> = {
  dissolve: [],
  wipe: [],
  slide: [],
  light: [],
  glitch: [],
  pattern: [],
  stylize: [],
  rotate: [],
  '3d': [],
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
registerTransition(blurDissolve);
registerTransition(additiveDissolve);
registerTransition(nonAdditiveDissolve);
registerTransition(dipToColor);
registerTransition(dipToBlack);
registerTransition(dipToWhite);
registerTransition(wipeLeft);
registerTransition(wipeRight);
registerTransition(wipeUp);
registerTransition(wipeDown);
registerTransition(circleIris);
registerTransition(ovalIris);
registerTransition(diamondIris);
registerTransition(squareIris);
registerTransition(triangleIris);
registerTransition(crossIris);
registerTransition(starIris);
registerTransition(clockWipe);
registerTransition(centerWipe);
registerTransition(barnDoorHorizontal);
registerTransition(barnDoorVertical);
registerTransition(pushLeft);
registerTransition(pushRight);
registerTransition(pushUp);
registerTransition(pushDown);
registerTransition(slideLeft);
registerTransition(slideRight);
registerTransition(slideUp);
registerTransition(slideDown);
registerTransition(flash);
registerTransition(lightLeak);
registerTransition(lightSweep);
registerTransition(chromaLeak);
registerTransition(lensFlare);
registerTransition(filmBurn);
registerTransition(projectorFlicker);
registerTransition(filmRoll);
registerTransition(vignetteBloom);
registerTransition(noiseDissolve);
registerTransition(rotateLeft);
registerTransition(rotateRight);
registerTransition(rotate90);
registerTransition(waterDrop);
registerTransition(swirl);
registerTransition(kaleidoscope);
registerTransition(blockGlitch);
registerTransition(crtCollapse);
registerTransition(rgbSplitGlitch);
registerTransition(mosaicGlitch);
registerTransition(scanlineGlitch);
registerTransition(checkerWipe);
registerTransition(randomBlocks);
registerTransition(paintSplatter);
registerTransition(polkaDotCurtain);
registerTransition(doomBars);
registerTransition(venetianBlindsHorizontal);
registerTransition(venetianBlindsVertical);
registerTransition(zigZagBlocks);
registerTransition(puzzlePush);
registerTransition(magneticTiles);
registerTransition(flipHorizontal);
registerTransition(flipVertical);
registerTransition(cardSpin);
registerTransition(tumbleAway);
registerTransition(roll3d);
registerTransition(spinback3d);
registerTransition(zoomIn);
registerTransition(zoomOut);
registerTransition(spinZoom);
registerTransition(zoomBlur);
registerTransition(directionalBlur);
registerTransition(whipPan);
for (const plannedTransition of plannedTransitions) {
  registerTransition(plannedTransition);
}

// ==================== Helper Functions ====================

export interface TransitionQueryOptions extends TransitionCapabilityOptions {
  runtimeOnly?: boolean;
}

function shouldIncludeTransition(
  transition: TransitionDefinition,
  options: TransitionQueryOptions = {},
): boolean {
  return options.runtimeOnly === false
    ? isTransitionVisibleInRegistry(transition, options)
    : isTransitionRuntimeEnabled(transition, options);
}

/**
 * Get a transition definition by ID
 */
export function getTransition(id: string): TransitionDefinition | undefined {
  return TRANSITION_REGISTRY.get(id as TransitionType);
}

/**
 * Get a transition definition only when it is enabled for preview/export/runtime use.
 */
export function getRuntimeTransition(
  id: string,
  options: TransitionCapabilityOptions = {},
): TransitionDefinition | undefined {
  const definition = getTransition(id);
  return definition && isTransitionRuntimeEnabled(definition, options)
    ? definition
    : undefined;
}

/**
 * Get all transitions visible for the supplied capability options.
 */
export function getAllTransitions(options: TransitionQueryOptions = {}): TransitionDefinition[] {
  return Array.from(TRANSITION_REGISTRY.values())
    .filter((transition) => shouldIncludeTransition(transition, options));
}

/**
 * Get transitions by category
 */
export function getTransitionsByCategory(
  category: TransitionCategory,
  options: TransitionQueryOptions = {},
): TransitionDefinition[] {
  return (TRANSITION_CATEGORIES[category] || [])
    .filter((transition) => shouldIncludeTransition(transition, options));
}

/**
 * Get all non-empty categories with their transitions
 */
export function getCategoriesWithTransitions(
  options: TransitionQueryOptions = {},
): { category: TransitionCategory; transitions: TransitionDefinition[] }[] {
  return Object.entries(TRANSITION_CATEGORIES)
    .map(([category, transitions]) => ({
      category: category as TransitionCategory,
      transitions: transitions.filter((transition) => shouldIncludeTransition(transition, options)),
    }))
    .filter((entry) => entry.transitions.length > 0)
    .map((entry) => entry);
}

export function normalizeTransitionInstanceParams<T extends {
  type: string;
  params?: Record<string, TransitionParamValue>;
}>(
  transition: T,
): T {
  const definition = getTransition(transition.type);
  // Known transitions are normalized against their schema and lose unknown params.
  // Unknown/future transition types are preserved so older builds do not
  // destructively strip params they cannot understand during save/load.
  if (!definition) return transition;

  const params = normalizeTransitionParamsForDefinition(definition, transition.params);
  const { params: _params, ...transitionWithoutParams } = transition;
  return {
    ...transitionWithoutParams,
    ...(params ? { params } : {}),
  } as T;
}

export function normalizeTransitionParams(
  transitionType: string,
  patch: Record<string, TransitionParamValue> | undefined,
  base?: Record<string, TransitionParamValue>,
): Record<string, TransitionParamValue> | undefined {
  return normalizeTransitionParamsForDefinition(
    getTransition(transitionType),
    patch,
    base,
  );
}

/**
 * Get all category metadata, including empty filtered categories when requested.
 */
export function getAllTransitionCategories(
  options: TransitionQueryOptions = {},
): { category: TransitionCategory; transitions: TransitionDefinition[] }[] {
  return Object.entries(TRANSITION_CATEGORIES)
    .map(([category, transitions]) => ({
      category: category as TransitionCategory,
      transitions: transitions.filter((transition) => shouldIncludeTransition(transition, options)),
    }));
}

/**
 * Check if a transition type exists
 */
export function hasTransition(id: string): boolean {
  return TRANSITION_REGISTRY.has(id as TransitionType);
}

export function hasRuntimeTransition(
  id: string,
  options: TransitionCapabilityOptions = {},
): boolean {
  const definition = getTransition(id);
  return definition ? isTransitionRuntimeEnabled(definition, options) : false;
}

// Log registered transitions in development
if (import.meta.env.DEV) {
  log.info(`Registered ${TRANSITION_REGISTRY.size} transitions: ${Array.from(TRANSITION_REGISTRY.keys()).join(', ')}`);
}
