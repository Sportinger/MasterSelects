import common from '../../src/effects/_shared/commonShader';
import { imageGraphProgramShader } from '../../src/effects/_shared/imageGraphDefinition';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import type { ImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { createKernelReducerBranchGraph, createRootPureImageSelectGraph, createSequenceReducerBranchGraph } from '../helpers/imageReducerBranchGraphs';

const width = 47, height = 29, rowPitch = 256;
const cases = [
  { name: 'sequence-root', graph: () => createSequenceReducerBranchGraph('root-first', true), entry: 'sequenceRoot' },
  { name: 'sequence-scope', graph: () => createSequenceReducerBranchGraph('scope-first', true), entry: 'sequenceScope' },
  { name: 'grid-root', graph: () => createKernelReducerBranchGraph('grid', 'root-first'), entry: 'gridRoot' },
  { name: 'grid-scope', graph: () => createKernelReducerBranchGraph('grid', 'scope-first'), entry: 'gridScope' },
  { name: 'rect-root', graph: () => createKernelReducerBranchGraph('rect', 'root-first'), entry: 'rectRoot' },
  { name: 'rect-scope', graph: () => createKernelReducerBranchGraph('rect', 'scope-first'), entry: 'rectScope' },
  { name: 'root-pure-select', graph: createRootPureImageSelectGraph, entry: 'pureSelect' },
] as const;

const reference = `
@group(0) @binding(0) var branchSampler: sampler;
@group(0) @binding(1) var branchTexture: texture_2d<f32>;
fn sourceAt(uv: vec2f) -> vec4f { return textureSample(branchTexture, branchSampler, uv) * .5; }
fn sequenceReference(uv: vec2f) -> vec4f {
  let count = 4;
  var sum = vec4f(0.0);
  for (var i = 0; i < count; i++) {
    let t = select(0.0, f32(i) / f32(count - 1), count > 1); let high = t > .5;
    let sampled = sourceAt(vec2f(t, select(0.0, 1.0, high)));
    sum += sampled;
  }
  return sum / f32(count);
}
fn kernelTerm(ix: i32, iy: i32) -> vec4f {
  let base = vec2f(.5 + f32(ix) * .1, .5 + f32(iy) * .1);
  return sourceAt(base + vec2f(select(0.0, .2, ix > 0), 0.0));
}
fn gridReference(uv: vec2f) -> vec4f {
  let extent = 1i;
  var sum = vec4f(0.0); var weight = 0.0;
  for (var x = -extent; x <= extent; x++) { for (var y = -extent; y <= extent; y++) { sum += kernelTerm(x, y); weight += 1.0; } }
  return sum / weight;
}
fn rectReference(uv: vec2f) -> vec4f {
  let columns = 2;
  var sum = vec4f(0.0); var weight = 0.0;
  for (var x = 0; x < columns; x++) { for (var y = 0; y < 2; y++) { sum += kernelTerm(x, y); weight += 1.0; } }
  return sum / weight;
}
@fragment fn sequenceRoot(input: VertexOutput) -> @location(0) vec4f { return sequenceReference(input.uv); }
@fragment fn sequenceScope(input: VertexOutput) -> @location(0) vec4f { return sequenceReference(input.uv); }
@fragment fn gridRoot(input: VertexOutput) -> @location(0) vec4f { return gridReference(input.uv); }
@fragment fn gridScope(input: VertexOutput) -> @location(0) vec4f { return gridReference(input.uv); }
@fragment fn rectRoot(input: VertexOutput) -> @location(0) vec4f { return rectReference(input.uv); }
@fragment fn rectScope(input: VertexOutput) -> @location(0) vec4f { return rectReference(input.uv); }
@fragment fn pureSelect(input: VertexOutput) -> @location(0) vec4f { return textureSample(branchTexture, branchSampler, input.uv); }
`;

function fixture() {
  const result = new Uint8Array(rowPitch * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
    result.set([255, 255, 255, 17 + (x * 43 + y * 71) % 239], y * rowPitch + x * 4);
  return result;
}
function mismatch(expected: Uint8Array, actual: Uint8Array) {
  let first = -1, count = 0, maxDelta = 0;
  expected.forEach((value, index) => { const delta = Math.abs(value - actual[index]); if (!delta) return;
    if (first < 0) first = index; count++; maxDelta = Math.max(maxDelta, delta); });
  return `byte ${first}: expected ${expected[first]}, actual ${actual[first]}; ${count}/${expected.length} differ, max delta ${maxDelta}`;
}
async function render(device: GPUDevice, sampler: GPUSampler, source: GPUTextureView, target: GPUTexture, readback: GPUBuffer, shader: string, entryPoint: string) {
  device.pushErrorScope('validation'); let popped = false; const pop = async () => { popped = true; return device.popErrorScope(); };
  try {
    const module = device.createShaderModule({ code: `${common}\n${shader}` }), info = await module.getCompilationInfo();
    const errors = info.messages.filter(message => message.type === 'error'); if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
    const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' }, fragment: { module, entryPoint, targets: [{ format: 'rgba8unorm' }] } });
    const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: sampler }, { binding: 1, resource: source }] });
    const encoder = device.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(6); pass.end(); encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: rowPitch }, [width, height]);
    device.queue.submit([encoder.finish()]); await readback.mapAsync(GPUMapMode.READ); const result = new Uint8Array(readback.getMappedRange()).slice(); readback.unmap();
    const validation = await pop(); if (validation) throw new Error(validation.message); return result;
  } catch (error) { const validation = popped ? null : await pop(); if (validation) throw new Error(validation.message, { cause: error }); throw error; }
}

async function validateExternalSequencePipeline(device: GPUDevice, plan: ImageOperatorPlan) {
  const module = device.createShaderModule({ code: `${common}\n${imageGraphProgramShader(plan, 'externalReducerFragment', 'external')}` });
  const info = await module.getCompilationInfo(), errors = info.messages.filter(message => message.type === 'error');
  if (errors.length) throw new Error(`external sequence shader: ${errors.map(message => message.message).join('\n')}`);
  await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
    fragment: { module, entryPoint: 'externalReducerFragment', targets: [{ format: 'rgba8unorm' }] } });
}

export async function checkImageReducerBranchesGpu(device: GPUDevice): Promise<number> {
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const input = fixture(), source = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: input.byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  device.queue.writeTexture({ texture: source }, input, { bytesPerRow: rowPitch }, [width, height]);
  try {
    for (const item of cases) {
      const plan = compileImageOperatorGraph(item.graph());
      if (plan.passes?.length) throw new Error(`${item.name}: unexpectedly materialized lexical reducer graph`);
      if (item.name === 'sequence-root') await validateExternalSequencePipeline(device, plan);
      if (item.name === 'root-pure-select' && (plan.capabilities.includes('sample') || plan.capabilities.includes('uv')))
        throw new Error('Root pure image select incorrectly requires sampling context.');
      const expected = await render(device, sampler, source.createView(), target, readback, reference, item.entry);
      const actual = await render(device, sampler, source.createView(), target, readback, imageGraphProgramShader(plan, 'reducerFragment'), 'reducerFragment');
      if (expected.some((value, index) => value !== actual[index])) throw new Error(`${item.name}: ${mismatch(expected, actual)}`);
    }
    return cases.length;
  } finally { source.destroy(); target.destroy(); readback.destroy(); }
}
