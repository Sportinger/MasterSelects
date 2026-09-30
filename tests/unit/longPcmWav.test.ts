import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildPeakDecimatedAudioBuffer } from '../../src/services/audio/longWavPeaksClient';
import {
  isLongPcmWav,
  readPcmWavInfo,
  type PcmWavInfo,
} from '../../src/services/audio/longPcmWav';

/** Minimal AudioBuffer for jsdom (the browser provides the real one). */
class FakeAudioBuffer {
  readonly length: number;
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  readonly channels: Float32Array[];
  constructor(options: { length: number; numberOfChannels: number; sampleRate: number }) {
    this.length = options.length;
    this.numberOfChannels = options.numberOfChannels;
    this.sampleRate = options.sampleRate;
    this.channels = Array.from({ length: options.numberOfChannels }, () => new Float32Array(options.length));
  }
  copyToChannel(data: Float32Array, channel: number) { this.channels[channel]!.set(data); }
  getChannelData(channel: number) { return this.channels[channel]!; }
}

/** 24-bit stereo PCM WAV with a LIST chunk before the data chunk. */
function wav24Bytes(left: number[], right: number[], sampleRate = 48_000): Uint8Array {
  const frames = left.length;
  const list = 26; // 'LIST' + size + 18 payload bytes
  const bytes = new Uint8Array(12 + 24 + list + 8 + frames * 6);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 2, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 6, true); view.setUint16(32, 6, true); view.setUint16(34, 24, true);
  text(36, 'LIST'); view.setUint32(40, 18, true);
  const data = 36 + list;
  text(data, 'data'); view.setUint32(data + 4, frames * 6, true);
  const put = (at: number, value: number) => {
    const int = Math.round(value * 8388607);
    view.setUint8(at, int & 0xff); view.setUint8(at + 1, (int >> 8) & 0xff); view.setUint8(at + 2, (int >> 16) & 0xff);
  };
  for (let i = 0; i < frames; i += 1) {
    put(data + 8 + i * 6, left[i]!);
    put(data + 8 + i * 6 + 3, right[i]!);
  }
  return bytes;
}

function wav24(left: number[], right: number[]): File {
  return new File([wav24Bytes(left, right)], 'stem.wav', { type: 'audio/wav' });
}

describe('long PCM WAV streaming', () => {
  const originalAudioBuffer = globalThis.AudioBuffer;
  beforeEach(() => { (globalThis as { AudioBuffer: unknown }).AudioBuffer = FakeAudioBuffer; });
  afterEach(() => { (globalThis as { AudioBuffer: unknown }).AudioBuffer = originalAudioBuffer; });

  it('reads the fmt and data chunks behind other chunks', async () => {
    const info = await readPcmWavInfo(wav24(new Array(32).fill(0), new Array(32).fill(0)));
    expect(info).toMatchObject({ format: 1, channels: 2, sampleRate: 48_000, bitsPerSample: 24, blockAlign: 6, frames: 32 });
  });

  it('rejects files that are not integer or float PCM WAV', async () => {
    expect(await readPcmWavInfo(new File([new Uint8Array(100)], 'x.wav'))).toBeNull();
    const bytes = wav24Bytes([0], [0]);
    new DataView(bytes.buffer).setUint16(20, 2, true);
    expect(await readPcmWavInfo(new File([bytes], 'adpcm.wav'))).toBeNull();
  });

  it('keeps the signed peak of every decimation block per channel', async () => {
    // 48 kHz decimates by 16 to the 3 kHz AudioBuffer minimum.
    const left = new Array(32).fill(0.01);
    const right = new Array(32).fill(-0.01);
    left[5] = -0.5;
    left[20] = 0.25;
    right[31] = 0.75;
    const file = wav24(left, right);
    const progress: number[] = [];
    const buffer = await buildPeakDecimatedAudioBuffer(file, (await readPcmWavInfo(file))!, {
      onProgress: (fraction, preview) => { progress.push(fraction); expect(Math.max(...preview)).toBe(1); },
    }) as unknown as FakeAudioBuffer;
    expect(progress.at(-1)).toBe(1);
    expect(buffer.sampleRate).toBe(3000);
    expect(buffer.length).toBe(2);
    expect([...buffer.channels[0]!].map((v) => +v.toFixed(4))).toEqual([-0.5, 0.25]);
    expect([...buffer.channels[1]!].map((v) => +v.toFixed(4))).toEqual([-0.01, 0.75]);
  });

  it('treats hour-long stems as long and five-minute pieces as decodable', () => {
    const stem = (seconds: number, channels: number): PcmWavInfo => ({
      format: 1, channels, sampleRate: 48_000, bitsPerSample: 24, blockAlign: channels * 3,
      dataOffset: 44, dataSize: seconds * 48_000 * channels * 3, frames: seconds * 48_000,
    });
    expect(isLongPcmWav(stem(4967, 2))).toBe(true);
    expect(isLongPcmWav(stem(2780, 1))).toBe(true);
    expect(isLongPcmWav(stem(300, 2))).toBe(false);
  });
});
