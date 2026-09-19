import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dispose: vi.fn(),
  inputConstructed: vi.fn(),
  videoTrack: {
    displayWidth: 1920,
    displayHeight: 1080,
    codedWidth: 1920,
    codedHeight: 1088,
    rotation: 0,
    pixelAspectRatio: { num: 1, den: 1 },
    internalCodecId: 'apch',
    getCodecParameterString: vi.fn(async () => null),
    computePacketStats: vi.fn(async () => ({ averagePacketRate: 23.976 })),
    getColorSpace: vi.fn(async () => ({
      primaries: 'bt709',
      transfer: 'bt709',
      matrix: 'bt709',
      fullRange: false,
    })),
    hasHighDynamicRange: vi.fn(async () => false),
    canBeTransparent: vi.fn(async () => false),
  },
  audioTrack: {
    internalCodecId: 'mp4a',
    getCodecParameterString: vi.fn(async () => 'mp4a.40.2'),
  },
}));

vi.mock('mediabunny', () => ({
  MP4: { name: 'MP4' },
  QTFF: { name: 'QTFF' },
  BlobSource: class BlobSource {
    constructor(public file: File, public options?: { maxCacheSize?: number }) {}
  },
  Input: class Input {
    constructor(options: unknown) {
      mocks.inputConstructed(options);
    }
    computeDuration = vi.fn(async () => 10);
    getVideoTracks = vi.fn(async () => [mocks.videoTrack]);
    getAudioTracks = vi.fn(async () => [mocks.audioTrack]);
    dispose = mocks.dispose;
  },
}));

import { readIsobmffMetadata } from '../../src/services/mediaMetadata/isobmffMetadata';
import { getMediaInfo } from '../../src/stores/mediaStore/helpers/mediaInfoHelpers';

describe('ISOBMFF media metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts raw FourCC, display/coded geometry, audio, and color hints', async () => {
    const result = await readIsobmMetadataFixture();

    expect(result).toMatchObject({
      duration: 10,
      width: 1920,
      height: 1080,
      codedWidth: 1920,
      codedHeight: 1088,
      fps: 23.98,
      videoCodecId: 'apch',
      audioCodecId: 'mp4a',
      audioCodecParameter: 'mp4a.40.2',
      hasAudio: true,
      rotation: 0,
      pixelAspectRatio: { numerator: 1, denominator: 1 },
      videoColorSpace: {
        primaries: 'bt709',
        transfer: 'bt709',
        matrix: 'bt709',
        fullRange: false,
      },
      hasHighDynamicRange: false,
      canBeTransparent: false,
    });
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });

  it('returns authoritative ProRes metadata even when HTML video rejects the file', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:prores');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName !== 'video') return realCreateElement(tagName);
      const fakeVideo = {
        onloadedmetadata: null as (() => void) | null,
        onerror: null as (() => void) | null,
        preload: '',
        muted: false,
        playsInline: false,
        src: '',
        duration: Number.NaN,
        videoWidth: 0,
        videoHeight: 0,
        pause: vi.fn(),
        removeAttribute(name: string) {
          if (name === 'src') this.src = '';
        },
        load() {
          this.onerror?.();
        },
      };
      return fakeVideo as unknown as HTMLVideoElement;
    }) as typeof document.createElement);

    const file = new File(['mov-bytes'], 'camera.mov', { type: 'video/quicktime' });
    const info = await getMediaInfo(file, 'video');

    expect(info).toMatchObject({
      duration: 10,
      width: 1920,
      height: 1080,
      codedHeight: 1088,
      fps: 23.98,
      codec: 'ProRes 422 HQ',
      videoCodecId: 'apch',
      audioCodec: 'AAC',
      hasAudio: true,
    });
    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:prores');
  });

  it.each([false, true])(
    'cancels the pending HTML probe before revoking its URL when container metadata wins (reset throws: %s)',
    async (resetThrows) => {
      const video = document.createElement('video');
      const loadedSources: Array<string | null> = [];
      vi.spyOn(video, 'pause').mockImplementation(() => undefined);
      vi.spyOn(video, 'load').mockImplementation(() => {
        const source = video.getAttribute('src');
        loadedSources.push(source);
        if (source === null && resetThrows) throw new Error('Detached video reset failed');
      });
      const realCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => (
        tagName === 'video' ? video : realCreateElement(tagName)
      )) as typeof document.createElement);
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pending-metadata');
      const revokedSources: Array<{ src: string | null; loadedSources: Array<string | null> }> = [];
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {
        revokedSources.push({ src: video.getAttribute('src'), loadedSources: [...loadedSources] });
      });

      // The HTML probe never emits loadedmetadata or error: the independent
      // container reader must cancel its still-pending browser request.
      const info = await getMediaInfo(
        new File(['mov-bytes'], 'camera.mov', { type: 'video/quicktime' }),
        'video',
      );

      expect(info).toMatchObject({ duration: 10, videoCodecId: 'apch', hasAudio: true });
      expect(revokedSources).toEqual([
        { src: null, loadedSources: ['blob:pending-metadata', null] },
      ]);
      expect(video.pause).toHaveBeenCalledOnce();
      expect(video.onloadedmetadata).toBeNull();
      expect(video.onerror).toBeNull();
    },
  );

  it('does not instantiate a demuxer for non-ISOBMFF names', async () => {
    const result = await readIsobmffMetadata(
      new File(['webm'], 'clip.webm', { type: 'video/webm' }),
    );
    expect(result).toBeNull();
    expect(mocks.inputConstructed).not.toHaveBeenCalled();
  });
});

function readIsobmMetadataFixture() {
  return readIsobmffMetadata(
    new File(['mov-bytes'], 'camera.mov', { type: 'video/quicktime' }),
  );
}
