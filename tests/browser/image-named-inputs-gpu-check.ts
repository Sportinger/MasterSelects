import common from '../../src/effects/_shared/commonShader';
import { imageGraphProgramShader } from '../../src/effects/_shared/imageGraphDefinition';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../src/types/operatorGraph';

const outputWidth = 5, outputHeight = 4, outputRowPitch = 256;
const node = (id: string, operator: string, value?: number, resource?: string): BoundOperatorNode => ({ id, operator, operatorVersion: 1,
  bindings: resource ? { resource } : {}, ...(value === undefined ? {} : { constants: { value } }) });
const edge = (id: string, from: string, output: string, to: string, input: string): OperatorEdge => ({ id, from, output, to, input });

function graph(): EffectOperatorGraph {
  const nodes = [node('frame', 'image.frame'), node('source', 'image.named-input', undefined, 'source'),
    node('decoded', 'image.named-input', undefined, 'decoded'), node('source-u', 'values.number', .42), node('source-v', 'values.number', .65),
    node('source-uv', 'vector.combine.vec2'), node('decoded-u', 'values.number', 1.2), node('decoded-v', 'values.number', -.25),
    node('decoded-uv', 'vector.combine.vec2'), node('source-sample', 'image.sample'), node('decoded-sample', 'image.sample'),
    node('source-rgba', 'convert.image-to-vec4'), node('decoded-rgba', 'convert.image-to-vec4'), node('amount', 'values.number', .37),
    node('mix', 'math.mix.vec4'), node('image', 'convert.vec4-to-image'), node('output', 'image.output')];
  const edges = [edge('source-u-uv', 'source-u', 'value', 'source-uv', 'x'), edge('source-v-uv', 'source-v', 'value', 'source-uv', 'y'),
    edge('decoded-u-uv', 'decoded-u', 'value', 'decoded-uv', 'x'), edge('decoded-v-uv', 'decoded-v', 'value', 'decoded-uv', 'y'),
    edge('source-image', 'source', 'image', 'source-sample', 'image'), edge('source-coordinate', 'source-uv', 'value', 'source-sample', 'uv'),
    edge('decoded-image', 'decoded', 'image', 'decoded-sample', 'image'), edge('decoded-coordinate', 'decoded-uv', 'value', 'decoded-sample', 'uv'),
    edge('source-vector', 'source-sample', 'image', 'source-rgba', 'image'), edge('decoded-vector', 'decoded-sample', 'image', 'decoded-rgba', 'image'),
    edge('source-mix', 'source-rgba', 'value', 'mix', 'a'), edge('decoded-mix', 'decoded-rgba', 'value', 'mix', 'b'),
    edge('amount-mix', 'amount', 'value', 'mix', 't'), edge('mix-image', 'mix', 'value', 'image', 'value'),
    edge('image-output', 'image', 'image', 'output', 'image')];
  return { version: 1, schemaVersion: 1, domain: 'image', nodes, edges,
    layout: Object.fromEntries(nodes.map((item, index) => [item.id, { x: index, y: 0 }])) };
}

const golden = `
@group(0) @binding(0) var namedSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(3) var namedSource: texture_2d<f32>;
@group(0) @binding(4) var namedDecoded: texture_2d<f32>;
fn fourLoad(texture: texture_2d<f32>, uv: vec2f) -> vec4f {
  let dimensions = vec2i(textureDimensions(texture));
  let position = clamp(uv, vec2f(0.0), vec2f(1.0)) * vec2f(dimensions) - 0.5;
  let origin = vec2i(floor(position)); let fraction = fract(position); let maximum = dimensions - 1;
  let a = textureLoad(texture, clamp(origin, vec2i(0), maximum), 0);
  let b = textureLoad(texture, clamp(origin + vec2i(1, 0), vec2i(0), maximum), 0);
  let c = textureLoad(texture, clamp(origin + vec2i(0, 1), vec2i(0), maximum), 0);
  let d = textureLoad(texture, clamp(origin + vec2i(1, 1), vec2i(0), maximum), 0);
  return mix(mix(a, b, fraction.x), mix(c, d, fraction.x), fraction.y);
}
@fragment fn namedInputsGolden(input: VertexOutput) -> @location(0) vec4f {
  let keepSourceBinding = textureSample(inputTex, namedSampler, input.uv) * 0.0;
  return mix(fourLoad(namedSource, vec2f(0.42, 0.65)), fourLoad(namedDecoded, vec2f(1.2, -0.25)), 0.37) + keepSourceBinding;
}`;

function texturePixels(width: number, height: number, seed: number) {
  const rowPitch = 256, data = new Uint8Array(rowPitch * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([
    (seed + x * 67 + y * 13) & 255, (seed * 3 + x * 19 + y * 71) & 255,
    (seed * 5 + x * 43 + y * 29) & 255, (seed * 7 + x * 31 + y * 53) & 255,
  ], y * rowPitch + x * 4);
  return { data, rowPitch };
}

async function render(device: GPUDevice, sampler: GPUSampler, input: GPUTextureView, source: GPUTextureView, decoded: GPUTextureView,
  target: GPUTexture, readback: GPUBuffer, shader: string, entryPoint: string) {
  const module = device.createShaderModule({ code: `${common}\n${shader}` }), info = await module.getCompilationInfo();
  const errors = info.messages.filter(message => message.type === 'error'); if (errors.length) throw new Error(errors.map(item => item.message).join('\n'));
  const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
    fragment: { module, entryPoint, targets: [{ format: 'rgba8unorm' }] } });
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: sampler },
    { binding: 1, resource: input }, { binding: 3, resource: source }, { binding: 4, resource: decoded }] });
  const encoder = device.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
  pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(6); pass.end();
  encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: outputRowPitch }, [outputWidth, outputHeight]);
  device.queue.submit([encoder.finish()]); await readback.mapAsync(GPUMapMode.READ);
  const result = new Uint8Array(readback.getMappedRange()).slice(); readback.unmap(); return result;
}

function mismatch(expected: Uint8Array, actual: Uint8Array) {
  let first = -1, count = 0, maxDelta = 0;
  expected.forEach((value, index) => { const delta = Math.abs(value - actual[index]); if (!delta) return;
    if (first < 0) first = index; count++; maxDelta = Math.max(maxDelta, delta); });
  return `byte ${first}: expected ${expected[first]}, actual ${actual[first]}; ${count}/${expected.length} differ, max delta ${maxDelta}`;
}

export async function checkImageNamedInputsGpu(device: GPUDevice): Promise<number> {
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const makeTexture = (width: number, height: number, seed: number) => {
    const texture = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    const pixels = texturePixels(width, height, seed); device.queue.writeTexture({ texture }, pixels.data, { bytesPerRow: pixels.rowPitch }, [width, height]); return texture;
  };
  const source = makeTexture(3, 2, 17), decoded = makeTexture(2, 3, 83), input = makeTexture(1, 1, 0);
  const target = device.createTexture({ size: [outputWidth, outputHeight], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: outputRowPitch * outputHeight, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  try {
    const plan = compileImageOperatorGraph(graph(), {}, { namedImages: [
      { id: 'source', sampling: 'manual-bilinear-clamp' }, { id: 'decoded', sampling: 'manual-bilinear-clamp' },
    ] });
    if (plan.passes?.length) throw new Error(`Named inputs unexpectedly compiled to ${plan.passes.length} passes.`);
    if (plan.resourceInputs?.length !== 2 || new Set(plan.resourceInputs).size !== 2
      || !plan.resourceInputs.includes('source') || !plan.resourceInputs.includes('decoded')) {
      throw new Error(`Unexpected named inputs: ${plan.resourceInputs?.join(',')}`);
    }
    if (plan.resourceSampling?.length !== plan.resourceInputs.length
      || plan.resourceSampling.some(mode => mode !== 'manual-bilinear-clamp')) throw new Error('Named input sampling metadata is not aligned.');
    const views = { source: source.createView(), decoded: decoded.createView() };
    const ordered = plan.resourceInputs.map(id => views[id as keyof typeof views]);
    const expected = await render(device, sampler, input.createView(), source.createView(), decoded.createView(), target, readback, golden, 'namedInputsGolden');
    const actual = await render(device, sampler, input.createView(), ordered[0], ordered[1], target, readback,
      imageGraphProgramShader(plan, 'namedInputsGraph'), 'namedInputsGraph');
    if (expected.some((value, index) => value !== actual[index])) throw new Error(`named input parity: ${mismatch(expected, actual)}`);
    const swappedViews = { source: views.decoded, decoded: views.source };
    const swappedOrder = plan.resourceInputs.map(id => swappedViews[id as keyof typeof swappedViews]);
    const swapped = await render(device, sampler, input.createView(), swappedOrder[0], swappedOrder[1], target, readback,
      imageGraphProgramShader(plan, 'namedInputsSwapped'), 'namedInputsSwapped');
    if (swapped.every((value, index) => value === actual[index])) throw new Error('Swapping unequal named image inputs did not change output.');
    return 2;
  } finally { source.destroy(); decoded.destroy(); input.destroy(); target.destroy(); readback.destroy(); }
}
