import { AudioEncoderWrapper, type EncodedAudioResult } from '../AudioEncoder';
import type { AudioExtractor } from '../AudioExtractor';
import type { AudioExportSettings } from '../AudioExportPipeline';
import { buildEncodingProgress, type AudioExportProgressSink } from './progress';

export interface EncodeExportAudioOptions {
  buffer: AudioBuffer;
  settings: AudioExportSettings;
  extractor: AudioExtractor;
  shouldCancel: () => boolean;
  setEncoder: (encoder: AudioEncoderWrapper) => void;
  onProgress?: AudioExportProgressSink;
}

export async function encodeExportAudio(options: EncodeExportAudioOptions): Promise<EncodedAudioResult | null> {
  let stereoBuffer = options.buffer;
  if (options.buffer.numberOfChannels === 1) {
    stereoBuffer = options.extractor.convertToStereo(options.buffer);
  }

  if (stereoBuffer.sampleRate !== options.settings.sampleRate) {
    stereoBuffer = await options.extractor.resampleBuffer(
      stereoBuffer,
      options.settings.sampleRate
    );
  }

  const encoder = new AudioEncoderWrapper({
    sampleRate: options.settings.sampleRate,
    numberOfChannels: 2,
    bitrate: options.settings.bitrate,
    codec: options.settings.codec,
  });
  options.setEncoder(encoder);

  try {
    const supported = await encoder.init();
    if (options.shouldCancel()) return null;
    if (!supported) {
      throw new Error('The requested audio encoding is not supported in this browser');
    }

    await encoder.encode(stereoBuffer, (progress) => {
      options.onProgress?.(buildEncodingProgress(progress.percent));
    }, options.shouldCancel);
    if (options.shouldCancel()) return null;

    const result = await encoder.finalize();
    return options.shouldCancel() ? null : result;
  } finally {
    // Also release an encoder created after cancellation during async init, or
    // left open by a failed encode/flush. Successful finalize already closes it.
    encoder.cancel();
  }
}
