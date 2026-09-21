import { analogSignalLab } from '../../src/effects/analog/signal-lab';
import { analogImageResolveShader } from '../../src/effects/analog/signal-lab/analogImageResolveShader';
import { ANALOG_SIGNAL_LAB_PARAMS } from '../../src/effects/analog/signal-lab/parameters';
import { ANALOG_DISPLAY_PARAMETER_IDS } from '../../src/services/operators/analogDisplayResolveGraph';
import { compileAnalogSignalGraph, createDefaultAnalogSignalGraph } from '../../src/services/operators/analogSignalGraph';
import { packImageOperatorRuntimeUniforms } from '../../src/services/operators/imageOperatorRuntimeUniforms';
import { compileImageOperatorPreview } from '../../src/services/operators/imageOperatorGraph';

const width = 23, height = 17, rowPitch = 256, decodedWidth = 360, decodedHeight = 288, decodedRowPitch = 5888;
const displayBounds = (boundary: 'min' | 'max') => Object.fromEntries(ANALOG_DISPLAY_PARAMETER_IDS.map(id => {
  const spec = ANALOG_SIGNAL_LAB_PARAMS[id];
  if (spec.type !== 'number') throw new Error(`Analog display parameter ${id} is not numeric.`);
  return [id, spec[boundary]];
}));
const cases = [
  { name: 'defaults', params: {}, time: 0 },
  { name: 'bypass', params: { palAmount: 0, rfAmount: 0, receiverAmount: 0, vhsAmount: 0, crtAmount: 0 }, time: 0 },
  { name: 'minimums', params: displayBounds('min'), time: 1.25 },
  { name: 'maximums-time', params: { ...displayBounds('max'), palAmount: 1, rfAmount: 1, receiverAmount: 1, vhsAmount: 1 }, time: 7.375 },
] as const;

function sourcePixels() {
  const data = new Uint8Array(rowPitch * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([
    (x * 37 + y * 11) & 255, (x * 13 + y * 67 + 19) & 255, (x * 83 + y * 7 + 41) & 255, (x * 29 + y * 43 + 53) & 255,
  ], y * rowPitch + x * 4);
  return data;
}

function decodedPixels() {
  const data = new Float32Array(decodedRowPitch * decodedHeight / 4);
  for (let y = 0; y < decodedHeight; y++) for (let x = 0; x < decodedWidth; x++) {
    const offset = y * decodedRowPitch / 4 + x * 4;
    data.set([((x * 17 + y * 3) & 255) / 255, ((x * 5 + y * 23 + 31) & 255) / 255,
      ((x * 41 + y * 13 + 71) & 255) / 255, ((x * 7 + y * 19 + 97) & 255) / 255], offset);
  }
  return data;
}

async function render(device: GPUDevice, source: GPUTextureView, decoded: GPUTextureView, target: GPUTexture, readback: GPUBuffer,
  shader: string, entryPoint: string, uniformData: Float32Array | null) {
  device.pushErrorScope('validation'); let popped = false;
  const pop = async () => { popped = true; return device.popErrorScope(); };
  const uniform = uniformData ? device.createBuffer({ size: uniformData.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }) : undefined;
  try {
    if (uniform && uniformData) device.queue.writeBuffer(uniform, 0, uniformData.buffer, uniformData.byteOffset, uniformData.byteLength);
    const module = device.createShaderModule({ code: shader }), info = await module.getCompilationInfo();
    const errors = info.messages.filter(message => message.type === 'error'); if (errors.length) throw new Error(errors.map(item => item.message).join('\n'));
    const layout = device.createBindGroupLayout({ entries: [
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: {} },
      ...(uniform ? [{ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' as const } }] : []),
      { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba8unorm' } },
    ] });
    const pipeline = device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), compute: { module, entryPoint } });
    const bind = device.createBindGroup({ layout, entries: [{ binding: 1, resource: source },
      ...(uniform ? [{ binding: 2, resource: { buffer: uniform } }] : []), { binding: 3, resource: decoded }, { binding: 5, resource: target.createView() }] });
    const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8)); pass.end();
    encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: rowPitch }, [width, height]);
    device.queue.submit([encoder.finish()]); await readback.mapAsync(GPUMapMode.READ);
    const result = new Uint8Array(readback.getMappedRange()).slice(); readback.unmap();
    const validation = await pop(); if (validation) throw new Error(validation.message); return result;
  } catch (error) { const validation = popped ? null : await pop(); if (validation) throw new Error(validation.message, { cause: error }); throw error; }
  finally { uniform?.destroy(); }
}

function mismatch(expected: Uint8Array, actual: Uint8Array) {
  let first = -1, count = 0, maxDelta = 0;
  expected.forEach((value, index) => { const delta = Math.abs(value - actual[index]); if (!delta) return;
    if (first < 0) first = index; count++; maxDelta = Math.max(maxDelta, delta); });
  return `byte ${first}: expected ${expected[first]}, actual ${actual[first]}; ${count}/${expected.length} differ, max delta ${maxDelta}`;
}

export async function checkAnalogDisplayResolveGpu(device: GPUDevice): Promise<number> {
  const sourceData = sourcePixels(), decodedData = decodedPixels();
  const source = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const decoded = device.createTexture({ size: [decodedWidth, decodedHeight], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: rowPitch * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  device.queue.writeTexture({ texture: source }, sourceData, { bytesPerRow: rowPitch }, [width, height]);
  device.queue.writeTexture({ texture: decoded }, decodedData, { bytesPerRow: decodedRowPitch }, [decodedWidth, decodedHeight]);
  let comparisons = 0, defaultOutput: Uint8Array | undefined;
  try {
    for (const item of cases) {
      const params = { ...Object.fromEntries(Object.entries(ANALOG_SIGNAL_LAB_PARAMS).map(([id, spec]) => [id, spec.default])), ...item.params };
      const plan = compileAnalogSignalGraph(createDefaultAnalogSignalGraph(), params);
      const program = plan.stages.find(stage => stage.kind === 'resolve')?.imageProgram;
      if (!program) throw new Error(`${item.name}: canonical display resolve program is missing.`);
      if (program.passes?.length) throw new Error(`${item.name}: display resolve unexpectedly requires extra passes.`);
      const generated = analogImageResolveShader(program);
      const expected = await render(device, source.createView(), decoded.createView(), target, readback, analogSignalLab.shader,
        analogSignalLab.entryPoint, analogSignalLab.packUniforms(params, width, height, item.time) as Float32Array);
      const packed = packImageOperatorRuntimeUniforms(program, item.time, width, height);
      if (!packed) throw new Error(`${item.name}: canonical display resolve runtime uniforms are missing.`);
      const actual = await render(device, source.createView(), decoded.createView(), target, readback, generated.shader, 'analogImageResolveCompute', packed);
      if (expected.some((value, index) => value !== actual[index])) throw new Error(`${item.name}: ${mismatch(expected, actual)}`);
      if (item.name === 'bypass' && sourceData.some((value, index) => value !== actual[index])) throw new Error(`bypass: ${mismatch(sourceData, actual)}`);
      if (item.name === 'defaults') defaultOutput = actual;
      comparisons++;
    }
    const sourceOnly = createDefaultAnalogSignalGraph(), output = sourceOnly.nodes.find(node => node.operator === 'image.output')!;
    sourceOnly.nodes.push({ id: 'fixture-uv', operator: 'image.normalized-uv', operatorVersion: 1, bindings: {} },
      { id: 'fixture-sample', operator: 'image.sample', operatorVersion: 1, bindings: {} });
    sourceOnly.layout['fixture-uv'] = { x: 1800, y: 360 }; sourceOnly.layout['fixture-sample'] = { x: 1950, y: 360 };
    sourceOnly.edges = sourceOnly.edges.filter(edge => edge.to !== output.id);
    sourceOnly.edges.push({ id: 'fixture-frame-sample', from: 'frame', output: 'image', to: 'fixture-sample', input: 'image' },
      { id: 'fixture-uv-sample', from: 'fixture-uv', output: 'uv', to: 'fixture-sample', input: 'uv' },
      { id: 'fixture-sample-output', from: 'fixture-sample', output: 'image', to: output.id, input: 'image' });
    const rewiredPlan = compileAnalogSignalGraph(sourceOnly, {}), rewiredProgram = rewiredPlan.stages.find(stage => stage.kind === 'resolve')?.imageProgram;
    if (!rewiredProgram || rewiredProgram.resourceInputs?.join(',') !== 'source') throw new Error('Source-only analog rewire did not compile one source resource.');
    const rewiredShader = analogImageResolveShader(rewiredProgram), rewiredUniforms = packImageOperatorRuntimeUniforms(rewiredProgram, 0, width, height);
    const rewired = await render(device, source.createView(), decoded.createView(), target, readback, rewiredShader.shader,
      'analogImageResolveCompute', rewiredUniforms);
    if (!defaultOutput || rewired.every((value, index) => value === defaultOutput![index])) throw new Error('Source-only analog graph rewire did not change output.');
    comparisons++;
    const preview = compileAnalogSignalGraph(createDefaultAnalogSignalGraph()).stages.find(stage => stage.imagePreview)?.imagePreview;
    if (!preview) throw new Error('Missing canonical Analog preview compilation.');
    for (const test of [{ nodeId: 'display-crt-clamp', portId: 'value', scalar: true },
      { nodeId: 'display-original-split', portId: 'rgb', scalar: false }]) {
      const program = compileImageOperatorPreview(preview.graph, preview.params,
        { nodeId: test.nodeId, portId: test.portId, direction: 'output' }, preview.context);
      const generated = analogImageResolveShader(program);
      const actual = await render(device, source.createView(), decoded.createView(), target, readback,
        generated.shader, 'analogImageResolveCompute', packImageOperatorRuntimeUniforms(program, 0, width, height));
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let channel = 0; channel < 4; channel++) {
        const index = y * rowPitch + x * 4 + channel;
        const expected = channel === 3 ? 255 : test.scalar ? 64 : sourceData[index];
        if (actual[index] !== expected) throw new Error(`Inner preview ${test.nodeId} byte ${index}: expected ${expected}, actual ${actual[index]}`);
      }
      comparisons++;
    }
    return comparisons;
  } finally { source.destroy(); decoded.destroy(); target.destroy(); readback.destroy(); }
}
