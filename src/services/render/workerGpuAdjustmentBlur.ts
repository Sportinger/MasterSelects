// Gaussian Blur on adjustment layers in the worker GPU host. It renders the same kernel as the
// editor's Gaussian Blur graph (contract: effects/blur/blurSampling.ts): Radius in pixels of a
// 1080p frame, sigma = radius px / 2 cut at 3 sigma, pair-merged linear taps, a premultiplied
// rgba16float source and horizontal pass, straight alpha after the vertical pass. The tap list
// comes from separableBlurTaps itself, so both hosts share one kernel; `samples` is not read.
import { separableBlurTaps } from '../../effects/blur/blurSampling';

export type WorkerAdjustmentBlurDirection = 'horizontal' | 'vertical';

/** Format of the premultiplied source and of the horizontal pass result. */
export const WORKER_ADJUSTMENT_BLUR_INTERMEDIATE_FORMAT: GPUTextureFormat = 'rgba16float';

const VERTEX_SHADER = `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var positions = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  var uvs = array<vec2f, 6>(
    vec2f(0.0, 1.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0),
    vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(1.0, 0.0)
  );
  var out: VertexOutput;
  out.position = vec4f(positions[vertexIndex], 0.0, 1.0);
  out.uv = uvs[vertexIndex];
  return out;
}
`;

const PREMULTIPLY_SHADER = `
@group(0) @binding(0) var frameSampler: sampler;
@group(0) @binding(1) var frameTexture: texture_2d<f32>;

@fragment
fn premultiplyMain(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSampleLevel(frameTexture, frameSampler, input.uv, 0.0);
  return vec4f(color.rgb * color.a, color.a);
}
`;

const BLUR_SHADER = `
struct BlurParams {
  direction: vec2f,
  texelSize: vec2f,
  count: f32,
  straightOutput: f32,
  _pad: vec2f,
};

@group(0) @binding(0) var frameSampler: sampler;
@group(0) @binding(1) var frameTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: BlurParams;
@group(0) @binding(3) var<storage, read> taps: array<vec2f>;

// One axis over a premultiplied input: each tap is (offset in texels, weight).
@fragment
fn blurMain(input: VertexOutput) -> @location(0) vec4f {
  var sum = vec4f(0.0);
  var total = 0.0;
  let count = u32(params.count);
  for (var k = 0u; k < count; k++) {
    let tap = taps[k];
    sum += textureSampleLevel(frameTexture, frameSampler, input.uv + params.direction * params.texelSize * tap.x, 0.0) * tap.y;
    total += tap.y;
  }
  let color = sum / max(total, 1e-20);
  if (params.straightOutput > 0.5) {
    return vec4f(color.rgb / max(color.a, 0.000001), color.a);
  }
  return color;
}
`;

interface BlurPipelines {
  readonly premultiply: GPURenderPipeline;
  readonly premultiplyLayout: GPUBindGroupLayout;
  readonly horizontal: GPURenderPipeline;
  readonly vertical: GPURenderPipeline;
  readonly blurLayout: GPUBindGroupLayout;
}

const pipelinesByDevice = new WeakMap<GPUDevice, BlurPipelines>();

function blurPipelines(device: GPUDevice): BlurPipelines {
  const existing = pipelinesByDevice.get(device);
  if (existing) return existing;
  const premultiplyModule = device.createShaderModule({ label: 'worker-gpu-adjustment-blur-premultiply', code: `${VERTEX_SHADER}\n${PREMULTIPLY_SHADER}` });
  const blurModule = device.createShaderModule({ label: 'worker-gpu-adjustment-blur', code: `${VERTEX_SHADER}\n${BLUR_SHADER}` });
  const premultiplyLayout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
  ] });
  const blurLayout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
    { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
  ] });
  const pipeline = (label: string, module: GPUShaderModule, entryPoint: string, layout: GPUBindGroupLayout, format: GPUTextureFormat) =>
    device.createRenderPipeline({
      label, layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'vertexMain' }, fragment: { module, entryPoint, targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
  const created: BlurPipelines = {
    premultiply: pipeline('worker-gpu-adjustment-blur-premultiply-pipeline', premultiplyModule, 'premultiplyMain', premultiplyLayout,
      WORKER_ADJUSTMENT_BLUR_INTERMEDIATE_FORMAT),
    premultiplyLayout,
    horizontal: pipeline('worker-gpu-adjustment-blur-horizontal-pipeline', blurModule, 'blurMain', blurLayout, WORKER_ADJUSTMENT_BLUR_INTERMEDIATE_FORMAT),
    vertical: pipeline('worker-gpu-adjustment-blur-vertical-pipeline', blurModule, 'blurMain', blurLayout, 'rgba8unorm'),
    blurLayout,
  };
  pipelinesByDevice.set(device, created);
  return created;
}

/**
 * Uniforms and tap list of one pass. The horizontal pass reads the premultiplied source and stays
 * premultiplied; the vertical pass restores straight alpha.
 */
export function workerAdjustmentBlurPassData(direction: WorkerAdjustmentBlurDirection, radius: number, width: number, height: number) {
  const { taps } = separableBlurTaps('gaussian', Number.isFinite(radius) ? radius : 0, width, height);
  const uniforms = new Float32Array([direction === 'horizontal' ? 1 : 0, direction === 'vertical' ? 1 : 0,
    1 / width, 1 / height, taps.length, direction === 'vertical' ? 1 : 0, 0, 0]);
  return { uniforms, taps: new Float32Array(taps.flatMap(tap => [tap.offset, tap.weight])) };
}

function drawFullscreen(encoder: GPUCommandEncoder, view: GPUTextureView, pipeline: GPURenderPipeline, bindGroup: GPUBindGroup): void {
  const pass = encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] });
  let ended = false;
  try {
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6);
    pass.end();
    ended = true;
  } finally {
    if (!ended) {
      try { pass.end(); } catch { /* Preserve the original render-pass failure. */ }
    }
  }
}

/**
 * Encodes one Gaussian Blur pass of an adjustment layer. The horizontal pass first premultiplies
 * `sourceView` into a transient rgba16float texture and writes into an rgba16float `outputView`;
 * the vertical pass reads that and writes straight RGBA.
 */
export function encodeWorkerAdjustmentBlurPass(input: {
  readonly device: GPUDevice;
  readonly commandEncoder: GPUCommandEncoder;
  readonly sampler: GPUSampler;
  readonly sourceView: GPUTextureView;
  readonly outputView: GPUTextureView;
  readonly direction: WorkerAdjustmentBlurDirection;
  readonly radius: number;
  readonly width: number;
  readonly height: number;
  readonly transientResources: Array<{ destroy(): void }>;
}): void {
  const { device, commandEncoder: encoder } = input;
  const pipelines = blurPipelines(device);
  let source = input.sourceView;
  if (input.direction === 'horizontal') {
    const premultiplied = device.createTexture({ label: 'worker-gpu-adjustment-blur-premultiplied', size: { width: input.width, height: input.height },
      format: WORKER_ADJUSTMENT_BLUR_INTERMEDIATE_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    input.transientResources.push(premultiplied);
    const view = premultiplied.createView();
    drawFullscreen(encoder, view, pipelines.premultiply, device.createBindGroup({ layout: pipelines.premultiplyLayout, entries: [
      { binding: 0, resource: input.sampler }, { binding: 1, resource: source }] }));
    source = view;
  }
  const data = workerAdjustmentBlurPassData(input.direction, input.radius, input.width, input.height);
  const uniformBuffer = device.createBuffer({ size: data.uniforms.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const tapBuffer = device.createBuffer({ size: data.taps.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  input.transientResources.push(uniformBuffer, tapBuffer);
  device.queue.writeBuffer(uniformBuffer, 0, data.uniforms);
  device.queue.writeBuffer(tapBuffer, 0, data.taps);
  drawFullscreen(encoder, input.outputView, input.direction === 'horizontal' ? pipelines.horizontal : pipelines.vertical,
    device.createBindGroup({ layout: pipelines.blurLayout, entries: [
      { binding: 0, resource: input.sampler }, { binding: 1, resource: source },
      { binding: 2, resource: { buffer: uniformBuffer } }, { binding: 3, resource: { buffer: tapBuffer } }] }));
}
