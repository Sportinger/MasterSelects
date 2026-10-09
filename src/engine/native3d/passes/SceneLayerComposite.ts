import blendFunctions from '../../../shaders/blendModes.wgsl?raw';
import { BLEND_MODE_MAP } from '../../core/types';
import type { BlendMode } from '../../../types';

export interface SceneLayerCompositeStyle { blendMode?: BlendMode; opacity?: number; time?: number }

// Reuse the editor's canonical blend math, including component blend modes.
const functions = ['Normal', '', '', 'Darken', 'Multiply', 'ColorBurn', 'ClassicColorBurn', 'LinearBurn', 'DarkerColor',
  'Add', 'Lighten', 'Screen', 'ColorDodge', 'ClassicColorDodge', 'LinearDodge', 'LighterColor', 'Overlay', 'SoftLight',
  'HardLight', 'LinearLight', 'VividLight', 'PinLight', 'HardMix', 'Difference', 'ClassicDifference', 'Exclusion',
  'Subtract', 'Divide', 'Hue', 'Saturation', 'Color', 'Luminosity'];
export const SCENE_LAYER_BLEND_CASES = functions.map((name, index) => name
  ? `case ${index}u: { mixed = blend${name}(base, source); }` : '').join('\n');
const SHADER = `${blendFunctions}
fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453); }
struct Params { mode: u32, opacity: f32, time: f32, pad: f32 }
@group(0) @binding(0) var background: texture_2d<f32>;
@group(0) @binding(1) var foreground: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: Params;
@vertex fn vertex(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = array<vec2f, 3>(vec2f(-1., -1.), vec2f(3., -1.), vec2f(-1., 3.)); return vec4f(p[i], 0., 1.);
}
@fragment fn copy(@builtin(position) p: vec4f) -> @location(0) vec4f { return textureLoad(background, vec2i(p.xy), 0); }
@fragment fn composite(@builtin(position) p: vec4f) -> @location(0) vec4f {
  let b = textureLoad(background, vec2i(p.xy), 0);
  let f = textureLoad(foreground, vec2i(p.xy), 0);
  let base = b.rgb / max(b.a, 1e-6);
  let source = f.rgb / max(f.a, 1e-6);
  let alpha = clamp(f.a * params.opacity, 0., 1.);
  if (params.mode >= 32u && params.mode <= 35u) {
    let mask = select(clamp(f.a, 0., 1.), clamp(getLuminosity(source) * f.a, 0., 1.), params.mode == 33u || params.mode == 35u);
    return b * mix(1., select(mask, 1. - mask, params.mode >= 34u), params.opacity);
  }
  if (alpha <= 0.) { return b; }
  if (params.mode == 36u) { return vec4f(b.rgb + f.rgb * params.opacity, min(1., b.a + alpha)); }
  var mixed = source;
  var coverage = alpha;
  switch (params.mode) {
    ${SCENE_LAYER_BLEND_CASES}
    case 1u, 2u: {
      let phase = select(0., floor(params.time * 30.), params.mode == 2u);
      let random = fract(sin(dot(floor(p.xy) + vec2f(phase), vec2f(12.9898, 78.233))) * 43758.5453);
      coverage = select(0., 1., random < alpha);
    }
    default: {}
  }
  // Premultiplied source-over with the blend operation only in overlapping coverage.
  let rgb = (1. - coverage) * b.rgb + coverage * ((1. - b.a) * source + b.a * mixed);
  return vec4f(rgb, coverage + b.a * (1. - coverage));
}`;

/** Isolates a depth-tested scene layer before applying its Transform blend mode. */
export class SceneLayerComposite {
  private device?: GPUDevice;
  private copyPipeline?: GPURenderPipeline;
  private blendPipeline?: GPURenderPipeline;
  private targets?: { width: number; height: number; background: GPUTexture; layer: GPUTexture };

  begin(device: GPUDevice, encoder: GPUCommandEncoder, scene: GPUTextureView, width: number, height: number): GPUTextureView {
    if (this.device !== device) {
      this.dispose(); this.device = device;
      const module = device.createShaderModule({ label: 'scene-layer-blend', code: SHADER });
      const pipeline = (entryPoint: string) => device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vertex' },
        fragment: { module, entryPoint, targets: [{ format: 'rgba16float' }] }, primitive: { topology: 'triangle-list' } });
      this.copyPipeline = pipeline('copy'); this.blendPipeline = pipeline('composite');
    }
    if (!this.targets || this.targets.width !== width || this.targets.height !== height) {
      this.targets?.background.destroy(); this.targets?.layer.destroy();
      const make = () => device.createTexture({ size: [width, height], format: 'rgba16float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
      this.targets = { width, height, background: make(), layer: make() };
    }
    const copy = encoder.beginRenderPass({ colorAttachments: [{ view: this.targets.background.createView(), loadOp: 'clear', storeOp: 'store' }] });
    copy.setPipeline(this.copyPipeline!);
    copy.setBindGroup(0, device.createBindGroup({ layout: this.copyPipeline!.getBindGroupLayout(0), entries: [{ binding: 0, resource: scene }] }));
    copy.draw(3); copy.end();
    const view = this.targets.layer.createView();
    const clear = encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] });
    clear.end(); return view;
  }

  end(encoder: GPUCommandEncoder, scene: GPUTextureView, style: SceneLayerCompositeStyle, temporaryBuffers: GPUBuffer[]): void {
    const device = this.device!;
    const data = new ArrayBuffer(16);
    new Uint32Array(data)[0] = BLEND_MODE_MAP[style.blendMode ?? 'normal'] ?? 0;
    new Float32Array(data).set([Math.max(0, Math.min(1, style.opacity ?? 1)), style.time ?? 0], 1);
    const uniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    temporaryBuffers.push(uniform); device.queue.writeBuffer(uniform, 0, data);
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: scene, loadOp: 'load', storeOp: 'store' }] });
    pass.setPipeline(this.blendPipeline!);
    pass.setBindGroup(0, device.createBindGroup({ layout: this.blendPipeline!.getBindGroupLayout(0), entries: [
      { binding: 0, resource: this.targets!.background.createView() }, { binding: 1, resource: this.targets!.layer.createView() },
      { binding: 2, resource: { buffer: uniform } },
    ] }));
    pass.draw(3); pass.end();
  }

  dispose(): void { this.targets?.background.destroy(); this.targets?.layer.destroy(); this.targets = undefined; this.device = undefined; }
}
