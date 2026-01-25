// TransformCache - Reuse transform objects to reduce GC pressure
// Only creates new objects when transform values actually change

import type { CachedTransform } from './types';
import { LAYER_BUILDER_CONSTANTS } from './types';

/**
 * Layer transform data as used in Layer objects
 */
export interface LayerTransform {
  position: { x: number; y: number; z: number };
  scale: { x: number; y: number };
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
  getTransform(layerId: string, transform: any): LayerTransform {
    const cached = this.cache.get(layerId);

    // If we have a cached transform and source reference matches, reuse objects
    if (cached && cached.sourceRef === transform) {
      return {
        position: cached.position,
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

    const scale = {
      x: transform.scale.x,
      y: transform.scale.y,
    };

    // Convert rotation from degrees to radians
    const rotation = {
      x: (transform.rotation.x * Math.PI) / 180,
      y: (transform.rotation.y * Math.PI) / 180,
      z: (transform.rotation.z * Math.PI) / 180,
    };

    const opacity = transform.opacity;
    const blendMode = transform.blendMode;

    // Store in cache
    this.cache.set(layerId, {
      position,
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

    return { position, scale, rotation, opacity, blendMode };
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
