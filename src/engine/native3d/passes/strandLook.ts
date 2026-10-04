import type { GeometryFiberMaterial, GeometryStrandRender } from '../../../services/operators/geometry/geometryProgram';
import { sigmaAFromMelanin } from '../pathtrace/materials/ptChiangHair';

/** Fiber Materials the raster distinguishes per point; further ones reuse the last entry. */
export const STRAND_LOOK_MATERIALS = 16;
/** Floats written by `packStrandLook`: look, look2, coat, then one vec4 per material. */
export const STRAND_LOOK_FLOATS = 12 + STRAND_LOOK_MATERIALS * 4;

/** Highlight model of the raster without a Fiber Material (StrandScene.wgsl before materials existed). */
const LEGACY_LOOK = [90, 24, 0.22, 0.3, 0.35, -0.08, 0.12];

export function parseHexColor(color: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})/i.exec(color.trim());
  const value = match ? Number.parseInt(match[1], 16) : 0xffffff;
  return [(value >> 16 & 255) / 255, (value >> 8 & 255) / 255, (value & 255) / 255];
}

/** Diffuse color of a material: its color, or the color its melanin absorbs to over about one fiber width. */
export function fiberMaterialDiffuse(material: GeometryFiberMaterial): [number, number, number] {
  if (material.absorption === 'color') return parseHexColor(material.color);
  return sigmaAFromMelanin(material.melanin, material.melaninRedness).map(sigma => Math.exp(-1.5 * sigma)) as [number, number, number];
}

/**
 * Maps the first Fiber Material onto the raster's Kajiya-Kay/Marschner highlights (plan 4.8): the
 * lobe exponents follow the longitudinal variance of Chiang's model (R: v, TRT: 4v), the shifts
 * the cuticle tilt (R -2α, TRT 4α), the lobe strengths shrink with the matte share and R takes the
 * coat tint. Writes [rExponent, trtExponent, rStrength, trtStrength], [ttStrength, rShift, trtShift,
 * hasAttributes], [coat rgb, 0] and per material [diffuse rgb or white for a Color Field, 0].
 * Without materials it writes the legacy constants, so existing projects render unchanged.
 */
export function packStrandLook(render: GeometryStrandRender, hasAttributes: boolean, target: Float32Array, offset: number): void {
  target.fill(0, offset, offset + STRAND_LOOK_FLOATS);
  const materials = render.materials ?? [];
  const first = materials[0];
  if (!first) {
    target.set(LEGACY_LOOK, offset);
    target.set([1, 1, 1], offset + 8);
  } else {
    const beta = first.roughnessLongitudinal, v = (0.726 * beta + 0.812 * beta * beta + 3.7 * beta ** 20) ** 2;
    const alpha = first.cuticleTilt * Math.PI / 180, gloss = 1 - first.matte;
    target.set([Math.min(400, Math.max(4, 1 / v)), Math.min(200, Math.max(2, 1 / (4 * v))), 0.22 * gloss, 0.3 * gloss,
      0.35 * gloss, -2 * alpha, 4 * alpha, hasAttributes ? 1 : 0], offset);
    target.set(parseHexColor(first.coatTint), offset + 8);
  }
  for (let index = 0; index < STRAND_LOOK_MATERIALS; index++) {
    const material = materials[Math.min(index, materials.length - 1)];
    target.set(material ? (material.colorField ? [1, 1, 1] : fiberMaterialDiffuse(material)) : parseHexColor(render.color), offset + 12 + index * 4);
  }
}

/** Color a layer's strands take without per-point attributes: the first Fiber Material, else Strand Render's Color. */
export function strandBaseColor(render: GeometryStrandRender): [number, number, number] {
  return render.materials?.[0] ? fiberMaterialDiffuse(render.materials[0]) : parseHexColor(render.color);
}
