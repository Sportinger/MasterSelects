import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  decodeAudioBuffer: vi.fn(),
  encodeWav: vi.fn(() => new Blob(['wav'], { type: 'audio/wav' })),
  readAll: vi.fn(),
  runVirtualCommand: vi.fn(),
}));

vi.mock('../../src/engine/audio/AudioFileEncoder', () => ({
  encodeAudioBufferToWavBlob: mocks.encodeWav,
}));
vi.mock('../../src/services/audio/AudioDecodeService', () => ({
  getSharedAudioDecodeService: () => ({ decodeAudioBuffer: mocks.decodeAudioBuffer }),
}));
vi.mock('../../src/engine/audio/exportPipeline/MediaAudioRangeReader', () => ({
  MediaAudioRangeReader: class MediaAudioRangeReader {
    readAll = mocks.readAll;
    dispose = () => {};
  },
}));
vi.mock('../../src/engine/ffmpeg', () => ({
  FFmpegBridge: { isSupported: () => true },
  getFFmpegBridge: () => ({ load: async () => {}, runVirtualCommand: mocks.runVirtualCommand }),
}));
vi.mock('../../src/services/projectFileService', () => ({
  projectFileService: { isProjectOpen: () => false },
}));

import { ensureAudioProxyForMediaFile, type AudioProxyGenerationUpdate } from '../../src/services/audio/AudioProxyService';
import { AudioDecodeServiceError } from '../../src/services/audio/decode/errors';
import { clearSharedSourceAudioDecodeState } from '../../src/services/audio/decode/sharedSourceAudioDecode';
import type { MediaFile } from '../../src/stores/mediaStore/types';

/** Mono 32-bit float WAV (format 3), as the FFmpeg fallback returns it. */
function floatWav(samples: number[], sampleRate = 8000): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 4);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 3, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 32, true);
  ascii(36, 'data'); view.setUint32(40, samples.length * 4, true);
  samples.forEach((sample, i) => view.setFloat32(44 + i * 4, sample, true));
  return bytes;
}

function browserCannotDecode(): AudioDecodeServiceError {
  return new AudioDecodeServiceError('Audio decode runtime browser.decodeAudioData failed', {
    code: 'decode-failed', jobId: 'job', cause: new DOMException('Unable to decode audio data', 'EncodingError'),
  });
}

async function runProxy(mediaFile: MediaFile): Promise<AudioProxyGenerationUpdate[]> {
  const updates: AudioProxyGenerationUpdate[] = [];
  await ensureAudioProxyForMediaFile(mediaFile, { onUpdate: update => updates.push(update) });
  return updates;
}

describe('audio proxy decode fallbacks', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:proxy') }));
  });
  afterEach(() => {
    clearSharedSourceAudioDecodeState();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('builds a playable WAV proxy for a source only FFmpeg can decode (WMA)', async () => {
    mocks.decodeAudioBuffer.mockRejectedValue(browserCannotDecode());
    mocks.readAll.mockRejectedValue(new Error('Unsupported or unrecognizable format'));
    mocks.runVirtualCommand.mockImplementation(async (input: { outputPaths: string[] }) => ({
      [input.outputPaths[0]]: floatWav([0.25, -0.5, 0.75]),
    }));

    const updates = await runProxy({
      id: 'wma', name: 'speech.wma', type: 'audio',
      file: new File([new Uint8Array([0x30, 0x26, 0xb2, 0x75])], 'speech.wma', { type: 'audio/x-ms-wma' }),
    } as MediaFile);

    expect(updates.at(-1)).toMatchObject({ status: 'ready', progress: 100, url: 'blob:proxy' });
    expect(mocks.runVirtualCommand).toHaveBeenCalledTimes(1);
    const encoded = (mocks.encodeWav.mock.calls[0] as unknown as [AudioBuffer])[0];
    expect(Array.from(encoded.getChannelData(0))).toEqual([0.25, -0.5, 0.75]);
  });

  it('reports no audio for a video whose container has no audio track, without running FFmpeg', async () => {
    mocks.decodeAudioBuffer.mockRejectedValue(browserCannotDecode());
    mocks.readAll.mockRejectedValue(Object.assign(new Error('Media source has no audio track'), { code: 'no-audio-track' }));

    const updates = await runProxy({
      id: 'silent-video', name: 'silent.mp4', type: 'video',
      file: new File([new Uint8Array([1, 2, 3])], 'silent.mp4', { type: 'video/mp4' }),
    } as MediaFile);

    expect(updates.at(-1)).toMatchObject({ status: 'none' });
    expect(mocks.runVirtualCommand).not.toHaveBeenCalled();
  });

  it('shows the proxy error status when no decoder can read the source', async () => {
    mocks.decodeAudioBuffer.mockRejectedValue(browserCannotDecode());
    mocks.readAll.mockRejectedValue(new Error('Unsupported or unrecognizable format'));
    mocks.runVirtualCommand.mockRejectedValue(new Error('FFmpeg exited with code 1'));

    const updates = await runProxy({
      id: 'corrupt', name: 'corrupt.wma', type: 'audio',
      file: new File([new Uint8Array([0])], 'corrupt.wma', { type: 'audio/x-ms-wma' }),
    } as MediaFile);

    expect(updates.at(-1)).toMatchObject({ status: 'error', error: expect.stringContaining('ffmpeg.wasm: FFmpeg exited with code 1') });
  });
});
