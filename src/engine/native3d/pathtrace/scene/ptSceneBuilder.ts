import type { SceneCamera, ScenePlaneLayer, SceneStrandLayer } from '../../../scene/types';
import type { PathTraceMeshPrimitive, SceneNativeMeshLayer } from '../../passes/MeshPass';
import type { StrandBuffers } from '../../passes/strandBuffers';
import { buildPlaneModelMatrix } from '../../sceneRenderer/planeUniforms';
import { PT_BVH_NODE, PT_FIBER_SEGMENT, PT_INSTANCE_FLAG_CASTS_SHADOW, PT_INSTANCE_FLAG_VISIBLE_TO_CAMERA, PT_INSTANCE_VEC4, PT_PRIMITIVE,
  PT_WIDE_NODE, ptWideNodeCount, type PtPrimitiveKind } from '../contracts/ptLayouts';
import { ptPackWideNodes } from '../bvh/ptWidePack';
import { PtLbvh, ptLbvhNodeCount, type PtBoundsInput } from '../bvh/ptLbvh';
import { PtFiberEmitter, ptFiberSlots } from './ptFiberEmission';
import { PtPagedBuffer, PtSceneLimitError } from './ptPagedBuffer';
import { PtMaterialTable, meshSurfaceMaterial, planeSurfaceMaterial, sphereSetMaterial, voxelSurfaceMaterial } from './ptSceneMaterials';
import { ptEmitVoxels, ptVoxelPlan, type PtVoxelInput } from './ptVoxelEmission';
import { PtTextureAtlas } from './ptTextureAtlas';

export interface PtStrandInput { layer: SceneStrandLayer; buffers: StrandBuffers }
export interface PtMeshInput { layer: SceneNativeMeshLayer; primitives: PathTraceMeshPrimitive[]; modelMatrix: Float32Array }
export interface PtPlaneInput { layer: ScenePlaneLayer; textureView: GPUTextureView | null; version: string }
export type { PtVoxelInput };
/**
 * Spheres a pass writes on the GPU (flock points): `count` PtShape records at vec4 `base` of the
 * object pool, in scene space; `version` changes whenever they may have moved.
 */
export interface PtSphereSetInput {
  key: string;
  count: number;
  lit: boolean;
  version: string;
  emit(encoder: GPUCommandEncoder, objects: GPUBuffer, base: number, temporaries: GPUBuffer[]): void;
}

export interface PtSceneInput {
  strands: PtStrandInput[];
  meshes: PtMeshInput[];
  planes: PtPlaneInput[];
  voxels: PtVoxelInput[];
  sphereSets: PtSphereSetInput[];
  camera: SceneCamera;
  /** Preview level of detail for fibers (off in export and still convergence). */
  fiberLod: boolean;
}

/** GPU scene of one frame, as the integrator binds it. */
export interface PtSceneFrame {
  nodePages: [GPUBuffer, GPUBuffer];
  fiberPages: [GPUBuffer, GPUBuffer];
  objects: GPUBuffer;
  materials: Float32Array<ArrayBuffer>;
  atlas: GPUTextureView;
  tlasRoot: number;
  instanceCount: number;
  nodePage1Start: number;
  fiberPage1Start: number;
  /** Changes whenever geometry, transforms or materials changed: the accumulation restarts. */
  revision: number;
  stats: { segments: number; bvhNodes: number; gpuBytes: number };
}

interface Blas {
  lbvh: PtLbvh;
  nodes: GPUBuffer;
  key: string;
  /** Bumped by every build and refit; the node pages copy a BLAS again when it changed. */
  version: number;
}

interface PlacedBlas { blas: Blas; count: number; kind: PtPrimitiveKind; primGlobal: number; materialBase: number; objectId: number;
  objectToWorld: Float32Array | null }

const IDENTITY = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);

/** A u32 stored bit for bit in a float lane (read back with bitcast<u32>). */
const bitsOfIndex = (value: number) => new Float32Array(Uint32Array.of(value).buffer)[0];

function hashId(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function invertAffine(m: Float32Array): Float32Array {
  const [a, b, c, , d, e, f, , g, h, i] = m, tx = m[12], ty = m[13], tz = m[14];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C || 1e-20;
  const inv = new Float32Array(16);
  // Column-major inverse of the 3x3 part.
  inv[0] = A / det; inv[1] = -(b * i - c * h) / det; inv[2] = (b * f - c * e) / det;
  inv[4] = B / det; inv[5] = (a * i - c * g) / det; inv[6] = -(a * f - c * d) / det;
  inv[8] = C / det; inv[9] = -(a * h - b * g) / det; inv[10] = (a * e - b * d) / det;
  inv[12] = -(inv[0] * tx + inv[4] * ty + inv[8] * tz);
  inv[13] = -(inv[1] * tx + inv[5] * ty + inv[9] * tz);
  inv[14] = -(inv[2] * tx + inv[6] * ty + inv[10] * tz);
  inv[15] = 1;
  return inv;
}

/** Writes rows of a column-major affine matrix as three vec4 (PtInstance transform rows). */
function writeRows(target: Float32Array, offset: number, m: Float32Array): void {
  for (let row = 0; row < 3; row++) target.set([m[row], m[4 + row], m[8 + row], m[12 + row]], offset + row * 4);
}

/**
 * Builds the path tracer's scene from the native layers each frame (plan 2.2): fibers are emitted
 * into the fiber pages and get one BLAS per strand layer (refit while the topology holds, rebuilt
 * when it changes or the SAH estimate degrades); mesh geometry is uploaded once per shape with an
 * object-space BLAS reused by every instance; planes share one world-space BLAS of quads; the TLAS
 * over all instances is rebuilt every frame. Each BLAS keeps its own (Karras) node buffer and is
 * packed into traversal nodes in the node pages after it changed (ptWidePack.ts).
 */
export class PtSceneBuilder {
  private readonly nodes = new PtPagedBuffer('pt-nodes', PT_WIDE_NODE.size);
  private readonly fibers = new PtPagedBuffer('pt-fibers', PT_FIBER_SEGMENT.size);
  private readonly emitter = new PtFiberEmitter();
  private readonly atlas = new PtTextureAtlas();
  private readonly fiberBlas = new Map<string, Blas>();
  private readonly meshBlas = new Map<string, Blas>();
  private planesBlas: Blas | null = null;
  private readonly voxelBlas = new Map<string, Blas>();
  private voxelBases = new Map<string, number>();
  private voxelSignatures = new Map<string, string>();
  private tlas: Blas | null = null;
  private objects: GPUBuffer | null = null;
  private objectsLayoutKey = '';
  private meshBases = new Map<string, { vertexRecord: number; triangleBase: number; triangles: number }>();
  /** Which BLAS (at which version) each node region holds. */
  private copied = new Map<number, { blas: Blas; version: number }>();
  private fiberSignatures = new Map<string, string>();
  private fiberKeeps = new Map<string, number>();
  private revision = 0;
  private lastFrameKey = '';
  private device: GPUDevice | null = null;

  /** Builds or updates the scene; throws PtSceneLimitError when it does not fit the device. */
  build(device: GPUDevice, encoder: GPUCommandEncoder, input: PtSceneInput, temporaries: GPUBuffer[], defer: (release: () => void) => void): PtSceneFrame {
    if (this.device !== device) { this.dispose(); this.device = device; }
    const materials = new PtMaterialTable();
    let changed = false;

    // ---- Fibers: emission into the fiber pages, one BLAS per strand layer ----
    const strandSlots = input.strands.map(strand => ptFiberSlots(strand.layer, strand.buffers));
    const fiberLayout = this.fibers.layout(device, strandSlots.map(count => Math.max(count, 1)), temporaries);
    const placed: PlacedBlas[] = [];
    const activeFibers = new Set<string>();
    input.strands.forEach((strand, index) => {
      const { layer, buffers } = strand, slots = strandSlots[index], region = fiberLayout.regions[index];
      if (!slots) return;
      activeFibers.add(layer.layerId);
      const keep = this.emitter.keepFraction(layer, buffers, input.camera, input.fiberLod);
      const materialBase = materials.addStrandLayer(layer);
      const topology = `${slots}|${buffers.topology}`;
      const geometry = `${topology}|${buffers.signature}|${Array.from(layer.worldMatrix).join(',')}|${keep}|${JSON.stringify(layer.strands.program.render)}`
        + `|${region.global}|${fiberLayout.reallocated ? this.revision : ''}`;
      let blas = this.fiberBlas.get(layer.layerId);
      if (blas && blas.key !== topology) { const old = blas; defer(() => { old.lbvh.dispose(); old.nodes.destroy(); }); blas = undefined; }
      if (!blas) {
        const lbvh = new PtLbvh(device, `pt-fibers-${layer.layerId}`, slots);
        blas = { lbvh, key: topology, version: 0, nodes: device.createBuffer({ label: `pt-fiber-blas-${layer.layerId}`,
          size: ptLbvhNodeCount(slots) * PT_BVH_NODE.size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }) };
        this.fiberBlas.set(layer.layerId, blas);
      }
      if (this.fiberSignatures.get(layer.layerId) !== geometry || !blas.lbvh.built) {
        const page = this.fibers.buffer(region.page);
        this.emitter.emit(device, encoder, layer, buffers, page, region.local, keep, 0, temporaries);
        const bounds: PtBoundsInput = { kind: PT_PRIMITIVE.fiber, count: slots, base: region.local, fibers: { buffer: page },
          objects: this.objectsBuffer(device), nodePages: this.nodes.bindings(device), nodePage1Start: this.nodes.page1Start };
        // A new level of detail hides or shows fibers: rebuild, so hidden ones sort into their own empty
        // subtree (a refit would keep them interleaved with the visible, now wider fibers).
        const lodChanged = this.fiberKeeps.get(layer.layerId) !== keep;
        if (blas.lbvh.built && !blas.lbvh.needsRebuild && !lodChanged) blas.lbvh.refit(encoder, bounds, { buffer: blas.nodes }, temporaries);
        else blas.lbvh.build(encoder, bounds, { buffer: blas.nodes }, temporaries);
        this.fiberKeeps.set(layer.layerId, keep);
        blas.version++;
        this.fiberSignatures.set(layer.layerId, geometry);
        changed = true;
      }
      placed.push({ blas, count: slots, kind: PT_PRIMITIVE.fiber, primGlobal: region.global, materialBase, objectId: hashId(layer.layerId),
        objectToWorld: null });
    });
    for (const [id, blas] of this.fiberBlas) if (!activeFibers.has(id)) {
      this.fiberBlas.delete(id); this.fiberSignatures.delete(id); this.fiberKeeps.delete(id); this.emitter.forget(id);
      defer(() => { blas.lbvh.dispose(); blas.nodes.destroy(); });
    }

    // ---- Object pool: instances, mesh vertices and triangles, quads ----
    const shapes = [...new Map(input.meshes.flatMap(mesh => mesh.primitives).map(primitive => [primitive.key, primitive])).values()];
    const instanceCapacity = Math.max(64, 2 ** Math.ceil(Math.log2(Math.max(1, placed.length + input.meshes.reduce((n, m) => n + m.primitives.length, 0) + 1))));
    const voxelPlans = input.voxels.map(voxel => ({ voxel, plan: ptVoxelPlan(voxel, input.camera) }));
    const voxelCounts = [...voxelPlans.map(({ voxel, plan }) => [voxel.layer.layerId, plan.count] as const),
      ...input.sphereSets.map(set => [set.key, set.count] as const)];
    const layoutKey = `${instanceCapacity}|${input.planes.length}|${shapes.map(shape => `${shape.key}:${shape.vertices.length}:${shape.indices.length}`).join(';')}`
      + `|${voxelCounts.map(([id, count]) => `${id}:${count}`).join(';')}`;
    if (layoutKey !== this.objectsLayoutKey) {
      this.writeObjectLayout(device, shapes, instanceCapacity, input.planes.length, voxelCounts, temporaries);
      this.voxelSignatures.clear();
      this.objectsLayoutKey = layoutKey;
      changed = true;
    }
    const objects = this.objectsBuffer(device);
    const quadBase = this.quadBase;
    this.atlas.begin(device, input.planes.length + input.meshes.reduce((n, mesh) => n + mesh.primitives.filter(p => p.textureView).length, 0));

    // Mesh BLAS per shape, built once after its geometry is in the pool.
    for (const shape of shapes) {
      const base = this.meshBases.get(shape.key)!;
      let blas = this.meshBlas.get(shape.key);
      if (!blas) {
        const lbvh = new PtLbvh(device, `pt-mesh-${shape.key}`, Math.max(1, base.triangles));
        blas = { lbvh, key: shape.key, version: 0, nodes: device.createBuffer({ label: `pt-mesh-blas`, size: ptLbvhNodeCount(Math.max(1, base.triangles)) * PT_BVH_NODE.size,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }) };
        lbvh.build(encoder, { kind: PT_PRIMITIVE.triangle, count: Math.max(1, base.triangles), base: base.triangleBase, fibers: { buffer: this.fibers.bindings(device)[0] },
          objects, nodePages: this.nodes.bindings(device), nodePage1Start: this.nodes.page1Start }, { buffer: blas.nodes }, temporaries);
        blas.version++;
        this.meshBlas.set(shape.key, blas);
        changed = true;
      }
    }
    for (const [key, blas] of this.meshBlas) if (!shapes.some(shape => shape.key === key)) {
      this.meshBlas.delete(key); defer(() => { blas.lbvh.dispose(); blas.nodes.destroy(); });
    }
    for (const mesh of input.meshes) {
      for (const primitive of mesh.primitives) {
        const textureLayer = primitive.textureView ? this.atlas.place(encoder, `mesh:${primitive.key}`, primitive.key, primitive.textureView) : -1;
        const materialBase = materials.addSurface(meshSurfaceMaterial(mesh.layer, primitive, textureLayer));
        const base = this.meshBases.get(primitive.key)!;
        placed.push({ blas: this.meshBlas.get(primitive.key)!, count: base.triangles, kind: PT_PRIMITIVE.triangle, primGlobal: base.triangleBase,
          materialBase, objectId: hashId(`${mesh.layer.layerId}:${primitive.key}`), objectToWorld: mesh.modelMatrix });
      }
    }

    // ---- Voxels: blocks emitted into the object pool (layer local space), one BLAS per layer ----
    const activeVoxels = new Set<string>();
    for (const { voxel, plan } of voxelPlans) {
      const id = voxel.layer.layerId, base = this.voxelBases.get(id)!;
      activeVoxels.add(id);
      const kind = plan.sphere ? PT_PRIMITIVE.sphere : PT_PRIMITIVE.box;
      let blas = this.voxelBlas.get(id);
      const key = `${kind}:${plan.count}`;
      if (blas && blas.key !== key) { const old = blas; defer(() => { old.lbvh.dispose(); old.nodes.destroy(); }); blas = undefined; }
      if (!blas) {
        blas = { lbvh: new PtLbvh(device, `pt-voxels-${id}`, plan.count), key, version: 0, nodes: device.createBuffer({ label: `pt-voxel-blas-${id}`,
          size: ptLbvhNodeCount(plan.count) * PT_BVH_NODE.size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }) };
        this.voxelBlas.set(id, blas);
        this.voxelSignatures.delete(id);
      }
      if (this.voxelSignatures.get(id) !== plan.signature) {
        ptEmitVoxels(device, encoder, plan, voxel.textureView, objects, base, temporaries);
        blas.lbvh.build(encoder, { kind, count: plan.count, base, fibers: { buffer: this.fibers.bindings(device)[0] }, objects,
          nodePages: this.nodes.bindings(device), nodePage1Start: this.nodes.page1Start }, { buffer: blas.nodes }, temporaries);
        blas.version++;
        this.voxelSignatures.set(id, plan.signature);
        changed = true;
      }
      placed.push({ blas, count: plan.count, kind, primGlobal: base, materialBase: materials.addSurface(voxelSurfaceMaterial(voxel.layer)),
        objectId: hashId(`voxels:${id}`), objectToWorld: plan.world });
    }

    // ---- Sphere sets (flock points): written by their pass, one BLAS each ----
    for (const set of input.sphereSets) {
      const base = this.voxelBases.get(set.key)!;
      activeVoxels.add(set.key);
      let blas = this.voxelBlas.get(set.key);
      const key = `${PT_PRIMITIVE.sphere}:${set.count}`;
      if (blas && blas.key !== key) { const old = blas; defer(() => { old.lbvh.dispose(); old.nodes.destroy(); }); blas = undefined; }
      if (!blas) {
        blas = { lbvh: new PtLbvh(device, `pt-spheres-${set.key}`, set.count), key, version: 0, nodes: device.createBuffer({ label: `pt-sphere-blas-${set.key}`,
          size: ptLbvhNodeCount(set.count) * PT_BVH_NODE.size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }) };
        this.voxelBlas.set(set.key, blas);
        this.voxelSignatures.delete(set.key);
      }
      if (this.voxelSignatures.get(set.key) !== set.version) {
        set.emit(encoder, objects, base, temporaries);
        const bounds: PtBoundsInput = { kind: PT_PRIMITIVE.sphere, count: set.count, base, fibers: { buffer: this.fibers.bindings(device)[0] }, objects,
          nodePages: this.nodes.bindings(device), nodePage1Start: this.nodes.page1Start };
        if (blas.lbvh.built && !blas.lbvh.needsRebuild) blas.lbvh.refit(encoder, bounds, { buffer: blas.nodes }, temporaries);
        else blas.lbvh.build(encoder, bounds, { buffer: blas.nodes }, temporaries);
        blas.version++;
        this.voxelSignatures.set(set.key, set.version);
        changed = true;
      }
      placed.push({ blas, count: set.count, kind: PT_PRIMITIVE.sphere, primGlobal: base, materialBase: materials.addSurface(sphereSetMaterial(set.lit)),
        objectId: hashId(set.key), objectToWorld: null });
    }
    for (const [id, blas] of this.voxelBlas) if (!activeVoxels.has(id)) {
      this.voxelBlas.delete(id); this.voxelSignatures.delete(id);
      defer(() => { blas.lbvh.dispose(); blas.nodes.destroy(); });
    }

    // ---- Planes: one world-space BLAS of quads, rebuilt every frame ----
    if (input.planes.length) {
      const quads = new Float32Array(input.planes.length * 16);
      input.planes.forEach((plane, index) => {
        const textureLayer = plane.textureView ? this.atlas.place(encoder, `plane:${plane.layer.layerId}`, plane.version, plane.textureView) : -1;
        const material = materials.addSurface(planeSurfaceMaterial(plane.layer, textureLayer));
        const m = buildPlaneModelMatrix(plane.layer, input.camera);
        const at = (x: number, y: number) => [0, 1, 2].map(r => m[r] * x + m[4 + r] * y + m[12 + r]);
        const origin = at(-0.5, -0.5);
        // Quad: origin (bottom left of the ±0.5 plane), edge U, edge V; p0.w holds the absolute material index as bits.
        quads.set([...origin, bitsOfIndex(material), m[0], m[1], m[2], 0, m[4], m[5], m[6], 0, 0, 0, 1, 1], index * 16);
      });
      device.queue.writeBuffer(objects, quadBase * 16, quads);
      if (!this.planesBlas || this.planesBlas.lbvh.count !== input.planes.length) {
        if (this.planesBlas) { const old = this.planesBlas; defer(() => { old.lbvh.dispose(); old.nodes.destroy(); }); }
        this.planesBlas = { lbvh: new PtLbvh(device, 'pt-planes', input.planes.length), key: 'planes', version: 0,
          nodes: device.createBuffer({ label: 'pt-planes-blas', size: ptLbvhNodeCount(input.planes.length) * PT_BVH_NODE.size,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }) };
      }
      this.planesBlas.lbvh.build(encoder, { kind: PT_PRIMITIVE.quad, count: input.planes.length, base: quadBase, fibers: { buffer: this.fibers.bindings(device)[0] },
        objects, nodePages: this.nodes.bindings(device), nodePage1Start: this.nodes.page1Start }, { buffer: this.planesBlas.nodes }, temporaries);
      this.planesBlas.version++;
      placed.push({ blas: this.planesBlas, count: input.planes.length, kind: PT_PRIMITIVE.quad, primGlobal: quadBase, materialBase: 0,
        objectId: hashId('planes'), objectToWorld: null });
    } else if (this.planesBlas) {
      const old = this.planesBlas; this.planesBlas = null; defer(() => { old.lbvh.dispose(); old.nodes.destroy(); });
    }

    // ---- Node pages: TLAS first, then every BLAS ----
    const instanceCount = placed.length;
    if (!this.tlas || this.tlas.lbvh.count !== Math.max(1, instanceCount)) {
      if (this.tlas) { const old = this.tlas; defer(() => { old.lbvh.dispose(); old.nodes.destroy(); }); }
      const count = Math.max(1, instanceCount);
      this.tlas = { lbvh: new PtLbvh(device, 'pt-tlas', count), key: 'tlas', version: 0, nodes: device.createBuffer({ label: 'pt-tlas-nodes',
        size: ptLbvhNodeCount(count) * PT_BVH_NODE.size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }) };
    }
    const nodeLayout = this.nodes.layout(device, [ptWideNodeCount(Math.max(1, instanceCount)), ...placed.map(item => ptWideNodeCount(item.blas.lbvh.count))],
      temporaries);
    if (nodeLayout.reallocated) { this.copied.clear(); changed = true; }
    placed.forEach((item, index) => {
      // Per node region: instances of one mesh shape share a BLAS but each has its own region.
      const region = nodeLayout.regions[index + 1], held = this.copied.get(region.global);
      if (held?.blas === item.blas && held.version === item.blas.version) return;
      ptPackWideNodes(device, encoder, item.blas.nodes, item.blas.lbvh.count, this.nodes.buffer(region.page), region.local, temporaries);
      this.copied.set(region.global, { blas: item.blas, version: item.blas.version });
      changed = true;
    });

    // ---- Instances and the TLAS ----
    const instances = new Float32Array(instanceCapacity * PT_INSTANCE_VEC4 * 4);
    placed.forEach((item, index) => {
      const offset = index * PT_INSTANCE_VEC4 * 4, toWorld = item.objectToWorld ?? IDENTITY;
      writeRows(instances, offset, invertAffine(toWorld));
      writeRows(instances, offset + 12, toWorld);
      const refs = new Uint32Array(instances.buffer, (offset + 24) * 4, 8);
      refs.set([nodeLayout.regions[index + 1].global, item.primGlobal, item.kind, item.materialBase,
        PT_INSTANCE_FLAG_CASTS_SHADOW | PT_INSTANCE_FLAG_VISIBLE_TO_CAMERA, item.count, index, item.objectId]);
    });
    device.queue.writeBuffer(objects, 0, instances);
    const frameKey = `${Array.from(instances.subarray(0, instanceCount * 32)).join(',')}|${Array.from(materials.data.subarray(0, materials.count * 20)).join(',')}`;
    if (frameKey !== this.lastFrameKey) { this.lastFrameKey = frameKey; changed = true; }
    const tlasRegion = nodeLayout.regions[0];
    this.tlas.lbvh.build(encoder, { kind: 'instance', count: Math.max(1, instanceCount), base: 0, fibers: { buffer: this.fibers.bindings(device)[0] },
      objects, nodePages: this.nodes.bindings(device), nodePage1Start: this.nodes.page1Start }, { buffer: this.tlas.nodes }, temporaries);
    ptPackWideNodes(device, encoder, this.tlas.nodes, this.tlas.lbvh.count, this.nodes.buffer(tlasRegion.page), tlasRegion.local, temporaries);
    if (changed) this.revision++;
    const segments = strandSlots.reduce((a, b) => a + b, 0);
    return {
      nodePages: this.nodes.bindings(device), fiberPages: this.fibers.bindings(device), objects,
      materials: materials.data, atlas: this.atlas.view(device), tlasRoot: tlasRegion.global, instanceCount,
      nodePage1Start: this.nodes.page1Start, fiberPage1Start: this.fibers.page1Start, revision: this.revision,
      stats: { segments, bvhNodes: nodeLayout.regions.reduce((n, region) => n + region.count, 0),
        gpuBytes: this.nodes.gpuBytes + this.fibers.gpuBytes + (this.objects?.size ?? 0) + this.atlas.gpuBytes
          + [...this.fiberBlas.values()].reduce((n, blas) => n + blas.lbvh.gpuBytes + blas.nodes.size, 0) },
    };
  }

  /** Called after the frame's encoder was submitted (SAH readbacks). */
  afterSubmit(): void {
    for (const blas of this.fiberBlas.values()) blas.lbvh.afterSubmit();
  }

  private quadBase = 0;

  private objectsBuffer(device: GPUDevice): GPUBuffer {
    return this.objects ??= device.createBuffer({ label: 'pt-objects-empty', size: 64, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  }

  /** Lays out the object pool: instances, then per shape its vertices (2 vec4) and triangles (1 vec4), then quads (4 vec4). */
  private writeObjectLayout(device: GPUDevice, shapes: readonly PathTraceMeshPrimitive[], instanceCapacity: number, planes: number,
    voxels: ReadonlyArray<readonly [string, number]>, temporaries: GPUBuffer[]): void {
    let cursor = instanceCapacity * PT_INSTANCE_VEC4;
    this.meshBases.clear();
    const parts: Array<{ at: number; data: Float32Array }> = [];
    for (const shape of shapes) {
      const vertices = shape.vertices.length / 8, triangles = Math.floor(shape.indices.length / 3);
      const vertexRecord = cursor / 2, vertexData = new Float32Array(vertices * 8);
      for (let v = 0; v < vertices; v++) {
        const s = v * 8;
        vertexData.set([shape.vertices[s], shape.vertices[s + 1], shape.vertices[s + 2], shape.vertices[s + 6],
          shape.vertices[s + 3], shape.vertices[s + 4], shape.vertices[s + 5], shape.vertices[s + 7]], v * 8);
      }
      parts.push({ at: cursor, data: vertexData });
      cursor += vertices * 2;
      const triangleBase = cursor, triangleData = new Uint32Array(Math.max(1, triangles) * 4);
      for (let t = 0; t < triangles; t++) {
        triangleData.set([vertexRecord + shape.indices[t * 3], vertexRecord + shape.indices[t * 3 + 1], vertexRecord + shape.indices[t * 3 + 2], 0], t * 4);
      }
      parts.push({ at: cursor, data: new Float32Array(triangleData.buffer) });
      cursor += Math.max(1, triangles);
      this.meshBases.set(shape.key, { vertexRecord, triangleBase, triangles });
    }
    this.quadBase = cursor;
    cursor += Math.max(1, planes) * 4;
    // Voxel blocks and sphere sets: 4 vec4 each, written on the GPU (ptVoxelEmission.ts, flock points).
    this.voxelBases.clear();
    for (const [id, count] of voxels) { this.voxelBases.set(id, cursor); cursor += count * 4; }
    const bytes = cursor * 16;
    if (bytes > Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize)) {
      throw new PtSceneLimitError('The meshes of the scene exceed the device storage binding size');
    }
    if (this.objects) temporaries.push(this.objects);
    this.objects = device.createBuffer({ label: 'pt-objects', size: Math.max(64, bytes), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    // Existing mesh BLAS stay valid: they index triangles relative to the shape's base.
    for (const part of parts) device.queue.writeBuffer(this.objects, part.at * 16, part.data as Float32Array<ArrayBuffer>);
  }

  dispose(): void {
    const all = [...this.fiberBlas.values(), ...this.meshBlas.values(), ...this.voxelBlas.values(), ...(this.planesBlas ? [this.planesBlas] : []),
      ...(this.tlas ? [this.tlas] : [])];
    for (const blas of all) { blas.lbvh.dispose(); blas.nodes.destroy(); }
    this.fiberBlas.clear(); this.meshBlas.clear(); this.voxelBlas.clear(); this.voxelSignatures.clear(); this.planesBlas = null; this.tlas = null;
    this.nodes.destroy(); this.fibers.destroy(); this.atlas.dispose();
    this.objects?.destroy(); this.objects = null; this.objectsLayoutKey = '';
    this.copied.clear(); this.fiberSignatures.clear(); this.fiberKeeps.clear(); this.device = null;
  }
}
