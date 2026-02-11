/**
 * GPU-accelerated histogram scope.
 * Compute shader bins pixel values into 256-bin histogram, render shader visualizes.
 */

const HISTOGRAM_COMPUTE = /* wgsl */ `
struct Params { srcW: u32, srcH: u32, _pad0: u32, _pad1: u32 }

@group(0) @binding(0) var inputTex: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> histR: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> histG: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> histB: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> histL: array<atomic<u32>>;
@group(0) @binding(5) var<uniform> params: Params;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= params.srcW || gid.y >= params.srcH) { return; }
  let pixel = textureLoad(inputTex, vec2i(gid.xy), 0);
  let r = min(u32(pixel.r * 255.0), 255u);
  let g = min(u32(pixel.g * 255.0), 255u);
  let b = min(u32(pixel.b * 255.0), 255u);
  let luma = min(u32(0.2126 * pixel.r * 255.0 + 0.7152 * pixel.g * 255.0 + 0.0722 * pixel.b * 255.0), 255u);
  atomicAdd(&histR[r], 1u);
  atomicAdd(&histG[g], 1u);
  atomicAdd(&histB[b], 1u);
  atomicAdd(&histL[luma], 1u);
}
`;

const HISTOGRAM_RENDER = /* wgsl */ `
struct VertexOutput { @builtin(position) pos: vec4f, @location(0) uv: vec2f }

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VertexOutput {
  var p = array<vec2f, 3>(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
  var out: VertexOutput;
  out.pos = vec4f(p[vid], 0, 1);
  out.uv = vec2f((p[vid].x + 1.0) * 0.5, (1.0 - p[vid].y) * 0.5);
  return out;
}

struct Params {
  totalPixels: f32,
  mode: f32,    // 0=RGB, 1=R, 2=G, 3=B, 4=Luma (as float for alignment)
  _pad1: f32,
  _pad2: f32,
}

@group(0) @binding(0) var<storage, read> histR: array<u32>;
@group(0) @binding(1) var<storage, read> histG: array<u32>;
@group(0) @binding(2) var<storage, read> histB: array<u32>;
@group(0) @binding(3) var<storage, read> histL: array<u32>;
@group(0) @binding(4) var<uniform> params: Params;

// Linear interpolation between bins for smooth curves
fn sampleHist(hist: ptr<storage, array<u32>, read>, fx: f32) -> f32 {
  let b0 = u32(clamp(fx, 0.0, 255.0));
  let b1 = min(b0 + 1u, 255u);
  let t = fract(fx);
  return mix(f32((*hist)[b0]), f32((*hist)[b1]), t);
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  let uv = in.uv;
  if (uv.x < 0.0 || uv.x >= 1.0 || uv.y < 0.0 || uv.y >= 1.0) {
    return vec4f(0.04, 0.04, 0.04, 1.0);
  }

  let mode = u32(params.mode);

  // Smooth bin position (linear interpolation between adjacent bins)
  let fx = uv.x * 255.0;
  let rVal = sampleHist(&histR, fx);
  let gVal = sampleHist(&histG, fx);
  let bVal = sampleHist(&histB, fx);
  let lVal = sampleHist(&histL, fx);

  // Sqrt scaling, normalized to total pixels (0.08 = expect peak bin ~8% of pixels)
  let scale = 1.0 / sqrt(params.totalPixels * 0.08);
  let rH = sqrt(rVal) * scale;
  let gH = sqrt(gVal) * scale;
  let bH = sqrt(bVal) * scale;
  let lH = sqrt(lVal) * scale;

  // Y coordinate: 0 = bottom (zero), 1 = top (highest count)
  let y = 1.0 - uv.y;

  // Anti-aliased edge width (in normalized Y units)
  let aaW = 0.004;

  // Filled area with soft anti-aliased top edge
  var color = vec3f(0.0);

  if (mode == 0u) {
    // RGB overlay: soft semi-transparent fills with additive blending
    let lFill = smoothstep(lH, lH - aaW, y);
    let rFill = smoothstep(rH, rH - aaW, y);
    let gFill = smoothstep(gH, gH - aaW, y);
    let bFill = smoothstep(bH, bH - aaW, y);
    // Gradient: brighter near top edge, dimmer at bottom
    let rGrad = 0.35 + 0.35 * (y / max(rH, 0.001));
    let gGrad = 0.35 + 0.35 * (y / max(gH, 0.001));
    let bGrad = 0.35 + 0.35 * (y / max(bH, 0.001));
    color += vec3f(0.08) * lFill;
    color += vec3f(rGrad, 0.05, 0.05) * rFill;
    color += vec3f(0.05, gGrad, 0.05) * gFill;
    color += vec3f(0.05, 0.05, bGrad) * bFill;
  } else if (mode == 1u) {
    let fill = smoothstep(rH, rH - aaW, y);
    let grad = 0.3 + 0.5 * (y / max(rH, 0.001));
    color = vec3f(grad, 0.08, 0.08) * fill;
  } else if (mode == 2u) {
    let fill = smoothstep(gH, gH - aaW, y);
    let grad = 0.3 + 0.5 * (y / max(gH, 0.001));
    color = vec3f(0.08, grad, 0.08) * fill;
  } else if (mode == 3u) {
    let fill = smoothstep(bH, bH - aaW, y);
    let grad = 0.3 + 0.5 * (y / max(bH, 0.001));
    color = vec3f(0.08, 0.08, grad) * fill;
  } else {
    let fill = smoothstep(lH, lH - aaW, y);
    let grad = 0.3 + 0.4 * (y / max(lH, 0.001));
    color = vec3f(grad) * fill;
  }

  // Bright edge glow at the top of each fill (phosphor-style)
  let edgeW = 0.006;
  if (mode == 0u) {
    let rEdge = smoothstep(edgeW, 0.0, abs(y - rH)) * step(y, rH + edgeW);
    let gEdge = smoothstep(edgeW, 0.0, abs(y - gH)) * step(y, gH + edgeW);
    let bEdge = smoothstep(edgeW, 0.0, abs(y - bH)) * step(y, bH + edgeW);
    color += vec3f(0.6, 0.12, 0.12) * rEdge;
    color += vec3f(0.12, 0.55, 0.12) * gEdge;
    color += vec3f(0.12, 0.12, 0.6) * bEdge;
  } else if (mode == 1u) {
    let e = smoothstep(edgeW, 0.0, abs(y - rH)) * step(y, rH + edgeW);
    color += vec3f(0.7, 0.18, 0.18) * e;
  } else if (mode == 2u) {
    let e = smoothstep(edgeW, 0.0, abs(y - gH)) * step(y, gH + edgeW);
    color += vec3f(0.18, 0.65, 0.18) * e;
  } else if (mode == 3u) {
    let e = smoothstep(edgeW, 0.0, abs(y - bH)) * step(y, bH + edgeW);
    color += vec3f(0.18, 0.18, 0.7) * e;
  } else {
    let e = smoothstep(edgeW, 0.0, abs(y - lH)) * step(y, lH + edgeW);
    color += vec3f(0.6) * e;
  }

  // Grid lines at 64, 128, 192 (anti-aliased)
  let gridBins = array<f32, 3>(64.0, 128.0, 192.0);
  for (var i = 0u; i < 3u; i++) {
    let gx = gridBins[i] / 256.0;
    let gAA = smoothstep(0.003, 0.001, abs(uv.x - gx));
    color = max(color, vec3f(0.10) * gAA);
  }
  // Horizontal grid at 25%, 50%, 75%
  for (var i = 1u; i < 4u; i++) {
    let gy = f32(i) * 0.25;
    let hAA = smoothstep(0.004, 0.001, abs(y - gy));
    color = max(color, vec3f(0.07) * hAA);
  }

  return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;

export class HistogramScope {
  private device: GPUDevice;

  private computePipeline!: GPUComputePipeline;
  private renderPipeline!: GPURenderPipeline;
  private computeBGL!: GPUBindGroupLayout;
  private renderBGL!: GPUBindGroupLayout;
  private histR!: GPUBuffer;
  private histG!: GPUBuffer;
  private histB!: GPUBuffer;
  private histL!: GPUBuffer;
  private computeParams!: GPUBuffer;
  private renderParams!: GPUBuffer;

  constructor(device: GPUDevice, format: GPUTextureFormat) {
    this.device = device;
    this.init(format);
  }

  private init(format: GPUTextureFormat) {
    const d = this.device;
    const histBufSize = 256 * 4;

    this.histR = d.createBuffer({ size: histBufSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.histG = d.createBuffer({ size: histBufSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.histB = d.createBuffer({ size: histBufSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.histL = d.createBuffer({ size: histBufSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.computeParams = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.renderParams = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    this.computeBGL = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });

    const computeModule = d.createShaderModule({ code: HISTOGRAM_COMPUTE });
    this.computePipeline = d.createComputePipeline({
      layout: d.createPipelineLayout({ bindGroupLayouts: [this.computeBGL] }),
      compute: { module: computeModule, entryPoint: 'main' },
    });

    this.renderBGL = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });

    const renderModule = d.createShaderModule({ code: HISTOGRAM_RENDER });
    this.renderPipeline = d.createRenderPipeline({
      layout: d.createPipelineLayout({ bindGroupLayouts: [this.renderBGL] }),
      vertex: { module: renderModule, entryPoint: 'vs' },
      fragment: { module: renderModule, entryPoint: 'fs', targets: [{ format }] },
    });
  }

  render(sourceTexture: GPUTexture, ctx: GPUCanvasContext, mode: number = 0) {
    const d = this.device;
    const srcW = sourceTexture.width;
    const srcH = sourceTexture.height;

    d.queue.writeBuffer(this.computeParams, 0, new Uint32Array([srcW, srcH, 0, 0]));
    d.queue.writeBuffer(this.renderParams, 0, new Float32Array([srcW * srcH, mode, 0, 0]));

    const encoder = d.createCommandEncoder();

    encoder.clearBuffer(this.histR);
    encoder.clearBuffer(this.histG);
    encoder.clearBuffer(this.histB);
    encoder.clearBuffer(this.histL);

    const computeBG = d.createBindGroup({
      layout: this.computeBGL,
      entries: [
        { binding: 0, resource: sourceTexture.createView() },
        { binding: 1, resource: { buffer: this.histR } },
        { binding: 2, resource: { buffer: this.histG } },
        { binding: 3, resource: { buffer: this.histB } },
        { binding: 4, resource: { buffer: this.histL } },
        { binding: 5, resource: { buffer: this.computeParams } },
      ],
    });

    const cp = encoder.beginComputePass();
    cp.setPipeline(this.computePipeline);
    cp.setBindGroup(0, computeBG);
    cp.dispatchWorkgroups(Math.ceil(srcW / 16), Math.ceil(srcH / 16));
    cp.end();

    const renderBG = d.createBindGroup({
      layout: this.renderBGL,
      entries: [
        { binding: 0, resource: { buffer: this.histR } },
        { binding: 1, resource: { buffer: this.histG } },
        { binding: 2, resource: { buffer: this.histB } },
        { binding: 3, resource: { buffer: this.histL } },
        { binding: 4, resource: { buffer: this.renderParams } },
      ],
    });

    const rp = encoder.beginRenderPass({
      colorAttachments: [{
        view: ctx.getCurrentTexture().createView(),
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0.04, g: 0.04, b: 0.04, a: 1 },
      }],
    });
    rp.setPipeline(this.renderPipeline);
    rp.setBindGroup(0, renderBG);
    rp.draw(3);
    rp.end();

    d.queue.submit([encoder.finish()]);
  }

  destroy() {
    const bufs = [
      this.histR, this.histG, this.histB, this.histL,
      this.computeParams, this.renderParams,
    ];
    for (const b of bufs) b?.destroy();
  }
}
