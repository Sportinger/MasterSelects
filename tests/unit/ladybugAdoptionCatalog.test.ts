import { describe, expect, it } from 'vitest';
import {
  EFFECT_CATEGORIES,
  getAllEffects,
  getDefaultParams,
  getEffect,
  isComputeEffectDefinition,
  isFullscreenEffectDefinition,
} from '../../src/effects';
import { STARTER_LOOKS } from '../../src/effects/looks/starterLooks';
import {
  decorateLandmarkEffects,
  getLandmarkEffectPoints,
  landmarkRuntime,
} from '../../src/services/landmarkTracking/landmarkRuntime';
import type { Effect } from '../../src/types/effects';
import { LANDMARK_MODELS } from '../../src/services/landmarkTracking/modelCatalog';

const ADOPTED_EFFECT_IDS = [
  'dither', 'dither-studio', 'halftone', 'pattern-halftone', 'riso', 'riso-glow',
  'paper-print', 'pixel-poster', 'tone-geometry', 'cross-stitch', 'glitch-grid',
  'scatter-mosaic', 'drift-lines', 'glitch', 'pixel-sort', 'crystal',
  'glass-dispersion', 'ribbon-scan', 'crt-screen', 'film-prism', 'wave-lines', 'holo',
  'blockify', 'block-mosaic', 'ascii', 'ascii-ghost', 'dither-text', 'word-mosaic',
  'matrix', 'pixel-code', 'number-field', 'grid-glyph', 'capsule-cloud', 'inscribe',
  'data-hatch', 'glyph-matrix', 'symbol-matrix', 'retro-matrix', 'pixel-dither',
  'brand-generator', 'ui-collage', 'stitch-poster', 'voronoi', 'quadtree-zoom',
  'contour', 'contour-map', 'contour-type', 'vector-tiling', 'crosshatch',
  'embroidery', 'kilim', 'outline', 'bricks', 'subject', 'tracked-scene',
  'hud-tracker', 'cctv', 'kinetic-trace', 'rain-reveal', 'stardust', 'hand-particles',
] as const;

describe('Ladybug adoption catalog', () => {
  it('registers the complete original implementation catalog in split categories', () => {
    expect(new Set(ADOPTED_EFFECT_IDS).size).toBe(61);
    for (const id of ADOPTED_EFFECT_IDS) expect(getEffect(id), id).toBeDefined();
    expect(EFFECT_CATEGORIES.halftone).toHaveLength(13);
    expect(EFFECT_CATEGORIES.glyph).toHaveLength(18);
    expect(EFFECT_CATEGORIES.geometry).toHaveLength(11);
    expect(EFFECT_CATEGORIES.tracking).toHaveLength(8);
    expect(EFFECT_CATEGORIES.analog.map((effect) => effect.id)).toContain('pixel-sort');
  });

  it('packs every GPU definition to its declared aligned uniform size', () => {
    for (const effect of getAllEffects()) {
      if (!isFullscreenEffectDefinition(effect) && !isComputeEffectDefinition(effect)) continue;
      const packed = effect.packUniforms(getDefaultParams(effect.id), 1920, 1080);
      if (effect.uniformSize === 0) {
        expect(packed, effect.id).toBeNull();
      } else {
        expect(packed?.byteLength, effect.id).toBe(effect.uniformSize);
        expect(effect.uniformSize % 16, effect.id).toBe(0);
      }
    }
    expect(isComputeEffectDefinition(getEffect('voronoi'))).toBe(true);
    expect(isComputeEffectDefinition(getEffect('pixel-sort'))).toBe(true);
    expect(isComputeEffectDefinition(getEffect('quadtree-zoom'))).toBe(true);
    expect(isComputeEffectDefinition(getEffect('contour'))).toBe(true);
  });

  it('ships 14 valid curated looks with only declared parameters', () => {
    expect(STARTER_LOOKS).toHaveLength(14);
    for (const look of STARTER_LOOKS) {
      expect(look.stack.length, look.id).toBeGreaterThan(0);
      for (const entry of look.stack) {
        const effect = getEffect(entry.effectId);
        expect(effect, `${look.id}:${entry.effectId}`).toBeDefined();
        for (const key of Object.keys(entry.params)) {
          expect(effect?.params, `${look.id}:${entry.effectId}:${key}`).toHaveProperty(key);
        }
      }
    }
  });
});

describe('landmark effect payloads', () => {
  const hand = Array.from({ length: 21 }, (_, index) => ({
    x: index / 20,
    y: 1 - index / 20,
    z: index / 100,
  }));

  function effect(source: string): Effect {
    return {
      id: `hand-${source}`,
      type: 'hand-particles',
      name: 'Hand Particles',
      enabled: true,
      params: { source },
    };
  }

  it('keeps fingertip, all-point, and centroid sources distinct', () => {
    landmarkRuntime.setSeries({
      version: 1,
      clipId: 'clip-landmarks',
      sampleInterval: 1 / 15,
      createdAt: 1,
      frames: [{ time: 0, hands: [hand], faces: [], poses: [] }],
    });
    const effects = [effect('fingertips'), effect('all'), effect('centroid')];
    decorateLandmarkEffects('clip-landmarks', 0, effects);
    expect(getLandmarkEffectPoints('hand-fingertips')).toHaveLength(5);
    expect(getLandmarkEffectPoints('hand-all')).toHaveLength(21);
    expect(getLandmarkEffectPoints('hand-centroid')).toHaveLength(1);
    expect(getLandmarkEffectPoints('hand-fingertips').map((point) => point.x)).toEqual([
      hand[4].x, hand[8].x, hand[12].x, hand[16].x, hand[20].x,
    ]);
  });

  it('uses only Apache-licensed Google model sources', () => {
    for (const model of Object.values(LANDMARK_MODELS)) {
      expect(model.license).toBe('Apache-2.0');
      expect(new URL(model.url).hostname).toBe('storage.googleapis.com');
    }
  });
});
