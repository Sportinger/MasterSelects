import { MAX_RUNTIME_PRIMARY_NODES, type RuntimeColorGrade } from '../../types';
import { Logger } from '../../services/logger';

const log = Logger.create('ColorPipeline');
const COLOR_NODE_VEC4_ROWS = 4;
const COLOR_UNIFORM_FLOATS = 4 + MAX_RUNTIME_PRIMARY_NODES * COLOR_NODE_VEC4_ROWS * 4;

const COLOR_SHADER = `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var positions = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f( 1.0, -1.0),
    vec2f(-1.0,  1.0),
    vec2f(-1.0,  1.0),
    vec2f( 1.0, -1.0),
    vec2f( 1.0,  1.0)
  );
  var uvs = array<vec2f, 6>(
    vec2f(0.0, 1.0),
    vec2f(1.0, 1.0),
    vec2f(0.0, 0.0),
    vec2f(0.0, 0.0),
    vec2f(1.0, 1.0),
    vec2f(1.0, 0.0)
  );
  var out: VertexOutput;
  out.position = vec4f(positions[vertexIndex], 0.0, 1.0);
  out.uv = uvs[vertexIndex];
  return out;
}

struct ColorUniforms {
  header: vec4f,
  data: array<vec4f, ${MAX_RUNTIME_PRIMARY_NODES * COLOR_NODE_VEC4_ROWS}>,
}

@group(0) @binding(0) var inputSampler: sampler;
@group(0) @binding(1) var inputTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> color: ColorUniforms;

fn luma(rgb: vec3f) -> f32 {
  return dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
}

fn hueRotate(rgb: vec3f, degrees: f32) -> vec3f {
  let angle = degrees * 0.01745329252;
  let sine = sin(angle);
  let cosine = cos(angle);
  let y = dot(rgb, vec3f(0.299, 0.587, 0.114));
  let inPhase = dot(rgb, vec3f(0.596, -0.274, -0.322));
  let quadrature = dot(rgb, vec3f(0.211, -0.523, 0.312));
  let rotatedI = inPhase * cosine - quadrature * sine;
  let rotatedQ = inPhase * sine + quadrature * cosine;
  return vec3f(
    y + 0.956 * rotatedI + 0.621 * rotatedQ,
    y - 0.272 * rotatedI - 0.647 * rotatedQ,
    y - 1.106 * rotatedI + 1.703 * rotatedQ
  );
}

fn applyPrimary(rgbIn: vec3f, nodeIndex: u32) -> vec3f {
  let baseIndex = nodeIndex * 4u;
  let p0 = color.data[baseIndex + 0u];
  let p1 = color.data[baseIndex + 1u];
  let p2 = color.data[baseIndex + 2u];
  let p3 = color.data[baseIndex + 3u];

  let exposure = p0.x;
  let contrast = p0.y;
  let pivot = p0.z;
  let saturation = p0.w;
  let vibrance = p1.x;
  let temperature = p1.y;
  let tint = p1.z;
  let hue = p1.w;
  let blackPoint = p2.x;
  let whitePoint = p2.y;
  let lift = p2.z;
  let gamma = p2.w;
  let gain = p3.x;
  let offset = p3.y;
  let shadows = p3.z;
  let highlights = p3.w;

  var rgb = rgbIn;
  let range = max(whitePoint - blackPoint, 0.001);
  rgb = clamp((rgb - vec3f(blackPoint)) / range, vec3f(0.0), vec3f(1.0));

  rgb += vec3f(lift + offset);
  rgb *= exp2(exposure);

  let toneY = luma(rgb);
  let shadowMask = clamp(1.0 - toneY * 2.0, 0.0, 1.0);
  let highlightMask = clamp(toneY * 2.0 - 1.0, 0.0, 1.0);
  rgb += vec3f(shadows * 0.35 * shadowMask + highlights * 0.35 * highlightMask);

  rgb = pow(max(rgb, vec3f(0.0)), vec3f(1.0 / max(gamma, 0.001)));
  rgb *= gain;
  rgb = (rgb - vec3f(pivot)) * contrast + vec3f(pivot);

  let y = luma(rgb);
  rgb = mix(vec3f(y), rgb, saturation);

  let chroma = length(rgb - vec3f(y));
  let vibranceMask = clamp(1.0 - chroma * 1.8, 0.0, 1.0);
  rgb = mix(vec3f(y), rgb, 1.0 + vibrance * vibranceMask);

  rgb = hueRotate(rgb, hue);
  rgb += vec3f(temperature * 0.08, tint * 0.05, -temperature * 0.08);
  return rgb;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let sampled = textureSample(inputTexture, inputSampler, input.uv);
  var rgb = sampled.rgb;

  let nodeCount = min(u32(color.header.x), ${MAX_RUNTIME_PRIMARY_NODES}u);
  for (var i = 0u; i < ${MAX_RUNTIME_PRIMARY_NODES}u; i = i + 1u) {
    if (i < nodeCount) {
      rgb = applyPrimary(rgb, i);
    }
  }

  return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), sampled.a);
}
`;

export class ColorPipeline {
  private device: GPUDevice;
  private pipeline: GPURenderPipeline | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private uniformBuffers = new Map<string, GPUBuffer>();

  constructor(device: GPUDevice) {
    this.device = device;
  }

  async createPipeline(): Promise<void> {
    if (this.pipeline) return;

    const module = this.device.createShaderModule({
      label: 'color-primary-module',
      code: COLOR_SHADER,
    });

    this.bindGroupLayout = this.device.createBindGroupLayout({
      label: 'color-primary-layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });

    this.pipeline = this.device.createRenderPipeline({
      label: 'color-primary-pipeline',
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout],
      }),
      vertex: {
        module,
        entryPoint: 'vertexMain',
      },
      fragment: {
        module,
        entryPoint: 'fragmentMain',
        targets: [{ format: 'rgba8unorm' }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  applyGrade(
    commandEncoder: GPUCommandEncoder,
    grade: RuntimeColorGrade | undefined,
    sampler: GPUSampler,
    inputView: GPUTextureView,
    outputView: GPUTextureView,
    layerKey: string
  ): { finalView: GPUTextureView; applied: boolean } {
    if (!grade?.enabled || !this.pipeline || !this.bindGroupLayout) {
      return { finalView: inputView, applied: false };
    }

    const uniformBuffer = this.getOrCreateUniformBuffer(layerKey);
    const primaryNodes = grade.primaryNodes.slice(0, MAX_RUNTIME_PRIMARY_NODES);
    const uniforms = new Float32Array(COLOR_UNIFORM_FLOATS);
    uniforms[0] = primaryNodes.length;
    primaryNodes.forEach((params, index) => {
      const offset = 4 + index * COLOR_NODE_VEC4_ROWS * 4;
      uniforms[offset + 0] = params.exposure;
      uniforms[offset + 1] = params.contrast;
      uniforms[offset + 2] = params.pivot;
      uniforms[offset + 3] = params.saturation;
      uniforms[offset + 4] = params.vibrance;
      uniforms[offset + 5] = params.temperature;
      uniforms[offset + 6] = params.tint;
      uniforms[offset + 7] = params.hue;
      uniforms[offset + 8] = params.blackPoint;
      uniforms[offset + 9] = params.whitePoint;
      uniforms[offset + 10] = params.lift;
      uniforms[offset + 11] = params.gamma;
      uniforms[offset + 12] = params.gain;
      uniforms[offset + 13] = params.offset;
      uniforms[offset + 14] = params.shadows;
      uniforms[offset + 15] = params.highlights;
    });
    this.device.queue.writeBuffer(uniformBuffer, 0, uniforms);

    const bindGroup = this.device.createBindGroup({
      label: `color-primary-bindgroup-${layerKey}`,
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: inputView },
        { binding: 2, resource: { buffer: uniformBuffer } },
      ],
    });

    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: outputView,
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6);
    pass.end();

    return { finalView: outputView, applied: true };
  }

  destroy(): void {
    for (const buffer of this.uniformBuffers.values()) {
      buffer.destroy();
    }
    this.uniformBuffers.clear();
    this.pipeline = null;
    this.bindGroupLayout = null;
  }

  private getOrCreateUniformBuffer(layerKey: string): GPUBuffer {
    const cached = this.uniformBuffers.get(layerKey);
    if (cached) {
      return cached;
    }

    const buffer = this.device.createBuffer({
      label: `color-primary-uniform-${layerKey}`,
      size: COLOR_UNIFORM_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.uniformBuffers.set(layerKey, buffer);
    log.debug('Created color uniform buffer', { layerKey });
    return buffer;
  }
}
