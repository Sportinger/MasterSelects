import type { SourceFrameSurface } from '../../services/mediaRuntime/sourceFrames/SourceFrameReader';

const shader = /* wgsl */`
@group(0) @binding(0) var source: texture_external;
@group(0) @binding(1) var linearSampler: sampler;
override rotation: u32 = 0u;
struct Vertex { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> }
@vertex fn vertex(@builtin(vertex_index) i: u32) -> Vertex {
  let uv = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  return Vertex(vec4<f32>(uv * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0), 0.0, 1.0), uv);
}
@fragment fn fragment(v: Vertex) -> @location(0) vec4<f32> {
  var uv = v.uv;
  if (rotation == 90u) { uv = vec2<f32>(uv.y, 1.0 - uv.x); }
  if (rotation == 180u) { uv = 1.0 - uv; }
  if (rotation == 270u) { uv = vec2<f32>(1.0 - uv.y, uv.x); }
  return textureSampleBaseClampToEdge(source, linearSampler, uv);
}`;

/** Converts the borrowed decoder surface directly into a persistent atlas layer.
 * Resize, container rotation and external-texture color conversion run on WebGPU.
 * Submit before the callback returns: closing the VideoFrame expires its import. */
export class TemporalFrameUploader {
  private pipelines = new Map<number, GPURenderPipeline>();
  private sampler: GPUSampler;
  private module: GPUShaderModule;
  private device: GPUDevice;
  constructor(device: GPUDevice) {
    this.device = device;
    this.sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
    this.module = device.createShaderModule({ label: 'temporal-frame-upload', code: shader });
  }

  upload(surface: SourceFrameSurface, atlas: GPUTexture, layer: number) {
    if (!surface.frame.codedWidth) throw new Error('Temporal source frame was closed before upload.');
    const rotation = ((surface.rotation % 360) + 360) % 360;
    if (![0, 90, 180, 270].includes(rotation)) throw new Error('Unsupported source rotation.');
    let pipeline = this.pipelines.get(rotation);
    if (!pipeline) {
      pipeline = this.device.createRenderPipeline({ label: 'temporal-frame-upload', layout: 'auto',
        vertex: { module: this.module, entryPoint: 'vertex' },
        fragment: { module: this.module, entryPoint: 'fragment', constants: { rotation }, targets: [{ format: 'rgba8unorm' }] },
        primitive: { topology: 'triangle-list' } });
      this.pipelines.set(rotation, pipeline);
    }
    const bindGroup = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: this.device.importExternalTexture({ source: surface.frame, colorSpace: 'srgb' }) },
      { binding: 1, resource: this.sampler },
    ] });
    const encoder = this.device.createCommandEncoder({ label: 'temporal-frame-upload' });
    const pass = encoder.beginRenderPass({ colorAttachments: [{
      view: atlas.createView({ dimension: '2d', baseArrayLayer: layer, arrayLayerCount: 1 }),
      loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0],
    }] });
    pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.draw(3); pass.end();
    this.device.queue.submit([encoder.finish()]);
  }
}
