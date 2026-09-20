import type { ClipTransform } from '../../types';
import { getEffectiveScale } from '../../utils/transformScale';
import { createFaceContact, type FaceContact } from './cableFaceSurface';
import { buildCableDepthGeometry } from './cableDepthSurface';
import { cableSceneLayout, type CableSceneBake } from './cableSceneData';

/** Invert cableSceneLocalPoint: collider and rope must meet in the simulation's composition coordinates. */
export function cableScenePhysicsPoint(p: number[], transform: ClipTransform, aspect: number) {
  const scale = getEffectiveScale(transform.scale), a = transform.anchor ?? { x: 0, y: 0, z: 0 };
  const angle = transform.rotation.z * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  const x = (p[0] - a.x) * scale.x, y = (p[1] - a.y) * scale.y;
  return { x: (cos * x - sin * y + transform.position.x) / 2 + aspect / 2,
    y: 0.5 - (sin * x + cos * y + transform.position.y) / 2,
    z: ((p[2] - a.z) * (scale.z ?? 1) + transform.position.z) * (2 * Math.tan(25 * Math.PI / 180)) };
}
/** Rasterize the exact rendered exterior, including its welded seam and image-edge clipping. */
export function createCableDepthContact(bake: CableSceneBake, frame: number, transform: ClipTransform, aspect: number): FaceContact {
  if (!bake.depthGrid) return () => {};
  const surface = buildCableDepthGeometry(bake, frame * cableSceneLayout(bake.cables, bake.depthGrid).stride);
  if (!surface.indices.length) return () => {};
  // Unreferenced enclosing-rectangle vertices may lie outside the clipped source: exclude them from bounds.
  const remap = new Map<number, number>();
  const points: ReturnType<typeof cableScenePhysicsPoint>[] = [], triangles: number[][] = [];
  for (let i = 0; i < surface.indices.length; i += 3) triangles.push(surface.indices.slice(i, i + 3).map(index => {
    let mapped = remap.get(index);
    if (mapped === undefined) { mapped = points.length; remap.set(index, mapped); points.push(cableScenePhysicsPoint(surface.vertices[index].position, transform, aspect)); }
    return mapped;
  }));
  return createFaceContact(points, triangles, 192);
}
