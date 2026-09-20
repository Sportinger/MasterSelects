import type { PreviewFrame, PreviewRequest } from './previewTypes';
import { prefersSoftwareTimelineCanvas } from '../../utils/canvasPlatform';

const SHADER = `
struct V { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
  let p = array<vec2f, 3>(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
  var v: V; v.position = vec4f(p[i],0,1); v.uv = vec2f((p[i].x+1)*0.5, (1-p[i].y)*0.5); return v;
}
@group(0) @binding(0) var s: sampler;
@group(0) @binding(1) var t: texture_2d<f32>;
@fragment fn fs(v: V) -> @location(0) vec4f { return textureSample(t,s,v.uv); }
`;
interface Consumer { request: PreviewRequest; resolve: (frame: PreviewFrame) => void }
interface Demand { request: PreviewRequest; consumers: Consumer[]; timeout: ReturnType<typeof setTimeout> }
interface Captured { demand: Demand; x: number; y: number; width: number; height: number; aspectRatio: number }

/** Same-device GPU downsampling, followed by a bounded batch of transferable thumbnails.
 * Texture views stay with their device. No full-resolution readPixels/mapAsync path.
 */
export class NodePreviewTextureTap {
  private demands = new Map<string, Demand>();
  private device?: GPUDevice;
  private canvas?: OffscreenCanvas;
  private context?: GPUCanvasContext;
  private pipeline?: GPURenderPipeline;
  private preparing = false;
  private batch: Captured[] = [];
  private batchView?: GPUTextureView;
  private busy = false;
  private generation = 0;
  private transparent?: GPUTexture;
  has(stage: string) { return this.demands.has(stage); }
  matching(prefix: string) { return [...this.demands].filter(([stage]) => stage.startsWith(prefix)).map(([stage, demand]) => ({ stage, request: demand.request })); }
  transparentView(device: GPUDevice) {
    this.transparent ??= device.createTexture({ label: 'node-preview-transparent', size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING });
    return this.transparent.createView();
  }

  request(stage: string, request: PreviewRequest): Promise<PreviewFrame> {
    const previous = this.demands.get(stage);
    if (previous && previous.consumers.length < 8) return new Promise(resolve => {
      previous.consumers.push({ request, resolve });
      if (request.width * request.height > previous.request.width * previous.request.height) previous.request = request;
    });
    if (previous || this.demands.size >= 8) return Promise.resolve(this.empty(request, 'Waiting for render'));
    return new Promise(resolve => {
      const timeout = setTimeout(() => {
        const demand = this.demands.get(stage);
        if (!demand) return;
        this.demands.delete(stage);
        this.resolveEmpty(demand, 'No rendered output at this time');
        this.releaseWhenIdle();
      }, 350);
      this.demands.set(stage, { request, consumers: [{ request, resolve }], timeout }); this.wake();
    });
  }
  private resolveEmpty(demand: Demand, label: string) {
    for (const consumer of demand.consumers) consumer.resolve(this.empty(consumer.request, label));
  }
  private empty(request: PreviewRequest, label: string): PreviewFrame {
    return { key: request.key, revision: request.revision, time: request.time, status: 'missing', label };
  }
  private wake() {
    void import('../../engine/WebGPUEngine').then(({ engine }) => engine.requestRender()).catch(() => {});
  }
  private prepare(device: GPUDevice) {
    if (this.preparing || prefersSoftwareTimelineCanvas() || typeof OffscreenCanvas === 'undefined') return;
    if (this.device && this.device !== device) this.releaseGraphics();
    this.device = device; this.preparing = true;
    const generation = this.generation;
    try {
      const shader = device.createShaderModule({ label: 'node-preview-downsample', code: SHADER });
      void device.createRenderPipelineAsync({ label: 'node-preview-downsample', layout: 'auto',
        vertex: { module: shader, entryPoint: 'vs' }, fragment: { module: shader, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
        primitive: { topology: 'triangle-list' } }).then(pipeline => {
        if (generation !== this.generation) return;
        const canvas = new OffscreenCanvas(1024, 512), context = canvas.getContext('webgpu');
        if (!context) throw new Error('Preview GPU canvas unavailable');
        context.configure({ device, format: 'rgba8unorm', alphaMode: 'premultiplied' });
        this.canvas = canvas; this.context = context; this.pipeline = pipeline; this.preparing = false;
        void device.lost.then(() => { if (this.device === device) this.releaseGraphics(); });
        this.wake();
      }).catch(() => { this.preparing = false; });
    } catch { this.preparing = false; }
  }

  capture(stage: string, device: GPUDevice, encoder: GPUCommandEncoder, sampler: GPUSampler,
    view: GPUTextureView, sourceWidth: number, sourceHeight: number) {
    this.draw(stage, device, encoder, sourceWidth, sourceHeight, pass => {
      const bind = device.createBindGroup({ layout: this.pipeline!.getBindGroupLayout(0), entries: [{ binding: 0, resource: sampler }, { binding: 1, resource: view }] });
      pass.setPipeline(this.pipeline!); pass.setBindGroup(0, bind); pass.draw(3);
    });
  }
  draw(stage: string, device: GPUDevice, encoder: GPUCommandEncoder, sourceWidth: number, sourceHeight: number, draw: (pass: GPURenderPassEncoder) => void) {
    const demand = this.demands.get(stage);
    if (!demand || this.busy || this.batch.length >= 8) return;
    if (this.device !== device || !this.pipeline || !this.context) { this.prepare(device); return; }
    try {
      const index = this.batch.length, x = index % 4 * 256, y = Math.floor(index / 4) * 256;
      const aspectRatio = sourceWidth / Math.max(1, sourceHeight);
      const scale = Math.min(demand.request.width / Math.max(1, sourceWidth), demand.request.height / Math.max(1, sourceHeight), 256 / Math.max(1, sourceWidth, sourceHeight));
      const width = Math.max(1, Math.round(sourceWidth * scale)), height = Math.max(1, Math.round(sourceHeight * scale));
      this.batchView ??= this.context.getCurrentTexture().createView();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.batchView, loadOp: index ? 'load' : 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] });
      try { pass.setViewport(x, y, width, height, 0, 1); pass.setScissorRect(x, y, width, height); draw(pass); }
      finally { pass.end(); }
      this.demands.delete(stage); clearTimeout(demand.timeout);
      this.batch.push({ demand, x, y, width, height, aspectRatio });
      if (!index) {
        // The owner's synchronous render submits the encoder before this microtask.
        queueMicrotask(() => this.flush());
      }
    } catch { this.demands.delete(stage); clearTimeout(demand.timeout); this.resolveEmpty(demand, 'Preview unavailable'); }
  }

  private async flush() {
    if (!this.batch.length || this.busy || !this.device || !this.canvas) return;
    this.busy = true;
    const batch = this.batch; this.batch = []; this.batchView = undefined;
    const generation = this.generation;
    let atlas: ImageBitmap | undefined;
    try {
      await this.device.queue.onSubmittedWorkDone();
      if (generation !== this.generation || !this.canvas) throw new Error('Preview device changed');
      atlas = this.canvas.transferToImageBitmap();
      for (const tile of batch) {
        for (const consumer of tile.demand.consumers) {
          const request = consumer.request;
          const bitmap = await createImageBitmap(atlas, tile.x, tile.y, tile.width, tile.height);
          consumer.resolve({ key: request.key, revision: request.revision, time: request.time, status: 'live', label: 'Rendered output', bitmap, aspectRatio: tile.aspectRatio });
        }
      }
    } catch { for (const tile of batch) this.resolveEmpty(tile.demand, 'Preview unavailable'); }
    finally { atlas?.close(); this.busy = false; this.releaseWhenIdle(); }
  }
  private idleTimer?: ReturnType<typeof setTimeout>;
  private releaseWhenIdle() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => { if (!this.demands.size && !this.busy) this.releaseGraphics(); }, 2000);
  }
  cancelClip(clipId: string) {
    for (const [key, demand] of this.demands) if (demand.request.clipId === clipId) {
      clearTimeout(demand.timeout); this.resolveEmpty(demand, 'Preview paused'); this.demands.delete(key);
    }
    this.releaseWhenIdle();
  }
  private releaseGraphics() {
    this.generation++; this.context?.unconfigure(); this.canvas = undefined; this.context = undefined; this.pipeline = undefined; this.device = undefined; this.preparing = false;
    this.transparent?.destroy(); this.transparent = undefined;
  }
}

const hot = import.meta.hot?.data as { nodePreviewTextureTap?: NodePreviewTextureTap } | undefined;
export const nodePreviewTextureTap = hot?.nodePreviewTextureTap ?? new NodePreviewTextureTap();
if (hot?.nodePreviewTextureTap) Object.setPrototypeOf(nodePreviewTextureTap, NodePreviewTextureTap.prototype);
if (import.meta.hot) import.meta.hot.dispose(data => { data.nodePreviewTextureTap = nodePreviewTextureTap; });
