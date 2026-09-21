import common from '../../src/effects/_shared/commonShader';
import { ImageGraphPassRuntime } from '../../src/effects/ImageGraphPassRuntime';
import { createDefaultBoxBlurGraph } from '../../src/services/operators/blurEffectGraphs';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../src/types/operatorGraph';

const width = 64, height = 37, rowPitch = 256;
const referenceShader = `
@group(0) @binding(0) var refSampler: sampler;
@group(0) @binding(1) var refTexture: texture_2d<f32>;
fn refTexel() -> vec2f { return vec2f(1.0) / vec2f(textureDimensions(refTexture)); }
@fragment fn horizontalReference(input: VertexOutput) -> @location(0) vec4f {
  let d = refTexel();
  return (textureSample(refTexture, refSampler, input.uv - vec2f(d.x, 0.0))
    + textureSample(refTexture, refSampler, input.uv)
    + textureSample(refTexture, refSampler, input.uv + vec2f(d.x, 0.0))) / 3.0;
}
@fragment fn verticalReference(input: VertexOutput) -> @location(0) vec4f {
  let d = refTexel();
  return (textureSample(refTexture, refSampler, input.uv - vec2f(0.0, d.y))
    + textureSample(refTexture, refSampler, input.uv)
    + textureSample(refTexture, refSampler, input.uv + vec2f(0.0, d.y))) / 3.0;
}`;

function directionalStage(prefix: string, axis: 'x' | 'y', sourceId: string) {
  const base = createDefaultBoxBlurGraph();
  const rename = (id: string) => id === 'frame' ? sourceId : `${prefix}${id}`;
  const nodes = base.nodes.filter(item => item.id !== 'frame' && item.id !== 'output').map(item => ({ ...item, id: rename(item.id),
    bindings: { ...item.bindings }, constants: item.constants ? { ...item.constants } : undefined }));
  const radius = nodes.find(item => item.id === `${prefix}radius`)!; radius.bindings = {}; radius.constants = { value: 1 };
  const edges = base.edges.filter(item => item.to !== 'output').map(item => ({ ...item, id: `${prefix}${item.id}`,
    from: rename(item.from), to: rename(item.to) })).filter(item => !(item.to === `${prefix}reduce` && item.input === 'weight'));
  const extraNodes: BoundOperatorNode[] = [
    { id: `${prefix}index-split`, operator: 'vector.split.vec2', operatorVersion: 1, bindings: {} },
    { id: `${prefix}axis-square`, operator: 'math.multiply.scalar', operatorVersion: 1, bindings: {} },
    { id: `${prefix}zero`, operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: 0 } },
    { id: `${prefix}off-axis`, operator: 'compare.greater.scalar', operatorVersion: 1, bindings: {} },
    { id: `${prefix}weight-mask`, operator: 'select.scalar', operatorVersion: 1, bindings: {} },
  ];
  const component = axis === 'x' ? 'y' : 'x';
  const extraEdges: OperatorEdge[] = [
    { id: `${prefix}index-mask`, from: `${prefix}index`, output: 'value', to: `${prefix}index-split`, input: 'value' },
    { id: `${prefix}axis-square-a`, from: `${prefix}index-split`, output: component, to: `${prefix}axis-square`, input: 'a' },
    { id: `${prefix}axis-square-b`, from: `${prefix}index-split`, output: component, to: `${prefix}axis-square`, input: 'b' },
    { id: `${prefix}square-condition`, from: `${prefix}axis-square`, output: 'value', to: `${prefix}off-axis`, input: 'a' },
    { id: `${prefix}zero-condition`, from: `${prefix}zero`, output: 'value', to: `${prefix}off-axis`, input: 'b' },
    { id: `${prefix}one-weight`, from: `${prefix}one`, output: 'value', to: `${prefix}weight-mask`, input: 'falseValue' },
    { id: `${prefix}zero-weight`, from: `${prefix}zero`, output: 'value', to: `${prefix}weight-mask`, input: 'trueValue' },
    { id: `${prefix}condition-weight`, from: `${prefix}off-axis`, output: 'condition', to: `${prefix}weight-mask`, input: 'condition' },
    { id: `${prefix}weight-reduce`, from: `${prefix}weight-mask`, output: 'value', to: `${prefix}reduce`, input: 'weight' },
  ];
  return { nodes: [...nodes, ...extraNodes], edges: [...edges, ...extraEdges], output: `${prefix}selected` };
}

function separableGraph(): EffectOperatorGraph {
  const horizontal = directionalStage('h-', 'x', 'frame');
  const vertical = directionalStage('v-', 'y', 'materialize');
  const nodes: BoundOperatorNode[] = [{ id: 'frame', operator: 'image.frame', operatorVersion: 1, bindings: {} },
    ...horizontal.nodes, { id: 'materialize', operator: 'image.materialize', operatorVersion: 1, bindings: {} }, ...vertical.nodes,
    { id: 'output', operator: 'image.output', operatorVersion: 1, bindings: {} }];
  const edges: OperatorEdge[] = [...horizontal.edges,
    { id: 'horizontal-materialize', from: horizontal.output, output: 'image', to: 'materialize', input: 'image' }, ...vertical.edges,
    { id: 'vertical-output', from: vertical.output, output: 'image', to: 'output', input: 'image' }];
  return { version: 1, schemaVersion: 1, domain: 'image', nodes, edges,
    layout: Object.fromEntries(nodes.map((item, index) => [item.id, { x: (index % 12) * 220, y: Math.floor(index / 12) * 320 }])) };
}

function automaticBarrierGraph(): EffectOperatorGraph {
  const graph = separableGraph();
  graph.nodes = graph.nodes.filter(item => item.id !== 'materialize');
  graph.edges = graph.edges.filter(item => item.id !== 'horizontal-materialize').map(item => item.from === 'materialize'
    ? { ...item, from: 'h-selected', output: 'image' } : item);
  delete graph.layout.materialize;
  return graph;
}

function mismatch(expected: Uint8Array, actual: Uint8Array): string {
  let first = -1, count = 0, maxDelta = 0;
  for (let index = 0; index < expected.length; index++) { const delta = Math.abs(expected[index] - actual[index]);
    if (!delta) continue; if (first < 0) first = index; count++; maxDelta = Math.max(maxDelta, delta); }
  return `byte ${first}: expected ${expected[first]}, actual ${actual[first]}; ${count}/${expected.length} differ, max delta ${maxDelta}`;
}

async function read(device: GPUDevice, encoder: GPUCommandEncoder, texture: GPUTexture, buffer: GPUBuffer) {
  encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: rowPitch }, [width, height]); device.queue.submit([encoder.finish()]);
  await buffer.mapAsync(GPUMapMode.READ); const bytes = new Uint8Array(buffer.getMappedRange()).slice(); buffer.unmap(); return bytes;
}

export async function checkImageMaterializationGpu(device: GPUDevice): Promise<number> {
  const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC;
  const source = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const intermediate = device.createTexture({ size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
  const expectedTarget = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage });
  const actualTarget = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage });
  const autoTarget = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage });
  const editedTarget = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage });
  const readback = device.createBuffer({ size: rowPitch * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const pixels = new Uint8Array(rowPitch * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set([
    (x * 67 + y * 7) % 256, (x * 5 + y * 83) % 256, ((x ^ y) & 1) ? 1 : 2, (x * 31 + y * 47) % 256,
  ], y * rowPitch + x * 4);
  device.queue.writeTexture({ texture: source }, pixels, { bytesPerRow: rowPitch }, [width, height]);
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const runtime = new ImageGraphPassRuntime(device);
  const sourceView = source.createView();
  device.pushErrorScope('validation');
  let errorScopePopped = false;
  const popValidation = async () => { errorScopePopped = true; return device.popErrorScope(); };
  try {
    const module = device.createShaderModule({ code: `${common}\n${referenceShader}` });
    const pipeline = (entryPoint: string, format: GPUTextureFormat) => device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint, targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
    const horizontal = pipeline('horizontalReference', 'rgba16float'), vertical = pipeline('verticalReference', 'rgba8unorm');
    const renderReference = async () => {
      const encoder = device.createCommandEncoder();
      for (const [activePipeline, input, output] of [[horizontal, sourceView, intermediate.createView()], [vertical, intermediate.createView(), expectedTarget.createView()]] as const) {
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: output, loadOp: 'clear', storeOp: 'store' }] });
        pass.setPipeline(activePipeline); pass.setBindGroup(0, device.createBindGroup({ layout: activePipeline.getBindGroupLayout(0), entries: [
          { binding: 0, resource: sampler }, { binding: 1, resource: input },
        ] })); pass.draw(6); pass.end();
      }
      return read(device, encoder, expectedTarget, readback);
    };
    const expected = await renderReference();
    const graph = separableGraph(), plan = compileImageOperatorGraph(graph, {});
    if (plan.passes?.length !== 2 || plan.resources?.length !== 1) throw new Error('Separable graph did not compile to two passes and one resource');
    const graphEncoder = device.createCommandEncoder();
    if (!runtime.encode({ encoder: graphEncoder, sampler, source: { kind: 'texture', view: sourceView }, width, height,
      timelineTimeSeconds: 0, plan, outputView: actualTarget.createView(), instanceId: 'materialization-probe' })) throw new Error('Materialization runtime declined multi-pass plan');
    const actual = await read(device, graphEncoder, actualTarget, readback);
    if (expected.some((value, index) => value !== actual[index])) throw new Error(`separable materialization differs from independent rgba16 reference: ${mismatch(expected, actual)}`);
    const autoPlan = compileImageOperatorGraph(automaticBarrierGraph(), {});
    if (autoPlan.passes?.length !== 2 || autoPlan.resources?.length !== 1) throw new Error('Automatic kernel barrier did not compile to two passes and one resource');
    const autoEncoder = device.createCommandEncoder();
    runtime.encode({ encoder: autoEncoder, sampler, source: { kind: 'texture', view: sourceView }, width, height,
      timelineTimeSeconds: 0, plan: autoPlan, outputView: autoTarget.createView(), instanceId: 'materialization-auto-probe' });
    const automatic = await read(device, autoEncoder, autoTarget, readback);
    if (expected.some((value, index) => value !== automatic[index])) throw new Error(`automatic kernel barrier differs from independent rgba16 reference: ${mismatch(expected, automatic)}`);
    const secondPixels = new Uint8Array(pixels);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) secondPixels.set([
      (x * 17 + y * 101) % 256, (x * 89 + y * 11) % 256, ((x + y) & 1) ? 3 : 7, (x * 7 + y * 109) % 256,
    ], y * rowPitch + x * 4);
    device.queue.writeTexture({ texture: source }, secondPixels, { bytesPerRow: rowPitch }, [width, height]);
    const secondExpected = await renderReference(), secondEncoder = device.createCommandEncoder();
    runtime.encode({ encoder: secondEncoder, sampler, source: { kind: 'texture', view: sourceView }, width, height,
      timelineTimeSeconds: 0, plan, outputView: actualTarget.createView(), instanceId: 'materialization-probe' });
    const secondActual = await read(device, secondEncoder, actualTarget, readback);
    if (secondExpected.some((value, index) => value !== secondActual[index])) throw new Error(`reused plan/source view produced stale resources: ${mismatch(secondExpected, secondActual)}`);
    if (secondActual.every((value, index) => value === actual[index])) throw new Error('Reused plan/source view ignored changed source pixels');
    graph.nodes.find(item => item.id === 'h-one')!.constants = { value: 2 };
    const editedPlan = compileImageOperatorGraph(graph, {}), editedEncoder = device.createCommandEncoder();
    runtime.encode({ encoder: editedEncoder, sampler, source: { kind: 'texture', view: sourceView }, width, height,
      timelineTimeSeconds: 0, plan: editedPlan, outputView: editedTarget.createView(), instanceId: 'materialization-probe' });
    const edited = await read(device, editedEncoder, editedTarget, readback);
    if (edited.every((value, index) => value === secondActual[index])) throw new Error('Edited upstream kernel spacing did not change final GPU output');
    const validation = await popValidation(); if (validation) throw new Error(validation.message);
    return 4;
  } catch (error) {
    const validation = errorScopePopped ? null : await popValidation();
    if (validation) throw new Error(`materialization WebGPU validation failed: ${validation.message}`, { cause: error });
    throw error;
  } finally { runtime.dispose(); source.destroy(); intermediate.destroy(); expectedTarget.destroy(); actualTarget.destroy(); autoTarget.destroy(); editedTarget.destroy(); readback.destroy(); }
}
