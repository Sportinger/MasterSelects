import type { SourceFrameLease } from '../../services/mediaRuntime/sourceFrames/SourceFrameService';
import type { SourceFrameReader } from '../../services/mediaRuntime/sourceFrames/SourceFrameReader';
import { TemporalFrameUploader } from '../../engine/texture/TemporalFrameUploader';
import type { SourceTemporalRequest } from './SourceTemporalRuntime';
import { LinearTemporalBlockGpu } from './LinearTemporalBlockGpu';
import { linearTemporalBlockPlan, linearTemporalStrip, type ScanAxis } from './linearTemporalBlockPlan';
import { setTemporalStatus } from './temporalResourcePreparation';

interface Tile { localTime: number; texture: GPUTexture; metadata: GPUBuffer; times: number[]; data: Float32Array }

/** One decoded source contributes to every output tile before its borrow expires.
 * Only historical contributions are cached. The actual current input is added
 * when each output is consumed, preserving earlier effects and frame ownership.
 */
export class LinearTemporalBlock {
  private tiles: Tile[] = [];
  private identity?: string;
  private ready = false;
  private gpu: LinearTemporalBlockGpu;
  private device: GPUDevice;
  constructor(device: GPUDevice) { this.device = device; this.gpu = new LinearTemporalBlockGpu(device); }

  find(identity: string, localTime: number) {
    return this.ready && this.identity === identity
      ? this.tiles.find(tile => Math.abs(tile.localTime - localTime) < 1e-7) : undefined;
  }

  async prepare(identity: string, request: SourceTemporalRequest, reader: SourceFrameReader, lease: SourceFrameLease,
    uploader: TemporalFrameUploader, axis: ScanAxis, step: number, count: number, signal: AbortSignal, check: () => void) {
    await this.clear(); check(); this.identity = identity;
    const { width, height } = request.currentInput!;
    const plan = linearTemporalBlockPlan(request, reader.frames, step, count);
    this.tiles = plan.map(frame => {
      const texture = this.device.createTexture({ label: 'slit-scan-output-tile', size: [width, height], format: 'rgba16float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      const metadata = this.device.createBuffer({ size: frame.metadata.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.device.queue.writeBuffer(metadata, 0, frame.metadata);
      return { localTime: frame.localTime, texture, metadata, times: frame.times, data: frame.metadata };
    });
    const clear = this.device.createCommandEncoder();
    for (const tile of this.tiles) clear.beginRenderPass({ colorAttachments: [{ view: tile.texture.createView(),
      loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] }).end();
    this.device.queue.submit([clear.finish()]);
    const delay = request.horizon / (request.timeFactor ?? 1);
    // Build the reverse relation once: source PTS -> destination strips.
    const destinations = new Map<number, { tile: Tile; group: number; rect: [number, number, number, number] }[]>();
    for (const tile of this.tiles) tile.times.forEach((time, index) => {
      const rect = linearTemporalStrip(tile.data, index + 1, delay, axis, width, height);
      if (!rect) return;
      const list = destinations.get(time) ?? [];
      list.push({ tile, group: index + 1, rect }); destinations.set(time, list);
    });
    const times = [...destinations.keys()].toSorted((a, b) => a - b);
    let decoded = 0;
    if (times.length) await lease.request({ times, priority: 'required', signal, onFrame: frame => {
      check();
      const targets = destinations.get(frame.time);
      if (!targets) throw new Error('Unexpected source PTS in temporal output block.');
      const rotation = ((frame.rotation % 360) + 360) % 360;
      if (![0, 90, 180, 270].includes(rotation)) throw new Error('Unsupported source rotation.');
      const source = uploader.importVideo(frame), encoder = this.device.createCommandEncoder();
      const buffers = targets.map(({ tile, group, rect }) =>
        this.gpu.draw(encoder, source, tile.metadata, tile.texture, group, delay, axis, rotation, rect));
      this.device.queue.submit([encoder.finish()]); // Before SourceFrameService closes the borrow.
      void this.device.queue.onSubmittedWorkDone().finally(() => buffers.forEach(buffer => buffer.destroy()));
      if (++decoded % 32 === 0 || decoded === times.length) setTemporalStatus(request.effectId,
        `Hybrid · shared source · ${this.tiles.length} outputs · ${decoded}/${times.length} source frames`);
    } });
    check(); this.ready = true;
  }

  clear() {
    const retired = this.tiles; this.tiles = []; this.ready = false; this.identity = undefined;
    return this.device.queue.onSubmittedWorkDone().finally(() => retired.forEach(tile => { tile.texture.destroy(); tile.metadata.destroy(); }));
  }
}
