import { afterEach, describe, expect, it, vi } from 'vitest';

import { compositionAudioMixer } from '../../src/services/compositionAudioMixer';
import { blobUrlManager } from '../../src/stores/timeline/helpers/blobUrlManager';

function audioBuffer(): AudioBuffer {
  return {
    numberOfChannels: 2,
    sampleRate: 48_000,
    length: 48_000,
    duration: 1,
    getChannelData: () => new Float32Array(48_000),
  } as unknown as AudioBuffer;
}

describe('compositionAudioMixer', () => {
  afterEach(() => {
    blobUrlManager.clear();
    compositionAudioMixer.dispose();
    vi.restoreAllMocks();
  });

  it('tracks owner-scoped mixdown audio URLs through the timeline blob manager', () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:composition-audio-1')
      .mockReturnValueOnce('blob:composition-audio-2');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const firstElement = compositionAudioMixer.createAudioElement(audioBuffer(), { ownerClipId: 'comp-clip' });
    const secondElement = compositionAudioMixer.createAudioElement(audioBuffer(), { ownerClipId: 'comp-clip' });

    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(firstElement.getAttribute('src')).toBe('blob:composition-audio-1');
    expect(secondElement.getAttribute('src')).toBe('blob:composition-audio-2');
    expect(blobUrlManager.get('comp-clip', 'audio')).toBe('blob:composition-audio-2');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:composition-audio-1');
  });
});
