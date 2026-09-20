export interface CollisionPoint { x: number; y: number; z?: number }
export type MeshContact = (point: CollisionPoint, previous: CollisionPoint, radius: number) => void;

/** Rasterized front surface: bounded per-frame work, constant-time contact per rope node. */
export function meshCollision(points: CollisionPoint[], triangles: number[][], size = 96): MeshContact {
  const vertices = points;
  const minX = Math.min(...vertices.map(p => p.x)), maxX = Math.max(...vertices.map(p => p.x));
  const minY = Math.min(...vertices.map(p => p.y)), maxY = Math.max(...vertices.map(p => p.y));
  const dx = (maxX - minX) / (size - 1), dy = (maxY - minY) / (size - 1);
  if (!(dx > 0 && dy > 0)) return () => {};
  const depth = new Float32Array(size * size).fill(-Infinity);
  for (const indices of triangles) {
    const [a, b, c] = indices.map(i => points[i]);
    if (!a || !b || !c) continue;
    const den = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(den) < 1e-12) continue;
    const x0 = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - minX) / dx));
    const x1 = Math.min(size - 1, Math.ceil((Math.max(a.x, b.x, c.x) - minX) / dx));
    const y0 = Math.max(0, Math.floor((Math.min(a.y, b.y, c.y) - minY) / dy));
    const y1 = Math.min(size - 1, Math.ceil((Math.max(a.y, b.y, c.y) - minY) / dy));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = minX + x * dx, py = minY + y * dy;
      const u = ((b.y - c.y) * (px - c.x) + (c.x - b.x) * (py - c.y)) / den;
      const v = ((c.y - a.y) * (px - c.x) + (a.x - c.x) * (py - c.y)) / den;
      if (u < -1e-5 || v < -1e-5 || u + v > 1.00001) continue;
      const z = u * (a.z ?? 0) + v * (b.z ?? 0) + (1 - u - v) * (c.z ?? 0);
      depth[y * size + x] = Math.max(depth[y * size + x], z);
    }
  }
  return (point, previous, radius) => {
    const x = (point.x - minX) / dx, y = (point.y - minY) / dy;
    if (x < 0 || y < 0 || x > size - 1 || y > size - 1) return;
    // Conservative neighboring samples bridge raster holes at triangle edges.
    const ix = Math.floor(x), iy = Math.floor(y);
    let z = -Infinity;
    for (let oy = 0; oy <= 1; oy++) for (let ox = 0; ox <= 1; ox++) {
      z = Math.max(z, depth[Math.min(size - 1, iy + oy) * size + Math.min(size - 1, ix + ox)]);
    }
    z += radius;
    if ((point.z ?? 0) >= z) return;
    point.z = z;
    previous.z = z; // Remove inward velocity instead of bouncing through the surface.
    previous.x += (point.x - previous.x) * 0.15;
    previous.y += (point.y - previous.y) * 0.15;
  };
}
