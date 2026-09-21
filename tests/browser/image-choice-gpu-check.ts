import common from '../../src/effects/_shared/commonShader';
import { imageGraphProgramShader } from '../../src/effects/_shared/imageGraphDefinition';
import { compileImageOperatorGraph, type ImageOperatorCompileContext } from '../../src/services/operators/imageOperatorGraph';
import { packImageOperatorParameters } from '../../src/services/operators/imageOperatorParameters';
import type { EffectOperatorGraph, OperatorEdge } from '../../src/types/operatorGraph';

const edge = (from: string, output: string, to: string, input: string): OperatorEdge => ({ id: `${from}-${to}-${input}`, from, output, to, input });
const graph: EffectOperatorGraph = {
  version: 1, schemaVersion: 1, domain: 'image', layout: {},
  nodes: [
    { id: 'frame', operator: 'image.frame', operatorVersion: 1, bindings: {} },
    { id: 'split', operator: 'vector.split.rgba', operatorVersion: 1, bindings: {} },
    { id: 'choice', operator: 'values.choice', operatorVersion: 1, bindings: { value: 'mode' } },
    { id: 'half', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: .5 } },
    { id: 'scale', operator: 'math.multiply.scalar', operatorVersion: 1, bindings: {} },
    { id: 'rgb', operator: 'convert.scalar-to-rgb', operatorVersion: 1, bindings: {} },
    { id: 'combine', operator: 'vector.combine.rgba', operatorVersion: 1, bindings: {} },
    { id: 'output', operator: 'image.output', operatorVersion: 1, bindings: {} },
  ],
  edges: [edge('frame', 'image', 'split', 'image'), edge('choice', 'value', 'scale', 'a'), edge('half', 'value', 'scale', 'b'),
    edge('scale', 'value', 'rgb', 'value'), edge('rgb', 'rgb', 'combine', 'rgb'), edge('split', 'alpha', 'combine', 'alpha'),
    edge('combine', 'image', 'output', 'image')],
};
const context: ImageOperatorCompileContext = { parameterSchema: { mode: { type: 'select', label: 'Mode', default: 'middle',
  options: [{ value: 'low', label: 'Low' }, { value: 'middle', label: 'Middle' }, { value: 'high', label: 'High' }] } } };

export async function checkImageChoiceGpu(device: GPUDevice): Promise<number> {
  const cases = [{ value: 'low', expected: 0 }, { value: 'middle', expected: 128 }, { value: 'high', expected: 255 },
    { value: 'invalid', expected: 128 }] as const;
  const plans = cases.map(item => compileImageOperatorGraph(graph, { mode: item.value }, context));
  if (!plans.every(plan => plan.key === plans[0].key && plan.wgsl === plans[0].wgsl)) throw new Error('Choice values changed the structural image program.');
  const module = device.createShaderModule({ code: `${common}\n${imageGraphProgramShader(plans[0], 'choiceFragment')}` });
  const info = await module.getCompilationInfo(), errors = info.messages.filter(message => message.type === 'error');
  if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
  const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
    fragment: { module, entryPoint: 'choiceFragment', targets: [{ format: 'rgba8unorm' }] } });
  const sampler = device.createSampler({ minFilter: 'nearest', magFilter: 'nearest' });
  const source = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const target = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const uniform = device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const readback = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  device.queue.writeTexture({ texture: source }, new Uint8Array([23, 45, 67, 255]), { bytesPerRow: 4 }, [1, 1]);
  const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
    { binding: 0, resource: sampler }, { binding: 1, resource: source.createView() }, { binding: 2, resource: { buffer: uniform } },
  ] });
  try {
    for (let index = 0; index < cases.length; index++) {
      device.queue.writeBuffer(uniform, 0, packImageOperatorParameters(plans[index].values));
      const encoder = device.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: [
        { view: target.createView(), loadOp: 'clear', storeOp: 'store' },
      ] });
      pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.draw(6); pass.end();
      encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: 256 }, [1, 1]);
      device.queue.submit([encoder.finish()]); await readback.mapAsync(GPUMapMode.READ);
      const pixel = new Uint8Array(readback.getMappedRange()).slice(0, 4); readback.unmap();
      const expected = cases[index].expected;
      if (pixel[0] !== expected || pixel[1] !== expected || pixel[2] !== expected || pixel[3] !== 255) {
        throw new Error(`Choice ${cases[index].value}: expected ${expected},${expected},${expected},255; got ${pixel.join(',')}`);
      }
    }
    return cases.length;
  } finally { source.destroy(); target.destroy(); uniform.destroy(); readback.destroy(); }
}
