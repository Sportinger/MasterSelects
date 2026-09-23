import type { SourceFrameResource } from '../../services/mediaRuntime/sourceFrames/SourceFrameService';

const shader = /* wgsl */`
@group(0) @binding(0) var source: texture_external;
@group(0) @binding(1) var linearSampler: sampler;
struct Transform { row0: vec4<f32>, row1: vec4<f32> }
@group(0) @binding(2) var<uniform> transform: Transform;
override rotation: u32 = 0u;
struct Vertex { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> }
@vertex fn vertex(@builtin(vertex_index) i: u32) -> Vertex {
  let uv = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  return Vertex(vec4<f32>(uv * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0), 0.0, 1.0), uv);
}
@fragment fn fragment(v: Vertex) -> @location(0) vec4<f32> {
  let p = vec3<f32>(v.uv, 1.0);
  var uv = vec2<f32>(dot(transform.row0.xyz, p), dot(transform.row1.xyz, p));
  let covered = all(uv >= vec2<f32>(0.0)) && all(uv <= vec2<f32>(1.0));
  if (rotation == 90u) { uv = vec2<f32>(uv.y, 1.0 - uv.x); }
  if (rotation == 180u) { uv = 1.0 - uv; }
  if (rotation == 270u) { uv = vec2<f32>(1.0 - uv.y, uv.x); }
  let color = textureSampleBaseClampToEdge(source, linearSampler, uv);
  return select(vec4<f32>(0.0), color, covered);
}`;

/** Converts the borrowed decoder surface directly into a persistent atlas layer.
 * Resize, container rotation and external-texture color conversion run on WebGPU.
 * Submit before the callback returns: closing the VideoFrame expires its import. */
export class TemporalFrameUploader {
  private pipelines = new Map<string, GPURenderPipeline>();
  private sampler: GPUSampler;
  private module: GPUShaderModule;
  private imageModule: GPUShaderModule;
  private imageTexture?: GPUTexture;
  private transformBuffer: GPUBuffer;
  private device: GPUDevice;
  constructor(device: GPUDevice) {
    this.device = device;
    this.sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
    this.transformBuffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.module = device.createShaderModule({ label: 'temporal-frame-upload', code: shader });
    this.imageModule = device.createShaderModule({ label: 'temporal-proxy-upload', code: shader
      .replace('source: texture_external', 'source: texture_2d<f32>')
      .replace('textureSampleBaseClampToEdge(source, linearSampler, uv)', 'textureSampleLevel(source, linearSampler, uv, 0.0)') });
  }

  upload(surface: SourceFrameResource, atlas: GPUTexture, layer: number, outputToSource?: readonly number[]) {
    const m = outputToSource ?? [1, 0, 0, 0, 1, 0, 0, 0, 1];
    this.device.queue.writeBuffer(this.transformBuffer, 0, new Float32Array([m[0], m[1], m[2], 0, m[3], m[4], m[5], 0]));
    const isImage = 'image' in surface;
    if (!isImage && !surface.frame.codedWidth) throw new Error('Temporal source frame was closed before upload.');
    const rotation = ((surface.rotation % 360) + 360) % 360;
    if (![0, 90, 180, 270].includes(rotation)) throw new Error('Unsupported source rotation.');
    const key = `${isImage ? 'image' : 'video'}:${rotation}`;
    let pipeline = this.pipelines.get(key);
    if (!pipeline) {
      pipeline = this.device.createRenderPipeline({ label: 'temporal-frame-upload', layout: 'auto',
        vertex: { module: this.module, entryPoint: 'vertex' },
        fragment: { module: isImage ? this.imageModule : this.module, entryPoint: 'fragment', constants: { rotation }, targets: [{ format: 'rgba8unorm' }] },
        primitive: { topology: 'triangle-list' } });
      this.pipelines.set(key, pipeline);
    }
    let resource: GPUTextureView | GPUExternalTexture;
    if (isImage) {
      if (this.imageTexture?.width !== surface.width || this.imageTexture.height !== surface.height) {
        this.imageTexture?.destroy();
        this.imageTexture = this.device.createTexture({ label: 'temporal-proxy-transfer',
          size: [surface.width, surface.height], format: 'rgba8unorm',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
      }
      this.device.queue.copyExternalImageToTexture({ source: surface.image }, { texture: this.imageTexture }, [surface.width, surface.height]);
      resource = this.imageTexture.createView();
    } else resource = this.device.importExternalTexture({ source: surface.frame, colorSpace: 'srgb' });
    const bindGroup = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource },
      { binding: 1, resource: this.sampler },
      { binding: 2, resource: { buffer: this.transformBuffer } },
    ] });
    const encoder = this.device.createCommandEncoder({ label: 'temporal-frame-upload' });
    const pass = encoder.beginRenderPass({ colorAttachments: [{
      view: atlas.createView({ dimension: '2d', baseArrayLayer: layer, arrayLayerCount: 1 }),
      loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0],
    }] });
    pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.draw(3); pass.end();
    this.device.queue.submit([encoder.finish()]);
  }
  destroy() { this.imageTexture?.destroy(); this.imageTexture = undefined; this.transformBuffer.destroy(); }
}
