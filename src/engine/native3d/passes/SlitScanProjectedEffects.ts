import type { ScenePlaneLayer } from '../../scene/types';
import type { LayerSpaceEffectContext } from '../sceneRenderer/LayerSpaceEffectRenderer';
import { SCENE_COLOR_FORMAT, SCENE_DEPTH_FORMAT } from '../sceneRenderer/constants';
import { SlitScanSurfacePass, type SlitScanSurfaceDraw } from './SlitScanSurfacePass';

const shader = /* wgsl */`
@group(0) @binding(0) var color: texture_2d<f32>;
@group(0) @binding(1) var depth: texture_depth_2d;
@group(0) @binding(2) var<uniform> opacity: vec4f;
@vertex fn vertexMain(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
  return vec4f(p[i],0,1);
}
@fragment fn straight(@builtin(position) p: vec4f) -> @location(0) vec4f {
  let c = textureLoad(color,vec2i(p.xy),0);
  return vec4f(select(vec3f(0),c.rgb/max(c.a,.000001),c.a>0),c.a);
}
struct Composite { @location(0) color: vec4f, @builtin(frag_depth) depth: f32 }
@fragment fn composite(@builtin(position) p: vec4f) -> Composite {
  let c = textureLoad(color,vec2i(p.xy),0);
  let a = clamp(c.a*opacity.x,0,1);
  if (a<=0) { discard; }
  var result: Composite;
  result.color = vec4f(c.rgb*a,a);
  result.depth = textureLoad(depth,vec2i(p.xy),0);
  return result;
}`;

interface Target {
  device: GPUDevice; width: number; height: number;
  textures: GPUTexture[];
  color: GPUTextureView; straight: GPUTextureView; ping: GPUTextureView; pong: GPUTextureView; depth: GPUTextureView;
}

/** Each surface's downstream stack sees its own projected straight-alpha image.
 * Its depth is preserved when that processed image joins the shared scene.
 * New pixels generated outside the mesh (e.g. blur) occupy the far plane.
 */
export class SlitScanProjectedEffects {
  private targets = new Map<string, Target>();
  private device?: GPUDevice;
  private straightPipeline?: GPURenderPipeline;
  private compositePipeline?: GPURenderPipeline;
  private mesh = new SlitScanSurfacePass();

  render(key: string, device: GPUDevice, encoder: GPUCommandEncoder, output: GPUTextureView,
    sceneDepth: GPUTextureView, width: number, height: number, layer: ScenePlaneLayer,
    draw: SlitScanSurfaceDraw, context: LayerSpaceEffectContext, temporary: GPUBuffer[]): void {
    this.initialize(device);
    const target = this.target(key, device, width, height);
    const clear = encoder.beginRenderPass({
      colorAttachments: [{ view: target.color, loadOp: 'clear', storeOp: 'store', clearValue: [0,0,0,0] }],
      depthStencilAttachment: { view: target.depth, depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 },
    });
    clear.end();
    // Opacity is a clip composite property, applied once after the effect stack.
    this.mesh.render(device, encoder, target.color, target.depth, [{ ...draw, opacity: 1 }], temporary);
    const unpremultiply = encoder.beginRenderPass({
      colorAttachments: [{ view: target.straight, loadOp: 'clear', storeOp: 'store', clearValue: [0,0,0,0] }],
    });
    unpremultiply.setPipeline(this.straightPipeline!);
    unpremultiply.setBindGroup(0, device.createBindGroup({ layout: this.straightPipeline!.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: target.color }] }));
    unpremultiply.draw(3); unpremultiply.end();
    const result = context.effectsPipeline.applyEffects(encoder, layer.postProjectionEffects ?? [], context.sampler,
      target.straight, target.ping, target.ping, target.pong, width, height,
      target.textures[2], target.textures[3], undefined, context.timelineTimeSeconds, undefined,
      { ...context.effectRenderClock, frameRate: context.effectRenderClock?.frameRate ?? 30,
        scopeId: JSON.stringify([context.effectRenderClock?.scopeId, key, 'post-projection']) });
    const uniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(uniform, 0, new Float32Array([draw.opacity,0,0,0])); temporary.push(uniform);
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: output, loadOp: 'load', storeOp: 'store' }],
      depthStencilAttachment: { view: sceneDepth, depthLoadOp: 'load', depthStoreOp: 'store' },
    });
    pass.setPipeline(this.compositePipeline!);
    pass.setBindGroup(0, device.createBindGroup({ layout: this.compositePipeline!.getBindGroupLayout(0), entries: [
      { binding: 0, resource: result.finalView }, { binding: 1, resource: target.depth }, { binding: 2, resource: { buffer: uniform } },
    ] }));
    pass.draw(3); pass.end();
  }

  release(key: string): void {
    const target = this.targets.get(key); if (!target) return;
    this.targets.delete(key);
    void Promise.resolve().then(() => target.device.queue.onSubmittedWorkDone()).then(
      () => target.textures.forEach(texture => texture.destroy()),
      () => target.textures.forEach(texture => texture.destroy()));
  }

  destroy(): void {
    for (const key of this.targets.keys()) this.release(key);
    this.mesh.dispose(); this.device = undefined;
    this.straightPipeline = undefined; this.compositePipeline = undefined;
  }

  private target(key: string, device: GPUDevice, width: number, height: number): Target {
    const old = this.targets.get(key);
    if (old?.device === device && old.width === width && old.height === height) return old;
    this.release(key);
    const textures = Array.from({ length: 4 }, () => device.createTexture({ size: [width,height], format: SCENE_COLOR_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC }));
    textures.push(device.createTexture({ size: [width,height], format: SCENE_DEPTH_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING }));
    const [color, straight, ping, pong, depth] = textures.map(texture => texture.createView());
    const result = { device, width, height, textures, color, straight, ping, pong, depth };
    this.targets.set(key,result); return result;
  }

  private initialize(device: GPUDevice): void {
    if (this.device === device) return;
    this.destroy(); this.device = device;
    const module = device.createShaderModule({ code: shader, label: 'slit-scan-projected-effects' });
    const vertex = { module, entryPoint: 'vertexMain' };
    this.straightPipeline = device.createRenderPipeline({ layout: 'auto', vertex,
      fragment: { module, entryPoint: 'straight', targets: [{ format: SCENE_COLOR_FORMAT }] } });
    this.compositePipeline = device.createRenderPipeline({ layout: 'auto', vertex,
      fragment: { module, entryPoint: 'composite', targets: [{ format: SCENE_COLOR_FORMAT,
        blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } }] },
      depthStencil: { format: SCENE_DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less-equal' } });
  }
}
