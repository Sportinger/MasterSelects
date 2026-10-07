// Frame-scoped GPU buffers for per-draw / per-dispatch data.
//
// `queue.writeBuffer()` is staged on the queue timeline before the command buffer it is
// meant for gets submitted. A single buffer that is rewritten between draws or dispatches
// recorded into one command encoder therefore hands every recorded pass the LAST written
// payload (two layers of one effect both render with the second layer's settings). And
// destroying a buffer that an unsubmitted encoder still references makes the whole submit
// fail. Every GPU node that writes per-draw data takes its buffers from these helpers
// instead of owning one shared buffer:
//
// - `GpuUniformRing`: `write()` hands out a distinct buffer per call within a frame, the
//   cursor rewinds at the next frame start, and the pool grows when a frame needs more
//   slots than it holds. A slot is never handed out twice in one frame.
// - `GpuFrameBuffers`: keyed buffers that grow by replacement (vertex buffers per output
//   target, index/counter buffers sized to the largest layer). A replaced buffer is
//   retired and destroyed at the next frame start, never while this frame can use it.
//
// Frame boundaries come in two modes:
// - 'explicit' (default): the owner calls `beginFrame()` and guarantees that every command
//   buffer recorded since the previous call has been submitted (or dropped).
// - 'task': for nodes reached from many frame owners without a common begin hook. The
//   frame ends with the current synchronous JS section (microtask checkpoint), relying on
//   the engine-wide rule that a command encoder is recorded and submitted without an
//   `await` in between. The first use in the next section starts a new frame.

import { Logger } from '../../services/logger';

const log = Logger.create('GpuUniformRing');

export type GpuFrameMode = 'explicit' | 'task';

/**
 * Slots per ring after which a missing frame start is assumed and reported once. Large:
 * a GPU bitonic sort legitimately takes a few hundred slots per splat layer and frame.
 */
const SLOT_WARNING_THRESHOLD = 8192;

/** Retirement and frame tracking shared by the ring and the keyed buffers. */
abstract class GpuFrameScope {
  protected readonly device: GPUDevice;
  readonly label: string;
  private readonly frameMode: GpuFrameMode;
  private retired: GPUBuffer[] = [];
  private taskFrameOpen = false;

  protected constructor(device: GPUDevice, label: string, frameMode: GpuFrameMode = 'explicit') {
    this.device = device;
    this.label = label;
    this.frameMode = frameMode;
  }

  /**
   * Start a new frame: destroy retired buffers and rewind per-frame state. The caller
   * guarantees that everything recorded with this scope's buffers has been submitted.
   */
  beginFrame(): void {
    const retired = this.retired;
    this.retired = [];
    for (const buffer of retired) buffer.destroy();
    this.onFrameStart();
  }

  /** Destroy `buffer` at the next frame start; commands recorded this frame may still use it. */
  retire(buffer: GPUBuffer | null | undefined): void {
    if (buffer) this.retired.push(buffer);
  }

  /** Number of buffers waiting for the next frame start. */
  get retiredCount(): number {
    return this.retired.length;
  }

  /** Destroy everything now. Only valid after the owner's last submit. */
  dispose(): void {
    for (const buffer of this.retired) buffer.destroy();
    this.retired = [];
    this.taskFrameOpen = false;
    this.onDispose();
  }

  /** Called before handing out a buffer; opens a new frame in 'task' mode. */
  protected enterFrame(): void {
    if (this.frameMode !== 'task' || this.taskFrameOpen) return;
    this.beginFrame();
    this.taskFrameOpen = true;
    queueMicrotask(() => {
      this.taskFrameOpen = false;
    });
  }

  protected abstract onFrameStart(): void;
  protected abstract onDispose(): void;
}

export interface GpuUniformRingOptions {
  /** Buffer label prefix; slots are labelled `${label}-${index}`. */
  label: string;
  /** Bytes per slot. Every write must fit. */
  size: number;
  /** Defaults to `UNIFORM | COPY_DST`. */
  usage?: GPUBufferUsageFlags;
  /** Defaults to 'explicit'. */
  frame?: GpuFrameMode;
}

/** Distinct buffer per write within a frame, rewound at the next frame start. */
export class GpuUniformRing extends GpuFrameScope {
  readonly size: number;
  private readonly usage: GPUBufferUsageFlags;
  private readonly slots: GPUBuffer[] = [];
  private cursor = 0;
  private warnedAboutGrowth = false;

  constructor(device: GPUDevice, options: GpuUniformRingOptions) {
    super(device, options.label, options.frame);
    if (!(options.size > 0)) throw new RangeError(`GpuUniformRing ${options.label} needs a positive slot size.`);
    this.size = options.size;
    this.usage = options.usage ?? (GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  }

  /** Write `data` into a slot nothing else in this frame uses and return that slot. */
  write(data: GPUAllowSharedBufferSource): GPUBuffer {
    if (data.byteLength > this.size) {
      throw new RangeError(`GpuUniformRing ${this.label}: ${data.byteLength} bytes exceed the ${this.size}-byte slot.`);
    }
    const buffer = this.acquire();
    this.device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  }

  /** Reserve a slot for this frame without writing it (for callers that fill it themselves). */
  acquire(): GPUBuffer {
    this.enterFrame();
    const index = this.cursor++;
    const existing = this.slots[index];
    if (existing) return existing;
    const buffer = this.device.createBuffer({ label: `${this.label}-${index}`, size: this.size, usage: this.usage });
    this.slots[index] = buffer;
    if (this.slots.length > SLOT_WARNING_THRESHOLD && !this.warnedAboutGrowth) {
      this.warnedAboutGrowth = true;
      log.warn('Uniform ring grew past its warning threshold; is beginFrame() missing for this owner?', {
        label: this.label,
        slots: this.slots.length,
      });
    }
    return buffer;
  }

  /** Slots handed out since the current frame started. */
  get frameSlotCount(): number {
    return this.cursor;
  }

  /** Slots allocated so far (the largest frame seen). */
  get slotCount(): number {
    return this.slots.length;
  }

  protected onFrameStart(): void {
    this.cursor = 0;
  }

  protected onDispose(): void {
    for (const buffer of this.slots) buffer.destroy();
    this.slots.length = 0;
    this.cursor = 0;
  }
}

export function createGpuUniformRing(device: GPUDevice, options: GpuUniformRingOptions): GpuUniformRing {
  return new GpuUniformRing(device, options);
}

export interface GpuFrameBuffersOptions {
  /** Buffer label prefix; buffers are labelled `${label}-${key}`. */
  label: string;
  usage: GPUBufferUsageFlags;
  /** Defaults to 'explicit'. */
  frame?: GpuFrameMode;
  /** Bytes to allocate when a key needs a larger buffer (e.g. power-of-two growth). */
  capacity?: (byteSize: number) => number;
}

interface FrameBufferEntry {
  buffer: GPUBuffer;
  size: number;
}

/**
 * Keyed buffers that only grow. Growing replaces the buffer; the old one is retired and
 * destroyed at the next frame start, so passes recorded earlier this frame stay valid.
 */
export class GpuFrameBuffers extends GpuFrameScope {
  private readonly usage: GPUBufferUsageFlags;
  private readonly capacity: (byteSize: number) => number;
  private readonly entries = new Map<string, FrameBufferEntry>();

  constructor(device: GPUDevice, options: GpuFrameBuffersOptions) {
    super(device, options.label, options.frame);
    this.usage = options.usage;
    this.capacity = options.capacity ?? ((byteSize) => byteSize);
  }

  /** Buffer for `key` holding at least `byteSize` bytes. */
  ensure(key: string, byteSize: number): GPUBuffer {
    this.enterFrame();
    const current = this.entries.get(key);
    if (current && current.size >= byteSize) return current.buffer;
    this.retire(current?.buffer);
    const size = alignTo4(Math.max(byteSize, this.capacity(byteSize), 4));
    const buffer = this.device.createBuffer({ label: `${this.label}-${key}`, size, usage: this.usage });
    this.entries.set(key, { buffer, size });
    return buffer;
  }

  get(key: string): GPUBuffer | undefined {
    return this.entries.get(key)?.buffer;
  }

  /** Drop `key`; its buffer is destroyed at the next frame start. */
  release(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.retire(entry.buffer);
  }

  protected onFrameStart(): void {}

  protected onDispose(): void {
    for (const entry of this.entries.values()) entry.buffer.destroy();
    this.entries.clear();
  }
}

export function createGpuFrameBuffers(device: GPUDevice, options: GpuFrameBuffersOptions): GpuFrameBuffers {
  return new GpuFrameBuffers(device, options);
}

function alignTo4(value: number): number {
  return Math.ceil(value / 4) * 4;
}
