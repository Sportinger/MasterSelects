import { cableFrameLayout, MAX_FACE_CABLES, decodeCableBake, CABLE_SHADOW_NODES } from '../../services/faceCables/cableData';
import { cableLightValue } from '../../services/faceCables/cableLight';
import { CABLE_NODES, MAX_CABLE_SEGMENTS } from '../../services/faceCables/cablePhysics';

const DRAW_NODES = MAX_CABLE_SEGMENTS + 1;
const SHADOW_OFFSET = 12 + DRAW_NODES * 4;
export const CABLE_UNIFORM_STRIDE = SHADOW_OFFSET + 8 + CABLE_SHADOW_NODES * 4;
export const CABLE_UNIFORM_SIZE = (4 + MAX_FACE_CABLES * CABLE_UNIFORM_STRIDE) * 4;

export function packFaceCableUniforms(params: Record<string, number | boolean | string>, width: number, height: number): Float32Array {
  const packed = new Float32Array(CABLE_UNIFORM_SIZE / 4);
  packed[0] = width; packed[1] = height;
  const bake = decodeCableBake(params.bakedData), time = Number(params.cableTime);
  if (!bake || !Number.isFinite(time) || time < 0 || time >= bake.duration) return packed;
  const frame = Math.min(bake.frames - 1, Math.floor(time * bake.fps + 1e-5));
  packed[2] = bake.cables.length;
  packed[3] = params.faceShadows ? cableLightValue(params, 'shadowStrength') : 0;
  const layout = cableFrameLayout(bake.version, bake.cables);
  bake.cables.forEach((cable, index) => {
    const source = frame * layout.stride + layout.offsets[index];
    const target = 4 + index * CABLE_UNIFORM_STRIDE;
    if (!bake.data[source]) return;
    const radius = bake.data[source + 1] * height;
    packed[target + 4] = radius;
    const sourceNodes = bake.version === 1 ? CABLE_NODES : (cable.segments ?? 24) + 1;
    const drawNodes = Math.min(DRAW_NODES, (sourceNodes - 1) * 3 + 1);
    packed[target + 5] = drawNodes;
    packed[target + 11] = cable.showAnchors === false ? 0 : (cable.lockFrom !== false ? 1 : 0) + (cable.lockTo !== false ? 2 : 0);
    packed[target + 6] = 1;
    packed[target + 7] = cable.renderStyle === 'flat' ? 1 : 0;
    const color = /^#[0-9a-f]{6}$/i.test(cable.color) ? cable.color : '#ff873d';
    for (let channel = 0; channel < 3; channel++) packed[target + 8 + channel] = parseInt(color.slice(1 + channel * 2, 3 + channel * 2), 16) / 255;
    let maxRadius = radius;
    const pointStride = bake.version >= 3 ? 3 : 2;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    // Interpolate the simulated rope for smooth curves without changing its anchors.
    const coordinate = (node: number, axis: number) => bake.data[source + 2 + Math.max(0, Math.min(sourceNodes - 1, node)) * pointStride + axis];
    for (let node = 0; node < drawNodes; node++) {
      const position = node / (drawNodes - 1) * (sourceNodes - 1);
      const segment = Math.min(sourceNodes - 2, Math.floor(position)), t = position - segment;
      const smooth = (axis: number) => {
        const a = coordinate(segment - 1, axis), b = coordinate(segment, axis);
        const c = coordinate(segment + 1, axis), d = coordinate(segment + 2, axis);
        return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
      };
      const x = smooth(0) * width, y = smooth(1) * height;
      const localRadius = radius * (bake.version >= 3 ? Math.max(0.01, smooth(2)) : 1);
      packed[target + 14 + node * 4] = localRadius; maxRadius = Math.max(maxRadius, localRadius);
      packed[target + 12 + node * 4] = x; packed[target + 13 + node * 4] = y;
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    const pad = maxRadius * 3.5 + 2;
    packed.set([minX - pad, minY - pad, maxX + pad, maxY + pad], target);
    if (bake.version === 4 && params.faceShadows) {
      const start = source + 2 + sourceNodes * 3, out = target + SHADOW_OFFSET;
      const softness = cableLightValue(params, 'shadowSoftness');
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      packed[out + 4] = 1;
      for (let node = 0; node < CABLE_SHADOW_NODES; node++) {
        const src = start + node * 4, dst = out + 8 + node * 4;
        if (bake.data[src + 3] < 0) { packed[dst + 2] = -1; continue; }
        const x = bake.data[src] * width, y = bake.data[src + 1] * height;
        const r = Math.max(0.5, radius * bake.data[src + 2]);
        const blur = 0.75 + bake.data[src + 3] * height * softness;
        packed.set([x, y, r, blur], dst);
        const reach = r + blur * 2;
        x0 = Math.min(x0, x - reach); y0 = Math.min(y0, y - reach);
        x1 = Math.max(x1, x + reach); y1 = Math.max(y1, y + reach);
      }
      if (Number.isFinite(x0)) packed.set([x0, y0, x1, y1], out);
      else packed[out + 4] = 0;
    }
  });
  return packed;
}
