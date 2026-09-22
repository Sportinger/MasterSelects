import commonShader from '../_shared/commonShader';
import { InputHistoryClock, inputHistorySize } from './InputHistoryClock';
import type { EffectFrameHistoryContext } from '../EffectsPipeline';

interface HistoryEntry {
  atlas: GPUTexture; ages: GPUTexture; atlasView: GPUTextureView; agesView: GPUTextureView;
  width: number; height: number; clock: InputHistoryClock; used: number; revision: number;
  encoder?: GPUCommandEncoder;
}

/** Device-local bounded input history, shared by the effect's graph and node previews. */
export class InputHistoryRuntime {
  private entries = new Map<string, HistoryEntry>();
  private pipeline?: GPURenderPipeline;
  private empty?: { atlas: GPUTexture; ages: GPUTexture };
  private device: GPUDevice;
  constructor(device: GPUDevice) { this.device = device; }

  prepare(key: string, encoder: GPUCommandEncoder, source: GPUTextureView, sampler: GPUSampler,
    width: number, height: number, time: number, horizon: number, context?: EffectFrameHistoryContext, interpolation = 'linear', fullResolution = false) {
    const [w, h] = fullResolution ? [width, height] : inputHistorySize(width, height, 160);
    const bytes = w * h * 64 * 4;
    const budget = 512 * 1024 * 1024;
    if (bytes > budget) throw new Error('Full-resolution rolling history exceeds 512 MiB. Use Live preview for playback at this resolution.');
    let state = this.entries.get(key);
    if (state && (state.width !== w || state.height !== h)) { this.remove(key); state = undefined; }
    if (!state) {
      while ([...this.entries.values()].reduce((sum, entry) => sum + entry.width * entry.height * 64 * 4, 0) + bytes > budget) {
        const old = [...this.entries].find(([, entry]) => entry.encoder !== encoder);
        if (!old) throw new Error('Simultaneous rolling histories exceed the 512 MiB budget.');
        this.remove(old[0]);
      }
      // Four tiny live-history owners: at most 25 MiB, independent of source resolution.
      if (this.entries.size >= 4) {
        const oldest = [...this.entries].filter(([, entry]) => entry.encoder !== encoder)
          .toSorted((a, b) => a[1].used - b[1].used)[0];
        // Never destroy textures referenced by this still-unsubmitted frame.
        // Additional simultaneous owners resolve to their current input.
        if (!oldest) return this.emptyResources();
        this.remove(oldest[0]);
      }
      const atlas = this.device.createTexture({ label: 'input-history-atlas', size: [w, h, 64], format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
      const ages = this.device.createTexture({ label: 'input-history-ages', size: [65, 1], format: 'rgba32float',
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
      state = { atlas, ages, atlasView: atlas.createView({ dimension: '2d-array' }), agesView: ages.createView(), width: w, height: h,
        clock: new InputHistoryClock(), used: 0, revision: 0 };
      this.entries.set(key, state);
    }
    state.used = performance.now();
    state.encoder = encoder;
    if (state.clock.update(time, horizon, context)) {
      if (!this.pipeline) {
        const module = this.device.createShaderModule({ code: `${commonShader}
@group(0) @binding(0) var s: sampler;
@group(0) @binding(1) var source: texture_2d<f32>;
@fragment fn capture(input: VertexOutput) -> @location(0) vec4f { return textureSampleLevel(source, s, input.uv, 0.0); }` });
        this.pipeline = this.device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
          fragment: { module, entryPoint: 'capture', targets: [{ format: 'rgba8unorm' }] }, primitive: { topology: 'triangle-list' } });
      }
      const bind = this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: sampler }, { binding: 1, resource: source },
      ] });
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: state.atlas.createView({ dimension: '2d', baseArrayLayer: state.clock.newest, arrayLayerCount: 1 }), loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(this.pipeline); pass.setBindGroup(0, bind);
      pass.setViewport(0, 0, w, h, 0, 1);
      pass.draw(6); pass.end();
      state.revision++;
    }
    const data = state.clock.metadata(time);
    data[64 * 4 + 2] = interpolation === 'nearest' ? -1 : 0;
    this.device.queue.writeTexture({ texture: state.ages }, data.buffer as ArrayBuffer, { bytesPerRow: 65 * 16 }, [65, 1]);
    const identity = `${key}:${state.revision}:${time}:${interpolation}`;
    return {
      atlas: { view: state.atlasView, identity: `${identity}:atlas` },
      ages: { view: state.agesView, identity: `${identity}:ages` },
    };
  }

  private remove(key: string) {
    const entry = this.entries.get(key); entry?.atlas.destroy(); entry?.ages.destroy(); this.entries.delete(key);
  }
  emptyResources() {
    this.empty ??= {
      atlas: this.device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING }),
      ages: this.device.createTexture({ size: [65, 1], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING }),
    };
    return { atlas: { view: this.empty.atlas.createView({ dimension: '2d-array' }), identity: 'input-history:capacity' },
      ages: { view: this.empty.ages.createView(), identity: 'input-history:capacity' } };
  }
  destroy() {
    for (const key of this.entries.keys()) this.remove(key);
    this.empty?.atlas.destroy(); this.empty?.ages.destroy(); this.empty = undefined; this.pipeline = undefined;
  }
}
