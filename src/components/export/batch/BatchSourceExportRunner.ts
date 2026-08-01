import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  ConversionCanceledError,
  Input,
  Mp3OutputFormat,
  Mp4OutputFormat,
  Output,
  WavOutputFormat,
  WebMOutputFormat,
  canEncodeAudio,
  type ConversionAudioOptions,
  type ConversionVideoOptions,
} from 'mediabunny';
import {
  BatchSourceExportCancelledError,
  BatchSourceExportUnsupportedError,
} from './batchSourceExportErrors';
import {
  createBatchSourceExportPlan,
  type BatchSourceAudioPlan,
  type BatchSourceImagePlan,
  type BatchSourceVideoPlan,
} from './batchSourceExportPlan';
import type {
  BatchSourceExportInput,
  BatchSourceExportProgress,
  BatchSourceExportProgressCallback,
  BatchSourceExportResult,
} from './batchSourceExportTypes';

type MediaConversion = Awaited<ReturnType<typeof Conversion.init>>;

interface ImageRenderSurface {
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  encode: (mimeType: string, quality: number) => Promise<Blob>;
}

let mp3EncoderRegistered = false;

function clampProgress(progress: number): number {
  return Math.max(0, Math.min(100, Math.round(progress)));
}

function emitProgress(
  callback: BatchSourceExportProgressCallback | undefined,
  update: BatchSourceExportProgress,
): void {
  callback?.({
    ...update,
    progress: clampProgress(update.progress),
  });
}

function describeDiscardedTracks(conversion: MediaConversion): string {
  const reasons = [...new Set(conversion.discardedTracks.map(({ reason }) => reason))];
  return reasons.length > 0 ? ` Discarded track reasons: ${reasons.join(', ')}.` : '';
}

async function ensureMp3Encoder(): Promise<void> {
  if (mp3EncoderRegistered || await canEncodeAudio('mp3')) {
    return;
  }

  const { registerMp3Encoder } = await import('@mediabunny/mp3-encoder');
  registerMp3Encoder();
  mp3EncoderRegistered = true;
}

function createImageRenderSurface(width: number, height: number): ImageRenderSurface {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) {
      throw new BatchSourceExportUnsupportedError('This browser cannot create a 2D image export canvas.');
    }
    return {
      context,
      encode: async (mimeType, quality) => {
        const blob = await canvas.convertToBlob({ type: mimeType, quality });
        if (blob.type !== mimeType) {
          throw new BatchSourceExportUnsupportedError(`This browser cannot encode ${mimeType} images.`);
        }
        return blob;
      },
    };
  }

  if (typeof document === 'undefined') {
    throw new BatchSourceExportUnsupportedError('Image export requires browser canvas support.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new BatchSourceExportUnsupportedError('This browser cannot create a 2D image export canvas.');
  }

  return {
    context,
    encode: (mimeType, quality) => new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => blob?.type === mimeType
          ? resolve(blob)
          : reject(new BatchSourceExportUnsupportedError(`This browser cannot encode ${mimeType} images.`)),
        mimeType,
        quality,
      );
    }),
  };
}

function encodeBmp(context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, width: number, height: number): Blob {
  const rgba = context.getImageData(0, 0, width, height).data;
  const rowStride = (width * 3 + 3) & ~3;
  const pixelBytes = rowStride * height;
  const headerBytes = 54;
  const buffer = new ArrayBuffer(headerBytes + pixelBytes);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  view.setUint16(0, 0x4d42, true);
  view.setUint32(2, buffer.byteLength, true);
  view.setUint32(10, headerBytes, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelBytes, true);
  view.setInt32(38, 2835, true);
  view.setInt32(42, 2835, true);

  for (let outputRow = 0; outputRow < height; outputRow++) {
    const sourceRow = height - 1 - outputRow;
    const sourceOffset = sourceRow * width * 4;
    const outputOffset = headerBytes + outputRow * rowStride;
    for (let x = 0; x < width; x++) {
      const rgbaOffset = sourceOffset + x * 4;
      const bgrOffset = outputOffset + x * 3;
      bytes[bgrOffset] = rgba[rgbaOffset + 2] ?? 0;
      bytes[bgrOffset + 1] = rgba[rgbaOffset + 1] ?? 0;
      bytes[bgrOffset + 2] = rgba[rgbaOffset] ?? 0;
    }
  }

  return new Blob([buffer], { type: 'image/bmp' });
}

export class BatchSourceExportRunner {
  private activeConversion: MediaConversion | null = null;
  private activeInput: Input<BlobSource> | null = null;
  private cancelRequested = false;
  private running = false;

  get isRunning(): boolean {
    return this.running;
  }

  async run(
    input: BatchSourceExportInput,
    onProgress?: BatchSourceExportProgressCallback,
  ): Promise<BatchSourceExportResult> {
    if (this.running) {
      throw new Error('This source media export runner is already in use.');
    }

    this.running = true;
    this.cancelRequested = false;
    emitProgress(onProgress, { progress: 0, phase: 'preparing' });

    try {
      const plan = createBatchSourceExportPlan({
        mediaType: input.mediaType,
        settings: input.settings,
        outputName: input.outputName?.trim() || input.file.name,
      });
      this.throwIfCancelled();

      const blob = plan.kind === 'image'
        ? await this.exportImage(input.file, plan, onProgress)
        : await this.exportMedia(input.file, plan, onProgress);

      this.throwIfCancelled();
      emitProgress(onProgress, { progress: 100, phase: 'complete' });
      return { blob, filename: plan.filename };
    } catch (error) {
      if (
        this.cancelRequested
        || error instanceof ConversionCanceledError
        || error instanceof BatchSourceExportCancelledError
      ) {
        throw new BatchSourceExportCancelledError();
      }
      throw error;
    } finally {
      this.activeInput?.dispose();
      this.activeInput = null;
      this.activeConversion = null;
      this.running = false;
      this.cancelRequested = false;
    }
  }

  async cancel(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.cancelRequested = true;
    if (this.activeConversion) {
      await this.activeConversion.cancel();
    } else if (this.activeInput) {
      this.activeInput.dispose();
    }
  }

  private async exportMedia(
    file: File,
    plan: BatchSourceVideoPlan | BatchSourceAudioPlan,
    onProgress: BatchSourceExportProgressCallback | undefined,
  ): Promise<Blob> {
    if (plan.kind === 'audio' && plan.container === 'mp3') {
      await ensureMp3Encoder();
      this.throwIfCancelled();
    }

    const sourceInput = new Input({
      formats: ALL_FORMATS,
      source: new BlobSource(file),
    });
    this.activeInput = sourceInput;
    const target = new BufferTarget();
    const format = plan.container === 'webm'
      ? new WebMOutputFormat()
      : plan.container === 'wav'
        ? new WavOutputFormat()
        : plan.container === 'mp3'
          ? new Mp3OutputFormat()
          : new Mp4OutputFormat({ fastStart: 'in-memory' });
    const output = new Output({ format, target });

    let video: ConversionVideoOptions;
    let audio: ConversionAudioOptions;
    if (plan.kind === 'video') {
      video = {
        width: plan.width,
        height: plan.height,
        fit: 'contain',
        frameRate: plan.frameRate,
        codec: plan.videoCodec,
        bitrate: plan.videoBitrate,
        forceTranscode: true,
      };
      audio = plan.includeAudio
        ? {
            codec: plan.audioCodec,
            bitrate: plan.audioBitrate,
            sampleRate: plan.audioSampleRate,
            forceTranscode: true,
          }
        : { discard: true };
    } else {
      video = { discard: true };
      audio = {
        codec: plan.audioCodec,
        bitrate: plan.audioBitrate,
        sampleRate: plan.audioSampleRate,
        forceTranscode: true,
      };
    }

    const conversion = await Conversion.init({
      input: sourceInput,
      output,
      video,
      audio,
      showWarnings: false,
    });
    this.activeConversion = conversion;

    if (this.cancelRequested) {
      await conversion.cancel();
      this.throwIfCancelled();
    }
    if (!conversion.isValid) {
      throw new BatchSourceExportUnsupportedError(
        `This browser cannot convert the source to ${plan.filename}.${describeDiscardedTracks(conversion)}`,
      );
    }

    conversion.onProgress = (progress) => {
      emitProgress(onProgress, {
        progress: 1 + progress * 97,
        phase: 'encoding',
      });
    };
    await conversion.execute();
    this.throwIfCancelled();
    emitProgress(onProgress, { progress: 99, phase: 'finalizing' });

    if (!target.buffer) {
      throw new Error('The source media encoder completed without producing output data.');
    }
    return new Blob([target.buffer], { type: plan.mimeType });
  }

  private async exportImage(
    file: File,
    plan: BatchSourceImagePlan,
    onProgress: BatchSourceExportProgressCallback | undefined,
  ): Promise<Blob> {
    if (typeof createImageBitmap !== 'function') {
      throw new BatchSourceExportUnsupportedError('Image export requires createImageBitmap support.');
    }

    emitProgress(onProgress, { progress: 10, phase: 'decoding' });
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch (error) {
      throw new BatchSourceExportUnsupportedError(
        `The source image could not be decoded: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    try {
      this.throwIfCancelled();
      const surface = createImageRenderSurface(plan.width, plan.height);
      const { context } = surface;
      context.clearRect(0, 0, plan.width, plan.height);
      if (plan.background === 'black') {
        context.fillStyle = '#000000';
        context.fillRect(0, 0, plan.width, plan.height);
      }

      const scale = Math.min(plan.width / bitmap.width, plan.height / bitmap.height);
      const drawWidth = bitmap.width * scale;
      const drawHeight = bitmap.height * scale;
      const drawX = (plan.width - drawWidth) / 2;
      const drawY = (plan.height - drawHeight) / 2;
      context.drawImage(bitmap, drawX, drawY, drawWidth, drawHeight);
      emitProgress(onProgress, { progress: 65, phase: 'rendering' });
      this.throwIfCancelled();

      emitProgress(onProgress, { progress: 85, phase: 'encoding' });
      const blob = plan.format === 'bmp'
        ? encodeBmp(context, plan.width, plan.height)
        : await surface.encode(plan.mimeType, plan.quality);
      this.throwIfCancelled();
      emitProgress(onProgress, { progress: 99, phase: 'finalizing' });
      return blob;
    } finally {
      bitmap.close();
    }
  }

  private throwIfCancelled(): void {
    if (this.cancelRequested) {
      throw new BatchSourceExportCancelledError();
    }
  }
}
