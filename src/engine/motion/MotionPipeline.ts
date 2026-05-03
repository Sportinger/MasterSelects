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
          visibility: GPUShaderStage.FRAGMENT,
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
        },
        fragment: {
          module,
          entryPoint: 'fragmentMain',
          targets: [{ format: MOTION_RENDER_TEXTURE_FORMAT }],
        },
        primitive: {
          topology: 'triangle-list',
        },
      });
    }

    return this.pipeline;
  }
}
