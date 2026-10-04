// The app enters the scene runtime through NativeSceneRenderer; importing it first keeps that module order.
import '../../src/engine/native3d/NativeSceneRenderer';
import { PT_COMMON_WGSL, PT_SCENE_BINDINGS_WGSL, composePtShader } from '../../src/engine/native3d/pathtrace/contracts/ptBindings';
import { PT_PRIMITIVE, PT_FIBER_FLAG_HIDDEN } from '../../src/engine/native3d/pathtrace/contracts/ptLayouts';
import { PtLbvh, ptLbvhNodeCount } from '../../src/engine/native3d/pathtrace/bvh/ptLbvh';
import { buildReferenceLbvh } from '../../src/engine/native3d/pathtrace/bvh/ptLbvhReference';
import { PtFiberEmitter, ptFiberSlots } from '../../src/engine/native3d/pathtrace/scene/ptFiberEmission';
import { StrandPass } from '../../src/engine/native3d/passes/StrandPass';
import fiberBsdf from '../../src/engine/native3d/pathtrace/materials/PtFiberBsdf.wgsl?raw';
import bsdf from '../../src/engine/native3d/pathtrace/materials/PtBsdf.wgsl?raw';
import surfaceTexture from '../../src/engine/native3d/pathtrace/materials/PtSurfaceTexture.wgsl?raw';
import sampler from '../../src/engine/native3d/pathtrace/integrator/PtSampler.wgsl?raw';
import { proceduralSkyHdr, referenceScenes } from './pathtraceScenes';
import lbvhSource from '../../src/engine/native3d/pathtrace/bvh/PtLbvh.wgsl?raw';
import boundsSource from '../../src/engine/native3d/pathtrace/bvh/PtPrimitiveBounds.wgsl?raw';
import emissionSource from '../../src/engine/native3d/pathtrace/scene/PtFiberEmission.wgsl?raw';
import { STRAND_FIBER_GEOMETRY_SHADER } from '../../src/engine/native3d/passes/strandShaders';
import type { SceneStrandLayer } from '../../src/engine/scene/types';

/**
 * Phase 1 kernel checks of the path tracer on the GPU: every WGSL module compiles, the GPU LBVH
 * equals the CPU reference node for node (build and refit), and fiber emission writes finite
 * segments for the standard weave.
 */
async function compileErrors(device: GPUDevice, label: string, code: string): Promise<string[]> {
  const info = await device.createShaderModule({ label, code }).getCompilationInfo();
  return info.messages.filter(message => message.type === 'error').map(message => `${label} ${message.lineNum}:${message.linePos} ${message.message}`);
}

async function readBuffer(device: GPUDevice, source: GPUBuffer, bytes: number): Promise<ArrayBuffer> {
  const staging = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(source, 0, staging, 0, bytes);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const copy = staging.getMappedRange().slice(0);
  staging.destroy();
  return copy;
}

const step = (label: string) => { document.querySelector('#result')!.textContent = `Running… ${label}`; };

async function run() {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('No WebGPU adapter');
  const device = await adapter.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
    maxBufferSize: adapter.limits.maxBufferSize } });
  const errors: string[] = [];
  device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  const report: Record<string, unknown> = {};

  step('compile');
  // 1. Modules compile (the BSDF through the fixed interfaces).
  const bsdfProbe = composePtShader('bsdf-probe', [PT_COMMON_WGSL, PT_SCENE_BINDINGS_WGSL, sampler, fiberBsdf, bsdf, surfaceTexture, `
    @group(3) @binding(0) var<storage, read_write> probeOut: array<vec4f>;
    @compute @workgroup_size(1) fn probe() {
      var s: PtSurface;
      s.kind = PT_MATERIAL_FIBER; s.tangent = vec3f(1.0, 0.0, 0.0); s.roughness = 1.0; s.baseColor = vec3f(0.8);
      var smp = ptSamplerStart(vec2u(1u, 2u), 3u, 0u);
      let u = ptNext4(&smp);
      let sample = pt_bsdf_sample(s, vec3f(0.0, 0.0, 1.0), u.xyz);
      probeOut[0] = vec4f(pt_bsdf_eval(s, vec3f(0.0, 0.0, 1.0), sample.wi), pt_bsdf_pdf(s, vec3f(0.0, 0.0, 1.0), sample.wi));
      probeOut[1] = vec4f(ptSurfaceColorOpacity(materials[0], vec2f(0.5)));
    }`]);
  const compile = (await Promise.all([compileErrors(device, 'bsdf-probe', bsdfProbe),
    compileErrors(device, 'lbvh', `${PT_COMMON_WGSL}
${lbvhSource}`), compileErrors(device, 'bounds', `${PT_COMMON_WGSL}
${boundsSource}`),
    compileErrors(device, 'emission', `${PT_COMMON_WGSL}
${STRAND_FIBER_GEOMETRY_SHADER}
${emissionSource}`)])).flat();
  if (compile.length) throw new Error(compile.join('\n'));
  report.compilation = 'passed (BSDF, sampler, surface texture, LBVH, bounds, emission)';

  step('lbvh build');
  // 2. GPU LBVH equals the CPU reference.
  const count = 3000, aabbs = new Float32Array(count * 6);
  let seed = 7;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const shapes = new Float32Array(count * 16);
  for (let i = 0; i < count; i++) {
    const c = [next() * 10 - 5, next() * 10 - 5, next() * 10 - 5], r = i % 17 === 0 ? 0 : 0.02 + next() * 0.2;
    aabbs.set(r > 0 ? [c[0] - r, c[1] - r, c[2] - r, c[0] + r, c[1] + r, c[2] + r] : [1, 1, 1, -1, -1, -1], i * 6);
    shapes.set([c[0], c[1], c[2], r], i * 16);
  }
  const objects = device.createBuffer({ size: shapes.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(objects, 0, shapes);
  const nodeCount = ptLbvhNodeCount(count);
  const nodes = device.createBuffer({ size: nodeCount * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
  const empty = device.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE });
  const lbvh = new PtLbvh(device, 'check-lbvh', count), temporaries: GPUBuffer[] = [];
  const input = { kind: PT_PRIMITIVE.sphere, count, base: 0, fibers: { buffer: empty }, objects, nodePages: [empty, empty] as const, nodePage1Start: 0 };
  let encoder = device.createCommandEncoder();
  lbvh.build(encoder, input, { buffer: nodes }, temporaries);
  device.queue.submit([encoder.finish()]);
  lbvh.afterSubmit();
  const reference = buildReferenceLbvh(aabbs);
  const compare = async (label: string) => {
    const data = await readBuffer(device, nodes, nodeCount * 32);
    const f = new Float32Array(data), u = new Uint32Array(data);
    let mismatches = 0, maxBoundsError = 0;
    const samples: string[] = [];
    for (let n = 0; n < nodeCount; n++) {
      const ref = reference.nodes[n];
      const left = u[n * 8 + 3], right = u[n * 8 + 7];
      const expectedLeft = ref.leaf ? (0x80000000 | ref.left) >>> 0 : ref.left;
      if (left !== expectedLeft || (!ref.leaf && right !== ref.right)) {
        mismatches++;
        if (samples.length < 4) samples.push(`node ${n}: gpu ${left}/${right} lo ${f[n * 8]} hi ${f[n * 8 + 4]}, cpu ${expectedLeft}/${ref.right} lo ${ref.lo[0]}`);
      }
      const empty = ref.lo[0] > ref.hi[0];
      if (!empty) for (let axis = 0; axis < 3; axis++) {
        maxBoundsError = Math.max(maxBoundsError, Math.abs(f[n * 8 + axis] - ref.lo[axis]), Math.abs(f[n * 8 + 4 + axis] - ref.hi[axis]));
      }
    }
    if (mismatches) throw new Error([`${label}: ${mismatches} of ${nodeCount} nodes differ from the CPU reference`, ...samples, ...errors].join(' | '));
    if (maxBoundsError > 1e-5) throw new Error(`${label}: bounds differ by ${maxBoundsError}`);
    return { nodes: nodeCount, maxBoundsError };
  };
  step('compare build');
  report.lbvhBuild = await compare('build');
  // Refit after moving every sphere by the same offset keeps the topology and shifts all bounds.
  for (let i = 0; i < count; i++) { shapes[i * 16 + 1] += 0.5; if (aabbs[i * 6] <= aabbs[i * 6 + 3]) { aabbs[i * 6 + 1] += 0.5; aabbs[i * 6 + 4] += 0.5; } }
  device.queue.writeBuffer(objects, 0, shapes);
  const moved = buildReferenceLbvh(aabbs);
  reference.nodes.forEach((node, index) => { node.lo = moved.nodes[index].lo; node.hi = moved.nodes[index].hi; });
  encoder = device.createCommandEncoder();
  lbvh.refit(encoder, input, { buffer: nodes }, temporaries);
  device.queue.submit([encoder.finish()]);
  lbvh.afterSubmit();
  report.lbvhRefit = await compare('refit');
  await new Promise(resolve => setTimeout(resolve, 50));
  report.sahCost = lbvh.sahCost;

  step('emission');
  // 3. Fiber emission of the standard weave.
  const hdrUrl = URL.createObjectURL(proceduralSkyHdr(32));
  const weave = referenceScenes(1920, 1080, hdrUrl)[0];
  URL.revokeObjectURL(hdrUrl);
  const layer = weave.layers[0] as SceneStrandLayer;
  const strandPass = new StrandPass();
  encoder = device.createCommandEncoder();
  const prepared = strandPass.prepare(device, [layer], temporaries)[0];
  const slots = ptFiberSlots(layer, prepared.buffers);
  const fibers = device.createBuffer({ size: slots * 48, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const emitter = new PtFiberEmitter();
  emitter.emit(device, encoder, layer, prepared.buffers, fibers, 0, 1, 0, temporaries);
  device.queue.submit([encoder.finish()]);
  const fiberData = await readBuffer(device, fibers, slots * 48);
  const ff = new Float32Array(fiberData), fu = new Uint32Array(fiberData);
  let visible = 0, nonFinite = 0, maxRadius = 0;
  for (let i = 0; i < slots; i++) {
    if (fu[i * 12 + 8] & PT_FIBER_FLAG_HIDDEN) continue;
    visible++;
    for (let k = 0; k < 8; k++) if (!Number.isFinite(ff[i * 12 + k])) nonFinite++;
    maxRadius = Math.max(maxRadius, ff[i * 12 + 3], ff[i * 12 + 7]);
  }
  if (nonFinite) throw new Error(`Fiber emission wrote ${nonFinite} non-finite values`);
  if (visible < slots * 0.5) throw new Error(`Only ${visible} of ${slots} fiber slots are visible`);
  report.fiberEmission = { slots, visible, maxRadius };
  step('fiber lbvh');
  // LBVH over the emitted fibers.
  const fiberNodes = device.createBuffer({ size: ptLbvhNodeCount(slots) * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const fiberBvh = new PtLbvh(device, 'check-fiber-lbvh', slots);
  encoder = device.createCommandEncoder();
  const started = performance.now();
  fiberBvh.build(encoder, { kind: PT_PRIMITIVE.fiber, count: slots, base: 0, fibers: { buffer: fibers }, objects: empty, nodePages: [empty, empty], nodePage1Start: 0 },
    { buffer: fiberNodes }, temporaries);
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  report.fiberLbvh = { nodes: ptLbvhNodeCount(slots), buildWallMs: Math.round((performance.now() - started) * 100) / 100 };
  const root = new Float32Array(await readBuffer(device, fiberNodes, 32));
  if (!(root[0] < root[4] && root[1] < root[5] && root[2] < root[6])) throw new Error('Fiber BVH root bounds are empty');
  report.fiberRootBounds = Array.from(root.slice(0, 3)).concat(Array.from(root.slice(4, 7))).map(value => Math.round(value * 1000) / 1000);

  await device.queue.onSubmittedWorkDone();
  temporaries.forEach(buffer => buffer.destroy());
  lbvh.dispose(); fiberBvh.dispose(); strandPass.dispose();
  [objects, nodes, empty, fibers, fiberNodes].forEach(buffer => buffer.destroy());
  if (errors.length) throw new Error(errors.join('\n'));
  return report;
}

run().then(result => { document.querySelector('#result')!.textContent = `PASS\n${JSON.stringify(result, null, 2)}`; })
  .catch(error => { document.querySelector('#result')!.textContent = `FAIL: ${error.stack ?? error}`; });
