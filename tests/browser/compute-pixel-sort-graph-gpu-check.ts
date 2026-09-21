import { ComputeEffectRuntime } from '../../src/effects/ComputeEffectRuntime';
import { pixelSort } from '../../src/effects/geometry';
import { compileComputeImageGraph } from '../../src/services/operators/computeImageGraph';
import { createDefaultPixelSortGraph } from '../../src/services/operators/pixelSortEffectGraph';
import { effectOperatorCompileContext } from '../../src/services/operators/effectGraphOwner';

const WIDTH = 19, HEIGHT = 5, BYTES_PER_ROW = 256;
const DEFAULTS = Object.fromEntries(Object.entries(pixelSort.params).map(([id, spec]) => [id, spec.default]));

function pixels() {
  const result = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    const offset = (y * WIDTH + x) * 4;
    // Adjacent near-ties exercise strict stable ordering; the last three pixels
    // are a partial segment whose padded values must never leak into other rows.
    const tie = Math.floor(x / 2) * 23 + y * 17;
    result.set([tie & 255, (x * 41 + y * 13) & 255, (255 - tie) & 255, (x * 29 + y * 47) & 255], offset);
  }
  return result;
}

function mismatch(actual: Uint8Array, expected: Uint8Array) {
  let count = 0, first = -1, maximum = 0;
  actual.forEach((value, index) => { const delta = Math.abs(value - expected[index]); maximum = Math.max(maximum, delta);
    if (delta) { count++; if (first < 0) first = index; } });
  return first < 0 ? 'none' : `${count}/${actual.length}; max delta ${maximum}; first byte ${first} actual=${actual[first]} expected=${expected[first]}`;
}

/** Strict legacy Pixel Sort compute versus canonical Image IR compute output. */
export async function checkComputePixelSortGraphGpu(device: GPUDevice): Promise<number> {
  const runtime = new ComputeEffectRuntime(device), usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT;
  const source = device.createTexture({ size: [WIDTH, HEIGHT], format: 'rgba8unorm', usage });
  const output = device.createTexture({ size: [WIDTH, HEIGHT], format: 'rgba8unorm', usage });
  const sourceData = pixels(); device.queue.writeTexture({ texture: source }, sourceData, { bytesPerRow: WIDTH * 4 }, [WIDTH, HEIGHT]);
  const sampler = device.createSampler({ minFilter: 'nearest', magFilter: 'nearest' });
  let comparisons = 0;
  const compile = (graph = createDefaultPixelSortGraph(), params: Record<string, unknown> = {}) =>
    compileComputeImageGraph(graph, params, effectOperatorCompileContext({ type: 'pixel-sort' }));

  const render = async (label: string, params: Record<string, unknown>, plan?: ReturnType<typeof compileComputeImageGraph>) => {
    const packed = pixelSort.packUniforms({ ...DEFAULTS, ...params }, WIDTH, HEIGHT, 0)!;
    const uniform = device.createBuffer({ size: pixelSort.uniformSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(uniform, 0, packed);
    const raw = device.createCommandEncoder({ label }); let computePasses = 0, renderPasses = 0;
    const encoder = new Proxy(raw, { get(target, property) { const value = target[property as keyof GPUCommandEncoder];
      if (property === 'beginComputePass') return (...args: Parameters<GPUCommandEncoder['beginComputePass']>) => { computePasses++; return target.beginComputePass(...args); };
      if (property === 'beginRenderPass') return (...args: Parameters<GPUCommandEncoder['beginRenderPass']>) => { renderPasses++; return target.beginRenderPass(...args); };
      return typeof value === 'function' ? value.bind(target) : value; } }) as GPUCommandEncoder;
    runtime.encode({ commandEncoder: encoder, definition: pixelSort, inputView: source.createView(), outputView: output.createView(),
      uniformBuffer: uniform, width: WIDTH, height: HEIGHT, sampler, instanceId: label, ...(plan ? { computeImagePlan: plan } : {}) });
    const readback = device.createBuffer({ size: BYTES_PER_ROW * HEIGHT, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    raw.copyTextureToBuffer({ texture: output }, { buffer: readback, bytesPerRow: BYTES_PER_ROW }, [WIDTH, HEIGHT]);
    device.queue.submit([raw.finish()]); await readback.mapAsync(GPUMapMode.READ);
    const padded = new Uint8Array(readback.getMappedRange()), result = new Uint8Array(sourceData.length);
    for (let y = 0; y < HEIGHT; y++) result.set(padded.subarray(y * BYTES_PER_ROW, y * BYTES_PER_ROW + WIDTH * 4), y * WIDTH * 4);
    readback.unmap(); readback.destroy(); uniform.destroy(); return { pixels: result, computePasses, renderPasses };
  };

  const compare = async (label: string, params: Record<string, unknown>, graph = createDefaultPixelSortGraph()) => {
    const legacy = await render(`${label}:legacy`, params), plan = compile(graph, params);
    const canonical = await render(`${label}:canonical`, params, plan);
    if (canonical.pixels.some((value, index) => value !== legacy.pixels[index])) {
      throw new Error(`${label}: canonical Pixel Sort differs from legacy: ${mismatch(canonical.pixels, legacy.pixels)}`);
    }
    for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel++) if (canonical.pixels[pixel * 4 + 3] !== sourceData[pixel * 4 + 3]) {
      throw new Error(`${label}: Pixel Sort changed source alpha at pixel ${pixel}.`);
    }
    if (canonical.renderPasses !== 0 || canonical.computePasses !== 1 || plan.stages.length !== 0) {
      throw new Error(`${label}: expected one canonical compute output and no render/materialization pass; got compute=${canonical.computePasses}, render=${canonical.renderPasses}.`);
    }
    comparisons++; return canonical.pixels;
  };

  try {
    await compare('defaults', {});
    await compare('minimums-identity', { amount: 0, scale: 4, threshold: 0 });
    await compare('maximums', { amount: 1, scale: 16, threshold: 1 });
    await compare('half-scale-ties', { amount: 1, scale: 4.5, threshold: 0 });
    const sorted = await compare('partial-row-segment', { amount: 1, scale: 16, threshold: 0 });
    await compare('threshold-eligibility', { amount: .65, scale: 7, threshold: .55 });
    const bypassed = createDefaultPixelSortGraph(); bypassed.nodes.find(node => node.id === 'sorted')!.bypassed = true;
    const bypassPlan = compile(bypassed, { amount: 1, scale: 16, threshold: 0 });
    const bypassResult = await render('bypassed-sort:canonical', { amount: 1, scale: 16, threshold: 0 }, bypassPlan);
    const identity = await render('bypassed-sort:identity-reference', { amount: 0, scale: 16, threshold: 0 });
    if (bypassResult.renderPasses !== 0 || bypassResult.computePasses !== 1 || bypassPlan.stages.length) {
      throw new Error('Bypassed sort did not remain one compute output with no materialization pass.');
    }
    const bypass = bypassResult.pixels;
    if (bypass.some((value, index) => value !== identity.pixels[index])) throw new Error(`Bypassed sort differs from legacy identity: ${mismatch(bypass, identity.pixels)}`);
    if (bypass.some((value, index) => value !== sourceData[index])) throw new Error(`Bypassed sort did not preserve source RGBA: ${mismatch(bypass, sourceData)}`);
    if (bypass.every((value, index) => value === sorted[index])) throw new Error('Bypassed sort did not differ from the normal sorted graph.');
    comparisons++;
    return comparisons;
  } finally { runtime.clear(); source.destroy(); output.destroy(); }
}
