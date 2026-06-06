import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  collectMediaFileObjectUrls,
  createMediaObjectUrl,
  createPrimaryMediaObjectUrl,
  createThumbnailMediaObjectUrl,
  getGaussianSplatSequenceFrameObjectUrlKey,
  getLazyMediaElementObjectUrlKey,
  getModelSequenceFrameObjectUrlKey,
  getPrimaryMediaObjectUrlKey,
  getThumbnailMediaObjectUrlKey,
  mediaObjectUrlManager,
  revokeAllMediaObjectUrls,
  revokeMediaFileObjectUrls,
} from '../../src/services/project/mediaObjectUrlManager';

describe('mediaObjectUrlManager', () => {
  afterEach(() => {
    revokeAllMediaObjectUrls();
    vi.restoreAllMocks();
  });

  it('tracks model and gaussian sequence frame urls by media id and frame key', () => {
    vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:model-frame-0')
      .mockReturnValueOnce('blob:splat-frame-0');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const modelUrl = createMediaObjectUrl(
      'media-1',
      getModelSequenceFrameObjectUrlKey(0),
      new File(['model'], 'hero000000.glb', { type: 'model/gltf-binary' }),
    );
    const splatUrl = createMediaObjectUrl(
      'media-1',
      getGaussianSplatSequenceFrameObjectUrlKey(0),
      new File(['splat'], 'scan000000.ply', { type: 'application/octet-stream' }),
    );

    expect(modelUrl).toBe('blob:model-frame-0');
    expect(splatUrl).toBe('blob:splat-frame-0');
    expect(mediaObjectUrlManager.get('media-1', getModelSequenceFrameObjectUrlKey(0))).toBe('blob:model-frame-0');
    expect(mediaObjectUrlManager.get('media-1', getGaussianSplatSequenceFrameObjectUrlKey(0))).toBe('blob:splat-frame-0');
    expect(mediaObjectUrlManager.getStats()).toEqual({ mediaCount: 1, urlCount: 2 });

    const revoked = revokeAllMediaObjectUrls();

    expect([...revoked].sort()).toEqual(['blob:model-frame-0', 'blob:splat-frame-0']);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:model-frame-0');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:splat-frame-0');
    expect(mediaObjectUrlManager.getStats()).toEqual({ mediaCount: 0, urlCount: 0 });
  });

  it('revokes replaced frame urls for the same media key', () => {
    vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:old-frame')
      .mockReturnValueOnce('blob:new-frame');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const key = getModelSequenceFrameObjectUrlKey(0);

    createMediaObjectUrl('media-1', key, new File(['old'], 'old.glb'));
    const nextUrl = createMediaObjectUrl('media-1', key, new File(['new'], 'new.glb'));

    expect(nextUrl).toBe('blob:new-frame');
    expect(mediaObjectUrlManager.get('media-1', key)).toBe('blob:new-frame');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:old-frame');
  });

  it('tracks primary media urls with a stable media key', () => {
    vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:primary-video');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const url = createPrimaryMediaObjectUrl('media-primary', new File(['video'], 'clip.mp4'));

    expect(url).toBe('blob:primary-video');
    expect(mediaObjectUrlManager.get('media-primary', getPrimaryMediaObjectUrlKey())).toBe('blob:primary-video');

    const revoked = revokeMediaFileObjectUrls({
      id: 'media-primary',
      url,
    });

    expect([...revoked]).toEqual(['blob:primary-video']);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:primary-video');
    expect(mediaObjectUrlManager.getStats()).toEqual({ mediaCount: 0, urlCount: 0 });
  });

  it('tracks lazy media element urls separately from primary urls', () => {
    vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:primary-video')
      .mockReturnValueOnce('blob:lazy-video');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' });
    const primaryUrl = createPrimaryMediaObjectUrl('media-video', file);
    const lazyUrl = createMediaObjectUrl('media-video', getLazyMediaElementObjectUrlKey('video', 'clip-1'), file);

    expect(primaryUrl).toBe('blob:primary-video');
    expect(lazyUrl).toBe('blob:lazy-video');
    expect(mediaObjectUrlManager.get('media-video', getPrimaryMediaObjectUrlKey())).toBe('blob:primary-video');
    expect(mediaObjectUrlManager.get('media-video', getLazyMediaElementObjectUrlKey('video', 'clip-1'))).toBe('blob:lazy-video');

    mediaObjectUrlManager.revoke('media-video', getLazyMediaElementObjectUrlKey('video', 'clip-1'));

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:lazy-video');
    expect(mediaObjectUrlManager.get('media-video', getPrimaryMediaObjectUrlKey())).toBe('blob:primary-video');
  });

  it('tracks thumbnail urls separately from primary media urls', () => {
    vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:primary-image')
      .mockReturnValueOnce('blob:thumbnail-image');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const file = new File(['image'], 'still.png', { type: 'image/png' });
    const thumbnail = new Blob(['thumb'], { type: 'image/webp' });

    const primaryUrl = createPrimaryMediaObjectUrl('media-image', file);
    const thumbnailUrl = createThumbnailMediaObjectUrl('media-image', thumbnail);

    expect(primaryUrl).toBe('blob:primary-image');
    expect(thumbnailUrl).toBe('blob:thumbnail-image');
    expect(mediaObjectUrlManager.get('media-image', getPrimaryMediaObjectUrlKey())).toBe('blob:primary-image');
    expect(mediaObjectUrlManager.get('media-image', getThumbnailMediaObjectUrlKey())).toBe('blob:thumbnail-image');

    const revoked = revokeMediaFileObjectUrls({
      id: 'media-image',
      url: primaryUrl,
      thumbnailUrl,
    });

    expect([...revoked].sort()).toEqual(['blob:primary-image', 'blob:thumbnail-image']);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:primary-image');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:thumbnail-image');
  });

  it('collects and revokes media-level sequence urls while preserving replacement urls', () => {
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const mediaFile = {
      id: 'media-1',
      url: 'blob:old-main',
      thumbnailUrl: 'data:image/png;base64,thumb',
      proxyVideoUrl: 'blob:old-proxy-video',
      audioProxyUrl: 'blob:old-audio-proxy',
      modelSequence: {
        frames: [
          { modelUrl: 'blob:old-model-0' },
          { modelUrl: 'blob:new-model-1' },
        ],
      },
      gaussianSplatSequence: {
        frames: [
          { splatUrl: 'blob:old-splat-0' },
        ],
      },
    };

    expect([...collectMediaFileObjectUrls(mediaFile)].sort()).toEqual([
      'blob:new-model-1',
      'blob:old-audio-proxy',
      'blob:old-main',
      'blob:old-model-0',
      'blob:old-proxy-video',
      'blob:old-splat-0',
    ]);

    const revoked = revokeMediaFileObjectUrls(mediaFile, {
      keepUrls: ['blob:new-model-1'],
    });

    expect([...revoked].sort()).toEqual([
      'blob:old-audio-proxy',
      'blob:old-main',
      'blob:old-model-0',
      'blob:old-proxy-video',
      'blob:old-splat-0',
    ]);
    expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:new-model-1');
  });
});
