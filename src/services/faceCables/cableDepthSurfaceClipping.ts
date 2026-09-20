export interface DepthSurfacePoint { uv: number[]; position: number[] }
export const depthSurfaceEdge = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;

/** Clip the triangulated exterior, not the face hole, so faces may cross any image edge. */
export function clipDepthSurface(vertices: DepthSurfacePoint[], indices: number[], boundary: Set<string>,
  surface: (uv: number[]) => number[]): number[] {
  const intersections = new Map<string, number>(), output: number[] = [];
  const intersect = (a: number, b: number, axis: number, bound: number) => {
    const pa = vertices[a], pb = vertices[b];
    const t = (bound - pa.uv[axis]) / (pb.uv[axis] - pa.uv[axis]);
    if (t <= 1e-10) return a;
    if (t >= 1 - 1e-10) return b;
    const edge = depthSurfaceEdge(a, b), key = `${edge}:${axis}:${bound}`, cached = intersections.get(key);
    if (cached !== undefined) return cached;
    const uv = pa.uv.map((v, j) => v + (pb.uv[j] - v) * t); uv[axis] = bound;
    const onFace = boundary.has(edge), index = vertices.length;
    vertices.push({ uv, position: onFace ? pa.position.map((v, j) => v + (pb.position[j] - v) * t) : surface(uv) });
    if (onFace) { boundary.add(depthSurfaceEdge(a, index)); boundary.add(depthSurfaceEdge(index, b)); }
    intersections.set(key, index); return index;
  };
  for (let i = 0; i < indices.length; i += 3) {
    let polygon = indices.slice(i, i + 3);
    for (const [axis, bound, sign] of [[0, 0, 1], [0, 1, -1], [1, 0, 1], [1, 1, -1]]) {
      const clipped: number[] = [];
      for (let j = 0; j < polygon.length; j++) {
        const a = polygon[j], b = polygon[(j + 1) % polygon.length];
        const insideA = (vertices[a].uv[axis] - bound) * sign >= 0;
        const insideB = (vertices[b].uv[axis] - bound) * sign >= 0;
        if (insideA) clipped.push(a);
        if (insideA !== insideB) clipped.push(intersect(a, b, axis, bound));
      }
      polygon = clipped.filter((v, j) => v !== clipped[(j + clipped.length - 1) % clipped.length]);
    }
    for (let j = 1; j + 1 < polygon.length; j++) {
      const [a, b, c] = [polygon[0], polygon[j], polygon[j + 1]].map(n => vertices[n].uv);
      if (Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) > 1e-12) output.push(polygon[0], polygon[j], polygon[j + 1]);
    }
  }
  return output;
}
