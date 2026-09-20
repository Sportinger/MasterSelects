import { decodeCableScene, cableSceneLayout } from '../faceCables/cableSceneData';
import { decodeCableBake, cableFrameLayout } from '../faceCables/cableData';
import { buildCableDepthGeometry } from '../faceCables/cableDepthSurface';
import { depthToMesh } from '../operators/geometry/depthMesh';
import type { SurfaceMesh } from '../operators/geometry/mesh';
import type { ArtifactSampleRequest, ArtifactSampleResult } from './previewArtifactProtocol';
import type { PreviewDrawing } from './previewTypes';

function meshDrawing(mesh: SurfaceMesh): PreviewDrawing {
  const points: number[] = [], edges: number[] = [], mapped = new Map<number, number>();
  const stride = Math.max(1, Math.ceil(mesh.indices.length / 3 / 900)) * 3;
  for (let i = 0; i < mesh.indices.length; i += stride) {
    const triangle = mesh.indices.slice(i, i + 3).map(index => {
      if (!mapped.has(index)) { mapped.set(index, points.length / 3); points.push(...mesh.vertices[index].position); }
      return mapped.get(index)!;
    });
    edges.push(triangle[0], triangle[1], triangle[1], triangle[2], triangle[2], triangle[0]);
  }
  return { kind: 'points', points, edges, dimensions: 3 };
}

/** Runs in the data worker, separately from the graph's input/render worker. */
export function samplePreviewArtifact(request: ArtifactSampleRequest, encoded: string): ArtifactSampleResult {
  const result = { id: request.id, label: 'Saved bake' };
  if (request.format === 'cables') {
    const bake = decodeCableBake(encoded);
    if (!bake || request.time < 0 || request.time >= bake.duration) return { ...result, label: 'No bake at this time' };
    const layout = cableFrameLayout(bake.version, bake.cables), frame = Math.min(bake.frames - 1, Math.floor(request.time * bake.fps));
    const points: number[] = [], edges: number[] = [];
    bake.cables.forEach((cable, index) => {
      const offset = frame * layout.stride + layout.offsets[index], dimensions = bake.version >= 3 ? 3 : 2;
      if (!bake.data[offset]) return;
      const start = points.length / 3;
      for (let point = 0; point <= (cable.segments ?? 24); point++) {
        const at = offset + 2 + point * dimensions;
        points.push(bake.data[at], -bake.data[at + 1], dimensions === 3 ? bake.data[at + 2] : 0);
        if (point) edges.push(start + point - 1, start + point);
      }
    });
    return { ...result, drawing: { kind: 'points', dimensions: 3, points, edges } };
  }
  const bake = decodeCableScene(encoded);
  if (!bake || request.time < 0 || request.time >= bake.duration) return { ...result, label: 'No scene bake at this time' };
  const layout = cableSceneLayout(bake.cables, bake.depthGrid), base = Math.min(bake.frames - 1, Math.floor(request.time * bake.fps)) * layout.stride;
  const data = bake.data, grid = bake.depthGrid;
  if (request.stage === 'depth') {
    if (!grid) return { ...result, label: 'Depth not baked' };
    return { ...result, label: 'Saved calibrated depth', drawing: { kind: 'depth', ...grid, values: Array.from(data.subarray(base + layout.depthOffset + 4, base + layout.depthOffset + 4 + grid.width * grid.height)) } };
  }
  const vertices = Array.from({ length: data[base] ? 468 : 0 }, (_, index) => {
    const offset = base + 21 + index * 5;
    return { position: Array.from(data.subarray(offset, offset + 3)), uv: Array.from(data.subarray(offset + 3, offset + 5)) };
  });
  if (request.stage === 'face') return { ...result, drawing: meshDrawing({ vertices, indices: vertices.length ? bake.triangles : [] }) };
  if (request.stage === 'surface' || request.stage === 'depth-mesh' || request.stage === 'geometry') {
    if (!grid && request.stage !== 'geometry') return { ...result, label: 'Depth not baked' };
    const offset = base + layout.depthOffset;
    const mesh = !grid ? { vertices: [], indices: [] } as SurfaceMesh : request.stage !== 'depth-mesh' ? buildCableDepthGeometry(bake, base) : depthToMesh(
      data.subarray(offset + 4, offset + 4 + grid.width * grid.height), grid,
      Array.from({ length: 4 }, (_, index) => Array.from(data.subarray(base + 1 + index * 5, base + 4 + index * 5))),
      Array.from(data.subarray(offset, offset + 3)), data[offset + 3]);
    if (request.stage !== 'depth-mesh' && vertices.length) {
      const start = mesh.vertices.length; mesh.vertices.push(...vertices); mesh.indices.push(...bake.triangles.map(index => index + start));
    }
    const drawing = meshDrawing(mesh);
    if (request.stage === 'geometry' && drawing.kind === 'points') {
      const cables = samplePreviewArtifact({ ...request, stage: 'cables' }, encoded).drawing;
      if (cables?.kind === 'points') {
        const start = drawing.points.length / 3;
        drawing.points.push(...cables.points); drawing.edges?.push(...(cables.edges ?? []).map(value => value + start));
      }
    }
    return { ...result, drawing };
  }
  const points: number[] = [], edges: number[] = [];
  bake.cables.forEach((cable, index) => {
    const offset = base + layout.offsets[index], start = points.length / 3;
    if (!data[offset]) return;
    for (let point = 0; point <= (cable.segments ?? 24); point++) {
      points.push(...data.subarray(offset + 6 + point * 3, offset + 9 + point * 3));
      if (point) edges.push(start + point - 1, start + point);
    }
  });
  return { ...result, drawing: { kind: 'points', dimensions: 3, points, edges } };
}
