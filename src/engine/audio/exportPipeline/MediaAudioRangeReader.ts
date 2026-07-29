import {
  ALL_FORMATS,
  AudioSampleSink,
  BlobSource,
  Input,
  type InputAudioTrack,
} from 'mediabunny';

import { createBuffer } from '../audioBufferFactory';

export class MediaAudioRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaAudioRangeError';
  }
}

/**
 * Decodes bounded audio ranges straight from a disk-backed media File.
 *
 * BlobSource performs byte-range reads, while AudioSampleSink seeks and decodes
 * only the packets overlapping the requested source interval. This keeps long
 * MP4/MOV/audio sources out of the JS heap when an export uses a few short cuts.
 */
export class MediaAudioRangeReader {
  private readonly input: Input<BlobSource>;
  private trackPromise: Promise<InputAudioTrack> | null = null;
  private disposed = false;

  constructor(file: File) {
    this.input = new Input({
      formats: ALL_FORMATS,
      source: new BlobSource(file, {
        maxCacheSize: 8 * 1024 * 1024,
      }),
    });
  }

  private async getTrack(): Promise<InputAudioTrack> {
    if (this.disposed) {
      throw new MediaAudioRangeError('Media audio range reader is disposed');
    }

    this.trackPromise ??= (async () => {
      const track = await this.input.getPrimaryAudioTrack();
      if (!track) {
        throw new MediaAudioRangeError('Media source has no audio track');
      }
      if (!(await track.canDecode())) {
        throw new MediaAudioRangeError(
          `Browser cannot decode the source audio codec (${track.codec ?? 'unknown'})`,
        );
      }
      return track;
    })();

    return this.trackPromise;
  }

  async read(startSeconds: number, endSeconds: number): Promise<AudioBuffer> {
    const safeStartSeconds = Math.max(0, startSeconds);
    const safeEndSeconds = Math.max(safeStartSeconds + 0.001, endSeconds);
    const track = await this.getTrack();
    const sampleRate = track.sampleRate;
    const channelCount = track.numberOfChannels;

    if (sampleRate < 1 || channelCount < 1) {
      throw new MediaAudioRangeError('Media audio track has invalid channel metadata');
    }

    const requestedStartFrame = Math.floor(safeStartSeconds * sampleRate);
    const requestedEndFrame = Math.max(
      requestedStartFrame + 1,
      Math.ceil(safeEndSeconds * sampleRate),
    );
    const output = createBuffer(
      channelCount,
      requestedEndFrame - requestedStartFrame,
      sampleRate,
    );
    const sink = new AudioSampleSink(track);

    for await (const sample of sink.samples(safeStartSeconds, safeEndSeconds)) {
      try {
        const sampleStartFrame = Math.round(sample.timestamp * sampleRate);
        const sampleEndFrame = sampleStartFrame + sample.numberOfFrames;
        const copyStartFrame = Math.max(requestedStartFrame, sampleStartFrame);
        const copyEndFrame = Math.min(requestedEndFrame, sampleEndFrame);
        const copyFrameCount = copyEndFrame - copyStartFrame;
        if (copyFrameCount <= 0) {
          continue;
        }

        const sourceFrameOffset = copyStartFrame - sampleStartFrame;
        const destinationFrameOffset = copyStartFrame - requestedStartFrame;
        for (let channel = 0; channel < channelCount; channel += 1) {
          const destination = output.getChannelData(channel).subarray(
            destinationFrameOffset,
            destinationFrameOffset + copyFrameCount,
          );
          sample.copyTo(destination, {
            planeIndex: channel,
            format: 'f32-planar',
            frameOffset: sourceFrameOffset,
            frameCount: copyFrameCount,
          });
        }
      } finally {
        sample.close();
      }
    }

    return output;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.input.dispose();
  }
}
