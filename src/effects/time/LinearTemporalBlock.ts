import type { SourceFrameLease } from '../../services/mediaRuntime/sourceFrames/SourceFrameService';
import type { SourceFrameReader } from '../../services/mediaRuntime/sourceFrames/SourceFrameReader';
import { TemporalFrameUploader } from '../../engine/texture/TemporalFrameUploader';
import type { SourceTemporalRequest } from './SourceTemporalRuntime';
import { LinearTemporalBlockGpu } from './LinearTemporalBlockGpu';
import { linearTemporalBlockPlan, linearTemporalStrips, type ScanAxis } from './linearTemporalBlockPlan';
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
  private allocationLimit = 100;
  private gpu: LinearTemporalBlockGpu;
  private device: GPUDevice;
  constructor(device: GPUDevice) { this.device = device; this.gpu = new LinearTemporalBlockGpu(device); }
  get count() { return this.tiles.length; }

  find(identity: string, localTime: number) {
    return this.ready && this.identity === identity
      ? this.tiles.find(tile => Math.abs(tile.localTime - localTime) < 1e-7) : undefined;
  }

  async prepare(identity: string, request: SourceTemporalRequest, reader: SourceFrameReader, lease: SourceFrameLease,
    uploader: TemporalFrameUploader, axis: ScanAxis, step: number, count: number, signal: AbortSignal, check: () => void) {
    await this.clear(); check();
    const { width, height } = request.currentInput!;
    const plan = linearTemporalBlockPlan(request, reader.frames, step, Math.min(count, this.allocationLimit));
    await this.allocate(plan, width, height, check);
    this.identity = identity;
    const clear = this.device.createCommandEncoder();
    for (const tile of this.tiles) clear.beginRenderPass({ colorAttachments: [{ view: tile.texture.createView(),
      loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] }).end();
    this.device.queue.submit([clear.finish()]);
    const delay = request.horizon / (request.timeFactor ?? 1);
    // Build the reverse relation once: source PTS -> destination strips.
    const destinations = new Map<number, { tile: Tile; group: number; rect: [number, number, number, number] }[]>();
    for (const tile of this.tiles) {
      const strips = linearTemporalStrips(tile.data, delay, axis, width, height);
      tile.times.forEach((time, index) => {
        const rect = strips.get(index + 1);
        if (!rect) return;
        const list = destinations.get(time) ?? [];
        list.push({ tile, group: index + 1, rect }); destinations.set(time, list);
      });
    }
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

  private async allocate(plan: ReturnType<typeof linearTemporalBlockPlan>, width: number, height: number, check: () => void) {
    let count = plan.length;
    for (;;) {
      check();
      this.device.pushErrorScope('out-of-memory'); this.device.pushErrorScope('validation');
      let failure: unknown;
      try {
        for (const frame of plan.slice(0, count)) {
          const texture = this.device.createTexture({ label: 'slit-scan-output-tile', size: [width, height], format: 'rgba16float',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
          let metadata: GPUBuffer;
          try { metadata = this.device.createBuffer({ size: frame.metadata.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }); }
          catch (error) { texture.destroy(); throw error; }
          this.tiles.push({ localTime: frame.localTime, texture, metadata, times: frame.times, data: frame.metadata });
          this.device.queue.writeBuffer(metadata, 0, frame.metadata);
        }
      } catch (error) { failure = error; }
      // Pop before awaiting, so unrelated renders cannot enter these scopes.
      const [validation, outOfMemory] = await Promise.all([this.device.popErrorScope(), this.device.popErrorScope()]);
      if (!failure && !validation && !outOfMemory) { check(); return; }
      await this.clear(); check();
      if (failure) throw failure;
      if (validation) throw new Error(`Temporal output block: ${validation.message}`);
      if (count <= 1) throw new Error(`Temporal output block: ${outOfMemory!.message}`);
      count = Math.max(1, Math.floor(count / 2));
      this.allocationLimit = count;
    }
  }

  clear() {
    const retired = this.tiles; this.tiles = []; this.ready = false; this.identity = undefined;
    return this.device.queue.onSubmittedWorkDone().finally(() => retired.forEach(tile => { tile.texture.destroy(); tile.metadata.destroy(); }));
  }
}
