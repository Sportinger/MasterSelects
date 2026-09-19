// TransformCache - Reuse transform objects to reduce GC pressure
// Only creates new objects when transform values actually change

import type { ClipTransform } from '../../types';
import type { CachedTransform } from './types';
import { LAYER_BUILDER_CONSTANTS } from './types';
import { getEffectiveScale } from '../../utils/transformScale';
import { rotationDegreesToRadians } from '../../utils/rotationUnits';

/**
 * Layer transform data as used in Layer objects
 */
export interface LayerTransform {
  position: { x: number; y: number; z: number };
  anchor: { x: number; y: number; z: number };
  scale: { x: number; y: number; z?: number };
  rotation: { x: number; y: number; z: number };
  opacity: number;
  blendMode: string;
}

/**
 * TransformCache - Caches transform objects per layer to reduce allocations
 */
export class TransformCache {
  private cache = new Map<string, CachedTransform>();

  /**
   * Get transform for a layer, reusing cached objects when possible
   * @param layerId Unique layer ID
   * @param transform The source transform data from interpolation
   * @returns Transform objects suitable for Layer, possibly reused
   */
  getTransform(layerId: string, transform: ClipTransform): LayerTransform {
    const cached = this.cache.get(layerId);

    // If we have a cached transform and source reference matches, reuse objects
    if (cached && cached.sourceRef === transform) {
      return {
        position: cached.position,
        anchor: cached.anchor,
        scale: cached.scale,
        rotation: cached.rotation,
        opacity: cached.opacity,
        blendMode: cached.blendMode,
      };
    }

    // Create new objects
    const position = {
      x: transform.position.x,
      y: transform.position.y,
      z: transform.position.z,
    };

    const anchor = {
      x: transform.anchor?.x ?? 0,
      y: transform.anchor?.y ?? 0,
      z: transform.anchor?.z ?? 0,
    };

    const scale = getEffectiveScale(transform.scale);

    const rotation = rotationDegreesToRadians(transform.rotation);

    const opacity = transform.opacity;
    const blendMode = transform.blendMode;

    // Store in cache
    this.cache.set(layerId, {
      position,
      anchor,
      scale,
      rotation,
      opacity,
      blendMode,
      sourceRef: transform,
    });

    // Limit cache size
    if (this.cache.size > LAYER_BUILDER_CONSTANTS.MAX_TRANSFORM_CACHE) {
      // Delete oldest entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    return { position, anchor, scale, rotation, opacity, blendMode };
  }

  /**
   * Clear the cache (call on composition change)
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache size for debugging
   */
  get size(): number {
    return this.cache.size;
  }
}
