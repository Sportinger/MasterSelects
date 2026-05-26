import { describe, expect, it } from 'vitest';
import {
  encodeAudioBufferToWavBytes,
  encodeFloat32PcmChunksToWavBytes,
  estimateFloat32PcmWavByteSize,
  estimateWavByteSize,
  type AudioBufferLike,
} from '../../src/engine/audio/AudioFileEncoder';
import {
  createDefaultExportSettings,
  useExportStore,
} from '../../src/stores/exportStore';

function createAudioBufferLike(options: {
  sampleRate?: number;
  channels: Float32Array[];
}): AudioBufferLike {
  const sampleRate = options.sampleRate ?? 48000;
  const length = options.channels[0]?.length ?? 0;

  return {
    sampleRate,
    numberOfChannels: options.channels.length,
    length,
    getChannelData: (channel) => options.channels[channel] ?? new Float32Array(length),
  };
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

describe('AudioFileEncoder WAV', () => {
  it('writes a valid 16-bit PCM WAV header and interleaved samples', () => {
    const buffer = createAudioBufferLike({
      sampleRate: 8000,
      channels: [
        new Float32Array([0, 1, -1]),
        new Float32Array([0.5, -0.5, 2]),
      ],
    });

    const bytes = encodeAudioBufferToWavBytes(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(bytes.byteLength).toBe(44 + 3 * 2 * 2);
    expect(ascii(bytes, 0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(bytes.byteLength - 8);
    expect(ascii(bytes, 8, 4)).toBe('WAVE');
    expect(ascii(bytes, 12, 4)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint32(28, true)).toBe(8000 * 2 * 2);
    expect(view.getUint16(32, true)).toBe(4);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(bytes, 36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(12);

    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(16384);
    expect(view.getInt16(48, true)).toBe(32767);
    expect(view.getInt16(50, true)).toBe(-16384);
    expect(view.getInt16(52, true)).toBe(-32768);
    expect(view.getInt16(54, true)).toBe(32767);
  });

  it('estimates WAV size without allocating the file', () => {
    const buffer = createAudioBufferLike({
      channels: [new Float32Array(10), new Float32Array(10)],
    });

    expect(estimateWavByteSize(buffer)).toBe(44 + 10 * 2 * 2);
  });

  it('rejects RIFF files above the 4 GB WAV limit', () => {
    const buffer: AudioBufferLike = {
      sampleRate: 48000,
      numberOfChannels: 2,
      length: 0xffffffff,
      getChannelData: () => new Float32Array(0),
    };

    expect(() => encodeAudioBufferToWavBytes(buffer)).toThrow('4 GB');
  });

  it('encodes streamed Float32 PCM chunks into the same interleaved WAV layout', () => {
    const bytes = encodeFloat32PcmChunksToWavBytes({
      sampleRate: 48000,
      channelCount: 2,
      chunks: [
        {
          channels: [
            new Float32Array([0, 0.25]),
            new Float32Array([1, -1]),
          ],
        },
        {
          channels: [
            new Float32Array([-0.25]),
            new Float32Array([0.5]),
          ],
        },
      ],
    });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(bytes.byteLength).toBe(44 + 3 * 2 * 2);
    expect(ascii(bytes, 0, 4)).toBe('RIFF');
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint32(40, true)).toBe(12);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(32767);
    expect(view.getInt16(48, true)).toBe(8192);
    expect(view.getInt16(50, true)).toBe(-32768);
    expect(view.getInt16(52, true)).toBe(-8192);
    expect(view.getInt16(54, true)).toBe(16384);
  });

  it('truncates streamed PCM to explicit frame count and zero-fills missing channels', () => {
    const bytes = encodeFloat32PcmChunksToWavBytes({
      sampleRate: 8000,
      channelCount: 2,
      frameCount: 2,
      chunks: [
        {
          channels: [
            new Float32Array([1, -1, 0.5]),
          ],
        },
      ],
    });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(bytes.byteLength).toBe(44 + 2 * 2 * 2);
    expect(view.getUint32(40, true)).toBe(8);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(0);
    expect(view.getInt16(48, true)).toBe(-32768);
    expect(view.getInt16(50, true)).toBe(0);
  });

  it('estimates streamed PCM WAV size from explicit frame count', () => {
    expect(estimateFloat32PcmWavByteSize({
      sampleRate: 44100,
      channelCount: 2,
      chunks: [],
      frameCount: 2048,
    })).toBe(44 + 2048 * 2 * 2);
  });

  it('rejects streamed PCM above the 4 GB WAV limit before allocation', () => {
    expect(() => encodeFloat32PcmChunksToWavBytes({
      sampleRate: 48000,
      channelCount: 2,
      chunks: [],
      frameCount: 0xffffffff,
    })).toThrow('4 GB');
  });
});

describe('audio-only export settings', () => {
  it('defaults audio-only export to WAV', () => {
    expect(createDefaultExportSettings().audioOnlyFormat).toBe('wav');
  });

  it('persists browser audio mode and sanitizes invalid values', () => {
    useExportStore.getState().reset();
    useExportStore.getState().setSettings({ audioOnlyFormat: 'browser' });
    expect(useExportStore.getState().settings.audioOnlyFormat).toBe('browser');

    useExportStore.getState().replaceSettings({
      audioOnlyFormat: 'mp3' as never,
    });
    expect(useExportStore.getState().settings.audioOnlyFormat).toBe('wav');
  });
});
