import type { ScenePlaneLayer, SceneStrandLayer } from '../../../scene/types';
import type { GeometryFiberMaterial } from '../../../../services/operators/geometry/geometryProgram';
import { mergeModelMaterialSettings } from '../../../../types/modelMaterial';
import type { PathTraceMeshPrimitive, SceneNativeMeshLayer } from '../../passes/MeshPass';
import { parseHexColor } from '../../passes/strandLook';
import { PT_MAX_MATERIALS } from '../contracts/ptLayouts';
import {
  DEFAULT_SURFACE_MATERIAL,
  FIBER_MATERIAL_PRESET_VALUES,
  packFiberMaterial,
  packSurfaceMaterial,
  PT_MATERIAL_FLOATS,
  type FiberMaterialParams,
  type SurfaceMaterialParams,
} from '../materials/ptMaterials';

export class PtMaterialLimitError extends Error {}

/** Fiber Material node values as BSDF parameters. */
export function fiberMaterialParams(material: GeometryFiberMaterial): FiberMaterialParams {
  return { color: parseHexColor(material.color), absorption: material.absorption, melanin: material.melanin,
    melaninRedness: material.melaninRedness, roughnessLongitudinal: material.roughnessLongitudinal,
    roughnessAzimuthal: material.roughnessAzimuthal, cuticleTilt: material.cuticleTilt, ior: material.ior,
    coatTint: parseHexColor(material.coatTint), matte: material.matte, fuzz: material.fuzz };
}

/**
 * The material table of one frame (uniform array, PT_MAX_MATERIALS entries). Strand layers get one
 * entry per Fiber Material in chain order (the per-point attribute holds the index), or one wool
 * entry tinted with Strand Render's Color when the graph has no Fiber Material.
 */
export class PtMaterialTable {
  readonly data = new Float32Array(PT_MAX_MATERIALS * PT_MATERIAL_FLOATS);
  count = 0;

  private next(): number {
    if (this.count >= PT_MAX_MATERIALS) throw new PtMaterialLimitError(`The scene needs more than ${PT_MAX_MATERIALS} materials`);
    return this.count++;
  }

  addStrandLayer(layer: SceneStrandLayer): number {
    const render = layer.strands.program.render!;
    const base = this.count;
    if (render.materials?.length) {
      for (const material of render.materials) {
        packFiberMaterial(this.data, this.next(), fiberMaterialParams(material),
          { color: !!material.colorField, melanin: !!material.melaninField, roughness: !!material.roughnessField });
      }
    } else {
      packFiberMaterial(this.data, this.next(), { ...FIBER_MATERIAL_PRESET_VALUES.wool, color: parseHexColor(render.color) });
    }
    return base;
  }

  addSurface(params: SurfaceMaterialParams): number {
    const index = this.next();
    packSurfaceMaterial(this.data, index, params);
    return index;
  }
}

const opacityOf = (layer: { opacity: number }) => Math.max(0, Math.min(1, layer.opacity ?? 1));

/** Mesh primitive material: raster color and unlit state, PBR fields from the scene graph or the model material. */
export function meshSurfaceMaterial(layer: SceneNativeMeshLayer, primitive: PathTraceMeshPrimitive, textureLayer: number): SurfaceMaterialParams {
  const plan = layer.kind === 'primitive' ? layer.surfacePlan : undefined;
  const settings = layer.kind === 'model' ? mergeModelMaterialSettings(layer.modelMaterialSettings) : undefined;
  const emissionColor = settings?.emissionColor ? parseHexColor(settings.emissionColor) : [1, 1, 1];
  const strength = settings?.emissionStrength ?? 0;
  const roughness = plan?.roughness ?? settings?.roughness ?? 1;
  const metallic = plan?.metallic ?? settings?.metallic ?? 0;
  return {
    ...DEFAULT_SURFACE_MATERIAL,
    baseColor: [primitive.material.color[0], primitive.material.color[1], primitive.material.color[2]],
    opacity: primitive.material.color[3] * opacityOf(layer) * (plan?.opacity ?? 1),
    roughness, metallic,
    emission: plan?.emission ?? (strength > 0 ? emissionColor.map(c => c * strength) as [number, number, number] : [0, 0, 0]),
    emissionFromTexture: (plan?.emissionFromTexture ?? 0) > 0,
    textureLayer: primitive.material.textureEnabled ? textureLayer : -1,
    unlit: primitive.material.unlit,
  };
}

/** Voxel blocks: each block's color comes from its record (the raster's source color and tint), lit and rough. */
export function voxelSurfaceMaterial(layer: { opacity: number }): SurfaceMaterialParams {
  return { ...DEFAULT_SURFACE_MATERIAL, baseColor: [1, 1, 1], opacity: opacityOf(layer), roughness: 0.7, metallic: 0, primitiveColor: true };
}

/** Flock points: the color of each sphere; lit points are rough diffuse, unlit ones glow in their color. */
export function sphereSetMaterial(lit: boolean): SurfaceMaterialParams {
  return { ...DEFAULT_SURFACE_MATERIAL, baseColor: [1, 1, 1], roughness: 0.55, metallic: 0, primitiveColor: true, unlit: !lit };
}

/**
 * Plane material. The raster shows a plane's texture unlit, so by default the path tracer lets it
 * emit that texture (same look in both engines, and it lights its surroundings like a screen).
 * Once material.surface sets roughness or metallic, the plane is a lit surface with the texture as
 * base color and the material's emission on top.
 */
export function planeSurfaceMaterial(layer: ScenePlaneLayer, textureLayer: number): SurfaceMaterialParams {
  const plan = layer.surfacePlan;
  const lit = plan?.roughness !== undefined || plan?.metallic !== undefined;
  return {
    ...DEFAULT_SURFACE_MATERIAL,
    baseColor: plan?.tint ? [...plan.tint] as [number, number, number] : [1, 1, 1],
    opacity: opacityOf(layer) * (plan?.opacity ?? 1),
    roughness: plan?.roughness ?? 1,
    metallic: plan?.metallic ?? 0,
    emission: plan?.emission ?? [0, 0, 0],
    emissionFromTexture: (plan?.emissionFromTexture ?? 0) > 0,
    textureLayer: plan?.textured === false ? -1 : textureLayer,
    unlit: !lit,
  };
}
