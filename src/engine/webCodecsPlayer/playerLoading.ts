import type { FileSampleDataOptions } from '../webcodecs/fileSampleData';
import { loadMp4FileOnDemand, loadMp4ForWebCodecs, type Mp4DemuxLoaderCallbacks } from '../webcodecs/mp4DemuxLoader';
import { WebCodecsPlayerBase, webCodecsPlayerLog } from './playerBase';

export abstract class WebCodecsPlayerLoading extends WebCodecsPlayerBase {
  protected abstract handleDecodedFrame(frame: VideoFrame): void;
  protected abstract decodeFirstFrame(): void;
  protected abstract resetDecodeQueueTracking(): void;

  async loadArrayBuffer(buffer: ArrayBuffer): Promise<void> {
    return loadMp4ForWebCodecs(buffer, this.demuxCallbacks());
  }

  /**
   * Export-only: parses the file's metadata and reads sample bytes on demand, so sources too
   * large for one ArrayBuffer still decode. Only the export decoder pump requests the bytes
   * (ensureSampleData); playback and scrubbing need loadArrayBuffer().
   */
  async loadFileOnDemand(file: Blob, options?: FileSampleDataOptions): Promise<void> {
    this.sampleData = await loadMp4FileOnDemand(file, this.demuxCallbacks(), options);
  }

  private demuxCallbacks(): Mp4DemuxLoaderCallbacks {
    return {
      log: webCodecsPlayerLog,
      hardwareAcceleration: this.hardwareAcceleration,
      onMp4FileCreated: (mp4File) => {
        this.mp4FileRef.current = mp4File;
      },
      onTrackReady: ({ videoTrack, codecConfig, width, height, frameRate, frameInterval }) => {
        this.videoTrack = videoTrack;
        this.codecConfig = codecConfig;
        this.width = width;
        this.height = height;
        this.frameRate = frameRate;
        this.frameInterval = frameInterval;
      },
      onSamples: (samples) => {
        this.samples.push(...samples);
        this.refreshPresentationOffset();

        // Mark ready when we have samples and decoder (for playback mode)
        if (!this.ready && this.samples.length > 0 && this.decoderInitialized) {
          this.ready = true;
          webCodecsPlayerLog.info(`READY: ${this.samples.length} samples loaded so far`);

          this.decodeFirstFrame();
          this.onReady?.(this.width, this.height);
        } else if (!this.ready && this.samples.length > 0 && !this.decoderInitialized) {
          // Samples received but decoder not ready yet
          this.pendingDecodeFirstFrame = true;
        }
      },
      onConfigSupported: () => {
        this.initDecoder();
      },
      onError: (error) => {
        this.onError?.(error);
      },
    };
  }

  protected initDecoder(): void {
    if (!this.codecConfig) return;

    this.decoder = new VideoDecoder({
      output: (frame) => {
        this.handleDecodedFrame(frame);
      },
      error: (e) => {
        webCodecsPlayerLog.error('VideoDecoder error', e);
        this.recordDecodeError(e, 'VideoDecoder.error');
        this.onError?.(new Error(`Decoder error: ${e.message}`));
      },
    });

    this.decoder.configure(this.codecConfig);
    this.resetDecodeQueueTracking();
    this.decoderInitialized = true;

    // Handle any deferred first frame decode and resolve loadArrayBuffer promise
    if (this.pendingDecodeFirstFrame && this.samples.length > 0) {
      this.pendingDecodeFirstFrame = false;
      this.ready = true;
      webCodecsPlayerLog.info(`READY (deferred): ${this.width}x${this.height} @ ${this.frameRate.toFixed(1)}fps, ${this.samples.length} samples`);

      this.decodeFirstFrame();
      this.onReady?.(this.width, this.height);

      // Resolve the loadArrayBuffer promise
      if (this.loadResolve) {
        this.loadResolve();
        this.loadResolve = null;
      }
    }
  }
}
