import shaderSource from './shaders/motionShapes.wgsl?raw';
import { MOTION_RENDER_TEXTURE_FORMAT } from './MotionTypes';
import { MOTION_REPLICATOR_INSTANCE_BYTE_STRIDE } from './replicator/runtimeContracts';

export class MotionPipeline {
  private device: GPUDevice;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private fallbackTexture: GPUTexture | null = null;
  private fallbackView: GPUTextureView | null = null;
  private sampler: GPUSampler | null = null;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  getBindGroupLayout(): GPUBindGroupLayout {
    if (!this.bindGroupLayout) {
      this.bindGroupLayout = this.device.createBindGroupLayout({
        label: 'motion-shape-bind-group-layout',
        entries: [{
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        }, {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d' },
        }, {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' },
        }, {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'read-only-storage' },
        }],
      });
    }

    return this.bindGroupLayout;
  }

  getPipeline(): GPURenderPipeline {
    if (!this.pipeline) {
      const module = this.device.createShaderModule({
        label: 'motion-shape-shader',
        code: shaderSource,
      });
      const layout = this.device.createPipelineLayout({
        label: 'motion-shape-pipeline-layout',
        bindGroupLayouts: [this.getBindGroupLayout()],
      });

      this.pipeline = this.device.createRenderPipeline({
        label: 'motion-shape-pipeline',
        layout,
        vertex: {
          module,
          entryPoint: 'vertexMain',
          buffers: [{
            arrayStride: MOTION_REPLICATOR_INSTANCE_BYTE_STRIDE,
            stepMode: 'instance',
            attributes: [
              {
                shaderLocation: 0,
                offset: 0,
                format: 'float32x4',
              },
              {
                shaderLocation: 1,
                offset: 4 * 4,
                format: 'float32x4',
              },
            ],
          }],
        },
        fragment: {
          module,
          entryPoint: 'fragmentMain',
          targets: [{
            format: MOTION_RENDER_TEXTURE_FORMAT,
            blend: {
              color: {
                operation: 'add',
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
              },
              alpha: {
                operation: 'add',
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
              },
            },
          }],
        },
        primitive: {
          topology: 'triangle-list',
        },
      });
    }

    return this.pipeline;
  }

  getTextureBinding(): { view: GPUTextureView; sampler: GPUSampler } {
    if (!this.fallbackTexture || !this.fallbackView) {
      this.fallbackTexture = this.device.createTexture({
        label: 'motion-shape-transparent-texture',
        size: { width: 1, height: 1 },
        format: MOTION_RENDER_TEXTURE_FORMAT,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      this.fallbackView = this.fallbackTexture.createView();
      this.device.queue.writeTexture?.(
        { texture: this.fallbackTexture },
        new Uint8Array([0, 0, 0, 0]),
        { bytesPerRow: 4 },
        { width: 1, height: 1 },
      );
    }
    this.sampler ??= this.device.createSampler?.({
      label: 'motion-shape-texture-sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    }) ?? {} as GPUSampler;
    return { view: this.fallbackView, sampler: this.sampler };
  }

  destroy(): void {
    this.fallbackTexture?.destroy();
    this.fallbackTexture = null;
    this.fallbackView = null;
    this.sampler = null;
    this.bindGroupLayout = null;
    this.pipeline = null;
  }
}
