import { ComputeEffectRuntime } from '../../src/effects/ComputeEffectRuntime';
import { contour } from '../../src/effects/geometry';
import { compileComputeImageGraph } from '../../src/services/operators/computeImageGraph';
import { connectEffectGraph } from '../../src/services/operators/effectGraph';
import { effectOperatorCompileContext } from '../../src/services/operators/effectGraphOwner';
import { createDefaultContourGraph } from '../../src/services/operators/contourEffectGraph';

const WIDTH = 29, HEIGHT = 21, BYTES_PER_ROW = 256;
const DEFAULTS = Object.fromEntries(Object.entries(contour.params).map(([id, spec]) => [id, spec.default]));
type Pattern = 'varying' | 'mask5' | 'mask10' | 'equality';

function sourcePixels(pattern: Pattern) {
  const result = new Uint8Array(WIDTH * HEIGHT * 4);
  const occupancy = pattern === 'mask5' ? new Set(['0,0', '4,4']) : pattern === 'mask10' ? new Set(['4,0', '0,4']) : undefined;
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    const offset = (y * WIDTH + x) * 4;
    const value = occupancy ? (occupancy.has(`${x},${y}`) ? 255 : 0) : pattern === 'equality' ? 128 : (x * 37 + y * 53) & 255;
    result.set([value, value, value, (x * 29 + y * 41) & 255], offset);
  }
  return result;
}

function mismatch(actual: Uint8Array, expected: Uint8Array) {
  let count = 0, first = -1, maximum = 0;
  actual.forEach((value, index) => { const delta = Math.abs(value - expected[index]); maximum = Math.max(maximum, delta);
    if (delta) { count++; if (first < 0) first = index; } });
  return first < 0 ? 'none' : `${count}/${actual.length}; max delta ${maximum}; first byte ${first} actual=${actual[first]} expected=${expected[first]}`;
}
function mismatchCoordinates(actual: Uint8Array, expected: Uint8Array, cellSize: number) {
  const pixels: string[] = []; let boundary = 0, total = 0;
  for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel++) if ([0, 1, 2, 3].some(channel => actual[pixel * 4 + channel] !== expected[pixel * 4 + channel])) {
    const x = pixel % WIDTH, y = Math.floor(pixel / WIDTH); total++;
    if (x % cellSize === 0 || y % cellSize === 0) boundary++;
    if (pixels.length < 12) pixels.push(`${x},${y}`);
  }
  return `pixels=${total}, cell-boundary=${boundary}, first=[${pixels.join(' ')}]`;
}

/** Strict legacy marching-squares compute versus canonical topology graph. */
export async function checkComputeContourGraphGpu(device: GPUDevice): Promise<number> {
  const runtime = new ComputeEffectRuntime(device), usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT;
  const source = device.createTexture({ size: [WIDTH, HEIGHT], format: 'rgba8unorm', usage });
  const output = device.createTexture({ size: [WIDTH, HEIGHT], format: 'rgba8unorm', usage });
  const sampler = device.createSampler({ minFilter: 'nearest', magFilter: 'nearest' });
  const context = effectOperatorCompileContext({ type: 'contour' }); let comparisons = 0;

  const render = async (label: string, params: Record<string, unknown>, data: Uint8Array,
    plan?: ReturnType<typeof compileComputeImageGraph>, definition = contour) => {
    device.queue.writeTexture({ texture: source }, data, { bytesPerRow: WIDTH * 4 }, [WIDTH, HEIGHT]);
    const packed = definition.packUniforms({ ...DEFAULTS, ...params }, WIDTH, HEIGHT, 0)!;
    const uniform = device.createBuffer({ size: definition.uniformSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(uniform, 0, packed);
    const raw = device.createCommandEncoder({ label }); let computePasses = 0, renderPasses = 0;
    const encoder = new Proxy(raw, { get(target, property) { const value = target[property as keyof GPUCommandEncoder];
      if (property === 'beginComputePass') return (...args: Parameters<GPUCommandEncoder['beginComputePass']>) => { computePasses++; return target.beginComputePass(...args); };
      if (property === 'beginRenderPass') return (...args: Parameters<GPUCommandEncoder['beginRenderPass']>) => { renderPasses++; return target.beginRenderPass(...args); };
      return typeof value === 'function' ? value.bind(target) : value; } }) as GPUCommandEncoder;
    const encoded = runtime.encode({ commandEncoder: encoder, definition, inputView: source.createView(), outputView: output.createView(),
      uniformBuffer: uniform, width: WIDTH, height: HEIGHT, sampler, instanceId: label, ...(plan ? { computeImagePlan: plan } : {}) });
    if (!encoded) { uniform.destroy(); return { encoded, pixels: data.slice(), computePasses, renderPasses }; }
    const readback = device.createBuffer({ size: BYTES_PER_ROW * HEIGHT, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    raw.copyTextureToBuffer({ texture: output }, { buffer: readback, bytesPerRow: BYTES_PER_ROW }, [WIDTH, HEIGHT]);
    device.queue.submit([raw.finish()]); await readback.mapAsync(GPUMapMode.READ);
    const padded = new Uint8Array(readback.getMappedRange()), pixels = new Uint8Array(data.length);
    for (let y = 0; y < HEIGHT; y++) pixels.set(padded.subarray(y * BYTES_PER_ROW, y * BYTES_PER_ROW + WIDTH * 4), y * WIDTH * 4);
    readback.unmap(); readback.destroy(); uniform.destroy(); return { encoded, pixels, computePasses, renderPasses };
  };

  const compare = async (label: string, params: Record<string, unknown>, pattern: Pattern) => {
    const data = sourcePixels(pattern), legacy = await render(`${label}:legacy`, params, data);
    const plan = compileComputeImageGraph(createDefaultContourGraph(), params, context);
    const canonical = await render(`${label}:canonical`, params, data, plan);
    if (canonical.pixels.some((value, index) => value !== legacy.pixels[index])) {
      const diagnostic = async (nodeId: 'topology' | 'line', legacyValue: string) => {
        const graph = createDefaultContourGraph();
        graph.nodes.push({ id: `diagnostic-${nodeId}-rgb`, operator: 'convert.scalar-to-rgb', operatorVersion: 1, bindings: {} });
        graph.layout[`diagnostic-${nodeId}-rgb`] = { x: 9000, y: 0 };
        graph.edges = graph.edges.filter(edge => !(edge.to === 'combined' && edge.input === 'rgb'));
        let scalarNode = nodeId, scalarPort = nodeId === 'topology' ? 'count' : 'value';
        if (nodeId === 'topology') {
          graph.nodes.push({ id: 'diagnostic-two', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: 2 } },
            { id: 'diagnostic-count-half', operator: 'math.divide-ieee.scalar', operatorVersion: 1, bindings: {} });
          graph.layout['diagnostic-two'] = { x: 8700, y: 100 }; graph.layout['diagnostic-count-half'] = { x: 8850, y: 0 };
          graph.edges.push({ id: 'diagnostic-count-a', from: 'topology', output: 'count', to: 'diagnostic-count-half', input: 'a' },
            { id: 'diagnostic-count-b', from: 'diagnostic-two', output: 'value', to: 'diagnostic-count-half', input: 'b' });
          scalarNode = 'diagnostic-count-half'; scalarPort = 'value';
        }
        graph.edges.push({ id: `diagnostic-${nodeId}-rgb-value`, from: scalarNode, output: scalarPort,
          to: `diagnostic-${nodeId}-rgb`, input: 'value' }, { id: `diagnostic-${nodeId}-combined`, from: `diagnostic-${nodeId}-rgb`,
          output: 'rgb', to: 'combined', input: 'rgb' });
        const originalStore = 'vec4f(mix(original.rgb, contourColor, params.amount), original.a)';
        const shader = contour.shader.replace(originalStore, `vec4f(vec3f(${legacyValue}), original.a)`);
        if (shader === contour.shader) throw new Error(`Contour ${nodeId} diagnostic did not patch the legacy output.`);
        const legacyDefinition = { ...contour, id: `${contour.id}:diagnostic-${nodeId}`, shader };
        const expected = await render(`${label}:diagnostic-${nodeId}:legacy`, params, data, undefined, legacyDefinition);
        const actual = await render(`${label}:diagnostic-${nodeId}:graph`, params, data,
          compileComputeImageGraph(graph, params, context));
        return mismatch(actual.pixels, expected.pixels);
      };
      const count = await diagnostic('topology', 'f32(topology.count) / 2.0');
      const line = await diagnostic('line', 'line');
      const scale = Math.max(4, Math.round(Number(params.scale ?? DEFAULTS.scale)));
      throw new Error(`${label}: canonical Contour differs from legacy: ${mismatch(canonical.pixels, legacy.pixels)}; `
        + `${mismatchCoordinates(canonical.pixels, legacy.pixels, scale)}; topology-count ${count}; line ${line}`);
    }
    if (canonical.computePasses !== 1 || canonical.renderPasses || plan.stages.length) {
      throw new Error(`${label}: expected one compute output and no render/materialized stages.`);
    }
    for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel++) if (canonical.pixels[pixel * 4 + 3] !== data[pixel * 4 + 3]) {
      throw new Error(`${label}: Contour changed source alpha at pixel ${pixel}.`);
    }
    comparisons++;
  };

  try {
    await compare('defaults', {}, 'varying');
    await compare('minimums', { amount: 0, scale: 4, threshold: 0 }, 'varying');
    await compare('maximums', { amount: 1, scale: 48, threshold: 1 }, 'varying');
    await compare('ambiguous-mask-5', { amount: 1, scale: 4, threshold: .5, colorA: '#ff2040', colorB: '#1020e0' }, 'mask5');
    await compare('ambiguous-mask-10', { amount: 1, scale: 4, threshold: .5, colorA: '#17d060', colorB: '#e09010' }, 'mask10');
    await compare('threshold-equality', { amount: .73, scale: 4, threshold: 128 / 255 }, 'equality');
    const direct = connectEffectGraph(createDefaultContourGraph(), { id: 'direct-output', from: 'frame', output: 'image', to: 'output', input: 'image' });
    const plan = compileComputeImageGraph(direct, {}, context), data = sourcePixels('varying');
    const result = await render('direct-output', {}, data, plan);
    if (result.encoded || result.computePasses || result.renderPasses || result.pixels.some((value, index) => value !== data[index])) {
      throw new Error('Direct Contour output did not remain a zero-pass source identity.');
    }
    comparisons++; return comparisons;
  } finally { runtime.clear(); source.destroy(); output.destroy(); }
}
