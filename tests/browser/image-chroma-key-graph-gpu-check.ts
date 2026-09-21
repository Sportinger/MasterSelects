import common from '../../src/effects/_shared/commonShader';
import { imageGraphProgramShader } from '../../src/effects/_shared/imageGraphDefinition';
import { getEffect } from '../../src/effects';
import { isFullscreenEffectDefinition } from '../../src/effects/types';
import {
  effectOperatorCompileContext,
  effectOperatorGraph,
  effectOperatorParams,
} from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { packImageOperatorRuntimeUniforms } from '../../src/services/operators/imageOperatorRuntimeUniforms';

const width = 13;
const height = 5;
const bytesPerRow = 256;

const cases = [
  { name: 'green-default', params: {} },
  { name: 'blue-default', params: { keyColor: 'blue' } },
  { name: 'custom-falls-back-green', params: { keyColor: 'custom' } },
  { name: 'tolerance-minimum', params: { tolerance: 0 } },
  { name: 'tolerance-maximum', params: { tolerance: 1 } },
  { name: 'softness-minimum', params: { softness: 0 } },
  { name: 'softness-maximum', params: { softness: 0.5 } },
  { name: 'spill-zero', params: { spillSuppression: 0 } },
  { name: 'spill-maximum', params: { spillSuppression: 1 } },
] as const;

function sourcePixels(): Uint8Array {
  const colors = [
    [0, 255, 0, 255], [0, 0, 255, 223], [8, 238, 15, 191], [14, 22, 232, 159],
    [80, 140, 80, 127], [90, 90, 90, 95], [180, 180, 20, 63], [20, 180, 180, 31],
    [120, 120, 120, 17], [255, 0, 255, 239], [18, 220, 18, 201], [18, 18, 220, 163],
    [117, 117, 19, 129],
  ] as const;
  const data = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const color = colors[(x + y * 5) % colors.length];
    data.set([color[0], color[1], color[2], (color[3] + y * 13) & 255], y * bytesPerRow + x * 4);
  }
  return data;
}

function mismatch(expected: Uint8Array, actual: Uint8Array): string {
  let first = -1, count = 0, maximum = 0;
  expected.forEach((value, index) => {
    const delta = Math.abs(value - actual[index]);
    if (!delta) return;
    if (first < 0) first = index;
    count += 1;
    maximum = Math.max(maximum, delta);
  });
  return `byte ${first}: expected ${expected[first]}, actual ${actual[first]}; ${count}/${expected.length} differ, max delta ${maximum}`;
}

async function render(
  device: GPUDevice,
  sampler: GPUSampler,
  source: GPUTextureView,
  target: GPUTexture,
  readback: GPUBuffer,
  shader: string,
  entryPoint: string,
  uniforms: Float32Array<ArrayBuffer> | null,
): Promise<Uint8Array> {
  device.pushErrorScope('validation');
  let popped = false;
  let uniform: GPUBuffer | undefined;
  const pop = async () => { popped = true; return device.popErrorScope(); };
  try {
    const module = device.createShaderModule({ code: `${common}\n${shader}` });
    const errors = (await module.getCompilationInfo()).messages.filter(message => message.type === 'error');
    if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
    const pipeline = await device.createRenderPipelineAsync({
      layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint, targets: [{ format: 'rgba8unorm' }] },
    });
    const entries: GPUBindGroupEntry[] = [
      { binding: 0, resource: sampler },
      { binding: 1, resource: source },
    ];
    if (uniforms) {
      uniform = device.createBuffer({ size: uniforms.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(uniform, 0, uniforms);
      entries.push({ binding: 2, resource: { buffer: uniform } });
    }
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries }));
    pass.draw(6);
    pass.end();
    encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow }, [width, height]);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const result = new Uint8Array(readback.getMappedRange()).slice();
    readback.unmap();
    const validation = await pop();
    if (validation) throw new Error(validation.message);
    return result;
  } catch (error) {
    const validation = popped ? null : await pop();
    if (validation) throw new Error(validation.message, { cause: error });
    throw error;
  } finally {
    uniform?.destroy();
  }
}

export async function checkChromaKeyGraphGpu(device: GPUDevice): Promise<number> {
  const definition = getEffect('chroma-key');
  if (!isFullscreenEffectDefinition(definition)) throw new Error('chroma-key is not a fullscreen effect.');
  const defaults = Object.fromEntries(Object.entries(definition.params).map(([id, spec]) => [id, spec.default]));
  const input = sourcePixels();
  const sampler = device.createSampler({ minFilter: 'nearest', magFilter: 'nearest', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const source = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  device.queue.writeTexture({ texture: source }, input, { bytesPerRow }, [width, height]);
  let comparisons = 0;
  let processed: Uint8Array | undefined;
  try {
    for (const item of cases) {
      const params = { ...defaults, ...item.params };
      const effect = { type: 'chroma-key', params };
      const plan = compileImageOperatorGraph(effectOperatorGraph(effect), effectOperatorParams(effect), effectOperatorCompileContext(effect));
      if (plan.passes?.length || plan.resources?.length) throw new Error(`${item.name}: chroma-key unexpectedly materialized a pass.`);
      const expected = await render(device, sampler, source.createView(), target, readback, definition.shader, definition.entryPoint,
        definition.packUniforms(params, width, height, 0));
      const entryPoint = `chromaKeyGraph${comparisons}Fragment`;
      const actual = await render(device, sampler, source.createView(), target, readback, imageGraphProgramShader(plan, entryPoint), entryPoint,
        packImageOperatorRuntimeUniforms(plan, 0, width, height));
      if (expected.some((value, index) => value !== actual[index])) throw new Error(`${item.name}: ${mismatch(expected, actual)}`);
      if (item.name === 'green-default') processed = actual;
      comparisons += 1;
    }

    const effect = { type: 'chroma-key', params: defaults };
    const graph = structuredClone(effectOperatorGraph(effect));
    const frame = graph.nodes.find(node => node.operator === 'image.frame');
    const output = graph.nodes.find(node => node.operator === 'image.output');
    if (!frame || !output) throw new Error('chroma-key graph lacks image boundaries.');
    graph.edges = graph.edges.filter(edge => edge.to !== output.id);
    graph.edges.push({ id: 'chroma-key-direct-output', from: frame.id, output: 'image', to: output.id, input: 'image' });
    const plan = compileImageOperatorGraph(graph, effectOperatorParams(effect), effectOperatorCompileContext(effect));
    const entryPoint = 'chromaKeyDirectFragment';
    const direct = await render(device, sampler, source.createView(), target, readback, imageGraphProgramShader(plan, entryPoint), entryPoint,
      packImageOperatorRuntimeUniforms(plan, 0, width, height));
    if (input.some((value, index) => value !== direct[index])) throw new Error(`direct: ${mismatch(input, direct)}`);
    if (!processed || processed.every((value, index) => value === direct[index])) throw new Error('Processed chroma-key output matched direct source.');
    return comparisons + 1;
  } finally {
    source.destroy();
    target.destroy();
    readback.destroy();
  }
}
