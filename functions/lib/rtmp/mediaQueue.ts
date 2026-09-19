import type { MediaFrame } from './types';

export const DEFAULT_QUEUE_BYTE_CAP = 16 * 1024 * 1024;
export const DEFAULT_QUEUE_MESSAGE_CAP = 511;

export class MediaQueue {
  private awaitingKeyframe = false;
  private readonly byteCap: number;
  private readonly items: MediaFrame[] = [];
  private waiter: (() => void) | null = null;
  private recoveryFloor: number | null = null;
  private readonly messageCap: number;
  droppedFrames = 0;
  queuedBytes = 0;

  constructor(byteCap = DEFAULT_QUEUE_BYTE_CAP, messageCap = DEFAULT_QUEUE_MESSAGE_CAP) {
    this.byteCap = byteCap;
    this.messageCap = messageCap;
  }

  get queuedMessages(): number {
    return this.items.length;
  }

  enqueue(frame: MediaFrame): void {
    const size = frame.payload.byteLength;
    if (size > this.byteCap) throw new Error('RTMP outbound queue capacity exceeded');
    if (frame.kind === 3 && !frame.keyframe && this.awaitingKeyframe) {
      this.droppedFrames += 1;
      return;
    }
    if (frame.kind === 3 && frame.keyframe && this.awaitingKeyframe) {
      this.dropOldestDeltaVideoUntil(size);
      this.dropOldestVideoUntil(size);
      if (!this.hasCapacity(size)) throw new Error('RTMP outbound queue capacity exceeded');
      this.insertPriorityFrame(frame, size);
      return;
    }
    if (this.hasCapacity(size)) {
      this.items.push(frame);
      this.queuedBytes += size;
      this.notify();
      return;
    }

    if (frame.kind === 3 && !frame.keyframe) {
      this.droppedFrames += 1;
      return;
    }

    // A recovery keyframe is forced through. Audio/config frames are never dropped.
    this.dropOldestDeltaVideoUntil(size);
    if (this.hasCapacity(size)) {
      this.insertPriorityFrame(frame, size);
      return;
    }

    // Evict other video (keyframes last) to preserve the hard byte cap without dropping audio.
    this.dropOldestVideoUntil(size);
    if (!this.hasCapacity(size)) {
      throw new Error('RTMP outbound queue capacity exceeded without dropping audio');
    }
    this.insertPriorityFrame(frame, size);
  }

  private insertPriorityFrame(frame: MediaFrame, size: number): void {
    if (frame.kind === 3 && frame.keyframe) {
      this.items.unshift(frame);
      this.recoveryFloor = frame.timestampMs;
      this.awaitingKeyframe = false;
    } else {
      this.items.push(frame);
    }
    this.queuedBytes += size;
    this.notify();
  }

  dropFrame(): void {
    this.droppedFrames += 1;
  }

  async dequeue(signal: AbortSignal): Promise<MediaFrame | null> {
    while (!signal.aborted) {
      const frame = this.items.shift();
      if (frame) {
        this.queuedBytes = Math.max(0, this.queuedBytes - frame.payload.byteLength);
        if (this.isStaleVideo(frame)) {
          this.droppedFrames += 1;
          continue;
        }
        if (frame.kind === 3 && frame.keyframe && this.recoveryFloor === frame.timestampMs) {
          this.recoveryFloor = frame.timestampMs;
        }
        return frame;
      }
      await new Promise<void>((resolve) => {
        const abort = (): void => {
          this.waiter = null;
          resolve();
        };
        this.waiter = (): void => {
          signal.removeEventListener('abort', abort);
          resolve();
        };
        signal.addEventListener('abort', abort, { once: true });
      });
    }
    return null;
  }

  private dropOldestDeltaVideoUntil(incomingBytes: number): void {
    while (!this.hasCapacity(incomingBytes)) {
      const index = this.items.findIndex((item) => item.kind === 3 && !item.keyframe);
      if (index < 0) return;
      this.removeAt(index);
    }
  }

  private dropOldestVideoUntil(incomingBytes: number): void {
    while (!this.hasCapacity(incomingBytes)) {
      const index = this.items.findIndex((item) => item.kind === 3);
      if (index < 0) return;
      this.removeAt(index);
    }
  }

  private removeAt(index: number): void {
    const [removed] = this.items.splice(index, 1);
    if (!removed) return;
    this.queuedBytes = Math.max(0, this.queuedBytes - removed.payload.byteLength);
    this.droppedFrames += 1;
    if (removed.kind === 3) this.awaitingKeyframe = true;
  }

  private isStaleVideo(frame: MediaFrame): boolean {
    if (frame.kind !== 3 || this.recoveryFloor === null) return false;
    const delta = (frame.timestampMs - this.recoveryFloor) >>> 0;
    // The forced recovery keyframe sits exactly on the floor and must pass;
    // only video strictly older than the floor (or a delta duplicate) is stale.
    if (delta === 0) return !frame.keyframe;
    return delta > 0x7fff_ffff;
  }

  private notify(): void {
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.();
  }

  private hasCapacity(incomingBytes: number): boolean {
    return this.queuedBytes + incomingBytes <= this.byteCap && this.items.length < this.messageCap;
  }
}
