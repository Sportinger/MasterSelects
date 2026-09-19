/**
 * GPU-accelerated waveform scope.
 * Compute shader accumulates pixel intensities, render shader visualizes with phosphor glow.
 */

const WAVEFORM_COMPUTE = /* wgsl */ `
struct Params {
  outW: u32,
  outH: u32,
  srcW: u32,
  srcH: u32,
  mode: u32,
  sampleStride: u32,
  _pad0: u32,
  _pad1: u32,
}

@group(0) @binding(0) var inputTex: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> accumR: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> accumG: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> accumB: array<atomic<u32>>;
@group(0) @binding(4) var<uniform> params: Params;
@group(0) @binding(5) var<storage, read_write> accumL: array<atomic<u32>>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let sourcePos = vec2u(gid.x, gid.y * params.sampleStride);
  if (sourcePos.x >= params.srcW || sourcePos.y >= params.srcH) { return; }

  let pixel = textureLoad(inputTex, vec2i(sourcePos), 0);

  // Sub-pixel X: distribute weight across 2 adjacent columns (scale 256)
  let fxPos = f32(sourcePos.x) * f32(params.outW) / f32(params.srcW);
  let x0 = u32(fxPos);
  let x1 = min(x0 + 1u, params.outW - 1u);
  let frac = fxPos - f32(x0);
  let w0 = u32((1.0 - frac) * 256.0);
  let w1 = 256u - w0;

  let hm1 = f32(params.outH - 1u);
  let maxY = i32(params.outH - 1u);

  // Strong nine-row blur with a soft core and broad phosphor-like falloff.
  let gK = array<f32, 9>(0.04, 0.07, 0.11, 0.16, 0.24, 0.16, 0.11, 0.07, 0.04);

  // ── Red ──
  if (params.mode == 0u || params.mode == 1u || params.mode == 5u) {
    let ryC = i32(hm1 - clamp(pixel.r, 0.0, 1.0) * hm1);
    for (var d: i32 = -4; d <= 4; d += 1) {
      let sampleY = ryC + d;
      if (sampleY < 0 || sampleY > maxY) { continue; }
      let y = u32(sampleY);
      let yw = gK[u32(d + 4)];
      let idx = y * params.outW;
      let wA = u32(f32(w0) * yw);
      let wB = u32(f32(w1) * yw);
      if (wA > 0u) { atomicAdd(&accumR[idx + x0], wA); }
      if (wB > 0u) { atomicAdd(&accumR[idx + x1], wB); }
    }
  }

  // ── Green ──
  if (params.mode == 0u || params.mode == 2u || params.mode == 5u) {
    let gyC = i32(hm1 - clamp(pixel.g, 0.0, 1.0) * hm1);
    for (var d: i32 = -4; d <= 4; d += 1) {
      let sampleY = gyC + d;
      if (sampleY < 0 || sampleY > maxY) { continue; }
      let y = u32(sampleY);
      let yw = gK[u32(d + 4)];
      let idx = y * params.outW;
      let wA = u32(f32(w0) * yw);
      let wB = u32(f32(w1) * yw);
      if (wA > 0u) { atomicAdd(&accumG[idx + x0], wA); }
      if (wB > 0u) { atomicAdd(&accumG[idx + x1], wB); }
    }
  }

  // ── Blue ──
  if (params.mode == 0u || params.mode == 3u || params.mode == 5u) {
    let byC = i32(hm1 - clamp(pixel.b, 0.0, 1.0) * hm1);
    for (var d: i32 = -4; d <= 4; d += 1) {
      let sampleY = byC + d;
      if (sampleY < 0 || sampleY > maxY) { continue; }
      let y = u32(sampleY);
      let yw = gK[u32(d + 4)];
      let idx = y * params.outW;
      let wA = u32(f32(w0) * yw);
      let wB = u32(f32(w1) * yw);
      if (wA > 0u) { atomicAdd(&accumB[idx + x0], wA); }
      if (wB > 0u) { atomicAdd(&accumB[idx + x1], wB); }
    }
  }

  // ── Luma (BT.709) ──
  if (params.mode == 4u) {
    let luma = 0.2126 * clamp(pixel.r, 0.0, 1.0) + 0.7152 * clamp(pixel.g, 0.0, 1.0) + 0.0722 * clamp(pixel.b, 0.0, 1.0);
    let lyC = i32(hm1 - luma * hm1);
    for (var d: i32 = -4; d <= 4; d += 1) {
      let sampleY = lyC + d;
      if (sampleY < 0 || sampleY > maxY) { continue; }
      let y = u32(sampleY);
      let yw = gK[u32(d + 4)];
      let idx = y * params.outW;
      let wA = u32(f32(w0) * yw);
      let wB = u32(f32(w1) * yw);
      if (wA > 0u) { atomicAdd(&accumL[idx + x0], wA); }
      if (wB > 0u) { atomicAdd(&accumL[idx + x1], wB); }
    }
  }
}
`;

const WAVEFORM_RENDER = /* wgsl */ `
struct VertexOutput {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VertexOutput {
  var p = array<vec2f, 3>(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
  var out: VertexOutput;
  out.pos = vec4f(p[vid], 0, 1);
  out.uv = vec2f((p[vid].x + 1.0) * 0.5, (1.0 - p[vid].y) * 0.5);
  return out;
}

struct RenderParams {
  outW: f32,
  outH: f32,
  refValue: f32,
  intensity: f32,
  mode: u32,   // 0=RGB, 1=R, 2=G, 3=B, 4=Luma
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
}

@group(0) @binding(0) var<storage, read> accumR: array<u32>;
@group(0) @binding(1) var<storage, read> accumG: array<u32>;
@group(0) @binding(2) var<storage, read> accumB: array<u32>;
@group(0) @binding(3) var<uniform> params: RenderParams;
@group(0) @binding(4) var<storage, read> accumL: array<u32>;

// Bilinear sample helper: reads accumulator with interpolation
fn sampleAccum(acc: ptr<storage, array<u32>, read>, fx: f32, fy: f32, w: u32, h: u32) -> f32 {
  let x0 = u32(clamp(fx, 0.0, f32(w - 1u)));
  let y0 = u32(clamp(fy, 0.0, f32(h - 1u)));
  let x1 = min(x0 + 1u, w - 1u);
  let y1 = min(y0 + 1u, h - 1u);
  let dx = fract(fx);
  let dy = fract(fy);
  let v00 = f32((*acc)[y0 * w + x0]);
  let v10 = f32((*acc)[y0 * w + x1]);
  let v01 = f32((*acc)[y1 * w + x0]);
  let v11 = f32((*acc)[y1 * w + x1]);
  return mix(mix(v00, v10, dx), mix(v01, v11, dx), dy);
}

// Nearest-neighbor read for bloom sampling
fn readAccum(acc: ptr<storage, array<u32>, read>, x: i32, y: i32, w: i32, h: i32) -> f32 {
  return f32((*acc)[u32(clamp(y, 0, h - 1)) * u32(w) + u32(clamp(x, 0, w - 1))]);
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  let uv = in.uv;
  if (uv.x < 0.0 || uv.x >= 1.0 || uv.y < 0.0 || uv.y >= 1.0) {
    return vec4f(0.04, 0.04, 0.04, 1.0);
  }

  let w = u32(params.outW);
  let h = u32(params.outH);
  let iw = i32(w);
  let ih = i32(h);
  var mode = params.mode;
  var waveformUv = uv;
  if (mode == 5u) {
    let paradePosition = min(uv.x * 3.0, 2.999999);
    mode = u32(paradePosition) + 1u;
    waveformUv.x = fract(paradePosition);
  }

  // Floating-point grid position for bilinear sampling
  let fx = waveformUv.x * params.outW - 0.5;
  let fy = waveformUv.y * params.outH - 0.5;

  // Center value (bilinear — sharp trace)
  let rCenter = sampleAccum(&accumR, fx, fy, w, h);
  let gCenter = sampleAccum(&accumG, fx, fy, w, h);
  let bCenter = sampleAccum(&accumB, fx, fy, w, h);
  let lCenter = sampleAccum(&accumL, fx, fy, w, h);

  // Phosphor bloom: 3x3 gaussian at 4px step for soft glow
  let ix = i32(fx + 0.5);
  let iy = i32(fy + 0.5);
  var rBloom = 0.0; var gBloom = 0.0; var bBloom = 0.0; var lBloom = 0.0;
  let bK = array<f32, 3>(0.25, 0.50, 0.25);
  for (var by: i32 = -1; by <= 1; by += 1) {
    for (var bx: i32 = -1; bx <= 1; bx += 1) {
      let bw = bK[u32(bx + 1)] * bK[u32(by + 1)];
      rBloom += readAccum(&accumR, ix + bx * 4, iy + by * 4, iw, ih) * bw;
      gBloom += readAccum(&accumG, ix + bx * 4, iy + by * 4, iw, ih) * bw;
      bBloom += readAccum(&accumB, ix + bx * 4, iy + by * 4, iw, ih) * bw;
      lBloom += readAccum(&accumL, ix + bx * 4, iy + by * 4, iw, ih) * bw;
    }
  }

  let rv = params.refValue;
  let s = params.intensity;

  // Preserve the unclipped density for a gradual white-hot phosphor core.
  let rDensity = sqrt(rCenter) / rv;
  let gDensity = sqrt(gCenter) / rv;
  let bDensity = sqrt(bCenter) / rv;
  let lDensity = sqrt(lCenter) / rv;
  let rBloomDensity = sqrt(rBloom) / rv;
  let gBloomDensity = sqrt(gBloom) / rv;
  let bBloomDensity = sqrt(bBloom) / rv;
  let lBloomDensity = sqrt(lBloom) / rv;

  // Tone-map: crisp colored trace with a quieter, smoothly fading halo.
  let rT = pow(clamp(rDensity, 0.0, 1.0), 0.92) * s * 0.72;
  let gT = pow(clamp(gDensity, 0.0, 1.0), 0.92) * s * 0.72;
  let bT = pow(clamp(bDensity, 0.0, 1.0), 0.92) * s * 0.72;
  let lT = pow(clamp(lDensity, 0.0, 1.0), 0.92) * s * 0.72;

  let rG = pow(clamp(rBloomDensity, 0.0, 1.0), 0.85) * 0.35;
  let gG = pow(clamp(gBloomDensity, 0.0, 1.0), 0.85) * 0.35;
  let bG = pow(clamp(bBloomDensity, 0.0, 1.0), 0.85) * 0.35;
  let lG = pow(clamp(lBloomDensity, 0.0, 1.0), 0.85) * 0.35;

  // Additive phosphor composite based on mode
  var color: vec3f;
  if (mode == 0u) {
    // RGB: all channels
    color = clamp(vec3f(rT + rG, gT + gG, bT + bG), vec3f(0.0), vec3f(1.0));
  } else if (mode == 1u) {
    // Red only
    let v = clamp(rT + rG, 0.0, 1.0);
    let hot = smoothstep(0.55, 1.10, rDensity) * 0.86;
    color = mix(vec3f(v, v * 0.15, v * 0.15), vec3f(v), hot);
  } else if (mode == 2u) {
    // Green only
    let v = clamp(gT + gG, 0.0, 1.0);
    let hot = smoothstep(0.55, 1.10, gDensity) * 0.86;
    color = mix(vec3f(v * 0.15, v, v * 0.15), vec3f(v), hot);
  } else if (mode == 3u) {
    // Blue only
    let v = clamp(bT + bG, 0.0, 1.0);
    let hot = smoothstep(0.55, 1.10, bDensity) * 0.86;
    color = mix(vec3f(v * 0.15, v * 0.15, v), vec3f(v), hot);
  } else {
    // Luma: white trace
    let v = clamp(lT + lG, 0.0, 1.0);
    color = vec3f(v);
  }

  // Resolve-style yellow reference grid: every 10 IRE (10% of height)
  let gridY = fract(uv.y * 10.0);
  let dGrid = min(gridY, 1.0 - gridY) * params.outH * 0.5;
  if (dGrid < 0.8) {
    let a = 1.0 - dGrid / 0.8;
    color = max(color, vec3f(0.32, 0.27, 0.02) * a);
  }

  return vec4f(color, 1.0);
}
`;

const DECAY_COMPUTE = /* wgsl */ `
struct Params { len: u32, _p0: u32, _p1: u32, _p2: u32 }

@group(0) @binding(0) var<storage, read_write> buf: array<u32>;
@group(0) @binding(1) var<uniform> params: Params;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= params.len) { return; }
  // Temporal decay: no persistence (full clear)
  buf[gid.x] = 0u;
}
`;

export const OUT_W = 1024;
export const OUT_H = 512;
const TARGET_SOURCE_SAMPLES = 1_000_000;
const MAX_SAMPLE_STRIDE = 4;

export function getWaveformSampleStride(srcW: number, srcH: number): number {
  const sourcePixels = Math.max(1, srcW) * Math.max(1, srcH);
  return Math.min(
    MAX_SAMPLE_STRIDE,
    Math.max(1, Math.ceil(Math.sqrt(sourcePixels / TARGET_SOURCE_SAMPLES))),
  );
}

export class WaveformScope {
  private device: GPUDevice;

  private computePipeline!: GPUComputePipeline;
  private renderPipeline!: GPURenderPipeline;
  private computeBGL!: GPUBindGroupLayout;
  private renderBGL!: GPUBindGroupLayout;
  private accumR!: GPUBuffer;
  private accumG!: GPUBuffer;
  private accumB!: GPUBuffer;
  private accumL!: GPUBuffer;
  private computeParams!: GPUBuffer;
  private renderParams!: GPUBuffer;

  private decayPipeline!: GPUComputePipeline;
  private decayBGL!: GPUBindGroupLayout;
  private decayParams!: GPUBuffer;

  constructor(device: GPUDevice, format: GPUTextureFormat) {
    this.device = device;
    this.initWaveform(format);
    this.initDecay();
  }

  private initWaveform(format: GPUTextureFormat) {
    const d = this.device;
    const bufSize = OUT_W * OUT_H * 4;

    this.accumR = d.createBuffer({ size: bufSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.accumG = d.createBuffer({ size: bufSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.accumB = d.createBuffer({ size: bufSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.accumL = d.createBuffer({ size: bufSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.computeParams = d.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.renderParams = d.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    this.computeBGL = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });

    const computeModule = d.createShaderModule({ code: WAVEFORM_COMPUTE });
    this.computePipeline = d.createComputePipeline({
      layout: d.createPipelineLayout({ bindGroupLayouts: [this.computeBGL] }),
      compute: { module: computeModule, entryPoint: 'main' },
    });

    this.renderBGL = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ],
    });

    const renderModule = d.createShaderModule({ code: WAVEFORM_RENDER });
    this.renderPipeline = d.createRenderPipeline({
      layout: d.createPipelineLayout({ bindGroupLayouts: [this.renderBGL] }),
      vertex: { module: renderModule, entryPoint: 'vs' },
      fragment: { module: renderModule, entryPoint: 'fs', targets: [{ format }] },
    });
  }

  private initDecay() {
    const d = this.device;
    this.decayBGL = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
    const module = d.createShaderModule({ code: DECAY_COMPUTE });
    this.decayPipeline = d.createComputePipeline({
      layout: d.createPipelineLayout({ bindGroupLayouts: [this.decayBGL] }),
      compute: { module, entryPoint: 'main' },
    });
    this.decayParams = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }

  render(sourceTexture: GPUTexture, ctx: GPUCanvasContext, mode: number = 0) {
    const d = this.device;
    const srcW = sourceTexture.width;
    const srcH = sourceTexture.height;
    const sampleStride = getWaveformSampleStride(srcW, srcH);

    d.queue.writeBuffer(
      this.computeParams,
      0,
      new Uint32Array([OUT_W, OUT_H, srcW, srcH, mode, sampleStride, 0, 0]),
    );
    const refValue = Math.sqrt(srcH / OUT_H) * 40.0 / Math.sqrt(sampleStride);
    const paramsData = new ArrayBuffer(32);
    new Float32Array(paramsData, 0, 4).set([OUT_W, OUT_H, refValue, 0.9]);
    new Uint32Array(paramsData, 16, 4).set([mode, 0, 0, 0]);
    d.queue.writeBuffer(this.renderParams, 0, paramsData);

    const encoder = d.createCommandEncoder();

    // Temporal decay
    const bufLen = OUT_W * OUT_H;
    d.queue.writeBuffer(this.decayParams, 0, new Uint32Array([bufLen, 0, 0, 0]));

    const decayBG_R = d.createBindGroup({
      layout: this.decayBGL,
      entries: [
        { binding: 0, resource: { buffer: this.accumR } },
        { binding: 1, resource: { buffer: this.decayParams } },
      ],
    });
    const decayBG_G = d.createBindGroup({
      layout: this.decayBGL,
      entries: [
        { binding: 0, resource: { buffer: this.accumG } },
        { binding: 1, resource: { buffer: this.decayParams } },
      ],
    });
    const decayBG_B = d.createBindGroup({
      layout: this.decayBGL,
      entries: [
        { binding: 0, resource: { buffer: this.accumB } },
        { binding: 1, resource: { buffer: this.decayParams } },
      ],
    });
    const decayBG_L = d.createBindGroup({
      layout: this.decayBGL,
      entries: [
        { binding: 0, resource: { buffer: this.accumL } },
        { binding: 1, resource: { buffer: this.decayParams } },
      ],
    });

    const dp = encoder.beginComputePass();
    dp.setPipeline(this.decayPipeline);
    dp.setBindGroup(0, decayBG_R);
    dp.dispatchWorkgroups(Math.ceil(bufLen / 256));
    dp.setBindGroup(0, decayBG_G);
    dp.dispatchWorkgroups(Math.ceil(bufLen / 256));
    dp.setBindGroup(0, decayBG_B);
    dp.dispatchWorkgroups(Math.ceil(bufLen / 256));
    dp.setBindGroup(0, decayBG_L);
    dp.dispatchWorkgroups(Math.ceil(bufLen / 256));
    dp.end();

    // Compute pass
    const computeBG = d.createBindGroup({
      layout: this.computeBGL,
      entries: [
        { binding: 0, resource: sourceTexture.createView() },
        { binding: 1, resource: { buffer: this.accumR } },
        { binding: 2, resource: { buffer: this.accumG } },
        { binding: 3, resource: { buffer: this.accumB } },
        { binding: 4, resource: { buffer: this.computeParams } },
        { binding: 5, resource: { buffer: this.accumL } },
      ],
    });

    const cp = encoder.beginComputePass();
    cp.setPipeline(this.computePipeline);
    cp.setBindGroup(0, computeBG);
    cp.dispatchWorkgroups(
      Math.ceil(srcW / 16),
      Math.ceil(srcH / (16 * sampleStride)),
    );
    cp.end();

    // Render pass
    const renderBG = d.createBindGroup({
      layout: this.renderBGL,
      entries: [
        { binding: 0, resource: { buffer: this.accumR } },
        { binding: 1, resource: { buffer: this.accumG } },
        { binding: 2, resource: { buffer: this.accumB } },
        { binding: 3, resource: { buffer: this.renderParams } },
        { binding: 4, resource: { buffer: this.accumL } },
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
      this.accumR, this.accumG, this.accumB, this.accumL,
      this.computeParams, this.renderParams, this.decayParams,
    ];
    for (const b of bufs) b?.destroy();
  }
}
