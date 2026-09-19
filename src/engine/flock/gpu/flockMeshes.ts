/**
 * Procedural low-poly instance meshes, authored with forward = +Z and a body
 * length of ~2 units (z in [-1, 1]); the render branch `size` scales them in
 * simulation units. Non-indexed float32 [px, py, pz, nx, ny, nz] triangles.
 */

export type FlockMeshKind = 'krill' | 'fish' | 'arrow' | 'tetra' | 'cube' | 'sphere';

export interface FlockMeshData {
  kind: FlockMeshKind | 'model';
  vertices: Float32Array;
  vertexCount: number;
}

type V3 = [number, number, number];

class MeshWriter {
  private readonly data: number[] = [];

  triangle(a: V3, b: V3, c: V3): void {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;
    for (const vertex of [a, b, c]) this.data.push(vertex[0], vertex[1], vertex[2], nx, ny, nz);
  }

  quad(a: V3, b: V3, c: V3, d: V3): void {
    this.triangle(a, b, c);
    this.triangle(a, c, d);
  }

  /** Tube of elliptical rings along z; profile gives [z, radiusX, radiusY, offsetY]. */
  loft(profile: Array<[number, number, number, number]>, segments: number): void {
    const rings = profile.map(([z, rx, ry, oy]) => Array.from({ length: segments }, (_, index) => {
      const angle = (index / segments) * Math.PI * 2;
      return [Math.cos(angle) * rx, Math.sin(angle) * ry + oy, z] as V3;
    }));
    for (let ring = 0; ring < rings.length - 1; ring += 1) {
      for (let segment = 0; segment < segments; segment += 1) {
        const next = (segment + 1) % segments;
        this.quad(rings[ring][segment], rings[ring][next], rings[ring + 1][next], rings[ring + 1][segment]);
      }
    }
    const capStart = profile[0];
    const capEnd = profile[profile.length - 1];
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      this.triangle([0, capStart[3], capStart[0]], rings[0][next], rings[0][segment]);
      this.triangle([0, capEnd[3], capEnd[0]], rings[rings.length - 1][segment], rings[rings.length - 1][next]);
    }
  }

  build(kind: FlockMeshKind): FlockMeshData {
    const vertices = Float32Array.from(this.data);
    return { kind, vertices, vertexCount: vertices.length / 6 };
  }
}

function krill(): FlockMeshData {
  const w = new MeshWriter();
  // Segmented, slightly arched shrimp body: head/carapace forward, tapering abdomen.
  w.loft([
    [-0.95, 0.03, 0.035, 0.1],
    [-0.75, 0.08, 0.09, 0.07],
    [-0.5, 0.12, 0.13, 0.03],
    [-0.2, 0.16, 0.17, 0],
    [0.15, 0.2, 0.2, 0],
    [0.5, 0.2, 0.19, 0.01],
    [0.78, 0.14, 0.13, 0.02],
    [0.95, 0.04, 0.05, 0.03],
  ], 8);
  // Tail fan
  w.triangle([0, 0.1, -0.9], [-0.28, 0.14, -1.18], [0.28, 0.14, -1.18]);
  w.triangle([0, 0.1, -0.9], [0.28, 0.14, -1.18], [-0.28, 0.14, -1.18]);
  // Eyes
  for (const side of [-1, 1]) {
    w.triangle([side * 0.12, 0.08, 0.8], [side * 0.22, 0.12, 0.86], [side * 0.14, 0.16, 0.9]);
  }
  // Antennae: long thin forward blades
  for (const side of [-1, 1]) {
    w.triangle([side * 0.05, 0.05, 0.9], [side * 0.06, 0.02, 0.92], [side * 0.45, 0.25, 2.1]);
    w.triangle([side * 0.06, 0.02, 0.92], [side * 0.05, 0.05, 0.9], [side * 0.45, 0.25, 2.1]);
  }
  // Swimmerets / legs under the body
  for (let leg = 0; leg < 6; leg += 1) {
    const z = 0.55 - leg * 0.17;
    for (const side of [-1, 1]) {
      w.triangle([side * 0.08, -0.12, z], [side * 0.08, -0.12, z - 0.06], [side * 0.26, -0.42, z - 0.1]);
    }
  }
  return w.build('krill');
}

function fish(): FlockMeshData {
  const w = new MeshWriter();
  w.loft([
    [-0.8, 0.02, 0.05, 0],
    [-0.55, 0.08, 0.2, 0],
    [-0.1, 0.16, 0.36, 0],
    [0.35, 0.17, 0.36, 0],
    [0.75, 0.1, 0.2, 0],
    [1, 0.02, 0.04, 0],
  ], 8);
  w.triangle([0, 0, -0.75], [0, 0.42, -1.12], [0, -0.42, -1.12]);
  w.triangle([0, 0, -0.75], [0, -0.42, -1.12], [0, 0.42, -1.12]);
  w.triangle([0, 0.3, 0.1], [0, 0.62, -0.2], [0, 0.33, -0.4]);
  w.triangle([0, 0.3, 0.1], [0, 0.33, -0.4], [0, 0.62, -0.2]);
  return w.build('fish');
}

function arrow(): FlockMeshData {
  const w = new MeshWriter();
  w.loft([[-1, 0.08, 0.08, 0], [0.2, 0.08, 0.08, 0], [0.2, 0.3, 0.3, 0], [1, 0.001, 0.001, 0]], 6);
  return w.build('arrow');
}

function tetra(): FlockMeshData {
  const w = new MeshWriter();
  const tip: V3 = [0, 0, 1];
  const a: V3 = [0, 0.4, -0.8];
  const b: V3 = [-0.35, -0.2, -0.8];
  const c: V3 = [0.35, -0.2, -0.8];
  w.triangle(tip, a, b);
  w.triangle(tip, b, c);
  w.triangle(tip, c, a);
  w.triangle(a, c, b);
  return w.build('tetra');
}

function cube(): FlockMeshData {
  const w = new MeshWriter();
  const s = 0.6;
  const corners: V3[] = [
    [-s, -s, -s], [s, -s, -s], [s, s, -s], [-s, s, -s],
    [-s, -s, s], [s, -s, s], [s, s, s], [-s, s, s],
  ];
  const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]];
  for (const face of faces) w.quad(corners[face[0]], corners[face[1]], corners[face[2]], corners[face[3]]);
  return w.build('cube');
}

function sphere(): FlockMeshData {
  const profile: Array<[number, number, number, number]> = [];
  for (let ring = 0; ring <= 6; ring += 1) {
    const angle = (ring / 6) * Math.PI;
    const z = -Math.cos(angle) * 0.8;
    const radius = Math.max(0.001, Math.sin(angle) * 0.8);
    profile.push([z, radius, radius, 0]);
  }
  const w = new MeshWriter();
  w.loft(profile, 10);
  return w.build('sphere');
}

const BUILDERS: Record<FlockMeshKind, () => FlockMeshData> = { krill, fish, arrow, tetra, cube, sphere };
const cache = new Map<FlockMeshKind, FlockMeshData>();

export function getFlockMesh(kind: string): FlockMeshData {
  const resolved = (kind in BUILDERS ? kind : 'arrow') as FlockMeshKind;
  let mesh = cache.get(resolved);
  if (!mesh) {
    mesh = BUILDERS[resolved]();
    cache.set(resolved, mesh);
  }
  return mesh;
}
