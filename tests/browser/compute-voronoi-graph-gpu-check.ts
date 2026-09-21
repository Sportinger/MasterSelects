import { ComputeEffectRuntime } from '../../src/effects/ComputeEffectRuntime';
import { ImageGraphPassRuntime } from '../../src/effects/ImageGraphPassRuntime';
import { JumpFloodRuntime } from '../../src/effects/JumpFloodRuntime';
import { voronoi } from '../../src/effects/geometry';
import { compileComputeImageGraph } from '../../src/services/operators/computeImageGraph';
import { connectEffectGraph } from '../../src/services/operators/effectGraph';
import { createDefaultVoronoiGraph } from '../../src/services/operators/voronoiEffectGraph';

const WIDTH = 17, HEIGHT = 11, BYTES_PER_ROW = 256;
const DEFAULT_PARAMS = Object.fromEntries(Object.entries(voronoi.params).map(([id, spec]) => [id, spec.default]));

function sourcePixels() {
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    const offset = (y * WIDTH + x) * 4;
    pixels.set([(x * 37 + y * 11) % 256, (x * 13 + y * 47) % 256,
      (x * 71 + y * 19) % 256, (x * 23 + y * 31) % 256], offset);
  }
  return pixels;
}

function mismatch(actual: Uint8Array, expected: Uint8Array) {
  let count = 0, first = -1, maximum = 0;
  actual.forEach((value, index) => { const delta = Math.abs(value - expected[index]); maximum = Math.max(maximum, delta);
    if (delta) { count++; if (first < 0) first = index; } });
  return first < 0 ? 'none' : `${count}/${actual.length}; max delta ${maximum}; first byte ${first} (pixel ${Math.floor(first / 4)}, channel ${first % 4}) actual=${actual[first]} expected=${expected[first]}`;
}

/** Strict legacy specialized resolve versus canonical staged graph execution. */
export async function checkComputeVoronoiGraphGpu(device: GPUDevice): Promise<number> {
  const runtime = new ComputeEffectRuntime(device);
  const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC
    | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT;
  const source = device.createTexture({ size: [WIDTH, HEIGHT], format: 'rgba8unorm', usage });
  const output = device.createTexture({ size: [WIDTH, HEIGHT], format: 'rgba8unorm', usage });
  const sourceData = sourcePixels();
  device.queue.writeTexture({ texture: source }, sourceData, { bytesPerRow: WIDTH * 4 }, [WIDTH, HEIGHT]);
  const sampler = device.createSampler({ minFilter: 'nearest', magFilter: 'nearest' });
  let comparisons = 0;

  const mixedFloatDiagnostic = async (params: Record<string, unknown>, timelineTimeSeconds: number) => {
    const plan = compileComputeImageGraph(createDefaultVoronoiGraph(), params), program = plan.imageProgram!;
    const encoder = device.createCommandEncoder({ label: 'voronoi-mixed-float-diagnostic' });
    const jumpRuntime = new JumpFloodRuntime(device), imageRuntime = new ImageGraphPassRuntime(device);
    const fields = jumpRuntime.encodeStages({ encoder, definition: voronoi, plan, instanceId: 'float-diagnostic',
      width: WIDTH, height: HEIGHT, timelineTimeSeconds });
    const external = new Map(program.fieldResources!.map(resource => {
      const field = fields.get(resource.producerNodeId)!;
      return [resource.resourceId, field] as const;
    }));
    const textureUsage = GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT;
    const legacyOutput = device.createTexture({ size: [WIDTH, HEIGHT], format: 'rgba32float', usage: textureUsage });
    const graphOutput = device.createTexture({ size: [WIDTH, HEIGHT], format: 'rgba32float', usage: textureUsage });
    const packed = voronoi.packUniforms({ ...DEFAULT_PARAMS, ...params }, WIDTH, HEIGHT, timelineTimeSeconds)!;
    const uniform = device.createBuffer({ size: voronoi.uniformSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(uniform, 0, new Float32Array(packed));
    const module = device.createShaderModule({ code: voronoi.shader.replaceAll('texture_storage_2d<rgba8unorm, write>',
      'texture_storage_2d<rgba32float, write>') });
    const layout = device.createBindGroupLayout({ entries: [
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: {} },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba32float' } },
    ] });
    const pipeline = device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint: voronoi.entryPoint } });
    const field = external.get(program.fieldResources![0].resourceId)!;
    const pass = encoder.beginComputePass({ label: 'voronoi-legacy-float-resolve' });
    pass.setPipeline(pipeline); pass.setBindGroup(0, device.createBindGroup({ layout, entries: [
      { binding: 1, resource: source.createView() }, { binding: 2, resource: { buffer: uniform } },
      { binding: 3, resource: field.view }, { binding: 5, resource: legacyOutput.createView() },
    ] })); pass.dispatchWorkgroups(Math.ceil(WIDTH / 8), Math.ceil(HEIGHT / 8)); pass.end();
    imageRuntime.encode({ encoder, sampler, source: { kind: 'texture', view: source.createView() }, width: WIDTH, height: HEIGHT,
      timelineTimeSeconds, plan: program, outputView: graphOutput.createView(), outputFormat: 'rgba32float',
      instanceId: 'voronoi-float-resolve', externalResources: external });
    const rowBytes = Math.ceil(WIDTH * 16 / 256) * 256, size = rowBytes * HEIGHT;
    const legacyRead = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const graphRead = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    encoder.copyTextureToBuffer({ texture: legacyOutput }, { buffer: legacyRead, bytesPerRow: rowBytes }, [WIDTH, HEIGHT]);
    encoder.copyTextureToBuffer({ texture: graphOutput }, { buffer: graphRead, bytesPerRow: rowBytes }, [WIDTH, HEIGHT]);
    device.queue.submit([encoder.finish()]); await Promise.all([legacyRead.mapAsync(GPUMapMode.READ), graphRead.mapAsync(GPUMapMode.READ)]);
    const component = (buffer: GPUBuffer) => new Float32Array(buffer.getMappedRange())[3 * 4 + 1];
    const result = { legacy: component(legacyRead), graph: component(graphRead) };
    legacyRead.unmap(); graphRead.unmap(); legacyRead.destroy(); graphRead.destroy(); uniform.destroy();
    legacyOutput.destroy(); graphOutput.destroy(); jumpRuntime.dispose(); imageRuntime.dispose(); return result;
  };

  const render = async (label: string, params: Record<string, unknown>, timelineTimeSeconds: number,
    plan = undefined as ReturnType<typeof compileComputeImageGraph> | undefined, instanceId = label,
    definition = voronoi) => {
    const packed = definition.packUniforms({ ...DEFAULT_PARAMS, ...params }, WIDTH, HEIGHT, timelineTimeSeconds)!;
    const uniform = device.createBuffer({ size: definition.uniformSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(uniform, 0, packed);
    const encoder = device.createCommandEncoder({ label });
    const encoded = runtime.encode({ commandEncoder: encoder, definition, inputView: source.createView(), outputView: output.createView(),
      uniformBuffer: uniform, width: WIDTH, height: HEIGHT, timelineTimeSeconds, sampler, instanceId, ...(plan ? { computeImagePlan: plan } : {}) });
    if (!encoded) { uniform.destroy(); return { encoded, pixels: sourceData.slice() }; }
    const readback = device.createBuffer({ size: BYTES_PER_ROW * HEIGHT, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    encoder.copyTextureToBuffer({ texture: output }, { buffer: readback, bytesPerRow: BYTES_PER_ROW }, [WIDTH, HEIGHT]);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const padded = new Uint8Array(readback.getMappedRange());
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    for (let y = 0; y < HEIGHT; y++) pixels.set(padded.subarray(y * BYTES_PER_ROW, y * BYTES_PER_ROW + WIDTH * 4), y * WIDTH * 4);
    readback.unmap(); readback.destroy(); uniform.destroy();
    return { encoded, pixels };
  };

  const compare = async (label: string, params: Record<string, unknown>, time: number,
    graph = createDefaultVoronoiGraph()) => {
    const legacy = await render(`${label}-legacy`, params, time);
    const canonical = await render(`${label}-graph`, params, time, compileComputeImageGraph(graph, params));
    if (legacy.pixels.some((value, index) => value !== canonical.pixels[index])) {
      const amountZeroLegacy = await render(`${label}-diagnostic-zero-legacy`, { ...params, amount: 0 }, time);
      const amountZeroGraph = await render(`${label}-diagnostic-zero-graph`, { ...params, amount: 0 }, time,
        compileComputeImageGraph(graph, { ...params, amount: 0 }));
      const amountOneLegacy = await render(`${label}-diagnostic-one-legacy`, { ...params, amount: 1 }, time);
      const amountOneGraph = await render(`${label}-diagnostic-one-graph`, { ...params, amount: 1 }, time,
        compileComputeImageGraph(graph, { ...params, amount: 1 }));
      const nearestGraph = createDefaultVoronoiGraph();
      nearestGraph.nodes.find(node => node.id === 'point-eight-two')!.constants = { value: 1 };
      nearestGraph.nodes.find(node => node.id === 'point-one-eight')!.constants = { value: 0 };
      const styledExpression = 'sampled.rgb * (0.82 + 0.18 * border)';
      const nearestShader = voronoi.shader.replaceAll(styledExpression, 'sampled.rgb');
      const activeResolveIndex = nearestShader.indexOf('fn voronoiResolveCompute');
      if (activeResolveIndex < 0 || nearestShader.slice(activeResolveIndex).includes(styledExpression)) {
        throw new Error('Nearest-sample diagnostic did not patch the active Voronoi resolve.');
      }
      const nearestLegacy = { ...voronoi, id: `${voronoi.id}:diagnostic-nearest`,
        shader: nearestShader };
      const nearestLegacyResult = await render(`${label}-diagnostic-nearest-legacy`, { ...params, amount: 1 }, time,
        undefined, `${label}:nearest-legacy`, nearestLegacy);
      const nearestGraphResult = await render(`${label}-diagnostic-nearest-graph`, { ...params, amount: 1 }, time,
        compileComputeImageGraph(nearestGraph, { ...params, amount: 1 }), `${label}:nearest-graph`);
      const mixedFloat = await mixedFloatDiagnostic(params, time);
      throw new Error(`${label}: canonical Voronoi differs from legacy: ${mismatch(canonical.pixels, legacy.pixels)}; `
        + `amount=0 ${mismatch(amountZeroGraph.pixels, amountZeroLegacy.pixels)}; `
        + `amount=1 ${mismatch(amountOneGraph.pixels, amountOneLegacy.pixels)}; `
        + `nearest-field-sample ${mismatch(nearestGraphResult.pixels, nearestLegacyResult.pixels)}; `
        + `pixel3.G float legacy=${mixedFloat.legacy} graph=${mixedFloat.graph}`);
    }
    comparisons++;
    return canonical.pixels;
  };

  try {
    await compare('default-t0', {}, 0);
    await compare('default-t1.75', {}, 1.75);
    await compare('minimums', { amount: 0, scale: 4, speed: 0 }, 1.75);
    await compare('maximums', { amount: 1, scale: 96, speed: 4 }, 1.75);

    const constants = createDefaultVoronoiGraph();
    const seed = constants.nodes.find(node => node.id === 'seeds')!;
    seed.bindings = {}; seed.constants = { scale: 4, speed: 0 };
    const constantPlan = compileComputeImageGraph(constants, { amount: .8, scale: 96, speed: 4 });
    const constantExpected = await render('stage-constants-legacy', { amount: .8, scale: 4, speed: 0 }, 1.75);
    const constantActual = await render('stage-constants-graph', { amount: .8, scale: 96, speed: 4 }, 1.75, constantPlan);
    if (constantActual.pixels.some((value, index) => value !== constantExpected.pixels[index])) {
      throw new Error(`Stage constants did not control execution: ${mismatch(constantActual.pixels, constantExpected.pixels)}`);
    }
    comparisons++;

    const seedOnly = createDefaultVoronoiGraph();
    for (const edge of seedOnly.edges.filter(edge => edge.from === 'jump-flood' && edge.output === 'field')) edge.from = 'seeds';
    const seedParams = { amount: 1, scale: 4, speed: 0 };
    const seedOnlyPlan = compileComputeImageGraph(seedOnly, seedParams);
    if (seedOnlyPlan.stages.map(stage => stage.kind).join(',') !== 'seed') throw new Error('Seed-only rewire scheduled Jump Flood.');
    const fullResult = await render('seed-only-reference', seedParams, 0, compileComputeImageGraph(createDefaultVoronoiGraph(), seedParams));
    const seedOnlyResult = await render('seed-only-rewire', seedParams, 0, seedOnlyPlan);
    if (seedOnlyResult.pixels.every((value, index) => value === fullResult.pixels[index])) throw new Error('Seed-only rewire did not change output pixels.');
    comparisons++;

    const direct = connectEffectGraph(createDefaultVoronoiGraph(), {
      id: 'direct-output', from: 'frame', output: 'image', to: 'output', input: 'image',
    });
    const directPlan = compileComputeImageGraph(direct);
    const directResult = await render('direct-rewire', {}, 0, directPlan);
    if (directResult.encoded || directPlan.stages.length || directResult.pixels.some((value, index) => value !== sourceData[index])) {
      throw new Error('Direct Frame output did not remain a zero-stage passthrough.');
    }
    comparisons++;
    return comparisons;
  } finally {
    runtime.clear(); source.destroy(); output.destroy();
  }
}
