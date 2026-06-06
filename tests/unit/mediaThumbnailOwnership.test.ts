import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbGetThumbnail: vi.fn(),
  dbSaveThumbnail: vi.fn(async () => undefined),
  getProjectThumbnail: vi.fn(),
  isProjectOpen: vi.fn(() => false),
  saveProjectThumbnail: vi.fn(async () => undefined),
}));

vi.mock('../../src/services/projectDB', () => ({
  projectDB: {
    getThumbnail: mocks.dbGetThumbnail,
    saveThumbnail: mocks.dbSaveThumbnail,
  },
}));

vi.mock('../../src/services/projectFileService', () => ({
  projectFileService: {
    getThumbnail: mocks.getProjectThumbnail,
    isProjectOpen: mocks.isProjectOpen,
    saveThumbnail: mocks.saveProjectThumbnail,
  },
}));

import { handleThumbnailDedup } from '../../src/stores/mediaStore/helpers/thumbnailHelpers';
import {
  getThumbnailMediaObjectUrlKey,
  mediaObjectUrlManager,
  revokeAllMediaObjectUrls,
} from '../../src/services/project/mediaObjectUrlManager';

describe('media thumbnail object URL ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    revokeAllMediaObjectUrls();
    mocks.dbGetThumbnail.mockResolvedValue(undefined);
    mocks.isProjectOpen.mockReturnValue(false);
  });

  afterEach(() => {
    revokeAllMediaObjectUrls();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns a managed media-owned URL for reused thumbnail blobs', async () => {
    const existingBlob = new Blob(['existing-thumb'], { type: 'image/webp' });
    mocks.dbGetThumbnail.mockResolvedValue({
      blob: existingBlob,
      createdAt: 1,
      fileHash: 'hash-1',
    });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:managed-existing');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    const thumbnailUrl = await handleThumbnailDedup('hash-1', 'blob:temporary-thumb', 'media-1');

    expect(thumbnailUrl).toBe('blob:managed-existing');
    expect(createObjectURL).toHaveBeenCalledWith(existingBlob);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:temporary-thumb');
    expect(mediaObjectUrlManager.get('media-1', getThumbnailMediaObjectUrlKey())).toBe('blob:managed-existing');
  });

  it('converts newly generated blob thumbnails to managed media-owned URLs', async () => {
    const generatedBlob = new Blob(['generated-thumb'], { type: 'image/webp' });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      blob: async () => generatedBlob,
    })));
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:managed-generated');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    const thumbnailUrl = await handleThumbnailDedup('hash-2', 'blob:temporary-generated', 'media-2');

    expect(thumbnailUrl).toBe('blob:managed-generated');
    expect(mocks.dbSaveThumbnail).toHaveBeenCalledWith(expect.objectContaining({
      blob: generatedBlob,
      fileHash: 'hash-2',
    }));
    expect(createObjectURL).toHaveBeenCalledWith(generatedBlob);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:temporary-generated');
    expect(mediaObjectUrlManager.get('media-2', getThumbnailMediaObjectUrlKey())).toBe('blob:managed-generated');
  });
});
