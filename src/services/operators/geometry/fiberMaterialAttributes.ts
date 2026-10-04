import type { CurveSet } from './geometryEvaluation';
import { evaluateFieldColumn } from './curveFieldColumns';
import type { GeometryFiberMaterial } from './geometryProgram';

/** Melanin and roughness ranges of the per-point attributes (match PT_MELANIN_RANGE, PT_ROUGHNESS_SCALE_RANGE). */
export const FIBER_ATTRIBUTE_MELANIN_RANGE = 8;
export const FIBER_ATTRIBUTE_ROUGHNESS_RANGE = 2;

/** Key of everything the per-point attributes depend on besides the curves. */
export function fiberAttributesKey(materials: readonly GeometryFiberMaterial[] | undefined): string {
  if (!materials?.length) return '';
  return JSON.stringify(materials.map(material => [material.colorField, material.roughnessField, material.melaninField, material.selection]));
}

/** True when every point uses the first material without fields; the shaders then need no attribute buffer. */
export function fiberAttributesTrivial(materials: readonly GeometryFiberMaterial[] | undefined): boolean {
  return !materials || materials.length <= 1 && !materials.some(material => material.colorField || material.roughnessField || material.melaninField);
}

const unorm8 = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255);

/**
 * Two u32 per curve point (PtFiberEmission.wgsl, StrandScene.wgsl): x = unorm4x8 color (rgb, absolute
 * when the point's material has a Color Field, white otherwise) and roughness scale / 2; y = melanin
 * / 8 as unorm16 in the high half and the material index (in chain order) in the low half. A point
 * takes the last material whose Selection exceeds 0.5 (no Selection selects every point).
 */
export function evaluateFiberAttributes(curves: CurveSet, materials: readonly GeometryFiberMaterial[]): Uint32Array {
  const count = curves.positions.length / 3, attributes = new Uint32Array(count * 2);
  const columns = materials.map(material => ({
    color: material.colorField && evaluateFieldColumn(material.colorField, curves),
    roughness: material.roughnessField && evaluateFieldColumn(material.roughnessField, curves),
    melanin: material.melaninField && evaluateFieldColumn(material.melaninField, curves),
    selection: material.selection && evaluateFieldColumn(material.selection, curves),
  }));
  for (let point = 0; point < count; point++) {
    let index = 0;
    for (let m = materials.length - 1; m >= 0; m--) {
      const selection = columns[m].selection;
      if (!selection || Number(selection(point)) > 0.5) { index = m; break; }
    }
    const column = columns[index];
    const color = column.color ? column.color(point) as number[] : [1, 1, 1];
    const roughness = column.roughness ? Math.max(0, Number(column.roughness(point))) : 1;
    const melanin = column.melanin ? Math.max(0, Number(column.melanin(point))) : 0;
    attributes[point * 2] = (unorm8(color[0]) | (unorm8(color[1]) << 8) | (unorm8(color[2]) << 16)
      | (unorm8(roughness / FIBER_ATTRIBUTE_ROUGHNESS_RANGE) << 24)) >>> 0;
    attributes[point * 2 + 1] = ((Math.round(Math.min(1, melanin / FIBER_ATTRIBUTE_MELANIN_RANGE) * 65535) << 16) | index) >>> 0;
  }
  return attributes;
}
