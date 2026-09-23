/** CPU-owned pixels only: retaining ImageBitmap/VideoFrame can retain GPU/decoder memory. */
export class ScrubRamCache {
  private readonly frames = new Map<string, ImageData>();
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

  clear(videoSrc?: string): void {
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
