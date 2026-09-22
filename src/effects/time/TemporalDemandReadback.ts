/** Tiny GPU occupancy readback: two bitsets instead of downloading a full time map. */
export class TemporalDemandReadback {
  private device: GPUDevice;
  private pipeline?: GPUComputePipeline;
  constructor(device: GPUDevice) { this.device = device; }

  encode(encoder: GPUCommandEncoder, demand: GPUTextureView, width: number, height: number,
    samples: number, horizon: number, nearest: boolean) {
    const device = this.device;
    if (!this.pipeline) {
      const module = device.createShaderModule({ code: `
@group(0) @binding(0) var demand: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> used: array<atomic<u32>, 2>;
@group(0) @binding(2) var<uniform> settings: vec4f;
fn mark(index: u32) { atomicOr(&used[index / 32u], 1u << (index % 32u)); }
@compute @workgroup_size(16, 16) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= textureDimensions(demand))) { return; }
  let delay = textureLoad(demand, vec2i(id.xy), 0).z;
  let position = clamp(delay / max(settings.y, 0.00001), 0.0, 1.0) * (settings.x - 1.0);
  if (settings.z > 0.5) { mark(u32(round(position))); return; }
  mark(u32(floor(position)));
  if (fract(position) > 0.0) { mark(min(u32(floor(position)) + 1u, u32(settings.x) - 1u)); }
}` });
      this.pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    }
    const used = device.createBuffer({ size: 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const staging = device.createBuffer({ size: 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const settings = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(settings, 0, new Float32Array([samples, horizon, nearest ? 1 : 0, 0]));
    const bind = device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: demand }, { binding: 1, resource: { buffer: used } }, { binding: 2, resource: { buffer: settings } },
    ] });
    const pass = encoder.beginComputePass(); pass.setPipeline(this.pipeline); pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(height / 16)); pass.end();
    encoder.copyBufferToBuffer(used, 0, staging, 0, 8);
    return async () => {
      try {
        await staging.mapAsync(GPUMapMode.READ);
        const bits = new Uint32Array(staging.getMappedRange());
        const indices = Array.from({ length: samples }, (_, index) => index).filter(index => (bits[index >>> 5] & (1 << (index % 32))) !== 0);
        staging.unmap();
        if (!indices.length) throw new Error('Temporal demand map did not request any source samples.');
        return indices;
      } finally { staging.destroy(); used.destroy(); settings.destroy(); }
    };
  }
}
