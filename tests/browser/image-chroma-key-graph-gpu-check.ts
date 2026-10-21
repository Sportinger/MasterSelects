import common from '../../src/effects/_shared/commonShader';
import { imageGraphProgramShader } from '../../src/effects/_shared/imageGraphDefinition';
import { ImageGraphPassRuntime } from '../../src/effects/ImageGraphPassRuntime';
import { packImageOperatorRuntimeUniforms } from '../../src/services/operators/imageOperatorRuntimeUniforms';
import { effectOperatorCompileContext, effectOperatorGraph, effectOperatorParams } from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { createLegacyChromaKeyGraph } from '../../src/services/operators/legacyChromaKeyEffectGraph';
import { applyWorkerSoftwareImageGraphs } from '../../src/services/render/workerSoftwareImageGraphs';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

/**
 * Chroma Key on the GPU: the multi-pass screen-matte plan (64 px Screen Grid, 1 px Screen Color, key pass,
 * Shrink/Grow and Edge Softness passes) through ImageGraphPassRuntime with a linear sampler and rgba16float
 * caches, against the same plan on the CPU pass runner (float caches, real bilinear reads). Covers the
 * downscaled caches, half-float precision of the weighted grid sums near the coverage ramp, grid filtering and
 * the dynamic-count Gaussian passes; plus an edited pre-rebuild (Rec.601) graph, which saved projects still render.
 */
const WIDTH = 160, HEIGHT = 90;
/** Bytes per readback row (WebGPU copies need a multiple of 256). */
const ROW_PITCH = Math.ceil(WIDTH * 4 / 256) * 256;
/** Up to 2 of 255 per channel: half-float caches and filtered grid reads against the CPU's float evaluation. */
const TOLERANCE = 2;

type Screen = 'green' | 'blue';
const SCREENS: Record<Screen, readonly [number, number, number]> = { green: [60, 150, 70], blue: [40, 70, 190] };

/** An unevenly lit screen with a subject block, a 50 % chiffon band, 1 px strands, a transparent strip and a faint-screen corner. */
function fixture(screen: Screen): Uint8Array {
  const base = SCREENS[screen], pixels = new Uint8Array(ROW_PITCH * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    const light = 0.65 + 0.35 * Math.exp(-(((x - 80) / 60) ** 2 + ((y - 45) / 35) ** 2));
    let rgba = [base[0] * light, base[1] * light, base[2] * light, 255];
    if (x >= 64 && x < 96 && y >= 20 && y < 70) rgba = x < 80 ? [225, 170, 140, 255] : [235, 235, 228, 255];
    else if (x >= 110 && x < 126) rgba = [(rgba[0] + 230) / 2, (rgba[1] + 230) / 2, (rgba[2] + 224) / 2, 255];
    else if (x === 40 || x === 140) rgba = [(rgba[0] + 210) / 2, (rgba[1] + 190) / 2, (rgba[2] + 170) / 2, 255];
    if (x < 8) rgba[3] = 0;
    else if (x < 12) rgba[3] = 128;
    pixels.set(rgba.map(Math.round), y * ROW_PITCH + x * 4);
  }
  return pixels;
}

/** `keys`: whether most of the screen must come out transparent (false: nothing keyed; absent: parity only). */
const cases: ReadonlyArray<{ name: string; screen: Screen; params: Record<string, unknown>; passes: number; keys?: boolean; operatorGraph?: EffectOperatorGraph }> = [
  { name: 'green-default', screen: 'green', params: {}, passes: 3, keys: true },
  { name: 'blue-default', screen: 'blue', params: { keyColor: 'blue' }, passes: 3, keys: true },
  { name: 'green-gentle-low-clip', screen: 'green', params: { clipBlack: 0.05, clipWhite: 1, spillMethod: 'max' }, passes: 3, keys: true },
  { name: 'green-matte-view', screen: 'green', params: { view: 'matte' }, passes: 3, keys: false },
  { name: 'blue-screen-on-green-keys-nothing', screen: 'green', params: { keyColor: 'blue' }, passes: 3, keys: false },
  { name: 'picked-colour', screen: 'green', params: { keyColor: 'custom', screenColor: '#3c9646' }, passes: 1, keys: true },
  { name: 'edge-softness', screen: 'green', params: { edgeSoftness: 20 }, passes: 5, keys: true },
  { name: 'shrink', screen: 'green', params: { edgeShrink: 20 }, passes: 6, keys: true },
  { name: 'grow-and-soften', screen: 'green', params: { edgeShrink: -20, edgeSoftness: 20 }, passes: 7, keys: true },
  { name: 'edited-pre-rebuild-graph', screen: 'green', params: { tolerance: 0.3, softness: 0.1, spillSuppression: 0.5 }, passes: 1,
    operatorGraph: (() => { const graph = createLegacyChromaKeyGraph(); graph.nodes.find(node => node.id === 'outer-tolerance')!.bypassed = true; return graph; })() },
];

async function renderGpu(device: GPUDevice, runtime: ImageGraphPassRuntime, sampler: GPUSampler, input: Uint8Array, plan: ReturnType<typeof compileImageOperatorGraph>, id: string) {
  const source = device.createTexture({ size: [WIDTH, HEIGHT], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const target = device.createTexture({ size: [WIDTH, HEIGHT], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: ROW_PITCH * HEIGHT, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  try {
    device.queue.writeTexture({ texture: source }, input, { bytesPerRow: ROW_PITCH }, [WIDTH, HEIGHT]);
    const encoder = device.createCommandEncoder();
    let uniform: GPUBuffer | undefined;
    // Multi-pass plans run through the pass runtime; a single-pass plan is one program, as the effect pipeline draws it.
    if (!runtime.encode({ encoder, sampler, source: { kind: 'texture', view: source.createView() }, width: WIDTH, height: HEIGHT,
      timelineTimeSeconds: 0, plan, outputView: target.createView(), instanceId: id })) {
      const entryPoint = `chromaKeyCheck${id.replace(/\W/g, '')}Fragment`;
      const module = device.createShaderModule({ code: `${common}\n${imageGraphProgramShader(plan, entryPoint)}` });
      const errors = (await module.getCompilationInfo()).messages.filter(message => message.type === 'error');
      if (errors.length) throw new Error(`${id}: ${errors.map(message => message.message).join('\n')}`);
      const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
        fragment: { module, entryPoint, targets: [{ format: 'rgba8unorm' }] } });
      const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: sampler }, { binding: 1, resource: source.createView() }];
      const uniforms = packImageOperatorRuntimeUniforms(plan, 0, WIDTH, HEIGHT);
      if (uniforms) {
        uniform = device.createBuffer({ size: uniforms.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(uniform, 0, uniforms);
        entries.push({ binding: 2, resource: { buffer: uniform } });
      }
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries }));
      pass.draw(6); pass.end();
    }
    encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: ROW_PITCH }, [WIDTH, HEIGHT]);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const result = new Uint8Array(readback.getMappedRange()).slice(); readback.unmap();
    uniform?.destroy();
    return result;
  } finally { source.destroy(); target.destroy(); readback.destroy(); }
}

/** The plan on the CPU pass runner, laid out in ROW_PITCH rows like the GPU readback. */
function renderCpu(input: Uint8Array, plan: ReturnType<typeof compileImageOperatorGraph>): Uint8Array {
  const tight = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) tight.set(input.subarray(y * ROW_PITCH, y * ROW_PITCH + WIDTH * 4), y * WIDTH * 4);
  applyWorkerSoftwareImageGraphs(tight, WIDTH, HEIGHT, [plan], 0);
  const result = new Uint8Array(ROW_PITCH * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) result.set(tight.subarray(y * WIDTH * 4, (y + 1) * WIDTH * 4), y * ROW_PITCH);
  return result;
}

function maxDelta(expected: Uint8Array, actual: Uint8Array): number {
  return expected.reduce((largest, value, index) => Math.max(largest, Math.abs(value - actual[index])), 0);
}

function mismatch(expected: Uint8Array, actual: Uint8Array): string {
  let first = -1, count = 0, largest = 0;
  expected.forEach((value, index) => { const delta = Math.abs(value - actual[index]); if (delta <= TOLERANCE) return;
    if (first < 0) first = index; count++; largest = Math.max(largest, delta); });
  const pixel = (offset: number) => [...expected.slice(offset, offset + 4)].join(',') + ' vs ' + [...actual.slice(offset, offset + 4)].join(',');
  const start = first - (first % 4);
  return `pixel ${Math.floor((first % ROW_PITCH) / 4)},${Math.floor(first / ROW_PITCH)} (CPU ${pixel(start)} GPU); ${count} bytes beyond ${TOLERANCE}, max delta ${largest}`;
}

/** Fully transparent output pixels carry no colour that compositing could show: compare alpha only there. */
function visible(pixels: Uint8Array, reference: Uint8Array): Uint8Array {
  const result = pixels.slice();
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    const index = y * ROW_PITCH + x * 4;
    if (reference[index + 3] === 0 && pixels[index + 3] === 0) result.fill(0, index, index + 3);
  }
  return result;
}

export async function checkChromaKeyGraphGpu(device: GPUDevice): Promise<number> {
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const runtime = new ImageGraphPassRuntime(device);
  let comparisons = 0;
  try {
    for (const item of cases) {
      const effect = { type: 'chroma-key', params: item.params, operatorGraph: item.operatorGraph };
      const plan = compileImageOperatorGraph(effectOperatorGraph(effect), effectOperatorParams(effect), effectOperatorCompileContext(effect));
      const passes = plan.passes?.length ?? 1;
      if (passes !== item.passes) throw new Error(`${item.name}: compiled to ${passes} passes instead of ${item.passes}.`);
      const input = fixture(item.screen);
      const gpu = await renderGpu(device, runtime, sampler, input, plan, item.name), cpu = renderCpu(input, plan);
      const [actual, expected] = [visible(gpu, cpu), visible(cpu, gpu)];
      if (maxDelta(expected, actual) > TOLERANCE) throw new Error(`${item.name}: GPU differs from the CPU pass runner: ${mismatch(expected, actual)}`);
      // The key must act (or, for the wrong screen, leave the picture alone).
      const keyed = (pixels: Uint8Array) => { let count = 0; for (let y = 0; y < HEIGHT; y++) for (let x = 12; x < WIDTH; x++) if (pixels[y * ROW_PITCH + x * 4 + 3] < 128) count++; return count; };
      if (item.keys !== undefined && item.keys !== keyed(gpu) > WIDTH * HEIGHT * 0.3) {
        throw new Error(`${item.name}: ${keyed(gpu)} keyed pixels, expected ${item.keys ? 'most of the screen' : 'none'}.`);
      }
      comparisons++;
    }
    return comparisons;
  } finally { runtime.dispose(); }
}
