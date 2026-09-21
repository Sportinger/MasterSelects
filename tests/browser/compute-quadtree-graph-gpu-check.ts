import { ComputeEffectRuntime } from '../../src/effects/ComputeEffectRuntime';
import { quadtreeZoom } from '../../src/effects/geometry';
import { compileComputeImageGraph } from '../../src/services/operators/computeImageGraph';
import { connectEffectGraph } from '../../src/services/operators/effectGraph';
import { effectOperatorCompileContext } from '../../src/services/operators/effectGraphOwner';
import { createDefaultQuadtreeGraph } from '../../src/services/operators/quadtreeEffectGraph';

const WIDTH = 37, HEIGHT = 19, BYTES_PER_ROW = 256;
const DEFAULTS = Object.fromEntries(Object.entries(quadtreeZoom.params).map(([id, spec]) => [id, spec.default]));
type Pattern = 'varying' | 'constant' | 'edge';

function sourcePixels(pattern: Pattern) {
  const result = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    const offset = (y * WIDTH + x) * 4;
    const rgb = pattern === 'constant' ? [73, 121, 189]
      : pattern === 'edge' ? (x === WIDTH - 1 || y === HEIGHT - 1 ? [255, 12, 231] : [4, 7, 11])
        : [(x * 37 + y * 11) & 255, (x * 13 + y * 47) & 255, (x * 71 + y * 19) & 255];
    result.set([...rgb, (x * 23 + y * 31) & 255], offset);
  }
  return result;
}

function mismatch(actual: Uint8Array, expected: Uint8Array) {
  let count = 0, first = -1, maximum = 0;
  actual.forEach((value, index) => { const delta = Math.abs(value - expected[index]); maximum = Math.max(maximum, delta);
    if (delta) { count++; if (first < 0) first = index; } });
  return first < 0 ? 'none' : `${count}/${actual.length}; max delta ${maximum}; first byte ${first} actual=${actual[first]} expected=${expected[first]}`;
}

/** Strict legacy Quadtree compute versus canonical scoped partition graph. */
export async function checkComputeQuadtreeGraphGpu(device: GPUDevice): Promise<number> {
  const runtime = new ComputeEffectRuntime(device), usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT;
  const source = device.createTexture({ size: [WIDTH, HEIGHT], format: 'rgba8unorm', usage });
  const output = device.createTexture({ size: [WIDTH, HEIGHT], format: 'rgba8unorm', usage });
  const sampler = device.createSampler({ minFilter: 'nearest', magFilter: 'nearest' }); let comparisons = 0;
  const context = effectOperatorCompileContext({ type: 'quadtree-zoom' });

  const render = async (label: string, params: Record<string, unknown>, time: number, sourceData: Uint8Array,
    plan?: ReturnType<typeof compileComputeImageGraph>) => {
    device.queue.writeTexture({ texture: source }, sourceData, { bytesPerRow: WIDTH * 4 }, [WIDTH, HEIGHT]);
    const packed = quadtreeZoom.packUniforms({ ...DEFAULTS, ...params }, WIDTH, HEIGHT, time)!;
    const uniform = device.createBuffer({ size: quadtreeZoom.uniformSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(uniform, 0, packed);
    const raw = device.createCommandEncoder({ label }); let computePasses = 0, renderPasses = 0;
    const encoder = new Proxy(raw, { get(target, property) { const value = target[property as keyof GPUCommandEncoder];
      if (property === 'beginComputePass') return (...args: Parameters<GPUCommandEncoder['beginComputePass']>) => { computePasses++; return target.beginComputePass(...args); };
      if (property === 'beginRenderPass') return (...args: Parameters<GPUCommandEncoder['beginRenderPass']>) => { renderPasses++; return target.beginRenderPass(...args); };
      return typeof value === 'function' ? value.bind(target) : value; } }) as GPUCommandEncoder;
    const encoded = runtime.encode({ commandEncoder: encoder, definition: quadtreeZoom, inputView: source.createView(), outputView: output.createView(),
      uniformBuffer: uniform, width: WIDTH, height: HEIGHT, timelineTimeSeconds: time, sampler, instanceId: label,
      ...(plan ? { computeImagePlan: plan } : {}) });
    if (!encoded) { uniform.destroy(); return { encoded, pixels: sourceData.slice(), computePasses, renderPasses }; }
    const readback = device.createBuffer({ size: BYTES_PER_ROW * HEIGHT, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    raw.copyTextureToBuffer({ texture: output }, { buffer: readback, bytesPerRow: BYTES_PER_ROW }, [WIDTH, HEIGHT]);
    device.queue.submit([raw.finish()]); await readback.mapAsync(GPUMapMode.READ);
    const padded = new Uint8Array(readback.getMappedRange()), pixels = new Uint8Array(sourceData.length);
    for (let y = 0; y < HEIGHT; y++) pixels.set(padded.subarray(y * BYTES_PER_ROW, y * BYTES_PER_ROW + WIDTH * 4), y * WIDTH * 4);
    readback.unmap(); readback.destroy(); uniform.destroy(); return { encoded, pixels, computePasses, renderPasses };
  };

  const compare = async (label: string, params: Record<string, unknown>, time: number, pattern: Pattern) => {
    const data = sourcePixels(pattern), graph = createDefaultQuadtreeGraph();
    const legacy = await render(`${label}:legacy`, params, time, data);
    const plan = compileComputeImageGraph(graph, params, context), canonical = await render(`${label}:canonical`, params, time, data, plan);
    if (canonical.pixels.some((value, index) => value !== legacy.pixels[index])) {
      throw new Error(`${label}: canonical Quadtree differs from legacy: ${mismatch(canonical.pixels, legacy.pixels)}`);
    }
    if (canonical.computePasses !== 1 || canonical.renderPasses !== 0 || plan.stages.length) {
      throw new Error(`${label}: expected one compute output, zero render passes/stages; got ${canonical.computePasses}/${canonical.renderPasses}/${plan.stages.length}.`);
    }
    for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel++) if (canonical.pixels[pixel * 4 + 3] !== data[pixel * 4 + 3]) {
      throw new Error(`${label}: Quadtree changed original alpha at pixel ${pixel}.`);
    }
    comparisons++;
  };

  try {
    await compare('defaults', {}, 0, 'varying');
    await compare('timeline', {}, 1.75, 'varying');
    await compare('minimums', { amount: 0, scale: 2, threshold: .001, speed: 0 }, 2, 'varying');
    await compare('maximums', { amount: 1, scale: 32, threshold: .2, speed: 4 }, 1.75, 'varying');
    await compare('constant-early-break', { amount: 1, scale: 3, threshold: .025, speed: .5 }, .75, 'constant');
    await compare('edge-nondivisible', { amount: .63, scale: 7, threshold: .011, speed: 1.25 }, 2.25, 'edge');
    const direct = connectEffectGraph(createDefaultQuadtreeGraph(), { id: 'direct-output', from: 'frame', output: 'image', to: 'output', input: 'image' });
    const directPlan = compileComputeImageGraph(direct, {}, context), data = sourcePixels('varying');
    const result = await render('direct-output', {}, 0, data, directPlan);
    if (result.encoded || result.computePasses || result.renderPasses || result.pixels.some((value, index) => value !== data[index])) {
      throw new Error('Direct Quadtree output did not remain a zero-pass source identity.');
    }
    comparisons++; return comparisons;
  } finally { runtime.clear(); source.destroy(); output.destroy(); }
}
