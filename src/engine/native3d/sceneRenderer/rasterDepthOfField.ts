import type { SceneCamera } from '../../scene/types';
import type { RenderEngine } from '../../../types/renderSettings';

/** Thin-lens circle-of-confusion radius, in output pixels. A scene unit is one metre. */
export function rasterFocusParams(camera: SceneCamera, engine: RenderEngine): Float32Array | null {
  const fStop = camera.lens?.fStop ?? 0;
  if (engine !== 'raster' || !(fStop > 0) || camera.projection === 'orthographic') return null;
  const a = camera.cameraPosition, b = camera.cameraTarget;
  const focus = camera.lens?.focusDistance || Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const focal = 0.024 / (2 * Math.tan(camera.fov * Math.PI / 360));
  if (!Number.isFinite(focus) || focus <= focal || !Number.isFinite(focal)) return null;
  const coefficient = camera.viewport.height / 0.024 * focal * focal / (2 * fStop * (focus - focal));
  return Float32Array.of(camera.projectionMatrix[10], camera.projectionMatrix[14], focus, coefficient);
}

export function rasterBlurRadius(params: Float32Array, distance: number): number {
  return Math.min(18, Math.abs(params[3] * (distance - params[2]) / Math.max(distance, 1e-5)));
}

const SHADER = /* wgsl */`
@group(0) @binding(0) var color: texture_2d<f32>;
@group(0) @binding(1) var depth: texture_depth_2d;
@group(0) @binding(2) var<uniform> params: array<vec4f, 2>;
@vertex fn vertex(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = array<vec2f, 3>(vec2f(-1., -1.), vec2f(3., -1.), vec2f(-1., 3.));
  return vec4f(p[i], 0., 1.);
}
fn zAt(p: vec2i) -> f32 {
  return abs(params[0].y / min(-1e-7, textureLoad(depth, p, 0) + params[0].x));
}
fn coc(z: f32) -> f32 { return clamp(params[0].w * (z - params[0].z) / max(z, 1e-5), -18., 18.); }
@fragment fn fragment(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let limit = vec2i(textureDimensions(color)) - 1;
  let p = clamp(vec2i(pos.xy), vec2i(0), limit);
  let z = zAt(p);
  let radius = abs(coc(z));
  var sum = vec4f(0.);
  var weight = 0.;
  // A foreground fiber must spread into its clear surroundings, including
  // pixels whose own circle of confusion is zero. Never early-out on center CoC.
  // Two separable gathers bound cost independently of geometry complexity.
  for (var i = -18; i <= 18; i++) {
    let q = clamp(p + vec2i(params[1].xy) * i, vec2i(0), limit);
    let sampleZ = zAt(q);
    let sampleBlur = coc(sampleZ);
    let support = max(0.5, max(radius, -sampleBlur));
    let offset = abs(f32(i));
    if (offset > support) { continue; }
    // A focused occluder is kept out of defocused background gathers. Empty
    // pixels behind a blurred fiber still participate: rejecting them would
    // renormalize thin bright strands back into perfectly sharp lines.
    if (sampleZ < z - max(0.01, z * 0.03) && abs(sampleBlur) + 0.5 < offset) { continue; }
    let w = exp(-2. * f32(i * i) / (support * support)) / support;
    sum += textureLoad(color, q, 0) * w;
    weight += w;
  }
  return sum / max(weight, 1e-7);
}`;

/** Per-scene HDR post pass; f-stop 0 costs nothing. Depth comes from the raster scene. */
export class RasterDepthOfField {
  private device?: GPUDevice;
  private pipeline?: GPURenderPipeline;
  private readonly targets = new Map<string, { texture: GPUTexture; view: GPUTextureView; intermediate: GPUTexture; intermediateView: GPUTextureView; uniforms: GPUBuffer[] }>();

  render(device: GPUDevice, encoder: GPUCommandEncoder, key: string, color: GPUTextureView,
    depth: GPUTextureView, camera: SceneCamera, engine: RenderEngine): GPUTextureView {
    const params = rasterFocusParams(camera, engine);
    if (!params) { this.releaseTarget(key); return color; }
    if (this.device !== device) {
      this.dispose(); this.device = device;
      const module = device.createShaderModule({ label: 'raster-depth-of-field', code: SHADER });
      this.pipeline = device.createRenderPipeline({ label: 'raster-depth-of-field', layout: 'auto',
        vertex: { module, entryPoint: 'vertex' }, fragment: { module, entryPoint: 'fragment', targets: [{ format: 'rgba16float' }] },
        primitive: { topology: 'triangle-list' } });
    }
    const { width, height } = camera.viewport;
    let target = this.targets.get(key);
    if (target && (target.texture.width !== width || target.texture.height !== height)) { this.releaseTarget(key); target = undefined; }
    if (!target) {
      const texture = device.createTexture({ label: 'raster-dof-color', size: [width, height], format: 'rgba16float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
      const intermediate = device.createTexture({ label: 'raster-dof-horizontal', size: [width, height], format: 'rgba16float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
      target = { texture, view: texture.createView(), intermediate, intermediateView: intermediate.createView(),
        uniforms: [0, 1].map(() => device.createBuffer({ label: 'raster-dof-lens', size: 32,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })) };
      this.targets.set(key, target);
    }
    for (let axis = 0; axis < 2; axis++) {
      const uniform = Float32Array.of(...params, axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, 0, 0);
      device.queue.writeBuffer(target.uniforms[axis], 0, uniform);
      const pass = encoder.beginRenderPass({ label: 'raster-depth-of-field', colorAttachments: [{
        view: axis === 0 ? target.intermediateView : target.view,
        loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] });
      pass.setPipeline(this.pipeline!);
      pass.setBindGroup(0, device.createBindGroup({ layout: this.pipeline!.getBindGroupLayout(0), entries: [
        { binding: 0, resource: axis === 0 ? color : target.intermediateView }, { binding: 1, resource: depth },
        { binding: 2, resource: { buffer: target.uniforms[axis] } },
      ] }));
      pass.draw(3); pass.end();
    }
    return target.view;
  }

  releaseTarget(key: string): void { const t = this.targets.get(key); t?.texture.destroy(); t?.intermediate.destroy(); t?.uniforms.forEach(buffer => buffer.destroy()); this.targets.delete(key); }
  dispose(): void { for (const key of this.targets.keys()) this.releaseTarget(key); this.pipeline = undefined; this.device = undefined; }
}
