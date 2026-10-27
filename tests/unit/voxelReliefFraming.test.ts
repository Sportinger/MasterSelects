import { describe, expect, it } from 'vitest';
import { getDefaultParams, getEffect } from '../../src/effects';
import { isFullscreenEffectDefinition } from '../../src/effects/types';
import { migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { withLegacyLookParams } from '../../src/effects/looks/legacyLookParams';
import {
  VOXEL_FRAMING_REFERENCE_HEIGHT,
  voxelCameraRadius,
  voxelFocalLength,
  voxelVisibleFieldFraction,
} from '../../src/effects/stylize/voxel-relief/framing';
import type { Effect } from '../../src/types/effects';

/** Slot of `cameraRadius` in the packed VoxelReliefParams (after pad2). */
const CAMERA_RADIUS_SLOT = 28;

/** "main voxel primary A" of the golden smoke stress fixture (stressTest/mainComposition.ts). */
const STRESS_FIXTURE = {
  columns: 92, baseHeight: 0.012, gap: 0.055, tilt: 86, yaw: 0, perspective: 0.46, heightContrast: 1.2,
  ambient: 0.54, lightStrength: 0.62, colorMix: 0.94, temporalBlend: 0.08, lightAngle: 315, lightElevation: 48,
  floorBrightness: 0.08, edgeDarkness: 0.72, maxSteps: 64, reset: false,
};

function packed(params: Record<string, number | boolean | string>): Float32Array {
  const voxel = getEffect('voxel-relief')!;
  if (!isFullscreenEffectDefinition(voxel)) throw new Error('Voxel Relief is a fullscreen effect');
  return voxel.packUniforms({ ...getDefaultParams('voxel-relief'), ...params }, 320, 180) as Float32Array;
}

const visible = (params: Record<string, number | boolean | string>) =>
  voxelVisibleFieldFraction(packed(params)[CAMERA_RADIUS_SLOT], Number(params.perspective ?? 0.22));

describe('Voxel Relief framing', () => {
  it('packs one uniform per byte of the declared uniform size', () => {
    expect(packed({}).length * 4).toBe(getEffect('voxel-relief')!.uniformSize);
  });

  it.each([0, 0.36, 0.43, 0.5, 0.62, 0.78])(
    'keeps the stress fixture framed like its default relief at Height %s (the golden smoke frame)',
    height => {
      // Before 2026-10-27 the camera followed the relief: Height 0.43 at Distance 0.8 saw only 87 %
      // of the layer height and cropped the bright edge of the golden smoke frame away.
      const atHeight = visible({ ...STRESS_FIXTURE, height });
      expect(atHeight).toBeCloseTo(visible({ ...STRESS_FIXTURE, height: 1.2 }), 6);
      expect(atHeight).toBeGreaterThanOrEqual(1);
    },
  );

  it.each([0, 0.36, 0.62, 1.2])('frames the default effect the same at Height %s', height => {
    expect(visible({ height })).toBeCloseTo(visible({ height: 1.2 }), 6);
    // The default Distance 0.8 still fills the layer (a slight crop, no transparent border).
    expect(visible({ height })).toBeCloseTo(0.96, 2);
  });

  it('pulls the camera back for a relief taller than the default', () => {
    const reference = voxelCameraRadius({ perspective: 0.22, distance: 0.8, reliefHeight: VOXEL_FRAMING_REFERENCE_HEIGHT, framing: 'fixed' });
    const tall = voxelCameraRadius({ perspective: 0.22, distance: 0.8, reliefHeight: 3, framing: 'fixed' });
    expect(tall).toBeGreaterThan(reference);
    expect(voxelCameraRadius({ perspective: 0.22, distance: 0.8, reliefHeight: 0.2, framing: 'fixed' })).toBe(reference);
  });

  it('keeps the camera of effects saved before steady framing (it follows Height)', () => {
    for (const height of [0, 0.36, 0.62, 1.2]) {
      const radius = packed({ ...STRESS_FIXTURE, height, distance: 0.8, framing: 'height' })[CAMERA_RADIUS_SLOT];
      const before = Math.max(0.9, voxelFocalLength(0.46) * 0.5 + (0.012 + height) * 0.7) * 0.8;
      expect(radius).toBeCloseTo(before, 5);
    }
  });

  it('stays finite for values keyframes and tools can set', () => {
    for (const params of [
      { perspective: Number.NaN, distance: Number.POSITIVE_INFINITY, height: Number.NaN },
      { perspective: -4, distance: 0, height: -3, baseHeight: -1 },
      { perspective: 40, distance: 400, height: 90 },
    ]) {
      const radius = packed(params)[CAMERA_RADIUS_SLOT];
      expect(Number.isFinite(radius)).toBe(true);
      expect(radius).toBeGreaterThanOrEqual(0.135);
    }
  });

  it('gives saved effects and Looks their earlier framing, new effects the steady one', () => {
    const effect = (params: Effect['params']): Effect => ({ id: 'voxel', name: 'Voxel Relief', type: 'voxel-relief', enabled: true, params });
    const { framing: _framing, ...saved } = getDefaultParams('voxel-relief');
    expect(getDefaultParams('voxel-relief').framing).toBe('fixed');
    expect(migratePersistedEffectOperatorGraph(effect(saved)).params.framing).toBe('height');
    expect(migratePersistedEffectOperatorGraph(effect(getDefaultParams('voxel-relief'))).params.framing).toBe('fixed');
    expect(withLegacyLookParams('voxel-relief', saved).framing).toBe('height');
    expect(withLegacyLookParams('voxel-relief', { ...saved, framing: 'fixed' }).framing).toBe('fixed');
  });
});
