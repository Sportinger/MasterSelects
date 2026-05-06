import shaderSource from './shaders/motionShapes.wgsl?raw';
import { MOTION_RENDER_TEXTURE_FORMAT } from './MotionTypes';

export class MotionPipeline {
  private device: GPUDevice;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private pipeline: GPURenderPipeline | null = null;

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
            arrayStride: 4 * 4,
            stepMode: 'instance',
            attributes: [{
              shaderLocation: 0,
              offset: 0,
              format: 'float32x4',
            }],
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
}
