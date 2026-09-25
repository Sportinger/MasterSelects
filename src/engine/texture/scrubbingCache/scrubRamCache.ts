type CaptureReply = { id: number; width: number; height: number; buffer: ArrayBuffer } | { id: number; failed: true };

/** CPU-owned pixels only: retaining ImageBitmap/VideoFrame can retain GPU/decoder memory. */
export class ScrubRamCache {
  private readonly frames = new Map<string, ImageData>();
  private worker: Worker | null = null;
  private workerFailed = false;
  private nextCaptureId = 0;
  private generation = 0;
  private readonly inFlight = new Map<number, { key: string; bytes: number; generation: number }>();
  private inFlightBytes = 0;
  private canvas: HTMLCanvasElement | null = null;
  private bytes = 0;
  private limit = 0;
  private failureLimit = Infinity;
  private captureUnavailable = false;
  private evictions = 0;
  private allocations = 0;
  private reuses = 0;
  private releases = 0;

  setBudget(bytes: number): void {
    this.limit = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
    this.trim();
    if (!this.limit) this.releaseCanvas();
  }

  getSnapshot() {
    return { count: this.frames.size, bytes: this.bytes, maxBytes: this.effectiveLimit,
      requestedBytes: this.limit, reduced: this.failureLimit < this.limit,
      captureUnavailable: this.captureUnavailable, evictions: this.evictions,
      allocations: this.allocations, reuses: this.reuses, releases: this.releases };
  }

  private get effectiveLimit(): number { return Math.min(this.limit, this.failureLimit); }
  has(key: string): boolean { return this.frames.has(key); }
  keys(): IterableIterator<string> { return this.frames.keys(); }

  get(key: string): ImageData | undefined {
    const pixels = this.frames.get(key);
    if (pixels) {
      this.reuses++;
      this.frames.delete(key);
      this.frames.set(key, pixels);
    }
    return pixels;
  }

  /** Reserve room before pixel allocation, including one frame of conversion headroom. */
  capture(key: string, source: HTMLVideoElement | ImageBitmap, width: number, height: number): void {
    const frameBytes = width * height * 4;
    if (this.frames.has(key) || this.captureUnavailable || frameBytes * 2 > this.effectiveLimit) return;
    this.trim(frameBytes * 2);
    try {
      this.canvas ??= document.createElement('canvas');
      if (this.canvas.width !== width) this.canvas.width = width;
      if (this.canvas.height !== height) this.canvas.height = height;
      const context = this.canvas.getContext('2d', { willReadFrequently: true });
      if (!context) { this.captureUnavailable = true; this.releaseCanvas(); return; }
      context.clearRect(0, 0, width, height);
      context.drawImage(source, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height);
      this.frames.set(key, pixels);
      this.bytes += pixels.data.byteLength;
      this.allocations++;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'SecurityError') {
        // Cross-origin pixels cannot be read. GPU/direct video remains available.
        this.releaseCanvas();
        return;
      }
      this.failureLimit = Math.floor(Math.min(this.bytes, this.effectiveLimit) * 0.75);
      this.trim();
      this.releaseCanvas();
    }
  }

  /**
   * Background variant: takes ownership of the bitmap and reads it back in a
   * worker, so filling the cache never blocks editor interaction. Falls back
   * to the synchronous path where workers or OffscreenCanvas are unavailable.
   */
  captureDetached(key: string, bitmap: ImageBitmap): void {
    const frameBytes = bitmap.width * bitmap.height * 4;
    if (this.frames.has(key) || this.captureUnavailable || frameBytes * 2 > this.effectiveLimit
      || [...this.inFlight.values()].some(entry => entry.key === key)) { bitmap.close(); return; }
    const worker = this.captureWorker();
    if (!worker) { this.capture(key, bitmap, bitmap.width, bitmap.height); bitmap.close(); return; }
    this.trim(frameBytes * 2 + this.inFlightBytes);
    const id = ++this.nextCaptureId;
    this.inFlight.set(id, { key, bytes: frameBytes, generation: this.generation });
    this.inFlightBytes += frameBytes;
    try { worker.postMessage({ id, bitmap }, [bitmap]); }
    catch { this.settleCapture(id); bitmap.close(); }
  }

  private captureWorker(): Worker | null {
    if (this.worker || this.workerFailed) return this.worker;
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') { this.workerFailed = true; return null; }
    try {
      const worker = new Worker(new URL('./scrubRamCapture.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<CaptureReply>) => this.receiveCapture(event.data);
      worker.onerror = () => this.failWorker();
      this.worker = worker;
    } catch { this.workerFailed = true; }
    return this.worker;
  }

  private receiveCapture(reply: CaptureReply): void {
    const entry = this.settleCapture(reply.id);
    if (!entry || 'failed' in reply || entry.generation !== this.generation || this.frames.has(entry.key)) return;
    const pixels = new ImageData(new Uint8ClampedArray(reply.buffer), reply.width, reply.height);
    this.trim(pixels.data.byteLength + this.inFlightBytes);
    if (pixels.data.byteLength > this.effectiveLimit) return;
    this.frames.set(entry.key, pixels);
    this.bytes += pixels.data.byteLength;
    this.allocations++;
  }

  private settleCapture(id: number) {
    const entry = this.inFlight.get(id);
    if (entry) { this.inFlight.delete(id); this.inFlightBytes -= entry.bytes; }
    return entry;
  }

  private failWorker(): void {
    this.worker?.terminate(); this.worker = null; this.workerFailed = true;
    this.inFlight.clear(); this.inFlightBytes = 0;
  }

  clear(videoSrc?: string): void {
    this.generation++;
    for (const [key, pixels] of this.frames) {
      if (videoSrc && !key.startsWith(`${videoSrc}:`)) continue;
      this.bytes -= pixels.data.byteLength;
      this.frames.delete(key);
      this.releases++;
    }
    if (!this.frames.size) this.releaseCanvas();
  }

  private trim(incoming = 0): void {
    while ((this.bytes + incoming > this.effectiveLimit ||
      this.frames.size + (incoming ? 1 : 0) > 10000) && this.frames.size) {
      const key = this.frames.keys().next().value!;
      this.bytes -= this.frames.get(key)!.data.byteLength;
      this.frames.delete(key);
      this.evictions++;
      this.releases++;
    }
  }

  private releaseCanvas(): void {
    if (this.canvas) { this.canvas.width = 0; this.canvas.height = 0; }
    this.canvas = null;
  }
}
