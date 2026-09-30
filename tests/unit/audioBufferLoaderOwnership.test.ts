import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAudioBufferLoadState, loadAudioBufferForScrub } from '../../src/services/proxyFrame/audioBufferLoader';
import { projectFileService } from '../../src/services/projectFileService';
import { useMediaStore } from '../../src/stores/mediaStore';

describe('audio decoder byte ownership', () => {
  afterEach(() => vi.restoreAllMocks());

  it('transfers freshly read bytes to the decoder and retains its decoded result', async () => {
    const ownedBytes = new ArrayBuffer(32);
    const file = { arrayBuffer: vi.fn().mockResolvedValue(ownedBytes) } as unknown as Blob;
    const decoded = { duration: 300, numberOfChannels: 2 } as AudioBuffer;
    vi.spyOn(projectFileService, 'getProxyAudio').mockResolvedValue(file);
    vi.spyOn(useMediaStore, 'getState').mockReturnValue({ files: [] } as unknown as ReturnType<typeof useMediaStore.getState>);
    const decodeAudioData = vi.fn(async (bytes: ArrayBuffer) => {
      // Native decodeAudioData consumes its input; no other owner needs it.
      structuredClone(bytes, { transfer: [bytes] });
      return decoded;
    });
    const cacheDecodedAudioBuffer = vi.fn().mockReturnValue(true);
    const state = createAudioBufferLoadState();
    const result = await loadAudioBufferForScrub({
      state, mediaFileId: 'audio',
      getAudioContext: () => ({ decodeAudioData }) as unknown as AudioContext,
      cacheDecodedAudioBuffer,
    });
    expect(decodeAudioData).toHaveBeenCalledWith(ownedBytes);
    expect(ownedBytes.byteLength).toBe(0);
    expect(result).toBe(decoded);
    expect(cacheDecodedAudioBuffer).toHaveBeenCalledWith('audio', decoded);
    expect(state.loading.size).toBe(0);
    expect(state.failed.size).toBe(0);
  });

  it('clears loading and allows a later retry when a consumed decode fails', async () => {
    vi.spyOn(projectFileService, 'getProxyAudio').mockResolvedValue({
      arrayBuffer: async () => new ArrayBuffer(32),
    } as unknown as Blob);
    vi.spyOn(useMediaStore, 'getState').mockReturnValue({ files: [] } as unknown as ReturnType<typeof useMediaStore.getState>);
    const state = createAudioBufferLoadState();
    const decoded = { duration: 300, numberOfChannels: 2 } as AudioBuffer;
    const decodeAudioData = vi.fn().mockRejectedValueOnce(new DOMException('closed', 'InvalidStateError')).mockResolvedValueOnce(decoded);
    const options = { state, mediaFileId: 'audio',
      getAudioContext: () => ({ decodeAudioData }) as unknown as AudioContext,
      cacheDecodedAudioBuffer: () => true };
    expect(await loadAudioBufferForScrub(options)).toBeNull();
    expect(state.loading.size).toBe(0);
    expect(state.failed.size).toBe(0);
    state.retryTime.clear();
    expect(await loadAudioBufferForScrub(options)).toBe(decoded);
    expect(decodeAudioData).toHaveBeenCalledTimes(2);
  });
});
