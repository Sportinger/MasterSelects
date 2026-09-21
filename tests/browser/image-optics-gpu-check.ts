import common from '../../src/effects/_shared/commonShader';
import { imageGraphProgramShader } from '../../src/effects/_shared/imageGraphDefinition';
import { fisheye } from '../../src/effects/distort/fisheye';
import type { FullscreenEffectDefinition } from '../../src/effects/types';
import { compileImageOperatorPreview } from '../../src/services/operators/imageOperatorGraph';
import { packImageOperatorRuntimeUniforms } from '../../src/services/operators/imageOperatorRuntimeUniforms';
import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../src/types/operatorGraph';
import originalFisheyeShader from './fixtures/fisheye-original.wgsl?raw';

const width = 47, height = 29, rowPitch = 256;
const cases = [
  { name: 'equidistant-positive-sample1', params: { projection: 'equidistant', strength: 1, samples: 1 } },
  { name: 'equidistant-negative-sample8', params: { projection: 'equidistant', strength: -1, samples: 8, curveBias: -1 } },
  { name: 'equisolid-positive-optics', params: { projection: 'equisolid', strength: .67, samples: 4, chromaticAberration: .05, vignette: 1, vignetteSoftness: .01 } },
  { name: 'equisolid-negative-transparent', params: { projection: 'equisolid', strength: -.72, samples: 1, edgeMode: 'transparent', outside: 'transparent', feather: 0, edgeFeather: 0 } },
  { name: 'stereographic-positive-mirror', params: { projection: 'stereographic', strength: .91, samples: 8, edgeMode: 'mirror', radius: .1, zoom: 4, centerX: 0, centerY: 1 } },
  { name: 'stereographic-negative-clamp', params: { projection: 'stereographic', strength: -.83, samples: 4, edgeMode: 'clamp', radius: 3, zoom: .25, squeeze: 4 } },
  { name: 'orthographic-positive-repeat', params: { projection: 'orthographic', strength: .58, samples: 1, edgeMode: 'repeat', fieldOfView: 175, rotation: 180, preserveAspect: false } },
  { name: 'orthographic-negative-edge-max', params: { projection: 'orthographic', strength: -.59, samples: 8, fieldOfView: 20, feather: .5, edgeFeather: .1, squeeze: .25 } },
] as const;

function fixture() {
  const result = new Uint8Array(rowPitch * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) result.set([
    (x * 37 + y * 11) & 255, ((x ^ y) * 53 + y * 7) & 255,
    ((x + y) % 4) ? (x * 17 + y * 89) & 255 : 247, (x * 43 + y * 71) & 255,
  ], y * rowPitch + x * 4);
  return result;
}

function mismatch(expected: Uint8Array, actual: Uint8Array) {
  let first = -1, count = 0, maxDelta = 0;
  expected.forEach((value, index) => { const delta = Math.abs(value - actual[index]); if (!delta) return;
    if (first < 0) first = index; count++; maxDelta = Math.max(maxDelta, delta); });
  return `byte ${first}: expected ${expected[first]}, actual ${actual[first]}; ${count}/${expected.length} differ, max delta ${maxDelta}`;
}

async function render(device: GPUDevice, sampler: GPUSampler, source: GPUTextureView, target: GPUTexture, readback: GPUBuffer,
  shader: string, entryPoint: string, packed?: Float32Array | null) {
  device.pushErrorScope('validation'); let popped = false, uniform: GPUBuffer | undefined;
  const pop = async () => { popped = true; return device.popErrorScope(); };
  try {
    const module = device.createShaderModule({ code: `${common}\n${shader}` }), info = await module.getCompilationInfo();
    const errors = info.messages.filter(message => message.type === 'error'); if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
    const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint, targets: [{ format: 'rgba8unorm' }] } });
    const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: sampler }, { binding: 1, resource: source }];
    if (packed) { uniform = device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(uniform, 0, packed); entries.push({ binding: 2, resource: { buffer: uniform } }); }
    const passEncoder = device.createCommandEncoder(), pass = passEncoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(pipeline); pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries })); pass.draw(6); pass.end();
    passEncoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: rowPitch }, [width, height]);
    device.queue.submit([passEncoder.finish()]); await readback.mapAsync(GPUMapMode.READ);
    const result = new Uint8Array(readback.getMappedRange()).slice(); readback.unmap();
    const validation = await pop(); if (validation) throw new Error(validation.message); return result;
  } catch (error) { const validation = popped ? null : await pop(); if (validation) throw new Error(validation.message, { cause: error }); throw error; }
  finally { uniform?.destroy(); }
}

const node = (id: string, operator: string, value?: number): BoundOperatorNode => ({ id, operator, operatorVersion: 1, bindings: {},
  ...(value === undefined ? {} : { constants: { value } }) });
const edge = (from: string, output: string, to: string, input: string): OperatorEdge => ({ id: `${from}-${to}-${input}`, from, output, to, input });
function primitiveGraph(model = 0): EffectOperatorGraph {
  const nodes = [node('frame', 'image.frame'), node('output', 'image.output'), node('x', 'values.number', .25), node('y', 'values.number', -.5),
    node('vector', 'vector.combine.vec2'), node('angle', 'values.number', .7), node('theta', 'values.number', .7), node('maximum', 'values.number', 1.2),
    node('radius', 'values.number', .65), node('model', 'values.number', model), node('rotate', 'coordinates.rotate.vec2'),
    node('project', 'optics.project-radius.scalar'), node('unproject', 'optics.unproject-radius.scalar')];
  return { version: 1, schemaVersion: 1, domain: 'image', nodes, layout: {}, edges: [edge('frame', 'image', 'output', 'image'),
    edge('x', 'value', 'vector', 'x'), edge('y', 'value', 'vector', 'y'), edge('vector', 'value', 'rotate', 'value'), edge('angle', 'value', 'rotate', 'angle'),
    edge('theta', 'value', 'project', 'theta'), edge('maximum', 'value', 'project', 'maxTheta'), edge('model', 'value', 'project', 'model'),
    edge('radius', 'value', 'unproject', 'radius'), edge('maximum', 'value', 'unproject', 'maxTheta'), edge('model', 'value', 'unproject', 'model')] };
}

const primitiveReference = `
fn referenceProject(theta: f32, maximum: f32, model: f32) -> f32 {
  if (model < .5) { return theta / max(maximum, .0001); }
  if (model < 1.5) { return sin(theta * .5) / max(sin(maximum * .5), .0001); }
  if (model < 2.5) { return tan(theta * .5) / max(tan(maximum * .5), .0001); }
  return sin(theta) / max(sin(maximum), .0001);
}
fn referenceUnproject(radius: f32, maximum: f32, model: f32) -> f32 {
  if (model < .5) { return radius * maximum; }
  if (model < 1.5) { return 2.0 * asin(clamp(radius * sin(maximum * .5), -1.0, 1.0)); }
  if (model < 2.5) { return 2.0 * atan(radius * tan(maximum * .5)); }
  return asin(clamp(radius * sin(maximum), -1.0, 1.0));
}
@group(0) @binding(0) var primitiveSampler: sampler;
@group(0) @binding(1) var primitiveTexture: texture_2d<f32>;
@fragment fn rotateReference(input: VertexOutput) -> @location(0) vec4f {
  let s = sin(.7); let c = cos(.7); return vec4f(.25*c-(-.5)*s, .25*s+(-.5)*c, 0.0, 1.0) + textureSample(primitiveTexture, primitiveSampler, input.uv) * 0.0;
}
@fragment fn projectReference(input: VertexOutput) -> @location(0) vec4f { let v = referenceProject(.7, 1.2, MODEL); return vec4f(v, v, v, 1.0) + textureSample(primitiveTexture, primitiveSampler, input.uv) * 0.0; }
@fragment fn unprojectReference(input: VertexOutput) -> @location(0) vec4f { let v = referenceUnproject(.65, 1.2, MODEL); return vec4f(v, v, v, 1.0) + textureSample(primitiveTexture, primitiveSampler, input.uv) * 0.0; }
`;

function unaryGraph(operator: string, source: 'uv' | 'bound' | 'literal'): EffectOperatorGraph {
  const value = source === 'uv' ? node('value', 'vector.split.vec2') : node('value', 'values.number', 37.5);
  if (source === 'bound') { value.bindings = { value: 'degrees' }; delete value.constants; }
  return { version: 1, schemaVersion: 1, domain: 'image', layout: {},
    nodes: [node('frame', 'image.frame'), node('output', 'image.output'), node('uv', 'image.normalized-uv'),
      value, node('operation', operator)],
    edges: [edge('frame', 'image', 'output', 'image'),
      ...(source === 'uv' ? [edge('uv', 'uv', 'value', 'value')] : []),
      edge('value', source === 'uv' ? 'x' : 'value', 'operation', 'value')] };
}

const unaryCases = [
  { operator: 'math.tan.scalar', source: 'uv', expression: 'tan(input.uv.x)' },
  { operator: 'math.atan.scalar', source: 'uv', expression: 'atan(input.uv.x)' },
  { operator: 'math.abs.scalar', source: 'uv', expression: 'abs(input.uv.x)' },
  { operator: 'convert.degrees-to-radians.scalar', source: 'uv', expression: '(input.uv.x * 3.141592653589793) / 180.0' },
  { operator: 'convert.degrees-to-radians.scalar', source: 'bound', expression: `${Math.fround(37.5 * Math.PI / 180)}` },
  { operator: 'convert.degrees-to-radians.scalar', source: 'literal', expression: `${Math.fround(37.5 * Math.PI / 180)}` },
] as const;

export async function checkImageOpticsGpu(device: GPUDevice): Promise<number> {
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const input = fixture(), source = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: input.byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  device.queue.writeTexture({ texture: source }, input, { bytesPerRow: rowPitch }, [width, height]); let comparisons = 0;
  try {
    const original: FullscreenEffectDefinition = { ...fisheye, shader: originalFisheyeShader };
    for (const item of cases) {
      const packed = fisheye.packUniforms(item.params, width, height, 0), sourceView = source.createView();
      const expected = await render(device, sampler, sourceView, target, readback, originalFisheyeShader, original.entryPoint, packed);
      const actual = await render(device, sampler, sourceView, target, readback, fisheye.shader, fisheye.entryPoint, packed);
      if (expected.some((value, index) => value !== actual[index])) throw new Error(`${item.name}: ${mismatch(expected, actual)}`); comparisons++;
    }
    for (const kind of ['rotate', 'project', 'unproject'] as const) for (const model of (kind === 'rotate' ? [0] : [0, 1, 2, 3])) {
      const graph = primitiveGraph(model), nodeId = kind === 'rotate' ? 'rotate' : kind;
      const plan = compileImageOperatorPreview(graph, {}, { nodeId, direction: 'output', portId: 'value' });
      const actual = await render(device, sampler, source.createView(), target, readback, imageGraphProgramShader(plan, 'primitiveFragment'), 'primitiveFragment');
      const reference = primitiveReference.replaceAll('MODEL', `${model}.0`), entry = `${kind}Reference`;
      const expected = await render(device, sampler, source.createView(), target, readback, reference, entry);
      if (expected.some((value, index) => value !== actual[index])) throw new Error(`${kind} model ${model}: ${mismatch(expected, actual)}`); comparisons++;
    }
    for (const item of unaryCases) {
      const plan = compileImageOperatorPreview(unaryGraph(item.operator, item.source), { degrees: 37.5 },
        { nodeId: 'operation', direction: 'output', portId: 'value' });
      const reference = `@group(0) @binding(0) var s: sampler; @group(0) @binding(1) var t: texture_2d<f32>;
        @fragment fn reference(input: VertexOutput) -> @location(0) vec4f {
          let v = ${item.expression}; return vec4f(v, v, v, 1.0) + textureSample(t, s, input.uv) * 0.0;
        }`;
      const expected = await render(device, sampler, source.createView(), target, readback, reference, 'reference');
      const actual = await render(device, sampler, source.createView(), target, readback,
        imageGraphProgramShader(plan, 'unaryFragment'), 'unaryFragment',
        packImageOperatorRuntimeUniforms(plan, 0, width, height));
      if (expected.some((value, index) => value !== actual[index])) throw new Error(`${item.operator}/${item.source}: ${mismatch(expected, actual)}`);
      comparisons++;
    }
    return comparisons;
  } finally { source.destroy(); target.destroy(); readback.destroy(); }
}
