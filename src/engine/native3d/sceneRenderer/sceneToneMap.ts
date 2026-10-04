import { createCompositeResources, type CompositeResources } from './pipelineResources';
import {
  DEFAULT_CAMERA_LENS,
  resolveToneMapping,
  TONE_MAPPING_CODE,
  type CameraLensSettings,
  type RenderEngine,
} from '../pathtrace/contracts/ptTypes';

/** Exposure scale and tone mapping code the scene to compositor transform uses. */
export function sceneToneParams(lens: CameraLensSettings | undefined, engine: RenderEngine): Float32Array<ArrayBuffer> {
  const settings = lens ?? DEFAULT_CAMERA_LENS;
  return Float32Array.of(2 ** settings.exposure, TONE_MAPPING_CODE[resolveToneMapping(settings.toneMapping, engine)], 0, 0);
}

/**
 * Exposes and tone maps the HDR scene target into the 8-bit display texture of a scene target, the
 * texture the compositor samples (SceneTextureComposite.wgsl). One uniform buffer per target key.
 */
export class SceneToneMap {
  private device: GPUDevice | null = null;
  private resources: CompositeResources | null = null;
  private readonly uniforms = new Map<string, GPUBuffer>();

  render(device: GPUDevice, encoder: GPUCommandEncoder, targetKey: string, hdr: GPUTextureView, display: GPUTextureView,
    lens: CameraLensSettings | undefined, engine: RenderEngine): void {
    if (this.device !== device) {
      this.dispose();
      this.device = device;
      this.resources = createCompositeResources(device);
    }
    let uniform = this.uniforms.get(targetKey);
    if (!uniform) {
      uniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: `native-scene-tone-${targetKey}` });
      this.uniforms.set(targetKey, uniform);
    }
    device.queue.writeBuffer(uniform, 0, sceneToneParams(lens, engine));
    const { pipeline, bindGroupLayout } = this.resources!;
    const pass = encoder.beginRenderPass({ label: 'native-scene-tone-map',
      colorAttachments: [{ view: display, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, device.createBindGroup({ layout: bindGroupLayout, entries: [
      { binding: 0, resource: hdr }, { binding: 1, resource: { buffer: uniform } },
    ] }));
    pass.draw(3);
    pass.end();
  }

  releaseTarget(targetKey: string): void {
    this.uniforms.get(targetKey)?.destroy();
    this.uniforms.delete(targetKey);
  }

  dispose(): void {
    for (const buffer of this.uniforms.values()) buffer.destroy();
    this.uniforms.clear();
    this.resources = null;
    this.device = null;
  }
}
