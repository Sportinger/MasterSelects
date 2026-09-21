import common from '../../src/effects/_shared/commonShader';
import { imageGraphProgramShader } from '../../src/effects/_shared/imageGraphDefinition';
import { ImageGraphPassRuntime } from '../../src/effects/ImageGraphPassRuntime';
import { memoryLeak } from '../../src/effects/generate/memoryLeak';
import { depthParam, numberParam, planMemoryWindow } from '../../src/effects/generate/memoryLeak/memoryWindow';
import type { FullscreenEffectDefinition } from '../../src/effects/types';
import { createDefaultMemoryLeakGraph } from '../../src/services/operators/memoryLeakEffectGraph';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { packImageOperatorRuntimeUniforms } from '../../src/services/operators/imageOperatorRuntimeUniforms';
import { effectOperatorCompileContext } from '../../src/services/operators/effectGraphOwner';

const width = 8, height = 6, outputBytesPerRow = 256;
const definition = memoryLeak as FullscreenEffectDefinition;
const compileContext = effectOperatorCompileContext({ type: 'memory-leak' });
const defaults = Object.fromEntries(Object.entries(definition.params).map(([id, spec]) => [id, spec.default]));
const DEPTH_INDEX = { '8': 0, '16': 1, '32': 2 } as const;
const FLOAT_MODE_INDEX: Record<string, number> = { clamp: 0, wrap: 1, abs: 2 };

const cases = [
  { name: '8-bit', params: { depth: '8', opaque: false } },
  { name: '16-bit', params: { depth: '16', opaque: false } },
  { name: '32-bit-clamp', params: { depth: '32', floatMode: 'clamp', floatGain: 1, opaque: false } },
  { name: '32-bit-wrap', params: { depth: '32', floatMode: 'wrap', floatGain: 2.75, opaque: false } },
  { name: '32-bit-abs', params: { depth: '32', floatMode: 'abs', floatGain: .75, opaque: false } },
  { name: 'active-minimums', params: { size: 8, offset: 0, stride: 1, seed: 0, floatGain: .001, mix: 1, opaque: false } },
  { name: 'maximum-controls', params: { size: 1024, offset: 4096, stride: 65536, seed: 9999, floatGain: 1000, mix: 1, opaque: true } },
  { name: 'opaque-false', params: { depth: '8', opaque: false, mix: .72 } },
  { name: 'opaque-true', params: { depth: '8', opaque: true, mix: .72 } },
  { name: 'nan-inf-holes', params: { depth: '32', floatMode: 'abs', opaque: false } },
] as const;

function sourcePixels(): Uint8Array {
  const data = new Uint8Array(outputBytesPerRow * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([
    (x * 37 + y * 13 + 7) & 255, (x * 17 + y * 83 + 31) & 255,
    (x * 109 + y * 29 + 3) & 255, (x * 43 + y * 67 + 11) & 255,
  ], y * outputBytesPerRow + x * 4);
  return data;
}

function f32bits(value: number): number {
  const data = new Float32Array([value]);
  return new Uint32Array(data.buffer)[0];
}

function memoryWords(wordsPerRow: number, rows: number): { bytes: Uint8Array; bytesPerRow: number } {
  const bytesPerRow = Math.ceil(wordsPerRow * 4 / 256) * 256;
  const bytes = new Uint8Array(bytesPerRow * rows), words = new Uint32Array(bytes.buffer);
  const values = [0x4080c0ff, 0xff102060, 0x7fff0000, 0x1234abcd,
    f32bits(-1.375), f32bits(.625), f32bits(2.25), f32bits(-.125), 0x7fc00001, 0x7f800000, 0xff800000, f32bits(.33333334)];
  const stride = bytesPerRow / 4;
  for (let y = 0; y < rows; y++) for (let x = 0; x < wordsPerRow; x++) words[y * stride + x] = values[(x + y * 5) % values.length];
  return { bytes, bytesPerRow };
}

function legacyUniforms(params: Record<string, unknown>, available: boolean): Float32Array<ArrayBuffer> {
  const primitive = params as Record<string, number | boolean | string>, plan = planMemoryWindow(primitive, width, height);
  return new Float32Array([width, height, plan.memWidth, plan.memRows, DEPTH_INDEX[depthParam(primitive)], available ? 1 : 0,
    Math.max(0, Math.min(1, numberParam(primitive, 'mix', 1))), primitive.opaque === false ? 0 : 1,
    FLOAT_MODE_INDEX[String(primitive.floatMode ?? 'wrap')] ?? 1, Math.max(.001, numberParam(primitive, 'floatGain', 1)), 0, 0]);
}

function mismatch(expected: Uint8Array, actual: Uint8Array): string {
  let first = -1, count = 0, maximum = 0;
  expected.forEach((value, index) => { const delta = Math.abs(value - actual[index]); if (!delta) return;
    if (first < 0) first = index; count += 1; maximum = Math.max(maximum, delta); });
  return `byte ${first}: expected ${expected[first]}, actual ${actual[first]}; ${count}/${expected.length} differ, max delta ${maximum}`;
}

async function read(device: GPUDevice, encoder: GPUCommandEncoder, target: GPUTexture, buffer: GPUBuffer): Promise<Uint8Array> {
  encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow: outputBytesPerRow }, [width, height]);
  device.queue.submit([encoder.finish()]); await buffer.mapAsync(GPUMapMode.READ);
  const result = new Uint8Array(buffer.getMappedRange()).slice(); buffer.unmap(); return result;
}

async function renderLegacy(device: GPUDevice, sampler: GPUSampler, source: GPUTextureView, memory: GPUTextureView,
  target: GPUTexture, readback: GPUBuffer, params: Record<string, unknown>, available: boolean): Promise<Uint8Array> {
  const module = device.createShaderModule({ code: `${common}\n${definition.shader}` });
  const errors = (await module.getCompilationInfo()).messages.filter(message => message.type === 'error');
  if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
  const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
    fragment: { module, entryPoint: definition.entryPoint, targets: [{ format: 'rgba8unorm' }] } });
  const packed = legacyUniforms(params, available), uniform = device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(uniform, 0, packed);
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
    { binding: 0, resource: sampler }, { binding: 1, resource: source }, { binding: 2, resource: { buffer: uniform } }, { binding: 5, resource: memory },
  ] });
  const encoder = device.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
  pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(6); pass.end();
  const result = await read(device, encoder, target, readback); uniform.destroy(); return result;
}

async function renderDirect(device: GPUDevice, sampler: GPUSampler, source: GPUTextureView, target: GPUTexture,
  readback: GPUBuffer, plan: ReturnType<typeof compileImageOperatorGraph>): Promise<Uint8Array> {
  const entryPoint = 'memoryLeakDirectFragment', module = device.createShaderModule({ code: `${common}\n${imageGraphProgramShader(plan, entryPoint)}` });
  const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
    fragment: { module, entryPoint, targets: [{ format: 'rgba8unorm' }] } });
  const packed = packImageOperatorRuntimeUniforms(plan, 0, width, height), entries: GPUBindGroupEntry[] = [
    { binding: 0, resource: sampler }, { binding: 1, resource: source },
  ];
  let uniform: GPUBuffer | undefined;
  if (packed) { uniform = device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(uniform, 0, packed); entries.push({ binding: 2, resource: { buffer: uniform } }); }
  const encoder = device.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
  pass.setPipeline(pipeline); pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries })); pass.draw(6); pass.end();
  const result = await read(device, encoder, target, readback); uniform?.destroy(); return result;
}

function directGraph() {
  const graph = createDefaultMemoryLeakGraph(), frame = graph.nodes.find(node => node.operator === 'image.frame'), output = graph.nodes.find(node => node.operator === 'image.output');
  if (!frame || !output) throw new Error('Memory Leak graph lacks image boundaries.');
  graph.edges = graph.edges.filter(edge => edge.to !== output.id);
  graph.edges.push({ id: 'memory-leak-direct', from: frame.id, output: 'image', to: output.id, input: 'image' });
  return graph;
}

function metadataGraph() {
  const graph = createDefaultMemoryLeakGraph(), memory = graph.nodes.find(node => node.operator === 'source.memory-window'), output = graph.nodes.find(node => node.operator === 'image.output');
  if (!memory || !output) throw new Error('Memory Leak graph lacks metadata boundaries.');
  graph.nodes.push({ id: 'metadata-image', operator: 'convert.vec4-to-image', operatorVersion: 1, bindings: {} });
  graph.edges = graph.edges.filter(edge => edge.to !== output.id);
  graph.edges.push({ id: 'metadata-to-image', from: memory.id, output: 'metadata', to: 'metadata-image', input: 'value' },
    { id: 'metadata-output', from: 'metadata-image', output: 'image', to: output.id, input: 'image' });
  return graph;
}

export async function checkMemoryLeakGraphGpu(device: GPUDevice): Promise<number> {
  const sourceBytes = sourcePixels(), source = device.createTexture({ size: [width, height], format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: outputBytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const runtime = new ImageGraphPassRuntime(device); let comparisons = 0;
  device.queue.writeTexture({ texture: source }, sourceBytes, { bytesPerRow: outputBytesPerRow }, [width, height]);
  try {
    for (const item of cases) {
      const params = { ...defaults, ...item.params }, window = planMemoryWindow(params as Record<string, number | boolean | string>, width, height);
      const memoryData = memoryWords(window.wordsPerRow, window.memRows), texture = device.createTexture({ size: [window.wordsPerRow, window.memRows],
        format: 'r32uint', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      device.queue.writeTexture({ texture }, memoryData.bytes, { bytesPerRow: memoryData.bytesPerRow }, [window.wordsPerRow, window.memRows]);
      try {
        const plan = compileImageOperatorGraph(createDefaultMemoryLeakGraph(), params, compileContext);
        if (plan.passes?.length) throw new Error(`${item.name}: Memory Leak unexpectedly materialized multiple passes.`);
        const resourceId = plan.resourceInputs?.find((id, index) => plan.resourceSampling?.[index] === 'exact-u32-pixel-load');
        if (!resourceId) throw new Error(`${item.name}: missing uint memory resource.`);
        const expected = await renderLegacy(device, sampler, source.createView(), texture.createView(), target, readback, params, true);
        const encoder = device.createCommandEncoder();
        runtime.encode({ encoder, sampler, source: { kind: 'texture', view: source.createView() }, width, height, timelineTimeSeconds: 0,
          plan, outputView: target.createView(), instanceId: `memory-${item.name}`,
          externalResources: new Map([[resourceId, { view: texture.createView(), identity: item.name,
            width: window.wordsPerRow, height: window.memRows, available: true }]]) });
        const actual = await read(device, encoder, target, readback);
        if (expected.some((value, index) => value !== actual[index])) throw new Error(`${item.name}: ${mismatch(expected, actual)}`);
        comparisons += 1;
      } finally { texture.destroy(); }
    }

    const params = { ...defaults, depth: '8', opaque: false }, window = planMemoryWindow(params as Record<string, number | boolean | string>, width, height);
    const texture = device.createTexture({ size: [window.wordsPerRow, window.memRows], format: 'r32uint', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    const memoryData = memoryWords(window.wordsPerRow, window.memRows);
    device.queue.writeTexture({ texture }, memoryData.bytes, { bytesPerRow: memoryData.bytesPerRow }, [window.wordsPerRow, window.memRows]);
    try {
      const unavailablePlan = compileImageOperatorGraph(createDefaultMemoryLeakGraph(), params, compileContext);
      const resourceId = unavailablePlan.resourceInputs!.find((id, index) => unavailablePlan.resourceSampling?.[index] === 'exact-u32-pixel-load')!;
      const expected = await renderLegacy(device, sampler, source.createView(), texture.createView(), target, readback, params, false);
      const unavailableEncoder = device.createCommandEncoder();
      runtime.encode({ encoder: unavailableEncoder, sampler, source: { kind: 'texture', view: source.createView() }, width, height, timelineTimeSeconds: 0,
        plan: unavailablePlan, outputView: target.createView(), instanceId: 'memory-unavailable', externalResources: new Map([[resourceId,
          { view: texture.createView(), identity: 'unavailable', width: 1, height: 1, available: false }]]) });
      const unavailable = await read(device, unavailableEncoder, target, readback);
      if (expected.some((value, index) => value !== unavailable[index])) throw new Error(`unavailable: ${mismatch(expected, unavailable)}`);
      comparisons += 1;

      const directPlan = compileImageOperatorGraph(directGraph(), params, compileContext);
      if (directPlan.resourceInputs?.length) throw new Error('Direct Memory Leak rewire retained uint resource.');
      const direct = await renderDirect(device, sampler, source.createView(), target, readback, directPlan);
      if (sourceBytes.some((value, index) => value !== direct[index])) throw new Error(`direct: ${mismatch(sourceBytes, direct)}`);
      comparisons += 1;

      const metadataPlan = compileImageOperatorGraph(metadataGraph(), params, compileContext);
      const metadataId = metadataPlan.resourceInputs!.find((id, index) => metadataPlan.resourceSampling?.[index] === 'exact-u32-pixel-load')!;
      const metadataEncoder = device.createCommandEncoder();
      runtime.encode({ encoder: metadataEncoder, sampler, source: { kind: 'texture', view: source.createView() }, width, height, timelineTimeSeconds: 0,
        plan: metadataPlan, outputView: target.createView(), instanceId: 'memory-metadata', externalResources: new Map([[metadataId,
          { view: texture.createView(), identity: 'metadata', width: window.wordsPerRow, height: window.memRows, available: true }]]) });
      const metadata = await read(device, metadataEncoder, target, readback);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const offset = y * outputBytesPerRow + x * 4;
        if (metadata[offset] !== 255 || metadata[offset + 1] !== 255 || metadata[offset + 2] !== 255 || metadata[offset + 3] !== 0) {
          throw new Error(`metadata-only output differs at ${x},${y}: ${[...metadata.slice(offset, offset + 4)].join(',')}`);
        }
      }
      comparisons += 1;
    } finally { texture.destroy(); }
    return comparisons;
  } finally { runtime.dispose(); source.destroy(); target.destroy(); readback.destroy(); }
}
