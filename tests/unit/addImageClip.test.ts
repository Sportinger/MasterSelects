import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadImageMedia } from '../../src/stores/timeline/clip/addImageClip';
import { blobUrlManager } from '../../src/stores/timeline/helpers/blobUrlManager';
import { useMediaStore } from '../../src/stores/mediaStore';
import { generateImageThumbnail } from '../../src/stores/timeline/helpers/thumbnailHelpers';
import type { TimelineClip } from '../../src/types';

vi.mock('../../src/stores/timeline/helpers/thumbnailHelpers', () => ({
  generateImageThumbnail: vi.fn(() => 'data:image/jpeg;base64,thumb'),
}));

function imageClip(): TimelineClip {
  const file = new File(['image-bytes'], 'still.png', { type: 'image/png' });

  return {
    id: 'image-clip',
    trackId: 'video-1',
    name: file.name,
    file,
    mediaFileId: 'media-image',
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: {
      type: 'image',
      naturalDuration: 5,
      mediaFileId: 'media-image',
    },
    transform: {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    effects: [],
    isLoading: true,
  };
}

describe('addImageClip', () => {
  afterEach(() => {
    blobUrlManager.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('loads added image clips as data-only sources after thumbnail/native-scale preparation', async () => {
    const clip = imageClip();
    const createdImages: HTMLImageElement[] = [];
    const updateClip = vi.fn();
    const importFile = vi.fn();
    const getFileByName = vi.fn(() => undefined);

    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:add-image');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.mocked(useMediaStore.getState).mockReturnValue({
      activeCompositionId: null,
      compositions: [],
      getFileByName,
      importFile,
    } as unknown as ReturnType<typeof useMediaStore.getState>);
    vi.stubGlobal('Image', function MockImage() {
      const image = document.createElement('img');
      Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 960 });
      Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 540 });
      createdImages.push(image);
      return image;
    } as unknown as typeof Image);

    const loadPromise = loadImageMedia({ clip, updateClip });

    expect(createdImages).toHaveLength(1);
    createdImages[0].dispatchEvent(new Event('load'));
    await loadPromise;

    expect(generateImageThumbnail).toHaveBeenCalledWith(createdImages[0]);
    expect(updateClip).toHaveBeenCalledWith(clip.id, expect.objectContaining({
      source: {
        type: 'image',
        imageUrl: 'blob:add-image',
        naturalDuration: 5,
        mediaFileId: 'media-image',
      },
      transform: expect.objectContaining({
        scale: { x: 0.5, y: 0.5 },
      }),
      thumbnails: ['data:image/jpeg;base64,thumb'],
      isLoading: false,
    }));

    const updates = updateClip.mock.calls[0]?.[1] as Partial<TimelineClip>;
    expect(updates.source && 'imageElement' in updates.source).toBe(false);
    expect(importFile).toHaveBeenCalledWith(clip.file);
  });
});
