import { afterEach, describe, expect, it, vi } from 'vitest';

const muxerRuntime = vi.hoisted(() => ({
  options: [] as unknown[],
  videoChunks: [] as unknown[],
  finalized: 0,
}));

vi.mock('../../src/engine/export/MediaBunnyMuxerAdapter', () => ({
  MediaBunnyMuxerAdapter: class MockMediaBunnyMuxerAdapter {
    constructor(options: unknown) {
      muxerRuntime.options.push(options);
    }

    addVideoChunk(chunk: unknown): void {
      muxerRuntime.videoChunks.push(chunk);
    }

    async finalize(): Promise<void> {
      muxerRuntime.finalized += 1;
    }

    getBuffer(): ArrayBuffer {
      return new Uint8Array([1, 2, 3, 4]).buffer;
    }
  },
}));

import {
  DATAMOSH_PLAYBACK_CONTAINER,
  DATAMOSH_PLAYBACK_EXTENSION,
  DATAMOSH_PLAYBACK_MIME_TYPE,
  DATAMOSH_PLAYBACK_VIDEO_CODEC,
  encodeDatamoshPlaybackArtifact,
} from '../../src/services/datamosh/codecDatamoshEncoder';

class MockVideoFrame {
  readonly close = vi.fn();

  constructor(
    readonly source: unknown,
    readonly init?: VideoFrameInit,
  ) {}
}

class MockEncodedVideoChunk {
  readonly byteLength: number;

  constructor(readonly init: EncodedVideoChunkInit) {
    this.byteLength = init.data.byteLength;
  }

  get type(): EncodedVideoChunkType {
    return this.init.type;
  }

  copyTo(destination: AllowSharedBufferSource): void {
    new Uint8Array(destination as ArrayBuffer).set(new Uint8Array(
      this.init.data.buffer,
      this.init.data.byteOffset,
      this.init.data.byteLength,
    ));
  }
}

class MockVideoEncoder {
  static instances: MockVideoEncoder[] = [];
  static isConfigSupported = vi.fn(async (config: VideoEncoderConfig) => ({
    supported: true,
    config,
  }));

  readonly configure = vi.fn((config: VideoEncoderConfig) => {
    this.config = config;
    this.state = 'configured';
  });
  readonly encode = vi.fn((_frame: VideoFrame, options?: VideoEncoderEncodeOptions) => {
    this.init.output(new MockEncodedVideoChunk({
      type: options?.keyFrame ? 'key' : 'delta',
      timestamp: this.outputIndex * 500_000,
      duration: 500_000,
      data: new Uint8Array([this.outputIndex + 1]),
    }) as unknown as EncodedVideoChunk, {});
    this.outputIndex += 1;
  });
  readonly flush = vi.fn(async () => undefined);
  readonly close = vi.fn(() => {
    this.state = 'closed';
  });
  encodeQueueSize = 0;
  state: CodecState = 'unconfigured';
  config: VideoEncoderConfig | null = null;
  private outputIndex = 0;

  constructor(private readonly init: VideoEncoderInit) {
    MockVideoEncoder.instances.push(this);
  }
}

describe('Datamosh playback artifact encoding', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    MockVideoEncoder.instances = [];
    muxerRuntime.options = [];
    muxerRuntime.videoChunks = [];
    muxerRuntime.finalized = 0;
  });

  it('stores the already-moshed frames as a seekable H.264 MP4 for FAST export', async () => {
    vi.stubGlobal('VideoEncoder', MockVideoEncoder);
    vi.stubGlobal('VideoFrame', MockVideoFrame);
    vi.stubGlobal('EncodedVideoChunk', MockEncodedVideoChunk);

    const result = await encodeDatamoshPlaybackArtifact({
      width: 4,
      height: 4,
      fps: 2,
      bitrate: 1_000_000,
      frameCount: 3,
      getFrame: async () => new MockVideoFrame(new Uint8Array(4 * 4 * 4)) as unknown as VideoFrame,
    });

    expect(DATAMOSH_PLAYBACK_CONTAINER).toBe('mp4');
    expect(DATAMOSH_PLAYBACK_EXTENSION).toBe('.mp4');
    expect(DATAMOSH_PLAYBACK_MIME_TYPE).toBe('video/mp4');
    expect(DATAMOSH_PLAYBACK_VIDEO_CODEC).toBe('h264');
    expect(MockVideoEncoder.isConfigSupported).toHaveBeenCalledWith(expect.objectContaining({
      codec: 'avc1.4d0028',
      hardwareAcceleration: 'prefer-hardware',
    }));
    expect(muxerRuntime.options).toEqual([expect.objectContaining({
      container: 'mp4',
      videoCodec: 'h264',
      hasAudio: false,
    })]);
    expect(MockVideoEncoder.instances[0].encode.mock.calls.map(call => call[1])).toEqual([
      { keyFrame: true },
      { keyFrame: false },
      { keyFrame: true },
    ]);
    expect(muxerRuntime.videoChunks).toHaveLength(3);
    expect(muxerRuntime.finalized).toBe(1);
    expect(result.blob.type).toBe('video/mp4');
    expect(result.outputPacketCount).toBe(3);
    expect(result.codec).toBe('avc1.4d0028');
  });
});
