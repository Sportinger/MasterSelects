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
  });
  options.setEncoder(encoder);

  const supported = await encoder.init();
  if (!supported) {
    throw new Error('AAC audio encoding is not supported in this browser');
  }
  if (options.shouldCancel()) return null;

  await encoder.encode(stereoBuffer, (progress) => {
    options.onProgress?.(buildEncodingProgress(progress.percent));
  }, options.shouldCancel);
  if (options.shouldCancel()) return null;

  return await encoder.finalize();
}
