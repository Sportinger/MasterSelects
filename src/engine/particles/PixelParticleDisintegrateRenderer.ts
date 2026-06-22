import type { Effect } from '../../types/effects';
import shaderSource from './shaders/PixelParticleDisintegrate.wgsl?raw';

export interface PixelParticleDisintegrateRenderOptions {
  readonly commandEncoder: GPUCommandEncoder;
  readonly sampler: GPUSampler;
  readonly sourceView: GPUTextureView;
  readonly accumulationView: GPUTextureView;
  readonly outputView: GPUTextureView;
  readonly outputWidth: number;
  readonly outputHeight: number;
  readonly effect: Effect;
  readonly motionTime: number;
  readonly quality: 'preview' | 'export';
  readonly clearOutput?: boolean;
}

export interface PixelParticleDisintegrateRenderStats {
  readonly particleCount: number;
  readonly columns: number;
  readonly rows: number;
  readonly cellSize: number;
  readonly clampedByBudget: boolean;
}

interface ParticleResources {
  readonly bindGroupLayout: GPUBindGroupLayout;
  readonly flatPipeline: GPURenderPipeline;
  readonly particlePipeline: GPURenderPipeline;
  readonly resolvePipeline: GPURenderPipeline;
  readonly uniformBuffer: GPUBuffer;
}

const rendererByDevice = new WeakMap<GPUDevice, PixelParticleDisintegrateRenderer>();

export function getPixelParticleDisintegrateRenderer(device: GPUDevice): PixelParticleDisintegrateRenderer {
  const existing = rendererByDevice.get(device);
  if (existing) return existing;
  const renderer = new PixelParticleDisintegrateRenderer(device);
  rendererByDevice.set(device, renderer);
  return renderer;
}

function finiteParam(params: Record<string, unknown>, name: string, fallback: number): number {
  const value = params[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function shapeIndex(value: unknown): number {
  if (value === 'square') return 0;
  if (value === 'shard') return 2;
  return 1;
}

export class PixelParticleDisintegrateRenderer {
  private readonly device: GPUDevice;
  private resources: ParticleResources | null = null;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  render(options: PixelParticleDisintegrateRenderOptions): PixelParticleDisintegrateRenderStats {
    const resources = this.getResources();
    const params = this.resolveParams(options);
    this.device.queue.writeBuffer(resources.uniformBuffer, 0, params.uniformBuffer);

    const sourceBindGroup = this.device.createBindGroup({
      layout: resources.bindGroupLayout,
      entries: [
        { binding: 0, resource: options.sampler },
        { binding: 1, resource: options.sourceView },
        { binding: 2, resource: { buffer: resources.uniformBuffer } },
      ],
    });

    const flatPass = options.commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: options.accumulationView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: options.clearOutput === false ? 'load' : 'clear',
        storeOp: 'store',
      }],
    });
    flatPass.setPipeline(resources.flatPipeline);
    flatPass.setBindGroup(0, sourceBindGroup);
    flatPass.draw(6);
    flatPass.end();

    if (params.particleCount > 0) {
      const particlePass = options.commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: options.accumulationView,
          loadOp: 'load',
          storeOp: 'store',
        }],
      });
      particlePass.setPipeline(resources.particlePipeline);
      particlePass.setBindGroup(0, sourceBindGroup);
      particlePass.draw(4, params.particleCount);
      particlePass.end();
    }

    const resolveBindGroup = this.device.createBindGroup({
      layout: resources.bindGroupLayout,
      entries: [
        { binding: 0, resource: options.sampler },
        { binding: 1, resource: options.accumulationView },
        { binding: 2, resource: { buffer: resources.uniformBuffer } },
      ],
    });
    const resolvePass = options.commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: options.outputView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    resolvePass.setPipeline(resources.resolvePipeline);
    resolvePass.setBindGroup(0, resolveBindGroup);
    resolvePass.draw(6);
    resolvePass.end();

    return {
      particleCount: params.particleCount,
      columns: params.columns,
      rows: params.rows,
      cellSize: params.cellSize,
      clampedByBudget: params.clampedByBudget,
    };
  }

  destroy(): void {
    this.resources?.uniformBuffer.destroy();
    this.resources = null;
  }

  private getResources(): ParticleResources {
    if (this.resources) return this.resources;

    const module = this.device.createShaderModule({
      label: 'pixel-particle-disintegrate-shader',
      code: shaderSource,
    });
    const bindGroupLayout = this.device.createBindGroupLayout({
      label: 'pixel-particle-disintegrate-bind-group-layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    const pipelineLayout = this.device.createPipelineLayout({
      label: 'pixel-particle-disintegrate-pipeline-layout',
      bindGroupLayouts: [bindGroupLayout],
    });
    const blend: GPUBlendState = {
      color: {
        srcFactor: 'one',
        dstFactor: 'one-minus-src-alpha',
        operation: 'add',
      },
      alpha: {
        srcFactor: 'one',
        dstFactor: 'one-minus-src-alpha',
        operation: 'add',
      },
    };
    const flatPipeline = this.device.createRenderPipeline({
      label: 'pixel-particle-disintegrate-flat-pipeline',
      layout: pipelineLayout,
      vertex: { module, entryPoint: 'flatVertexMain' },
      fragment: {
        module,
        entryPoint: 'flatFragmentMain',
        targets: [{ format: 'rgba8unorm', blend }],
      },
      primitive: { topology: 'triangle-list' },
    });
    const particlePipeline = this.device.createRenderPipeline({
      label: 'pixel-particle-disintegrate-particle-pipeline',
      layout: pipelineLayout,
      vertex: { module, entryPoint: 'particleVertexMain' },
      fragment: {
        module,
        entryPoint: 'particleFragmentMain',
        targets: [{ format: 'rgba8unorm', blend }],
      },
      primitive: { topology: 'triangle-strip' },
    });
    const resolvePipeline = this.device.createRenderPipeline({
      label: 'pixel-particle-disintegrate-resolve-pipeline',
      layout: pipelineLayout,
      vertex: { module, entryPoint: 'flatVertexMain' },
      fragment: {
        module,
        entryPoint: 'resolveFragmentMain',
        targets: [{ format: 'rgba8unorm' }],
      },
      primitive: { topology: 'triangle-list' },
    });
    const uniformBuffer = this.device.createBuffer({
      label: 'pixel-particle-disintegrate-uniforms',
      size: 128,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.resources = { bindGroupLayout, flatPipeline, particlePipeline, resolvePipeline, uniformBuffer };
    return this.resources;
  }

  private resolveParams(options: PixelParticleDisintegrateRenderOptions): {
    readonly uniformBuffer: ArrayBuffer;
    readonly particleCount: number;
    readonly columns: number;
    readonly rows: number;
    readonly cellSize: number;
    readonly clampedByBudget: boolean;
  } {
    const raw = options.effect.params as Record<string, unknown>;
    const progress = clamp(finiteParam(raw, 'progress', 0), 0, 1);
    const requestedCellSize = clamp(finiteParam(raw, 'cellSize', 8), 1, 256);
    const maxPreviewParticles = Math.floor(clamp(finiteParam(raw, 'maxPreviewParticles', 60000), 1, 1_000_000));
    const maxExportParticles = Math.floor(clamp(finiteParam(raw, 'maxExportParticles', 180000), 1, 1_000_000));
    const hardMaxInstances = Math.floor(clamp(finiteParam(raw, 'maxInstances', 220000), 1, 1_000_000));
    const qualityBudget = options.quality === 'export' ? maxExportParticles : maxPreviewParticles;
    const budget = Math.max(1, Math.min(qualityBudget, hardMaxInstances));
    const initialColumns = Math.max(1, Math.ceil(options.outputWidth / requestedCellSize));
    const initialRows = Math.max(1, Math.ceil(options.outputHeight / requestedCellSize));
    const initialCount = initialColumns * initialRows;
    const clampedByBudget = initialCount > budget;
    const cellSize = clampedByBudget
      ? Math.ceil(requestedCellSize * Math.sqrt(initialCount / budget))
      : requestedCellSize;
    const columns = Math.max(1, Math.ceil(options.outputWidth / cellSize));
    const rows = Math.max(1, Math.ceil(options.outputHeight / cellSize));
    const particleCount = Math.min(columns * rows, budget, hardMaxInstances);
    const flatAlpha = 0;
    const particleAlpha = 1;

    const uniformBuffer = new ArrayBuffer(128);
    const f32 = new Float32Array(uniformBuffer);
    const u32 = new Uint32Array(uniformBuffer);
    f32[0] = progress;
    f32[1] = cellSize;
    f32[2] = clamp(finiteParam(raw, 'particleSize', 1.2), 0.01, 8);
    f32[3] = clamp(finiteParam(raw, 'spread', 0.55), 0, 8);
    f32[4] = clamp(finiteParam(raw, 'depth', 0.45), 0, 8);
    f32[5] = clamp(finiteParam(raw, 'curlStrength', 0.35), 0, 8);
    f32[6] = clamp(finiteParam(raw, 'turbulence', 0.2), 0, 8);
    f32[7] = clamp(finiteParam(raw, 'directionX', 0), -8, 8);
    f32[8] = clamp(finiteParam(raw, 'directionY', -0.25), -8, 8);
    f32[9] = clamp(finiteParam(raw, 'gravity', 0.35), -8, 8);
    f32[10] = clamp(finiteParam(raw, 'spin', 0.7), -16, 16);
    f32[11] = clamp(finiteParam(raw, 'stagger', 0.35), 0, 0.95);
    f32[12] = clamp(finiteParam(raw, 'tail', 0.45), 0.02, 1);
    f32[13] = finiteParam(raw, 'seed', 1);
    f32[14] = Number.isFinite(options.motionTime) ? options.motionTime : 0;
    f32[15] = Math.max(1, options.outputWidth);
    f32[16] = Math.max(1, options.outputHeight);
    u32[17] = columns;
    u32[18] = rows;
    u32[19] = particleCount;
    u32[20] = shapeIndex(raw.shape);
    f32[21] = clamp(finiteParam(raw, 'softness', 0.55), 0, 1);
    f32[22] = flatAlpha;
    f32[23] = particleAlpha;
    f32[24] = clamp(finiteParam(raw, 'gustStrength', 0.75), 0, 2);
    f32[25] = clamp(finiteParam(raw, 'gustScale', 5.5), 0.5, 32);
    f32[26] = clamp(finiteParam(raw, 'windSweep', 0.35), 0, 1);
    f32[27] = clamp(finiteParam(raw, 'releaseContrast', 0.65), 0, 2);

    return { uniformBuffer, particleCount, columns, rows, cellSize, clampedByBudget };
  }
}
