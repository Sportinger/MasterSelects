// Decoder lifecycle, chunk submission/backpressure and EOF draining for FAST export.
// Frame selection and retained VideoFrame ownership remain in WebCodecsExportMode.
import { Logger } from '../../services/logger';
import type { ExportModePlayer } from '../WebCodecsExportMode';
import type { Sample } from '../webCodecsTypes';
import { frameToleranceUs } from './exportSamplePlanning';

const log = Logger.create('WebCodecsExportMode');

interface ExportDecoderPumpHooks {
  sampleTimestampUs(sample: Sample): number;
  onSamplesSubmitted(endIndexExclusive: number): number;
  findBufferedFrameIndex(targetCtsUs: number, toleranceUs: number): number;
  refreshBufferedFrameIndex(): void;
  getBufferedFrameCount(): number;
}

export class ExportDecoderPump {
  private static readonly MAX_DECODE_QUEUE = 2;

  private player: ExportModePlayer;
  private hooks: ExportDecoderPumpHooks;

  constructor(player: ExportModePlayer, hooks: ExportDecoderPumpHooks) {
    this.player = player;
    this.hooks = hooks;
  }

  getConfiguredDecoderOrThrow(context: string): VideoDecoder {
    const decoder = this.player.getDecoder();
    if (!decoder) {
      throw new Error(`FAST export decoder missing during ${context}`);
    }
    if (decoder.state === 'closed') {
      throw new Error(`FAST export decoder closed during ${context}`);
    }
    return decoder;
  }

  async waitForBufferedTarget(
    targetCtsUs: number,
    timeoutMs: number,
    toleranceUs = frameToleranceUs(this.player.getFrameRate(), 2.5),
    allowIdleExit = true,
  ): Promise<void> {
    const startTime = performance.now();
    let previousBufferSize = this.hooks.getBufferedFrameCount();
    let stablePolls = 0;

    while (performance.now() - startTime < timeoutMs) {
      this.hooks.refreshBufferedFrameIndex();
      if (this.hooks.findBufferedFrameIndex(targetCtsUs, toleranceUs) >= 0) return;

      const decoder = this.getConfiguredDecoderOrThrow('waitForBufferedTarget');
      const bufferSize = this.hooks.getBufferedFrameCount();
      if (bufferSize !== previousBufferSize || decoder.decodeQueueSize > 0) {
        previousBufferSize = bufferSize;
        stablePolls = 0;
      } else if (allowIdleExit && ++stablePolls >= 4) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    this.hooks.refreshBufferedFrameIndex();
  }

  isRecoverableDecoderFailure(error: unknown): boolean {
    if ((this.player.getDecoder()?.state ?? 'closed') === 'closed') {
      return true;
    }

    const record = typeof error === 'object' && error !== null
      ? error as { name?: unknown; message?: unknown }
      : null;
    const name = typeof record?.name === 'string' ? record.name : '';
    const message = typeof record?.message === 'string'
      ? record.message.toLowerCase()
      : String(error).toLowerCase();

    return name === 'FastExportDecoderClosedError'
      || name === 'InvalidStateError'
      || name === 'EncodingError'
      || message.includes('decoder closed')
      || message.includes('closed codec')
      || message.includes('decoding error');
  }

  async reconfigureDecoderForExport(
    context: string,
    preferFreshDecoder = false
  ): Promise<void> {
    let decoder = this.player.getDecoder();
    let recreatedDecoder = false;

    // Android's hardware HEVC decoder can remain "configured" after reset()
    // while silently dropping every subsequently submitted chunk. Start each
    // export source with a new decoder when the player can provide one.
    if (preferFreshDecoder) {
      const freshDecoder = this.player.recreateExportDecoder?.() ?? null;
      if (freshDecoder && freshDecoder.state !== 'closed') {
        decoder = freshDecoder;
        recreatedDecoder = true;
        log.info(`Created fresh FAST export decoder (${context})`);
      }
    }
    // Recover from a decoder that errored out (closed) mid-export by recreating
    // it, instead of throwing — one bad warmup decode shouldn't kill the export.
    if (!decoder || decoder.state === 'closed') {
      decoder = this.player.recreateExportDecoder?.() ?? null;
      if (!decoder || decoder.state === 'closed') {
        throw new Error(`FAST export decoder unavailable during ${context}`);
      }
      recreatedDecoder = true;
      log.warn(`Recreated FAST export decoder after it closed (${context})`);
    }

    const codecConfig = this.player.getCodecConfig();
    if (!codecConfig) {
      throw new Error(`FAST export codec config missing during ${context}`);
    }

    // recreateExportDecoder() returns a decoder already configured by the
    // player. Do not immediately reset that fresh Android hardware instance.
    if (recreatedDecoder && decoder.state === 'configured') {
      return;
    }

    if (decoder.state === 'configured') {
      decoder.reset();
    }
    decoder.configure({
      ...codecConfig,
      hardwareAcceleration: 'prefer-hardware',
    });
  }

  async decodeSampleWindow(
    startIndex: number,
    endIndexExclusive: number,
    targetCtsUs: number,
    awaitTargetOutput = true,
  ): Promise<void> {
    const samples = this.player.getSamples();
    if (startIndex >= endIndexExclusive || startIndex >= samples.length) {
      return;
    }

    const decoder = this.getConfiguredDecoderOrThrow(`decodeSampleWindow ${startIndex}-${endIndexExclusive}`);

    for (let i = startIndex; i < endIndexExclusive; i++) {
      // Backpressure: wait for the decode queue to drain before queuing more, so
      // a software decoder isn't overwhelmed (the main cause of mid-export
      // "Decoding error" closes and the periodic 1fps keyframe restarts).
      let backpressureGuard = 0;
      while (decoder.decodeQueueSize >= ExportDecoderPump.MAX_DECODE_QUEUE && backpressureGuard < 500) {
        if (decoder.state === 'closed') {
          throw new Error(`FAST export decoder closed during decodeSampleWindow ${startIndex}-${endIndexExclusive}`);
        }
        await new Promise(resolve => setTimeout(resolve, 2));
        backpressureGuard++;
      }

      const sample = samples[i];
      const chunk = new EncodedVideoChunk({
        type: sample.is_sync ? 'key' : 'delta',
        timestamp: this.hooks.sampleTimestampUs(sample),
        duration: (sample.duration * 1_000_000) / sample.timescale,
        data: sample.data,
      });

      try {
        decoder.decode(chunk);
      } catch (e) {
        const errorRecord = typeof e === 'object' && e !== null
          ? e as { name?: unknown; message?: unknown }
          : null;
        const message = typeof errorRecord?.message === 'string'
          ? errorRecord.message
          : String(e);
        const errorName = typeof errorRecord?.name === 'string' ? errorRecord.name : '';
        if (
          decoder.state === 'closed' ||
          errorName === 'InvalidStateError' ||
          errorName === 'EncodingError'
        ) {
          const decoderError = new Error(
            `FAST export decoder closed while decoding sample ${i}: ${message}`
          );
          decoderError.name = 'FastExportDecoderClosedError';
          throw decoderError;
        }
        if (message.includes('key frame')) {
          throw new Error(`FAST export lost keyframe context near sample ${i}`);
        }
        throw e instanceof Error
          ? e
          : new Error(`FAST export decode failed at sample ${i}: ${message}`);
      }
    }

    this.player.setSampleIndex(this.hooks.onSamplesSubmitted(endIndexExclusive));

    // Flushing mid-stream can cut a GOP and trigger a decoder failure.
    // Only drain with flush when we truly reached the end of the source.
    if (endIndexExclusive >= samples.length) {
      await this.waitForDecoderFlush(Math.max(4000, (endIndexExclusive - startIndex) * 10));
    } else if (awaitTargetOutput) {
      await this.waitForBufferedTarget(
        targetCtsUs,
        Math.max(1200, (endIndexExclusive - startIndex) * 12)
      );
    }

    this.hooks.refreshBufferedFrameIndex();
  }

  /**
   * Wait for decoder to flush with timeout fallback.
   * Only safe to use when we actually reached the end of the source.
   */
  private async waitForDecoderFlush(timeoutMs: number): Promise<void> {
    const decoder = this.getConfiguredDecoderOrThrow('waitForDecoderFlush');

    const startTime = performance.now();
    const startBufferSize = this.hooks.getBufferedFrameCount();
    let flushError: unknown = null;

    const flushPromise = decoder.flush().catch(e => {
      flushError = e;
      log.warn(`Flush error: ${e}`);
    });

    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    });

    await Promise.race([flushPromise, timeoutPromise]);

    const decoderAfter = this.player.getDecoder();
    if (!decoderAfter || decoderAfter.state === 'closed') {
      throw new Error('FAST export decoder closed during flush');
    }

    if (decoderAfter.decodeQueueSize > 0) {
      log.warn(`Flush timeout, waiting for queue (${decoderAfter.decodeQueueSize} remaining)...`);
      let waitCount = 0;
      while (
        this.player.getDecoder() &&
        this.player.getDecoder()!.state !== 'closed' &&
        this.player.getDecoder()!.decodeQueueSize > 0 &&
        waitCount < 100
      ) {
        await new Promise(r => setTimeout(r, 20));
        waitCount++;
      }
    }

    const decoderFinal = this.player.getDecoder();
    if (!decoderFinal || decoderFinal.state === 'closed') {
      throw new Error('FAST export decoder closed during queue drain');
    }

    if (flushError) {
      throw flushError instanceof Error
        ? flushError
        : new Error(`FAST export flush failed: ${String(flushError)}`);
    }

    const elapsed = performance.now() - startTime;
    const framesOutput = this.hooks.getBufferedFrameCount() - startBufferSize;
    log.debug(
      `Flush complete: ${framesOutput} frames output in ${elapsed.toFixed(0)}ms, buffer now ${this.hooks.getBufferedFrameCount()}`
    );
  }

}
