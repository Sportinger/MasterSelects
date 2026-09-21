import common from '../../src/effects/_shared/commonShader';
import { imageGraphProgramShader } from '../../src/effects/_shared/imageGraphDefinition';
import { FISHEYE_PARAMS, fisheye, normalizeFisheyeParameters } from '../../src/effects/distort/fisheye';
import { createDefaultFisheyeGraph } from '../../src/services/operators/fisheyeEffectGraph';
import { compileImageOperatorGraph, compileImageOperatorPreview } from '../../src/services/operators/imageOperatorGraph';
import { packImageOperatorRuntimeUniforms } from '../../src/services/operators/imageOperatorRuntimeUniforms';
import type { ImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import originalFisheyeShader from './fixtures/fisheye-original.wgsl?raw';
import { compareFisheyeGpuBytes } from '../helpers/fisheyeRoundingTolerance';

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

async function dimensionDivisionDiagnostic(device: GPUDevice): Promise<string> {
  const module = device.createShaderModule({ code: `${common}
struct DiagnosticDimensions { value: vec4f, };
@group(0) @binding(0) var<uniform> diagnosticDimensions: DiagnosticDimensions;
@fragment fn dimensionDivisionFragment() -> @location(0) vec4f {
  let size = diagnosticDimensions.value.xy;
  return vec4f(size.x / size.y, 1.0 / size.x, 1.0 / size.y, 0.0);
}` });
  const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
    fragment: { module, entryPoint: 'dimensionDivisionFragment', targets: [{ format: 'rgba32float' }] } });
  const uniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const target = device.createTexture({ size: [1, 1], format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  try {
    device.queue.writeBuffer(uniform, 0, new Float32Array([width, height, 0, 0]));
    const encoder = device.createCommandEncoder(), pass = encoder.beginRenderPass({
      colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }],
    });
    pass.setPipeline(pipeline); pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: uniform } }] })); pass.draw(6); pass.end();
    encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: 256 }, [1, 1]);
    device.queue.submit([encoder.finish()]); await readback.mapAsync(GPUMapMode.READ);
    const bytes = readback.getMappedRange().slice(0, 16), gpu = [...new Float32Array(bytes)], gpuBits = [...new Uint32Array(bytes)]; readback.unmap();
    const cpu = [Math.fround(width / height), Math.fround(1 / width), Math.fround(1 / height), 0];
    const cpuBits = [...new Uint32Array(new Float32Array(cpu).buffer)];
    return `dimension division GPU=${gpu.join(',')} bits=${gpuBits.map(bit => `0x${bit.toString(16)}`).join(',')}; CPU-f32=${cpu.join(',')} bits=${cpuBits.map(bit => `0x${bit.toString(16)}`).join(',')}`;
  } finally { uniform.destroy(); target.destroy(); readback.destroy(); }
}

async function floatPixelDiagnostic(device: GPUDevice, sampler: GPUSampler, source: GPUTextureView, shader: string, entryPoint: string,
  packed?: Float32Array | null): Promise<number[]> {
  const floatRowPitch = 1024, module = device.createShaderModule({ code: `${common}\n${shader}` });
  const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
    fragment: { module, entryPoint, targets: [{ format: 'rgba32float' }] } });
  const target = device.createTexture({ size: [width, height], format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: floatRowPitch * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  let uniform: GPUBuffer | undefined;
  try {
    const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: sampler }, { binding: 1, resource: source }];
    if (packed) { uniform = device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(uniform, 0, packed); entries.push({ binding: 2, resource: { buffer: uniform } }); }
    const encoder = device.createCommandEncoder(), pass = encoder.beginRenderPass({
      colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }],
    });
    pass.setPipeline(pipeline); pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries })); pass.draw(6); pass.end();
    encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: floatRowPitch }, [width, height]);
    device.queue.submit([encoder.finish()]); await readback.mapAsync(GPUMapMode.READ);
    const offset = 9 * floatRowPitch + 9 * 16;
    const result = [...new Float32Array(readback.getMappedRange().slice(offset, offset + 16))]; readback.unmap(); return result;
  } finally { uniform?.destroy(); target.destroy(); readback.destroy(); }
}

async function dualFloatPixelDiagnostic(device: GPUDevice, sampler: GPUSampler, source: GPUTextureView, shader: string, entryPoint: string,
  packed: Float32Array): Promise<number[][]> {
  const pitch = 1024, module = device.createShaderModule({ code: `${common}\n${shader}` });
  const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
    fragment: { module, entryPoint, targets: [{ format: 'rgba32float' }, { format: 'rgba32float' }] } });
  const targets = [0, 1].map(() => device.createTexture({ size: [width, height], format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC }));
  const buffers = [0, 1].map(() => device.createBuffer({ size: pitch * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }));
  const uniform = device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  try {
    device.queue.writeBuffer(uniform, 0, packed);
    const encoder = device.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: targets.map(target =>
      ({ view: target.createView(), loadOp: 'clear' as const, storeOp: 'store' as const })) });
    pass.setPipeline(pipeline); pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: sampler }, { binding: 1, resource: source }, { binding: 2, resource: { buffer: uniform } },
    ] })); pass.draw(6); pass.end();
    targets.forEach((target, index) => encoder.copyTextureToBuffer({ texture: target }, { buffer: buffers[index], bytesPerRow: pitch }, [width, height]));
    device.queue.submit([encoder.finish()]); await Promise.all(buffers.map(buffer => buffer.mapAsync(GPUMapMode.READ)));
    return buffers.map(buffer => { const offset = 9 * pitch + 9 * 16;
      const value = [...new Float32Array(buffer.getMappedRange().slice(offset, offset + 16))]; buffer.unmap(); return value; });
  } finally { uniform.destroy(); targets.forEach(target => target.destroy()); buffers.forEach(buffer => buffer.destroy()); }
}

function legacyUvMrtShader(auxiliary: 'point' | 'delta'): string {
  const auxiliaryValue = auxiliary === 'point' ? 'diagnosticGreenPoint' : 'diagnosticGreenDelta';
  return originalFisheyeShader
    .replace('fn lensSpaceToUv(lensPosition: vec2f) -> vec2f {', `fn lensSpaceToUv(lensPosition: vec2f) -> vec2f {
  if (diagnosticSampleIndex == 4u) { diagnosticGreenPoint = lensPosition; }`)
    .replace('return vec2f(params.centerX, params.centerY) + delta;', `if (diagnosticSampleIndex == 4u) { diagnosticGreenDelta = delta; }
  return vec2f(params.centerX, params.centerY) + delta;`)
    .replace('fn renderFisheyeSample(outputUv: vec2f) -> vec4f {', `var<private> diagnosticSampleIndex: u32;
var<private> diagnosticGreenUv: vec2f;
var<private> diagnosticGreenPoint: vec2f;
var<private> diagnosticGreenDelta: vec2f;
fn renderFisheyeSample(outputUv: vec2f) -> vec4f {`)
    .replace('lensColor = sampleWithEdges(lensSpaceToUv(direction * sampleRadius));', `let capturedGreenUv = lensSpaceToUv(direction * sampleRadius);
    if (diagnosticSampleIndex == 4u) { diagnosticGreenUv = capturedGreenUv; }
    lensColor = sampleWithEdges(capturedGreenUv);`)
    .replace('@fragment\nfn fisheyeFragment(input: VertexOutput) -> @location(0) vec4f {',
      'struct DiagnosticMrt { @location(0) color: vec4f, @location(1) coordinates: vec4f }\n@fragment\nfn fisheyeFragment(input: VertexOutput) -> DiagnosticMrt {')
    .replace('accumulated += renderFisheyeSample(input.uv + jitter);', 'diagnosticSampleIndex = sampleIndex;\n      accumulated += renderFisheyeSample(input.uv + jitter);')
    .replace('return accumulated / f32(sampleTotal);', `return DiagnosticMrt(accumulated / f32(sampleTotal), vec4f(diagnosticGreenUv, ${auxiliaryValue}));`);
}

function graphUvMrtShader(plan: ImageOperatorPlan, auxiliary: 'point' | 'delta'): string {
  const auxiliaryValue = auxiliary === 'point' ? 'diagnosticGreenPoint' : 'diagnosticGreenDelta';
  const greenRegisters = plan.instructions.flatMap((item, index) => item.nodeId === 'green-uv' ? [index] : []);
  const pointRegisters = plan.instructions.flatMap((item, index) => item.nodeId === 'green-point' ? [index] : []);
  const deltaRegisters = plan.instructions.flatMap((item, index) => item.nodeId === 'green-aspect-select' ? [index] : []);
  if (!greenRegisters.length || !pointRegisters.length || !deltaRegisters.length) throw new Error('Fisheye graph lacks green coordinate instructions.');
  let shader = imageGraphProgramShader(plan, 'fisheyeGraphFragment');
  const capture = (registers: number[], target: string) => registers.forEach(register => { shader = shader
    .replace(new RegExp(`(let v${register}: vec2f = [^;]+;)`), `$1\n  if (sequenceIndex == 4.0) { ${target} = v${register}; }`); });
  capture(greenRegisters, 'diagnosticGreenUv'); capture(pointRegisters, 'diagnosticGreenPoint'); capture(deltaRegisters, 'diagnosticGreenDelta');
  if ((shader.match(/diagnosticGreen(Uv|Point|Delta) = v/g) ?? []).length !== greenRegisters.length + pointRegisters.length + deltaRegisters.length) {
    throw new Error('Fisheye graph green-uv instrumentation missed a scoped instruction.');
  }
  shader = shader
    .replace('@fragment fn fisheyeGraphFragment(input: VertexOutput) -> @location(0) vec4f {',
      'struct DiagnosticMrt { @location(0) color: vec4f, @location(1) coordinates: vec4f }\n@fragment fn fisheyeGraphFragment(input: VertexOutput) -> DiagnosticMrt {')
    .replace(' return evaluateImageGraph(', ' let diagnosticColor = evaluateImageGraph(')
    .replace(/\);\n}$/, `);\n return DiagnosticMrt(diagnosticColor, vec4f(diagnosticGreenUv, ${auxiliaryValue}));\n}`);
  return `var<private> diagnosticGreenUv: vec2f;\nvar<private> diagnosticGreenPoint: vec2f;\nvar<private> diagnosticGreenDelta: vec2f;\n${shader}`;
}

function compileSingleAaSample(params: ReturnType<typeof normalizeFisheyeParameters>, sampleIndex: number,
  stage?: { nodeId: string; portId: string; type: 'scalar' | 'vec2' | 'image' }, rawGreen = false): ImageOperatorPlan {
  const graph = createDefaultFisheyeGraph(), add = (id: string, operator: string, value?: number | boolean) => {
    graph.nodes.push({ id, operator, operatorVersion: 1, bindings: {}, ...(value === undefined ? {} : { constants: { value } }) });
    graph.layout[id] = { x: 0, y: 0 };
  };
  add('diagnostic-lower', 'values.number', sampleIndex - .5); add('diagnostic-upper', 'values.number', sampleIndex + .5);
  add('diagnostic-above-lower', 'compare.greater.scalar'); add('diagnostic-below-upper', 'compare.greater.scalar');
  add('diagnostic-selected', 'logic.and.boolean'); add('diagnostic-zero', 'values.number', 0); add('diagnostic-one', 'values.number', 1);
  add('diagnostic-weight', 'select.scalar');
  graph.edges = graph.edges.filter(edge => !(edge.to === 'aa-reduce' && (edge.input === 'weight' || (stage && edge.input === 'sample'))));
  graph.edges.push(
    { id: 'diagnostic-index-lower', from: 'aa-sequence', output: 'index', to: 'diagnostic-above-lower', input: 'a' },
    { id: 'diagnostic-lower-bound', from: 'diagnostic-lower', output: 'value', to: 'diagnostic-above-lower', input: 'b' },
    { id: 'diagnostic-upper-bound', from: 'diagnostic-upper', output: 'value', to: 'diagnostic-below-upper', input: 'a' },
    { id: 'diagnostic-index-upper', from: 'aa-sequence', output: 'index', to: 'diagnostic-below-upper', input: 'b' },
    { id: 'diagnostic-lower-and', from: 'diagnostic-above-lower', output: 'condition', to: 'diagnostic-selected', input: 'a' },
    { id: 'diagnostic-upper-and', from: 'diagnostic-below-upper', output: 'condition', to: 'diagnostic-selected', input: 'b' },
    { id: 'diagnostic-zero-weight', from: 'diagnostic-zero', output: 'value', to: 'diagnostic-weight', input: 'falseValue' },
    { id: 'diagnostic-one-weight', from: 'diagnostic-one', output: 'value', to: 'diagnostic-weight', input: 'trueValue' },
    { id: 'diagnostic-condition-weight', from: 'diagnostic-selected', output: 'value', to: 'diagnostic-weight', input: 'condition' },
    { id: 'diagnostic-weight-reduce', from: 'diagnostic-weight', output: 'value', to: 'aa-reduce', input: 'weight' },
  );
  if (stage) {
    let from = stage.nodeId, output = stage.portId;
    if (stage.type === 'scalar') {
      add('diagnostic-stage-vec4', 'convert.scalar-to-vec4'); add('diagnostic-stage-image', 'convert.vec4-to-image');
      graph.edges.push({ id: 'diagnostic-stage-scalar', from, output, to: 'diagnostic-stage-vec4', input: 'value' },
        { id: 'diagnostic-stage-scalar-image', from: 'diagnostic-stage-vec4', output: 'value', to: 'diagnostic-stage-image', input: 'value' });
      from = 'diagnostic-stage-image'; output = 'image';
    } else if (stage.type === 'vec2') {
      add('diagnostic-stage-split', 'vector.split.vec2'); add('diagnostic-stage-zero', 'values.number', 0);
      add('diagnostic-stage-one', 'values.number', 1); add('diagnostic-stage-vec4', 'vector.combine.vec4'); add('diagnostic-stage-image', 'convert.vec4-to-image');
      graph.edges.push({ id: 'diagnostic-stage-split-in', from, output, to: 'diagnostic-stage-split', input: 'value' },
        { id: 'diagnostic-stage-x', from: 'diagnostic-stage-split', output: 'x', to: 'diagnostic-stage-vec4', input: 'x' },
        { id: 'diagnostic-stage-y', from: 'diagnostic-stage-split', output: 'y', to: 'diagnostic-stage-vec4', input: 'y' },
        { id: 'diagnostic-stage-z', from: 'diagnostic-stage-zero', output: 'value', to: 'diagnostic-stage-vec4', input: 'z' },
        { id: 'diagnostic-stage-w', from: 'diagnostic-stage-one', output: 'value', to: 'diagnostic-stage-vec4', input: 'w' },
        { id: 'diagnostic-stage-vec4-image', from: 'diagnostic-stage-vec4', output: 'value', to: 'diagnostic-stage-image', input: 'value' });
      from = 'diagnostic-stage-image'; output = 'image';
    }
    graph.edges.push({ id: 'diagnostic-stage-reduce', from, output, to: 'aa-reduce', input: 'sample' });
  }
  if (rawGreen) {
    graph.edges = graph.edges.filter(edge => !(edge.to === 'green-sample' && edge.input === 'image'));
    graph.edges.push({ id: 'diagnostic-raw-green-source', from: 'edge-color', output: 'image', to: 'green-sample', input: 'image' });
  }
  return compileImageOperatorGraph(graph, params, { parameterSchema: FISHEYE_PARAMS });
}

function legacyAa4StageShader(expression: string) {
  return `${originalFisheyeShader}\n@fragment fn fisheyeStageDiagnostic(input: VertexOutput) -> @location(0) vec4f {
  let jitter = sampleJitter(4u, 8u) * vec2f(params.texelSizeX, params.texelSizeY);
  let sampleUv = input.uv + jitter;
  let lensPosition = uvToLensSpace(sampleUv);
  let lensRadius = length(lensPosition);
  let direction = lensPosition / max(lensRadius, 0.000001);
  let sampleRadius = mappedLensRadius(lensRadius);
  let greenUv = lensSpaceToUv(direction * sampleRadius);
  let greenSample = sampleWithEdges(greenUv);
  let softCoverage = 1.0 - smoothstep(max(0.0, 1.0 - params.feather), 1.0, lensRadius);
  return ${expression};
}`;
}

const withExplicitLod0 = (shader: string) => shader
  .replaceAll('textureSample(inputTex, texSampler, edgeAdjustedUv(uv))', 'textureSampleLevel(inputTex, texSampler, edgeAdjustedUv(uv), 0.0)')
  .replaceAll('textureSample(inputTex, texSampler, outputUv)', 'textureSampleLevel(inputTex, texSampler, outputUv, 0.0)');

const legacyLoopAa4StageShader = (expression: string) => originalFisheyeShader
  .replace('return mix(outsideColor, lensColor, lensCoverage(radius));', `return ${expression};`)
  .replace('if (sampleIndex < sampleTotal) {', 'if (sampleIndex == 4u) {')
  .replace('return accumulated / f32(sampleTotal);', 'return accumulated;');

const legacyAa4DirectGreenBranchShader = () => {
  const specialized = originalFisheyeShader.replace(`  var lensColor: vec4f;
  if (params.chromaticAberration <= 0.000001) {
    lensColor = sampleWithEdges(lensSpaceToUv(direction * sampleRadius));
  } else {
    let red = sampleWithEdges(lensSpaceToUv(direction * sampleRadius * (1.0 + chromaShift)));
    let green = sampleWithEdges(lensSpaceToUv(direction * sampleRadius));
    let blue = sampleWithEdges(lensSpaceToUv(direction * sampleRadius * (1.0 - chromaShift)));
    lensColor = vec4f(red.r, green.g, blue.b, (red.a + green.a + blue.a) / 3.0);
  }`, '  var lensColor = sampleWithEdges(lensSpaceToUv(direction * sampleRadius));');
  if (specialized === originalFisheyeShader) throw new Error('Fisheye direct-green diagnostic could not specialize the chroma branch.');
  return specialized.replace('return mix(outsideColor, lensColor, lensCoverage(radius));', 'return lensColor;')
    .replace('if (sampleIndex < sampleTotal) {', 'if (sampleIndex == 4u) {')
    .replace('return accumulated / f32(sampleTotal);', 'return accumulated;');
};

const legacyAa4SameGreenBranchShader = () => {
  const specialized = originalFisheyeShader.replace(`  var lensColor: vec4f;
  if (params.chromaticAberration <= 0.000001) {
    lensColor = sampleWithEdges(lensSpaceToUv(direction * sampleRadius));
  } else {
    let red = sampleWithEdges(lensSpaceToUv(direction * sampleRadius * (1.0 + chromaShift)));
    let green = sampleWithEdges(lensSpaceToUv(direction * sampleRadius));
    let blue = sampleWithEdges(lensSpaceToUv(direction * sampleRadius * (1.0 - chromaShift)));
    lensColor = vec4f(red.r, green.g, blue.b, (red.a + green.a + blue.a) / 3.0);
  }`, `  let diagnosticGreen = sampleWithEdges(lensSpaceToUv(direction * sampleRadius));
  var lensColor: vec4f;
  if (params.chromaticAberration <= 0.000001) {
    lensColor = diagnosticGreen;
  } else {
    lensColor = diagnosticGreen;
  }`);
  if (specialized === originalFisheyeShader) throw new Error('Fisheye same-green branch diagnostic could not specialize the chroma branch.');
  return specialized.replace('return mix(outsideColor, lensColor, lensCoverage(radius));', 'return lensColor;')
    .replace('if (sampleIndex < sampleTotal) {', 'if (sampleIndex == 4u) {')
    .replace('return accumulated / f32(sampleTotal);', 'return accumulated;');
};

function specializeFrameMetrics(plan: ImageOperatorPlan, shader: string, metric: 'aspect' | 'texel' | 'both') {
  const scalar = (value: number) => { const text = Math.fround(value).toString(); return text.includes('.') ? text : `${text}.0`; };
  const replacements = metric === 'both' ? ['frame-aspect', 'texel-size'] : metric === 'aspect' ? ['frame-aspect'] : ['texel-size'];
  for (const nodeId of replacements) plan.instructions.forEach((instruction, index) => {
    if (instruction.nodeId !== nodeId) return;
    const type = nodeId === 'frame-aspect' ? 'f32' : 'vec2f';
    const value = nodeId === 'frame-aspect' ? scalar(width / height) : `vec2f(${scalar(1 / width)}, ${scalar(1 / height)})`;
    shader = shader.replaceAll(new RegExp(`let v${index}: ${type} = [^;]+;`, 'g'), `let v${index}: ${type} = ${value};`);
  });
  return shader;
}

async function fisheyeMismatchDiagnostic(device: GPUDevice, sampler: GPUSampler, source: GPUTextureView,
  params: ReturnType<typeof normalizeFisheyeParameters>, plan: ImageOperatorPlan): Promise<string> {
  const legacy = await floatPixelDiagnostic(device, sampler, source, originalFisheyeShader, fisheye.entryPoint,
    fisheye.packUniforms(params, width, height, 0));
  const graph = await floatPixelDiagnostic(device, sampler, source, imageGraphProgramShader(plan, 'fisheyeFloatDiagnostic'),
    'fisheyeFloatDiagnostic', packImageOperatorRuntimeUniforms(plan, 0, width, height));
  const legacyPointMrt = await dualFloatPixelDiagnostic(device, sampler, source, legacyUvMrtShader('point'), fisheye.entryPoint,
    fisheye.packUniforms(params, width, height, 0)!);
  const graphPointMrt = await dualFloatPixelDiagnostic(device, sampler, source, graphUvMrtShader(plan, 'point'), 'fisheyeGraphFragment',
    packImageOperatorRuntimeUniforms(plan, 0, width, height)!);
  const legacyDeltaMrt = await dualFloatPixelDiagnostic(device, sampler, source, legacyUvMrtShader('delta'), fisheye.entryPoint,
    fisheye.packUniforms(params, width, height, 0)!);
  const graphDeltaMrt = await dualFloatPixelDiagnostic(device, sampler, source, graphUvMrtShader(plan, 'delta'), 'fisheyeGraphFragment',
    packImageOperatorRuntimeUniforms(plan, 0, width, height)!);
  const legacyLod0 = await floatPixelDiagnostic(device, sampler, source, withExplicitLod0(originalFisheyeShader), fisheye.entryPoint,
    fisheye.packUniforms(params, width, height, 0));
  const aaValues: string[] = [];
  let aa4Plan: ImageOperatorPlan | undefined;
  for (let index = 0; index < 8; index++) {
    const legacyShader = originalFisheyeShader
      .replace('if (sampleIndex < sampleTotal) {', `if (sampleIndex == ${index}u) {`)
      .replace('return accumulated / f32(sampleTotal);', 'return accumulated;');
    const legacySample = await floatPixelDiagnostic(device, sampler, source, legacyShader, fisheye.entryPoint,
      fisheye.packUniforms(params, width, height, 0));
    const samplePlan = compileSingleAaSample(params, index);
    if (index === 4) aa4Plan = samplePlan;
    const graphSample = await floatPixelDiagnostic(device, sampler, source, imageGraphProgramShader(samplePlan, `fisheyeAa${index}`),
      `fisheyeAa${index}`, packImageOperatorRuntimeUniforms(samplePlan, 0, width, height));
    aaValues.push(`${index}:L[${legacySample.join(',')}]G[${graphSample.join(',')}]`);
  }
  const legacyAa4Lod0Shader = withExplicitLod0(originalFisheyeShader)
    .replace('if (sampleIndex < sampleTotal) {', 'if (sampleIndex == 4u) {')
    .replace('return accumulated / f32(sampleTotal);', 'return accumulated;');
  const legacyAa4Lod0 = await floatPixelDiagnostic(device, sampler, source, legacyAa4Lod0Shader, fisheye.entryPoint,
    fisheye.packUniforms(params, width, height, 0));
  const metricValues: string[] = [];
  for (const metric of ['aspect', 'texel', 'both'] as const) {
    const fullEntry = `metricFull_${metric}`, aaEntry = `metricAa4_${metric}`;
    const fullShader = specializeFrameMetrics(plan, imageGraphProgramShader(plan, fullEntry), metric);
    const full = await floatPixelDiagnostic(device, sampler, source, fullShader, fullEntry, packImageOperatorRuntimeUniforms(plan, 0, width, height));
    const selectedPlan = aa4Plan!, aaShader = specializeFrameMetrics(selectedPlan, imageGraphProgramShader(selectedPlan, aaEntry), metric);
    const aa4 = await floatPixelDiagnostic(device, sampler, source, aaShader, aaEntry, packImageOperatorRuntimeUniforms(selectedPlan, 0, width, height));
    metricValues.push(`${metric}:full[${full.join(',')}]aa4[${aa4.join(',')}]`);
  }
  const aa4Stages = [
    { nodeId: 'sample-uv', portId: 'value', type: 'vec2' as const, legacy: 'vec4f(sampleUv, 0.0, 1.0)', loop: 'vec4f(outputUv, 0.0, 1.0)' },
    { nodeId: 'lens-position', portId: 'value', type: 'vec2' as const, legacy: 'vec4f(lensPosition, 0.0, 1.0)', loop: 'vec4f(lensPosition, 0.0, 1.0)' },
    { nodeId: 'lens-position-radius', portId: 'value', type: 'scalar' as const, legacy: 'vec4f(lensRadius)', loop: 'vec4f(radius)' },
    { nodeId: 'sample-radius', portId: 'value', type: 'scalar' as const, legacy: 'vec4f(sampleRadius)', loop: 'vec4f(sampleRadius)' },
    { nodeId: 'green-uv', portId: 'value', type: 'vec2' as const, legacy: 'vec4f(greenUv, 0.0, 1.0)', loop: 'vec4f(lensSpaceToUv(direction * sampleRadius), 0.0, 1.0)' },
    { nodeId: 'green-sample', portId: 'image', type: 'image' as const, legacy: 'greenSample', loop: 'sampleWithEdges(lensSpaceToUv(direction * sampleRadius))' },
    { nodeId: 'chroma-select', portId: 'image', type: 'image' as const, legacy: 'greenSample', loop: 'lensColor' },
    { nodeId: 'lens-soft-coverage', portId: 'value', type: 'scalar' as const, legacy: 'vec4f(softCoverage)', loop: undefined },
  ];
  const aa4StageValues: string[] = [];
  for (const stage of aa4Stages) {
    const legacyStage = await floatPixelDiagnostic(device, sampler, source, legacyAa4StageShader(stage.legacy), 'fisheyeStageDiagnostic',
      fisheye.packUniforms(params, width, height, 0));
    const stagePlan = compileSingleAaSample(params, 4, stage);
    const graphStage = await floatPixelDiagnostic(device, sampler, source, imageGraphProgramShader(stagePlan, `aa4_${stage.nodeId.replaceAll('-', '_')}`),
      `aa4_${stage.nodeId.replaceAll('-', '_')}`, packImageOperatorRuntimeUniforms(stagePlan, 0, width, height));
    const loopStage = stage.loop ? await floatPixelDiagnostic(device, sampler, source, legacyLoopAa4StageShader(stage.loop), fisheye.entryPoint,
      fisheye.packUniforms(params, width, height, 0)) : [];
    aa4StageValues.push(`${stage.nodeId}:Lstandalone[${legacyStage.join(',')}]Lloop[${loopStage.join(',')}]G[${graphStage.join(',')}]`);
  }
  const legacyRawGreen = await floatPixelDiagnostic(device, sampler, source,
    legacyAa4StageShader('textureSampleLevel(inputTex, texSampler, edgeAdjustedUv(greenUv), 0.0)'), 'fisheyeStageDiagnostic',
    fisheye.packUniforms(params, width, height, 0));
  const rawGreenPlan = compileSingleAaSample(params, 4, { nodeId: 'green-sample', portId: 'image', type: 'image' }, true);
  const rawGreenEntry = 'aa4_raw_green';
  const graphRawGreen = await floatPixelDiagnostic(device, sampler, source, imageGraphProgramShader(rawGreenPlan, rawGreenEntry), rawGreenEntry,
    packImageOperatorRuntimeUniforms(rawGreenPlan, 0, width, height));
  const legacyDirectGreen = await floatPixelDiagnostic(device, sampler, source, legacyAa4DirectGreenBranchShader(), fisheye.entryPoint,
    fisheye.packUniforms(params, width, height, 0));
  const legacySameGreenBranch = await floatPixelDiagnostic(device, sampler, source, legacyAa4SameGreenBranchShader(), fisheye.entryPoint,
    fisheye.packUniforms(params, width, height, 0));
  const sourceGraph = createDefaultFisheyeGraph(), stages: Array<[string, string]> = [
    ['green-sample', 'image'], ['lens-hard-coverage', 'value'], ['lens-feather-mask', 'value'],
    ['lens-feather-select', 'image'], ['aa-average', 'value'],
  ];
  const stageValues: string[] = [];
  for (const [nodeId, portId] of stages) try {
    const stage = compileImageOperatorPreview(sourceGraph, params, { nodeId, direction: 'output', portId }, { parameterSchema: FISHEYE_PARAMS });
    const value = await floatPixelDiagnostic(device, sampler, source, imageGraphProgramShader(stage, `diagnostic_${nodeId.replaceAll('-', '_')}`),
      `diagnostic_${nodeId.replaceAll('-', '_')}`, packImageOperatorRuntimeUniforms(stage, 0, width, height));
    stageValues.push(`${nodeId}=[${value.join(',')}]`);
  } catch (error) { stageValues.push(`${nodeId}=unavailable(${error instanceof Error ? error.message : String(error)})`); }
  return `float@9,9 legacy=[${legacy.join(',')}] legacyLOD0=[${legacyLod0.join(',')}] graph=[${graph.join(',')}]; simultaneous-MRT point:Lcolor[${legacyPointMrt[0].join(',')}]LuvPoint[${legacyPointMrt[1].join(',')}] Gcolor[${graphPointMrt[0].join(',')}]GuvPoint[${graphPointMrt[1].join(',')}]; delta:Lcolor[${legacyDeltaMrt[0].join(',')}]LuvDelta[${legacyDeltaMrt[1].join(',')}] Gcolor[${graphDeltaMrt[0].join(',')}]GuvDelta[${graphDeltaMrt[1].join(',')}]; AA ${aaValues.join('; ')}; AA4 legacyLOD0=[${legacyAa4Lod0.join(',')}]; metrics ${metricValues.join('; ')}; AA4 stages ${aa4StageValues.join('; ')}; AA4 raw-green L[${legacyRawGreen.join(',')}]G[${graphRawGreen.join(',')}]; direct-green-loop[${legacyDirectGreen.join(',')}]; same-green-branch-loop[${legacySameGreenBranch.join(',')}]; ${stageValues.join('; ')}`;
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
    const encoder = device.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(pipeline); pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries })); pass.draw(6); pass.end();
    encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: rowPitch }, [width, height]);
    device.queue.submit([encoder.finish()]); await readback.mapAsync(GPUMapMode.READ); const result = new Uint8Array(readback.getMappedRange()).slice(); readback.unmap();
    const validation = await pop(); if (validation) throw new Error(validation.message); return result;
  } catch (error) { const validation = popped ? null : await pop(); if (validation) throw new Error(validation.message, { cause: error }); throw error; }
  finally { uniform?.destroy(); }
}

function compile(params: Record<string, unknown>, rewired = false): ImageOperatorPlan {
  const graph = createDefaultFisheyeGraph();
  if (rewired) {
    const frame = graph.nodes.find(node => node.operator === 'image.frame'), uv = graph.nodes.find(node => node.operator === 'image.normalized-uv');
    const output = graph.nodes.find(node => node.operator === 'image.output'), sample = graph.nodes.find(node => node.operator === 'image.sample');
    if (!frame || !uv || !output || !sample) throw new Error('Fisheye graph is missing its canonical image endpoints.');
    graph.edges = graph.edges.filter(edge => edge.to !== output.id && !(edge.to === sample.id && (edge.input === 'image' || edge.input === 'uv')));
    graph.edges.push(
      { id: 'fixture-frame-sample', from: frame.id, output: 'image', to: sample.id, input: 'image' },
      { id: 'fixture-uv-sample', from: uv.id, output: 'uv', to: sample.id, input: 'uv' },
      { id: 'fixture-sample-output', from: sample.id, output: 'image', to: output.id, input: 'image' },
    );
  }
  const plan = compileImageOperatorGraph(graph, params, { parameterSchema: FISHEYE_PARAMS });
  if (plan.passes?.length) throw new Error(`Fisheye unexpectedly compiled to ${plan.passes.length} passes.`);
  return plan;
}

export async function checkFisheyeGraphGpu(device: GPUDevice, onAcceptedRounding: (detail: string) => void = () => {}): Promise<number> {
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const input = fixture(), source = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: input.byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  device.queue.writeTexture({ texture: source }, input, { bytesPerRow: rowPitch }, [width, height]); let comparisons = 0;
  try {
    for (const item of cases) {
      const params = normalizeFisheyeParameters(item.params), plan = compile(params), sourceView = source.createView();
      const expected = await render(device, sampler, sourceView, target, readback, originalFisheyeShader, fisheye.entryPoint,
        fisheye.packUniforms(params, width, height, 0));
      const actual = await render(device, sampler, sourceView, target, readback, imageGraphProgramShader(plan, 'fisheyeGraphFragment'), 'fisheyeGraphFragment',
        packImageOperatorRuntimeUniforms(plan, 0, width, height));
      const comparison = compareFisheyeGpuBytes(expected, actual, { caseName: item.name, width, height, rowPitch, params: { ...params } });
      if (!comparison.equal) {
        const dimensions = await dimensionDivisionDiagnostic(device);
        const stages = await fisheyeMismatchDiagnostic(device, sampler, sourceView, params, plan);
        throw new Error(`${item.name}: ${mismatch(expected, actual)}; ${dimensions}; ${stages}`);
      }
      if (comparison.acceptedKnownRounding) {
        const detail = comparison.message!; console.info(`[Fisheye GPU] ${detail}`); onAcceptedRounding(detail);
      }
      comparisons++;
      if (item.name === 'equidistant-positive-sample1') {
        const direct = compile(params, true), rewired = await render(device, sampler, sourceView, target, readback,
          imageGraphProgramShader(direct, 'fisheyeDirectFragment'), 'fisheyeDirectFragment', packImageOperatorRuntimeUniforms(direct, 0, width, height));
        if (input.some((value, index) => value !== rewired[index])) throw new Error(`direct original-UV rewire: ${mismatch(input, rewired)}`);
        if (rewired.every((value, index) => value === actual[index])) throw new Error('Fisheye original-UV rewire did not change pixels.');
        comparisons++;
      }
    }
    return comparisons;
  } finally { source.destroy(); target.destroy(); readback.destroy(); }
}
