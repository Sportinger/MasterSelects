import common from '../../src/effects/_shared/commonShader';
import { imageGraphDefinition } from '../../src/effects/_shared/imageGraphDefinition';
import { exposure } from '../../src/effects/color/exposure';
import { chromaKey } from '../../src/effects/keying/chroma-key';
import { holo } from '../../src/effects/analog';
import type { FullscreenEffectDefinition } from '../../src/effects/types';
import { measureEffectPipelineCpu } from './node-effect-pipeline-performance';

// This is an isolated GPU comparison, not a playback/decode or whole-editor FPS test.
const PASSES = 12, ROUNDS = 12, TIME = 2.125;
const fixtures: Array<{ definition: FullscreenEffectDefinition; overrides: Record<string, number | boolean | string> }> = [
  { definition: exposure as FullscreenEffectDefinition, overrides: { exposure: .7, gamma: 1.1, offset: .03 } },
  { definition: chromaKey as FullscreenEffectDefinition, overrides: {} },
  { definition: holo as FullscreenEffectDefinition, overrides: {} },
];
const output = document.querySelector<HTMLPreElement>('#result')!;
const button = document.querySelector<HTMLButtonElement>('#run')!;
const download = document.querySelector<HTMLButtonElement>('#download')!;
download.onclick = () => {
  const url = URL.createObjectURL(new Blob([output.textContent ?? ''], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'node-effect-performance.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
function summarize(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b);
  const round = (value: number) => Math.round(value * 10000) / 10000;
  return { median: round((sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2),
    p95: round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))]),
    min: round(sorted[0]), max: round(sorted.at(-1)!), samples: values.map(round) };
}

async function compare(device: GPUDevice, timestamp: boolean, definition: FullscreenEffectDefinition,
  overrides: Record<string, number | boolean | string>, width: number, height: number) {
  const params = { ...Object.fromEntries(Object.entries(definition.params).map(([key, spec]) => [key, spec.default])), ...overrides };
  const compileStart = performance.now();
  const graph = imageGraphDefinition({ type: definition.id, params }, definition, TIME);
  const graphLoweringMs = performance.now() - compileStart;
  if (graph.shader === definition.shader) throw new Error(`${definition.id}: graph path was not generated`);
  const source = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
  const pixels = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * bytesPerRow + x * 4;
    pixels[i] = (x * 7 + y * 3) & 255; pixels[i + 1] = (x * 11 + y * 13) & 255;
    pixels[i + 2] = (x * 17 + y * 5) & 255; pixels[i + 3] = 64 + ((x + y) % 192);
  }
  device.queue.writeTexture({ texture: source }, pixels, { bytesPerRow }, [width, height]);
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
  const resources: Array<{ destroy(): void }> = [source];
  const query = timestamp ? device.createQuerySet({ type: 'timestamp', count: 2 }) : undefined;
  const resolve = timestamp ? device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }) : undefined;
  const timing = timestamp ? device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }) : undefined;
  if (query && resolve && timing) resources.push(query, resolve, timing);
  const variants: Array<{ name: string; target: GPUTexture; view: GPUTextureView; pipeline: GPURenderPipeline;
    bind: GPUBindGroup; pipelineCompileMs: number; shaderBytes: number; gpu: number[]; wall: number[]; cpu: number[] }> = [];
  try {
    for (const [name, effect] of [['legacy', definition], ['nodes', graph]] as const) {
      const target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      resources.push(target);
      const module = device.createShaderModule({ code: `${common}\n${effect.shader}` });
      const errors = (await module.getCompilationInfo()).messages.filter(message => message.type === 'error');
      if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
      const compileAt = performance.now();
      const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
        fragment: { module, entryPoint: effect.entryPoint, targets: [{ format: 'rgba8unorm' }] } });
      const pipelineCompileMs = performance.now() - compileAt;
      const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: sampler }, { binding: 1, resource: source.createView() }];
      const uniforms = effect.packUniforms(params, width, height, TIME);
      // The original animated catalog shader normally uses wall time. Pin the
      // same time as the graph to make both the image and the workload identical.
      if (name === 'legacy' && definition.id === 'holo' && uniforms) uniforms[5] = TIME;
      if (uniforms) {
        const buffer = device.createBuffer({ size: uniforms.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        resources.push(buffer); device.queue.writeBuffer(buffer, 0, uniforms as Float32Array<ArrayBuffer>);
        entries.push({ binding: 2, resource: { buffer } });
      }
      const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries });
      variants.push({ name, target, view: target.createView(), pipeline, bind, pipelineCompileMs,
        gpu: [] as number[], wall: [] as number[], cpu: [] as number[], shaderBytes: effect.shader.length });
    }
    async function batch(variant: typeof variants[number], passes: number, record: boolean) {
      const started = performance.now();
      const encoder = device.createCommandEncoder();
      for (let i = 0; i < passes; i++) {
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: variant.view, loadOp: 'clear', storeOp: 'store' }],
          ...(query && (i === 0 || i === passes - 1) ? { timestampWrites: { querySet: query,
            ...(i === 0 ? { beginningOfPassWriteIndex: 0 } : {}),
            ...(i === passes - 1 ? { endOfPassWriteIndex: 1 } : {}) } } : {}) });
        pass.setPipeline(variant.pipeline); pass.setBindGroup(0, variant.bind); pass.draw(6); pass.end();
      }
      if (query && resolve && timing) { encoder.resolveQuerySet(query, 0, 2, resolve, 0); encoder.copyBufferToBuffer(resolve, 0, timing, 0, 16); }
      device.queue.submit([encoder.finish()]);
      const cpuMs = performance.now() - started;
      await device.queue.onSubmittedWorkDone();
      const wallMs = performance.now() - started;
      if (timing) {
        await timing.mapAsync(GPUMapMode.READ);
        const times = new BigUint64Array(timing.getMappedRange());
        if (record) variant.gpu.push(Number(times[1] - times[0]) / 1e6 / passes);
        timing.unmap();
      }
      if (record) { variant.cpu.push(cpuMs / passes); variant.wall.push(wallMs / passes); }
    }
    for (let warm = 0; warm < 3; warm++) for (const variant of variants) await batch(variant, PASSES, false);
    for (let round = 0; round < ROUNDS; round++) {
      for (const variant of round % 2 ? variants.toReversed() : variants) await batch(variant, PASSES, true);
    }
    const readback = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    resources.push(readback);
    const images: Uint8Array[] = [];
    for (const variant of variants) {
      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer({ texture: variant.target }, { buffer: readback, bytesPerRow }, [width, height]);
      device.queue.submit([encoder.finish()]); await readback.mapAsync(GPUMapMode.READ);
      images.push(new Uint8Array(readback.getMappedRange()).slice()); readback.unmap();
    }
    let differingBytes = 0, maxDelta = 0;
    for (let i = 0; i < images[0].length; i++) {
      const delta = Math.abs(images[0][i] - images[1][i]);
      if (delta) differingBytes++; maxDelta = Math.max(maxDelta, delta);
    }
    return { effect: definition.id, width, height, params, graphLoweringMs, parity: { differingBytes, maxDelta, totalBytes: width * height * 4 },
      variants: variants.map(value => ({ name: value.name, shaderBytes: value.shaderBytes, pipelineCompileMs: value.pipelineCompileMs,
        gpuMsPerPass: timestamp ? summarize(value.gpu) : null, cpuEncodeMsPerPass: summarize(value.cpu), fencedWallMsPerPass: summarize(value.wall) })) };
  } finally { for (const resource of resources) resource.destroy(); }
}

button.onclick = async () => {
  button.disabled = true;
  download.disabled = true;
  let device: GPUDevice | undefined;
  try {
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('WebGPU adapter unavailable');
    const timestamp = adapter.features.has('timestamp-query');
    device = await adapter.requestDevice({ requiredFeatures: timestamp ? ['timestamp-query'] : [] });
    device.pushErrorScope('validation');
    const info = adapter.info;
    const result = { date: new Date().toISOString(), userAgent: navigator.userAgent,
      adapter: { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description },
      timestampQueries: timestamp, passesPerBatch: PASSES, measuredBatchesPerVariant: ROUNDS, warmupPassesPerVariant: PASSES * 3,
      note: 'cases: single-pass GPU execution, compilation excluded. cpuPipeline: real applyEffects CPU preparation including per-frame graph work. Neither includes decode, node UI or previews.',
      cases: [] as Awaited<ReturnType<typeof compare>>[], cpuPipeline: [] as Awaited<ReturnType<typeof measureEffectPipelineCpu>>[] };
    for (const [width, height] of [[1920, 1080], [3840, 2160]]) for (const fixture of fixtures) {
      output.textContent = `Running ${fixture.definition.id} at ${width}x${height} (${result.cases.length}/6 complete)`;
      result.cases.push(await compare(device, timestamp, fixture.definition, fixture.overrides, width, height));
    }
    // Exposure is normally fused into the compositor in the editor; measuring
    // it through the standalone EffectsPipeline would misrepresent that route.
    for (const fixture of fixtures.filter(item => item.definition.id !== 'exposure')) {
      output.textContent = `Running real CPU pipeline for ${fixture.definition.id}`;
      const params = { ...Object.fromEntries(Object.entries(fixture.definition.params).map(([key, spec]) => [key, spec.default])), ...fixture.overrides };
      result.cpuPipeline.push(await measureEffectPipelineCpu(device, fixture.definition, params, summarize));
    }
    const error = await device.popErrorScope(); if (error) throw new Error(error.message);
    output.textContent = JSON.stringify({ success: true, ...result }, null, 2);
    download.disabled = false;
  } catch (error) { output.textContent = JSON.stringify({ success: false, error: String(error) }); }
  finally { device?.destroy(); button.disabled = false; }
};
