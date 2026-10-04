import { PT_MATERIAL, PT_MATERIAL_FLAG, PT_MATERIAL_KIND } from '../contracts/ptLayouts';

const FLOATS = PT_MATERIAL.size / 4;

/** Fiber material as the Fiber Material node defines it (plan 4.10); see ptChiangHair.ts for the model. */
export interface FiberMaterialParams {
  color: [number, number, number];
  absorption: 'color' | 'melanin';
  melanin: number;
  melaninRedness: number;
  /** Longitudinal (β_m) and azimuthal (β_n) roughness in [0, 1]. */
  roughnessLongitudinal: number;
  roughnessAzimuthal: number;
  /** Cuticle tilt in degrees. */
  cuticleTilt: number;
  ior: number;
  coatTint: [number, number, number];
  /** Share of the matte (diffuse) lobe in [0, 1]. */
  matte: number;
  /** Extra roughness of flyaway fibers in [0, 1]. */
  fuzz: number;
}

export type FiberMaterialPreset = 'wool' | 'cotton' | 'silk' | 'synthetic' | 'hair';
export const FIBER_MATERIAL_PRESETS: readonly FiberMaterialPreset[] = ['wool', 'cotton', 'silk', 'synthetic', 'hair'];

/** Starting points per fiber; Phase 4.3 calibrates them against high sample references. */
export const FIBER_MATERIAL_PRESET_VALUES: Record<FiberMaterialPreset, FiberMaterialParams> = {
  wool: { color: [0.93, 0.9, 0.85], absorption: 'color', melanin: 0, melaninRedness: 0, roughnessLongitudinal: 0.45,
    roughnessAzimuthal: 0.75, cuticleTilt: 3, ior: 1.55, coatTint: [1, 1, 1], matte: 0.35, fuzz: 0.5 },
  cotton: { color: [0.95, 0.94, 0.91], absorption: 'color', melanin: 0, melaninRedness: 0, roughnessLongitudinal: 0.55,
    roughnessAzimuthal: 0.85, cuticleTilt: 2, ior: 1.53, coatTint: [1, 1, 1], matte: 0.5, fuzz: 0.35 },
  silk: { color: [0.96, 0.93, 0.87], absorption: 'color', melanin: 0, melaninRedness: 0, roughnessLongitudinal: 0.15,
    roughnessAzimuthal: 0.35, cuticleTilt: 1, ior: 1.55, coatTint: [1, 1, 1], matte: 0.05, fuzz: 0.1 },
  synthetic: { color: [0.94, 0.94, 0.95], absorption: 'color', melanin: 0, melaninRedness: 0, roughnessLongitudinal: 0.2,
    roughnessAzimuthal: 0.4, cuticleTilt: 0.5, ior: 1.58, coatTint: [1, 1, 1], matte: 0.1, fuzz: 0.15 },
  hair: { color: [0.35, 0.22, 0.12], absorption: 'melanin', melanin: 1.3, melaninRedness: 0.25, roughnessLongitudinal: 0.3,
    roughnessAzimuthal: 0.3, cuticleTilt: 2, ior: 1.55, coatTint: [1, 1, 1], matte: 0, fuzz: 0.2 },
};

/** Per-point fields a fiber material reads (colorField: absolute color; others multiply / replace). */
export interface FiberMaterialFieldFlags { color?: boolean; melanin?: boolean; roughness?: boolean }

export function packFiberMaterial(target: Float32Array, index: number, params: FiberMaterialParams, fields: FiberMaterialFieldFlags = {}): void {
  const flags = (fields.color ? PT_MATERIAL_FLAG.colorField : 0) | (fields.melanin ? PT_MATERIAL_FLAG.melaninField : 0)
    | (fields.roughness ? PT_MATERIAL_FLAG.roughnessField : 0);
  target.set([
    PT_MATERIAL_KIND.fiber, flags, -1, 1,
    ...params.color, params.roughnessLongitudinal,
    params.roughnessAzimuthal, params.cuticleTilt * Math.PI / 180, params.ior, params.absorption === 'melanin' ? 1 : 0,
    ...params.coatTint, params.melanin,
    params.melaninRedness, params.matte, params.fuzz, 0,
  ], index * FLOATS);
}

/** Surface material of meshes, planes, voxels and flock points (plan 4.5). */
export interface SurfaceMaterialParams {
  baseColor: [number, number, number];
  opacity: number;
  roughness: number;
  metallic: number;
  /** Emitted radiance, already multiplied by the emission strength. */
  emission: [number, number, number];
  emissionFromTexture: boolean;
  /** Texture atlas layer of the base color (-1: none) and its sub-rectangle (u0, v0, u1, v1). */
  textureLayer: number;
  textureRect: [number, number, number, number];
  unlit: boolean;
  /** Voxels and flock points: the base color comes from each primitive. */
  primitiveColor: boolean;
}

export const DEFAULT_SURFACE_MATERIAL: SurfaceMaterialParams = {
  baseColor: [0.8, 0.8, 0.8], opacity: 1, roughness: 1, metallic: 0, emission: [0, 0, 0], emissionFromTexture: false,
  textureLayer: -1, textureRect: [0, 0, 1, 1], unlit: false, primitiveColor: false,
};

export function packSurfaceMaterial(target: Float32Array, index: number, params: SurfaceMaterialParams): void {
  target.set([
    PT_MATERIAL_KIND.surface, params.primitiveColor ? PT_MATERIAL_FLAG.primitiveColor : 0, params.textureLayer, params.opacity,
    ...params.baseColor, params.roughness,
    params.metallic, params.unlit ? 1 : 0, 0, 0,
    ...params.emission, params.emissionFromTexture ? 1 : 0,
    ...params.textureRect,
  ], index * FLOATS);
}

export const PT_MATERIAL_FLOATS = FLOATS;
