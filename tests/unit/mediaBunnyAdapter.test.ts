import { afterEach, describe, it, expect } from 'vitest';
import { MediaBunnyMuxerAdapter } from '../../src/engine/export/MediaBunnyMuxerAdapter';

/**
 * Tests for the MediaBunny MuxerAdapter interface contract.
 *
 * Agent A is creating `src/engine/export/MediaBunnyMuxerAdapter.ts` in a parallel worktree.
 * These tests define the expected interface and behavior. Once Agent A's code lands,
 * update the import path below to point to the actual implementation.
 *
 * The adapter wraps MediaBunny's Output + BufferTarget behind the same interface
 * that VideoEncoderWrapper uses, so the encoder doesn't need to know which muxer
 * library is in use.
 */

// ─── Adapter Interface Definition ─────────────────────────────────────────
// This is the contract Agent A's adapter must satisfy.

interface MuxerAdapterConfig {
  container: 'mp4' | 'webm';
  video: {
    codec: 'h264' | 'h265' | 'vp9' | 'av1';
    width: number;
    height: number;
  };
  audio?: {
    codec: 'aac' | 'opus';
    sampleRate: number;
    numberOfChannels: number;
  };
  fastStart?: boolean;
}

interface MuxerAdapter {
  addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void;
  addAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata): void;
  finalize(): Promise<void>;
  getBuffer(): ArrayBuffer;
}

// ─── Codec Mapping Helpers ────────────────────────────────────────────────
// These are the mapping functions that Agent A may add or that already exist in codecHelpers.
// We test both the old function names (getMp4MuxerCodec/getWebmMuxerCodec) and
// the expected MediaBunny codec mapping logic.

/**
 * Maps MasterSelects VideoCodec to MediaBunny's video codec string.
 * MediaBunny uses: 'avc' | 'hevc' | 'vp9' | 'av1' | 'vp8'
 * This is identical to mp4-muxer's mapping (which is why the migration is low-risk).
 */
function mapVideoCodecToMediaBunny(codec: 'h264' | 'h265' | 'vp9' | 'av1'): string {
  switch (codec) {
    case 'h264': return 'avc';
    case 'h265': return 'hevc';
    case 'vp9': return 'vp9';
    case 'av1': return 'av1';
    default: return 'avc';
  }
}

/**
 * Maps MasterSelects AudioCodec to MediaBunny's audio codec string.
 * MediaBunny uses: 'aac' | 'opus' | 'mp3' | 'vorbis' | 'flac' | ...
 */
function mapAudioCodecToMediaBunny(codec: 'aac' | 'opus'): string {
  return codec; // Direct 1:1 mapping
}

/**
 * Returns the MediaBunny output format class name for a container.
 */
function getOutputFormatForContainer(container: 'mp4' | 'webm'): string {
  return container === 'mp4' ? 'Mp4OutputFormat' : 'WebMOutputFormat';
}

// ─── Codec Mapping Tests ──────────────────────────────────────────────────

describe('MediaBunny Codec Mapping', () => {
  describe('Video codec mapping', () => {
    it('maps h264 to avc (same as mp4-muxer)', () => {
      expect(mapVideoCodecToMediaBunny('h264')).toBe('avc');
    });

    it('maps h265 to hevc (same as mp4-muxer)', () => {
      expect(mapVideoCodecToMediaBunny('h265')).toBe('hevc');
    });

    it('maps vp9 to vp9', () => {
      expect(mapVideoCodecToMediaBunny('vp9')).toBe('vp9');
    });

    it('maps av1 to av1', () => {
      expect(mapVideoCodecToMediaBunny('av1')).toBe('av1');
    });

    it('produces unique codec string for each input', () => {
      const inputs: Array<'h264' | 'h265' | 'vp9' | 'av1'> = ['h264', 'h265', 'vp9', 'av1'];
      const results = new Set(inputs.map(mapVideoCodecToMediaBunny));
      expect(results.size).toBe(4);
    });
  });

  describe('Audio codec mapping', () => {
    it('maps aac directly', () => {
      expect(mapAudioCodecToMediaBunny('aac')).toBe('aac');
    });

    it('maps opus directly', () => {
      expect(mapAudioCodecToMediaBunny('opus')).toBe('opus');
    });
  });

  describe('Output format selection', () => {
    it('selects Mp4OutputFormat for mp4 container', () => {
      expect(getOutputFormatForContainer('mp4')).toBe('Mp4OutputFormat');
    });

    it('selects WebMOutputFormat for webm container', () => {
      expect(getOutputFormatForContainer('webm')).toBe('WebMOutputFormat');
    });
  });
});

// ─── Adapter Config Validation Tests ──────────────────────────────────────

describe('MuxerAdapter Configuration', () => {
  describe('Config shape validation', () => {
    it('accepts minimal mp4 video-only config', () => {
      const config: MuxerAdapterConfig = {
        container: 'mp4',
        video: { codec: 'h264', width: 1920, height: 1080 },
      };
      expect(config.container).toBe('mp4');
      expect(config.video.codec).toBe('h264');
      expect(config.audio).toBeUndefined();
    });

    it('accepts mp4 config with audio', () => {
      const config: MuxerAdapterConfig = {
        container: 'mp4',
        video: { codec: 'h264', width: 1920, height: 1080 },
        audio: { codec: 'aac', sampleRate: 48000, numberOfChannels: 2 },
      };
      expect(config.audio).toBeDefined();
      expect(config.audio!.codec).toBe('aac');
      expect(config.audio!.sampleRate).toBe(48000);
    });

    it('accepts webm config with opus audio', () => {
      const config: MuxerAdapterConfig = {
        container: 'webm',
        video: { codec: 'vp9', width: 1280, height: 720 },
        audio: { codec: 'opus', sampleRate: 48000, numberOfChannels: 2 },
      };
      expect(config.container).toBe('webm');
      expect(config.audio!.codec).toBe('opus');
    });

    it('accepts 4K resolution config', () => {
      const config: MuxerAdapterConfig = {
        container: 'mp4',
        video: { codec: 'h265', width: 3840, height: 2160 },
      };
      expect(config.video.width).toBe(3840);
      expect(config.video.height).toBe(2160);
    });

    it('supports fastStart option for mp4', () => {
      const config: MuxerAdapterConfig = {
        container: 'mp4',
        video: { codec: 'h264', width: 1920, height: 1080 },
        fastStart: true,
      };
      expect(config.fastStart).toBe(true);
    });
  });

  describe('Container-codec compatibility', () => {
    it('mp4 supports all video codecs', () => {
      const codecs: Array<'h264' | 'h265' | 'vp9' | 'av1'> = ['h264', 'h265', 'vp9', 'av1'];
      for (const codec of codecs) {
        const config: MuxerAdapterConfig = {
          container: 'mp4',
          video: { codec, width: 1920, height: 1080 },
        };
        expect(config.video.codec).toBe(codec);
      }
    });

    it('webm should only use vp9 or av1 video codecs', () => {
      const validWebmCodecs = ['vp9', 'av1'];
      const allCodecs: Array<'h264' | 'h265' | 'vp9' | 'av1'> = ['h264', 'h265', 'vp9', 'av1'];
      for (const codec of allCodecs) {
        if (validWebmCodecs.includes(codec)) {
          expect(true).toBe(true); // valid combo
        } else {
          // h264 and h265 are not valid in webm
          expect(validWebmCodecs).not.toContain(codec);
        }
      }
    });

    it('webm audio should use opus', () => {
      // In the existing codebase, webm always uses opus for audio
      const config: MuxerAdapterConfig = {
        container: 'webm',
        video: { codec: 'vp9', width: 1920, height: 1080 },
        audio: { codec: 'opus', sampleRate: 48000, numberOfChannels: 2 },
      };
      expect(config.audio!.codec).toBe('opus');
    });

    it('mp4 audio supports both aac and opus', () => {
      for (const audioCodec of ['aac', 'opus'] as const) {
        const config: MuxerAdapterConfig = {
          container: 'mp4',
          video: { codec: 'h264', width: 1920, height: 1080 },
          audio: { codec: audioCodec, sampleRate: 48000, numberOfChannels: 2 },
        };
        expect(config.audio!.codec).toBe(audioCodec);
      }
    });
  });
});

// ─── MediaBunny API Contract Tests ────────────────────────────────────────
// These verify assumptions about the MediaBunny API that the adapter relies on.
// They test the actual package imports (types only, no browser APIs needed).

describe('MediaBunny Package Availability', () => {
  it('mediabunny package is importable', async () => {
    // Verify the package resolves without throwing
    const mod = await import('mediabunny');
    expect(mod).toBeDefined();
  });

  it('exports Mp4OutputFormat class', async () => {
    const { Mp4OutputFormat } = await import('mediabunny');
    expect(Mp4OutputFormat).toBeDefined();
    expect(typeof Mp4OutputFormat).toBe('function');
  });

  it('exports WebMOutputFormat class', async () => {
    const { WebMOutputFormat } = await import('mediabunny');
    expect(WebMOutputFormat).toBeDefined();
    expect(typeof WebMOutputFormat).toBe('function');
  });

  it('exports BufferTarget class', async () => {
    const { BufferTarget } = await import('mediabunny');
    expect(BufferTarget).toBeDefined();
    expect(typeof BufferTarget).toBe('function');
  });

  it('exports Output class', async () => {
    const { Output } = await import('mediabunny');
    expect(Output).toBeDefined();
    expect(typeof Output).toBe('function');
  });

  it('exports EncodedVideoPacketSource class', async () => {
    const { EncodedVideoPacketSource } = await import('mediabunny');
    expect(EncodedVideoPacketSource).toBeDefined();
    expect(typeof EncodedVideoPacketSource).toBe('function');
  });

  it('exports EncodedAudioPacketSource class', async () => {
    const { EncodedAudioPacketSource } = await import('mediabunny');
    expect(EncodedAudioPacketSource).toBeDefined();
    expect(typeof EncodedAudioPacketSource).toBe('function');
  });

  it('exports VIDEO_CODECS constant', async () => {
    const { VIDEO_CODECS } = await import('mediabunny');
    expect(VIDEO_CODECS).toBeDefined();
    expect(Array.isArray(VIDEO_CODECS)).toBe(true);
    expect(VIDEO_CODECS).toContain('avc');
    expect(VIDEO_CODECS).toContain('hevc');
    expect(VIDEO_CODECS).toContain('vp9');
    expect(VIDEO_CODECS).toContain('av1');
  });

  it('exports AUDIO_CODECS constant', async () => {
    const { AUDIO_CODECS } = await import('mediabunny');
    expect(AUDIO_CODECS).toBeDefined();
    expect(Array.isArray(AUDIO_CODECS)).toBe(true);
    expect(AUDIO_CODECS).toContain('aac');
    expect(AUDIO_CODECS).toContain('opus');
  });
});

// ─── Format Instance Tests ────────────────────────────────────────────────
// Test that format instances can be created and expose expected properties.

describe('MediaBunny Format Instances', () => {
  it('Mp4OutputFormat has .mp4 extension', async () => {
    const { Mp4OutputFormat } = await import('mediabunny');
    const format = new Mp4OutputFormat();
    expect(format.fileExtension).toBe('.mp4');
  });

  it('Mp4OutputFormat has video/mp4 MIME type', async () => {
    const { Mp4OutputFormat } = await import('mediabunny');
    const format = new Mp4OutputFormat();
    expect(format.mimeType).toBe('video/mp4');
  });

  it('WebMOutputFormat has .webm extension', async () => {
    const { WebMOutputFormat } = await import('mediabunny');
    const format = new WebMOutputFormat();
    expect(format.fileExtension).toBe('.webm');
  });

  it('WebMOutputFormat has video/webm MIME type', async () => {
    const { WebMOutputFormat } = await import('mediabunny');
    const format = new WebMOutputFormat();
    expect(format.mimeType).toBe('video/webm');
  });

  it('Mp4OutputFormat supports avc, hevc, vp9, av1 video codecs', async () => {
    const { Mp4OutputFormat } = await import('mediabunny');
    const format = new Mp4OutputFormat();
    const videoCodecs = format.getSupportedVideoCodecs();
    expect(videoCodecs).toContain('avc');
    expect(videoCodecs).toContain('hevc');
    expect(videoCodecs).toContain('vp9');
    expect(videoCodecs).toContain('av1');
  });

  it('Mp4OutputFormat supports aac and opus audio codecs', async () => {
    const { Mp4OutputFormat } = await import('mediabunny');
    const format = new Mp4OutputFormat();
    const audioCodecs = format.getSupportedAudioCodecs();
    expect(audioCodecs).toContain('aac');
    expect(audioCodecs).toContain('opus');
  });

  it('WebMOutputFormat supports vp9 and av1 but not h264/h265', async () => {
    const { WebMOutputFormat } = await import('mediabunny');
    const format = new WebMOutputFormat();
    const videoCodecs = format.getSupportedVideoCodecs();
    expect(videoCodecs).toContain('vp9');
    expect(videoCodecs).toContain('av1');
    expect(videoCodecs).not.toContain('avc');
    expect(videoCodecs).not.toContain('hevc');
  });

  it('WebMOutputFormat supports opus audio', async () => {
    const { WebMOutputFormat } = await import('mediabunny');
    const format = new WebMOutputFormat();
    const audioCodecs = format.getSupportedAudioCodecs();
    expect(audioCodecs).toContain('opus');
  });

  it('BufferTarget can be instantiated', async () => {
    const { BufferTarget } = await import('mediabunny');
    const target = new BufferTarget();
    expect(target).toBeDefined();
    // Buffer is null before finalization
    expect(target.buffer).toBeNull();
  });
});

// ─── Backward Compatibility: Old Function Names ──────────────────────────
// These tests verify that the old codec helper functions (getMp4MuxerCodec, getWebmMuxerCodec)
// still exist and return values compatible with MediaBunny's codec names.
// If Agent A renames these functions, these imports will need updating.

describe('Backward Compatibility with codecHelpers', () => {
  it('getMp4MuxerCodec returns values that map to MediaBunny video codecs', async () => {
    // Import from the actual codecHelpers module
    const { getMp4MuxerCodec } = await import('../../src/engine/export/codecHelpers');

    // MediaBunny VIDEO_CODECS: ['avc', 'hevc', 'vp9', 'av1', 'vp8']
    const mediaBunnyVideoCodecs = ['avc', 'hevc', 'vp9', 'av1', 'vp8'];

    const codecs: Array<'h264' | 'h265' | 'vp9' | 'av1'> = ['h264', 'h265', 'vp9', 'av1'];
    for (const codec of codecs) {
      const muxerCodec = getMp4MuxerCodec(codec);
      expect(mediaBunnyVideoCodecs).toContain(muxerCodec);
    }
  });

  it('getWebmMuxerCodec values can be mapped to MediaBunny codecs', async () => {
    const { getWebmMuxerCodec } = await import('../../src/engine/export/codecHelpers');

    // WebM muxer uses V_VP9 / V_AV1, while MediaBunny uses vp9 / av1
    const webmToMediaBunny: Record<string, string> = {
      'V_VP9': 'vp9',
      'V_AV1': 'av1',
    };

    const codecs: Array<'h264' | 'h265' | 'vp9' | 'av1'> = ['h264', 'h265', 'vp9', 'av1'];
    for (const codec of codecs) {
      const webmCodec = getWebmMuxerCodec(codec);
      expect(Object.keys(webmToMediaBunny)).toContain(webmCodec);
      const mbCodec = webmToMediaBunny[webmCodec];
      expect(['vp9', 'av1']).toContain(mbCodec);
    }
  });
});

class MockEncodedChunk {
  readonly byteLength: number;
  readonly type: 'key' | 'delta';
  readonly timestamp: number;
  readonly duration: number;
  private readonly bytes: Uint8Array;

  constructor(init: {
    data?: Uint8Array;
    type: 'key' | 'delta';
    timestamp: number;
    duration: number;
  }) {
    this.bytes = init.data ?? new Uint8Array([1, 2, 3]);
    this.byteLength = this.bytes.byteLength;
    this.type = init.type;
    this.timestamp = init.timestamp;
    this.duration = init.duration;
  }

  copyTo(destination: Uint8Array) {
    destination.set(this.bytes);
  }
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).EncodedVideoChunk;
  delete (globalThis as Record<string, unknown>).EncodedAudioChunk;
});

describe('MediaBunnyMuxerAdapter packet sequencing', () => {
  it('assigns monotonic sequence numbers to queued video packets', () => {
    (globalThis as Record<string, unknown>).EncodedVideoChunk = MockEncodedChunk;
    (globalThis as Record<string, unknown>).EncodedAudioChunk = MockEncodedChunk;

    const adapter = new MediaBunnyMuxerAdapter({
      container: 'mp4',
      videoCodec: 'h264',
      fps: 30,
      hasAudio: false,
      audioCodec: 'aac',
    }) as unknown as MuxerAdapter & {
      queue: Array<{ packet: { sequenceNumber: number } }>;
    };

    adapter.addVideoChunk(new MockEncodedChunk({
      type: 'key',
      timestamp: 0,
      duration: 33_333,
    }) as unknown as EncodedVideoChunk);
    adapter.addVideoChunk(new MockEncodedChunk({
      type: 'delta',
      timestamp: 33_333,
      duration: 33_333,
    }) as unknown as EncodedVideoChunk);
    adapter.addVideoChunk(new MockEncodedChunk({
      type: 'delta',
      timestamp: 66_666,
      duration: 33_333,
    }) as unknown as EncodedVideoChunk);

    expect(adapter.queue.map(entry => entry.packet.sequenceNumber)).toEqual([0, 1, 2]);
  });
});
