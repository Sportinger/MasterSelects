import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  decodeAudioBuffer: vi.fn(),
  encodeWav: vi.fn(() => new Blob(['wav'], { type: 'audio/wav' })),
  rangeRead: vi.fn(),
  rangeDispose: vi.fn(),
}));

vi.mock('../../src/engine/audio/AudioFileEncoder', () => ({
  encodeAudioBufferToWavBlob: mocks.encodeWav,
}));
vi.mock('../../src/services/audio/AudioDecodeService', () => ({
  AudioDecodeServiceError: class AudioDecodeServiceError extends Error {},
  getSharedAudioDecodeService: () => ({ decodeAudioBuffer: mocks.decodeAudioBuffer }),
}));
vi.mock('../../src/engine/audio/exportPipeline/MediaAudioRangeReader', () => ({
  MediaAudioRangeReader: class MediaAudioRangeReader {
    read = mocks.rangeRead;
    dispose = mocks.rangeDispose;
  },
}));
vi.mock('../../src/services/projectFileService', () => ({
  projectFileService: {
    isProjectOpen: () => false,
  },
}));

import { ensureAudioProxyForMediaFile } from '../../src/services/audio/AudioProxyService';
import type { MediaFile } from '../../src/stores/mediaStore/types';

describe('ProRes audio proxy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mocks.decodeAudioBuffer.mockReset();
    mocks.encodeWav.mockClear();
    mocks.rangeRead.mockReset();
    mocks.rangeDispose.mockReset();
  });

  it('decodes the MOV audio track independently through Mediabunny range reads', async () => {
    const audioBuffer = { duration: 4 } as AudioBuffer;
    mocks.rangeRead.mockResolvedValue(audioBuffer);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:prores-audio-proxy');
    const onUpdate = vi.fn();
    const file = new File(['mov'], 'camera.mov', { type: 'video/quicktime' });
    const mediaFile = {
      id: 'media-prores-audio',
      name: 'camera.mov',
      type: 'video',
      file,
      duration: 4,
      hasAudio: true,
      audioCodec: 'aac',
      videoCodecId: 'apch',
    } as MediaFile;

    await ensureAudioProxyForMediaFile(mediaFile, { onUpdate });

    expect(mocks.rangeRead).toHaveBeenCalledWith(0, 4);
    expect(mocks.rangeDispose).toHaveBeenCalledOnce();
    expect(mocks.decodeAudioBuffer).not.toHaveBeenCalled();
    expect(mocks.encodeWav).toHaveBeenCalledWith(audioBuffer);
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'ready',
      progress: 100,
      url: 'blob:prores-audio-proxy',
    }));
  });
});
