import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAudioBufferLoadState, loadAudioBufferForScrub } from '../../src/services/proxyFrame/audioBufferLoader';
import { estimateDecodedSourceAudioBytes, MAX_DECODED_SOURCE_AUDIO_BYTES } from '../../src/services/audio/fullSourceDecodeBudget';
import { projectFileService } from '../../src/services/projectFileService';
import { useMediaStore } from '../../src/stores/mediaStore';

function mockMediaFiles(files: Record<string, unknown>[]): void {
  vi.spyOn(useMediaStore, 'getState').mockReturnValue({ files } as unknown as ReturnType<typeof useMediaStore.getState>);
}

function loadOptions(mediaFileId: string, decodeAudioData = vi.fn()) {
  return {
    state: createAudioBufferLoadState(),
    mediaFileId,
    getAudioContext: () => ({ decodeAudioData }) as unknown as AudioContext,
    cacheDecodedAudioBuffer: () => true,
  };
}

describe('full-source audio decode limits', () => {
  afterEach(() => vi.restoreAllMocks());

  it('never reads or decodes a source too long for a whole-file AudioBuffer', async () => {
    const getProxyAudio = vi.spyOn(projectFileService, 'getProxyAudio');
    const arrayBuffer = vi.fn();
    // 83-minute camera clip: ~1.9 GB of Float32 stereo at 48 kHz.
    mockMediaFiles([{ id: 'camera', name: 'holger 1.MXF', duration: 5016.48, file: { size: 62e9, arrayBuffer } }]);
    const decodeAudioData = vi.fn();
    const options = loadOptions('camera', decodeAudioData);

    expect(await loadAudioBufferForScrub(options)).toBeNull();
    expect(await loadAudioBufferForScrub(options)).toBeNull();
    expect(getProxyAudio).not.toHaveBeenCalled();
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(decodeAudioData).not.toHaveBeenCalled();
    expect(options.state.oversized.has('camera')).toBe(true);
    expect(options.state.loading.size).toBe(0);
  });

  it('does not fall back to reading an MXF container without an audio proxy', async () => {
    vi.spyOn(projectFileService, 'getProxyAudio').mockResolvedValue(null);
    const arrayBuffer = vi.fn();
    mockMediaFiles([{ id: 'mxf', name: 'short.MXF', container: 'MXF', duration: 60, file: { size: 4e8, arrayBuffer } }]);
    const decodeAudioData = vi.fn();

    expect(await loadAudioBufferForScrub(loadOptions('mxf', decodeAudioData))).toBeNull();
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(decodeAudioData).not.toHaveBeenCalled();
  });

  it('skips original media larger than the raw read limit', async () => {
    vi.spyOn(projectFileService, 'getProxyAudio').mockResolvedValue(null);
    const arrayBuffer = vi.fn();
    mockMediaFiles([{ id: 'big', name: 'camera.mov', duration: 120, fileSize: 3e9, file: { size: 3e9, arrayBuffer } }]);

    expect(await loadAudioBufferForScrub(loadOptions('big'))).toBeNull();
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('keeps decoding five-minute sources', () => {
    expect(estimateDecodedSourceAudioBytes(300, 48_000)).toBeLessThan(MAX_DECODED_SOURCE_AUDIO_BYTES);
    expect(estimateDecodedSourceAudioBytes(undefined, 48_000)).toBe(0);
  });
});
