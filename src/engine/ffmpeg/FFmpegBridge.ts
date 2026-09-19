// src/engine/ffmpeg/FFmpegBridge.ts
// Bridge to FFmpeg WASM for professional codec export

import type {
  FFmpegExportSettings,
  FFmpegProgress,
  FFmpegLogEntry,
  FFmpegVideoCodec,
} from './types';
import { Logger } from '../../services/logger';
import { buildEncodeArgs, audioBufferToPCM } from './bridge/ffmpegEncodeArgs';
import { parseEncodeProgressLine, containerMimeType } from './bridge/ffmpegLogParsing';

const log = Logger.create('FFmpegBridge');

// FFmpeg WASM core interface (direct core, not @ffmpeg/ffmpeg wrapper)
interface FFmpegCore {
  FS: {
    writeFile: (path: string, data: Uint8Array) => void;
    readFile: (path: string) => Uint8Array;
    unlink: (path: string) => void;
    readdir: (path: string) => string[];
    mkdir: (path: string) => void;
  };
  exec?: (...args: string[]) => number;
  callMain?: (args: string[]) => number;
  setLogger: (logger: (log: { type: string; message: string }) => void) => void;
  setProgress: (handler: (progress: { progress: number; time: number }) => void) => void;
  reset: () => void;
  ret: number;
  /** Live Uint8Array view over the wasm linear memory; replaced by Emscripten on growth. */
  HEAPU8?: Uint8Array;
}

/**
 * Snapshot of the wasm heap state. `bytes` is a live view; callers must not
 * cache it across FFmpeg runs because memory growth replaces the buffer.
 */
export interface FFmpegHeapState {
  bytes: Uint8Array;
  /** Increments after load and after every executed FFmpeg command. */
  epoch: number;
}

export interface FFmpegVirtualCommandInput {
  inputFiles: Record<string, Uint8Array>;
  args: string[];
  outputPaths: string[];
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export class FFmpegBridge {
  private ffmpeg: FFmpegCore | null = null;
  private loadState: LoadState = 'idle';
  private loadPromise: Promise<void> | null = null;
  private logs: FFmpegLogEntry[] = [];
  private onProgress?: (progress: FFmpegProgress) => void;
  private onLog?: (log: FFmpegLogEntry) => void;
  private cancelled = false;
  private totalFrames = 0;
  private startTime = 0;
  private heapEpoch = 0;
  private heapListeners = new Set<(epoch: number) => void>();

  /**
   * Check if FFmpeg WASM is supported in this browser
   * Now supports single-threaded mode, so only WebAssembly is required
   */
  static isSupported(): boolean {
    return typeof WebAssembly !== 'undefined';
  }

  /**
   * Check if multi-threaded mode is available (faster but needs SharedArrayBuffer)
   */
  static isMultiThreaded(): boolean {
    return typeof SharedArrayBuffer !== 'undefined';
  }

  /**
   * Load FFmpeg WASM module
   * Uses @ffmpeg/ffmpeg from npm (must be installed)
   */
  async load(): Promise<void> {
    if (this.loadState === 'ready') return;
    if (this.loadPromise) return this.loadPromise;

    this.loadState = 'loading';
    this.loadPromise = this.doLoad();

    try {
      await this.loadPromise;
      this.loadState = 'ready';
    } catch (error) {
      this.loadState = 'error';
      throw error;
    }
  }

  private async doLoad(): Promise<void> {
    log.info('Loading FFmpeg WASM...');
    const startTime = performance.now();

    try {
      // Load FFmpeg core directly (bypassing @ffmpeg/ffmpeg wrapper which has issues)
      const baseURL = `${window.location.origin}/ffmpeg`;

      log.debug('Fetching ffmpeg-core.js...');

      // Load via script tag since it's a UMD module, not ES module
      await new Promise<void>((resolve, reject) => {
        // Check if already loaded
        if ((window as unknown as Record<string, unknown>).createFFmpegCore) {
          resolve();
          return;
        }

        const script = document.createElement('script');
        script.src = `${baseURL}/ffmpeg-core.js`;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load ffmpeg-core.js'));
        document.head.appendChild(script);
      });

      // Get the global createFFmpegCore function
      const createFFmpegCore = (window as unknown as Record<string, unknown>).createFFmpegCore as (
        options: Record<string, unknown>
      ) => Promise<FFmpegCore>;

      if (!createFFmpegCore) {
        throw new Error('createFFmpegCore not found after script load');
      }

      log.debug('Fetching compressed ffmpeg-core.wasm...');
      const compressedWasm = await fetch(`${baseURL}/ffmpeg-core.wasm.gz`).then(r => r.arrayBuffer());
      const compressedBytes = new Uint8Array(compressedWasm);
      if (compressedBytes[0] !== 0x1f || compressedBytes[1] !== 0x8b) {
        throw new Error('FFmpeg core asset was not served as gzip data.');
      }
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('This browser cannot decompress the FFmpeg core.');
      }
      const wasmBinary = await new Response(
        new Blob([compressedWasm]).stream().pipeThrough(new DecompressionStream('gzip')),
      ).arrayBuffer();

      log.debug('Initializing FFmpeg core...');
      const core = await createFFmpegCore({
        wasmBinary,
        locateFile: (path: string) => `${baseURL}/${path}`,
        // Capture stdout/stderr
        print: (message: string) => {
          log.debug('FFmpeg output', message);
          this.handleLog('info', message);
        },
        printErr: (message: string) => {
          if (!message.startsWith('Aborted')) {
            log.debug('FFmpeg stderr', message);
            this.handleLog('warning', message);
          }
        },
      }) as FFmpegCore;

      core.setLogger?.(({ type, message }) => {
        if (!message.startsWith('Aborted')) {
          this.handleLog(type === 'stderr' ? 'warning' : 'info', message);
        }
      });

      // Set up progress handler
      if (core.setProgress) {
        core.setProgress(({ progress, time }) => {
          if (this.onProgress && this.totalFrames > 0) {
            const elapsed = (performance.now() - this.startTime) / 1000;
            const speed = elapsed > 0 ? progress / elapsed : 0;
            const remaining = speed > 0 ? (1 - progress) / speed : 0;

            this.onProgress({
              frame: Math.floor(progress * this.totalFrames),
              fps: speed * 30,
              time,
              speed,
              bitrate: 0,
              size: 0,
              percent: progress * 100,
              eta: remaining,
            });
          }
        });
      }

      // Debug: expose to window for testing
      (window as unknown as Record<string, unknown>).ffmpegCore = core;

      this.ffmpeg = core;
      this.bumpHeapEpoch();

      const loadTime = ((performance.now() - startTime) / 1000).toFixed(2);
      log.info(`Loaded in ${loadTime}s`);
    } catch (error) {
      log.error('Failed to load', error);
      throw new Error(`Failed to load FFmpeg: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check if FFmpeg is loaded and ready
   */
  isLoaded(): boolean {
    return this.loadState === 'ready' && this.ffmpeg !== null;
  }

  /**
   * Get current load state
   */
  getLoadState(): LoadState {
    return this.loadState;
  }

  private handleLog(type: 'info' | 'warning' | 'error', message: string): void {
    const entry: FFmpegLogEntry = {
      type,
      message,
      timestamp: Date.now(),
    };
    this.logs.push(entry);
    this.onLog?.(entry);

    // Parse progress from FFmpeg output
    if (this.onProgress) {
      const progress = parseEncodeProgressLine(message, this.totalFrames);
      if (progress) {
        log.debug(`Progress: frame=${progress.frame}/${this.totalFrames} (${progress.percent.toFixed(1)}%)`);
        this.onProgress(progress);
      }
    }
  }

  private execute(args: string[]): number {
    if (!this.ffmpeg) throw new Error('FFmpeg not loaded');
    try {
      if (typeof this.ffmpeg.exec === 'function') return this.ffmpeg.exec(...args);
      if (typeof this.ffmpeg.callMain === 'function') return this.ffmpeg.callMain(args);
      throw new Error('Loaded FFmpeg core has no executable entry point.');
    } finally {
      this.bumpHeapEpoch();
    }
  }

  private bumpHeapEpoch(): void {
    this.heapEpoch += 1;
    for (const listener of this.heapListeners) {
      try {
        listener(this.heapEpoch);
      } catch (error) {
        log.warn('Heap listener failed', error);
      }
    }
  }

  /**
   * Read access to the wasm linear memory of the loaded core. The returned
   * view is live: freed allocations from previous commands stay in place
   * until reused, which is exactly what the Memory Leak effect visualizes.
   */
  getHeapState(): FFmpegHeapState | null {
    const heap = this.ffmpeg?.HEAPU8;
    if (!heap || heap.byteLength === 0) return null;
    return { bytes: heap, epoch: this.heapEpoch };
  }

  /** Subscribe to heap epoch changes (load + every executed command). */
  subscribeHeap(listener: (epoch: number) => void): () => void {
    this.heapListeners.add(listener);
    return () => {
      this.heapListeners.delete(listener);
    };
  }

  /**
   * Encode frames to video using FFmpeg
   * @param frames - Array of raw RGBA frame data
   * @param settings - Export settings (resolution, codec, etc.)
   * @param onProgress - Progress callback
   * @param audioBuffer - Optional mixed audio buffer to include
   */
  async encode(
    frames: Uint8Array[],
    settings: FFmpegExportSettings,
    onProgress?: (progress: FFmpegProgress) => void,
    audioBuffer?: AudioBuffer | null
  ): Promise<Blob> {
    if (!this.ffmpeg) {
      await this.load();
    }
    if (!this.ffmpeg) {
      throw new Error('FFmpeg not loaded');
    }

    this.cancelled = false;
    this.onProgress = onProgress;
    this.logs = [];
    this.totalFrames = frames.length;
    this.startTime = performance.now();

    const fs = this.ffmpeg.FS;

    try {
      // Clean up any previous files first to reset FFmpeg state
      this.cleanup();

      // Create directories (they may already exist)
      try { fs.mkdir('/input'); } catch { /* exists */ }
      try { fs.mkdir('/output'); } catch { /* exists */ }

      // Concatenate all frames into a single raw file
      // This bypasses the pattern matching issue in WASM FFmpeg's image2 demuxer
      const frameSize = frames[0].byteLength;
      const totalSize = frameSize * frames.length;
      log.debug(`Writing ${frames.length} frames (${(totalSize / 1024 / 1024).toFixed(1)} MB)...`);
      log.debug(`Frame size: ${frameSize} bytes (expected: ${settings.width * settings.height * 4})`);

      // Debug: check if frames have unique content
      if (frames.length >= 2) {
        let sameCount = 0;
        for (let i = 0; i < Math.min(100, frameSize); i++) {
          if (frames[0][i] === frames[1][i]) sameCount++;
        }
        log.debug(`Frame 0 vs 1: ${sameCount}/100 bytes identical (should be <90 if different)`);
      }

      const allFrames = new Uint8Array(totalSize);
      for (let i = 0; i < frames.length; i++) {
        if (this.cancelled) throw new Error('Cancelled');
        allFrames.set(frames[i], i * frameSize);
      }

      fs.writeFile('/input/frames.raw', allFrames);
      log.debug(`Wrote /input/frames.raw: ${allFrames.byteLength} bytes`);

      // Write audio if provided
      const supportsAudio = settings.container !== 'gif' && settings.codec !== 'gif';
      let hasAudio = false;
      if (supportsAudio && audioBuffer && audioBuffer.length > 0) {
        const audioData = audioBufferToPCM(audioBuffer);
        fs.writeFile('/input/audio.raw', new Uint8Array(audioData.buffer));
        hasAudio = true;
        log.debug(`Audio: ${audioBuffer.duration.toFixed(2)}s, ${audioBuffer.sampleRate}Hz`);
      }

      // Build FFmpeg arguments (using single file input)
      const args = buildEncodeArgs(settings, frames.length, hasAudio ? audioBuffer : null);
      log.debug('Running: ffmpeg', args.join(' '));

      // NOTE: Do NOT call reset() here - it clears the virtual filesystem!
      // The files we just wrote would be deleted.

      // Execute FFmpeg (callMain is synchronous but may take a while)
      log.info('Starting FFmpeg encode...');
      const encodeStart = performance.now();
      const exitCode = this.execute(args);
      const encodeTime = ((performance.now() - encodeStart) / 1000).toFixed(2);
      log.info(`FFmpeg finished in ${encodeTime}s with exit code ${exitCode}`);

      if (exitCode !== 0) {
        log.error('FFmpeg logs:', this.logs.map(l => l.message).join('\n'));
        throw new Error(`FFmpeg exited with code ${exitCode}`);
      }

      // Read output file
      const outputPath = `/output/output.${settings.container}`;
      const data = fs.readFile(outputPath);
      log.info(`Output file size: ${(data.byteLength / 1024 / 1024).toFixed(2)} MB`);

      // Create a copy of the data to ensure it's a standard ArrayBuffer
      const buffer = new ArrayBuffer(data.byteLength);
      new Uint8Array(buffer).set(data);
      return new Blob([buffer], { type: containerMimeType(settings.container) });
    } finally {
      this.cleanup();
    }
  }

  /**
   * Clean up virtual filesystem
   */
  private cleanup(): void {
    if (!this.ffmpeg) return;
    const fs = this.ffmpeg.FS;

    try {
      // Clean input files
      const inputFiles = fs.readdir('/input');
      for (const file of inputFiles) {
        if (file !== '.' && file !== '..') {
          try { fs.unlink(`/input/${file}`); } catch { /* ignore */ }
        }
      }

      // Clean output files
      const outputFiles = fs.readdir('/output');
      for (const file of outputFiles) {
        if (file !== '.' && file !== '..') {
          try { fs.unlink(`/output/${file}`); } catch { /* ignore */ }
        }
      }
    } catch (e) {
      log.warn('Cleanup error', e);
    }
  }

  /**
   * Cancel current export
   */
  cancel(): void {
    this.cancelled = true;
  }

  /**
   * Get accumulated logs
   */
  getLogs(): FFmpegLogEntry[] {
    return [...this.logs];
  }

  /** Run a bounded FFmpeg command against files in its in-memory filesystem. */
  async runVirtualCommand(input: FFmpegVirtualCommandInput): Promise<Record<string, Uint8Array>> {
    if (!this.ffmpeg) await this.load();
    if (!this.ffmpeg) throw new Error('FFmpeg not loaded');
    for (const pathName of [...Object.keys(input.inputFiles), ...input.outputPaths]) {
      if (!pathName.startsWith('/input/') && !pathName.startsWith('/output/')) {
        throw new Error(`FFmpeg virtual path must stay under /input or /output: ${pathName}`);
      }
    }

    this.logs = [];
    this.cleanup();
    const fs = this.ffmpeg.FS;
    try {
      try { fs.mkdir('/input'); } catch { /* exists */ }
      try { fs.mkdir('/output'); } catch { /* exists */ }
      for (const [pathName, bytes] of Object.entries(input.inputFiles)) {
        fs.writeFile(pathName, bytes);
      }
      this.ffmpeg.reset?.();
      const exitCode = this.execute(['-nostdin', '-y', '-loglevel', 'warning', ...input.args]);
      if (exitCode !== 0) {
        const detail = this.logs.slice(-8).map(entry => entry.message).join('\n');
        throw new Error(`FFmpeg exited with code ${exitCode}${detail ? `:\n${detail}` : ''}`);
      }

      const outputs: Record<string, Uint8Array> = {};
      for (const pathName of input.outputPaths) {
        const source = fs.readFile(pathName);
        outputs[pathName] = new Uint8Array(source);
      }
      return outputs;
    } finally {
      this.cleanup();
    }
  }

  /**
   * Extract audio from a video file
   * Returns audio as AAC in M4A container for fast loading
   */
  async extractAudio(
    file: File,
    onProgress?: (percent: number) => void
  ): Promise<Blob | null> {
    if (!this.ffmpeg) {
      throw new Error('FFmpeg not loaded. Call load() first.');
    }

    this.cancelled = false;
    this.logs = [];

    const fs = this.ffmpeg.FS;

    try {
      // Create directories
      try { fs.mkdir('/input'); } catch { /* exists */ }
      try { fs.mkdir('/output'); } catch { /* exists */ }

      // Write input file to virtual filesystem
      log.info(`Loading ${file.name} for audio extraction...`);
      onProgress?.(5);

      const inputData = new Uint8Array(await file.arrayBuffer());
      const inputPath = `/input/${file.name}`;
      fs.writeFile(inputPath, inputData);

      onProgress?.(20);

      // Build FFmpeg arguments for audio extraction
      // -vn: no video, -acodec aac: encode to AAC, -b:a 192k: 192kbps bitrate
      const args = [
        '-y',                    // Overwrite output
        '-i', inputPath,         // Input file
        '-vn',                   // No video
        '-acodec', 'aac',        // Encode to AAC
        '-b:a', '192k',          // 192 kbps bitrate
        '-ar', '48000',          // 48kHz sample rate
        '-ac', '2',              // Stereo
        '/output/audio.m4a',     // Output file
      ];

      log.debug('Extracting audio: ffmpeg', args.join(' '));
      onProgress?.(30);

      // Reset state before running
      if (this.ffmpeg.reset) {
        this.ffmpeg.reset();
      }

      // Execute FFmpeg
      const exitCode = this.execute(args);

      onProgress?.(90);

      if (exitCode !== 0) {
        log.warn('Audio extraction failed with code', exitCode);
        return null;
      }

      // Read output file
      const data = fs.readFile('/output/audio.m4a');

      // Create a copy to ensure it's a standard ArrayBuffer
      const buffer = new ArrayBuffer(data.byteLength);
      new Uint8Array(buffer).set(data);

      onProgress?.(100);

      log.info(`Audio extracted: ${(data.byteLength / 1024 / 1024).toFixed(2)} MB`);
      return new Blob([buffer], { type: 'audio/mp4' });
    } catch (error) {
      log.error('Audio extraction error', error);
      return null;
    } finally {
      this.cleanup();
    }
  }

  /**
   * Set log callback
   */
  setLogCallback(callback: (log: FFmpegLogEntry) => void): void {
    this.onLog = callback;
  }

  /**
   * Terminate FFmpeg instance (free resources)
   */
  terminate(): void {
    if (this.ffmpeg) {
      // Core doesn't have terminate, just clear reference
      this.ffmpeg = null;
      this.loadState = 'idle';
      this.loadPromise = null;
    }
  }

  /**
   * Check which codecs are available in the loaded FFmpeg build
   * NOTE: ASYNCIFY build includes only native FFmpeg encoders
   */
  async getAvailableCodecs(): Promise<FFmpegVideoCodec[]> {
    // ASYNCIFY build with native encoders only
    // External libs (libx264, libvpx, libsnappy) require pkg-config which fails in Emscripten
    return [
      'prores',    // Apple ProRes (prores_ks)
      'dnxhd',     // Avid DNxHR
      'ffv1',      // FFV1 lossless
      'utvideo',   // UTVideo lossless
      'mjpeg',     // Motion JPEG
      'gif',       // Animated GIF
    ];
  }
}

// Singleton instance with HMR support
let instance: FFmpegBridge | null = null;

// HMR handling
if (import.meta.hot) {
  import.meta.hot.accept();
  if (import.meta.hot.data?.ffmpegBridge) {
    instance = import.meta.hot.data.ffmpegBridge;
  }
  import.meta.hot.dispose((data) => {
    data.ffmpegBridge = instance;
  });
}

/**
 * Get singleton FFmpegBridge instance
 */
export function getFFmpegBridge(): FFmpegBridge {
  if (!instance) {
    instance = new FFmpegBridge();
  }
  return instance;
}
