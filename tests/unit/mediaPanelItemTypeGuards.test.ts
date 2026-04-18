import { describe, expect, it } from 'vitest';

import {
  getItemImportProgress,
  isImportedMediaFileItem,
} from '../../src/components/panels/media/itemTypeGuards';
import type { MediaFile, MeshItem } from '../../src/stores/mediaStore/types';

describe('media panel item type guards', () => {
  it('treats imported glb assets as media files', () => {
    const item: MediaFile = {
      id: 'media-1',
      name: 'frame (231f)',
      type: 'model',
      parentId: null,
      createdAt: Date.now(),
      file: new File(['glb'], 'frame000001.glb', { type: 'model/gltf-binary' }),
      url: 'blob:test',
      duration: 7.7,
    };

    expect(isImportedMediaFileItem(item)).toBe(true);
  });

  it('does not treat primitive mesh items as imported media files', () => {
    const item: MeshItem = {
      id: 'mesh-1',
      name: 'Cube',
      type: 'model',
      parentId: null,
      createdAt: Date.now(),
      meshType: 'cube',
      color: '#ffffff',
      duration: 10,
    };

    expect(isImportedMediaFileItem(item)).toBe(false);
  });

  it('returns rounded import progress only while importing', () => {
    const item: MediaFile = {
      id: 'media-2',
      name: 'frame (231f)',
      type: 'model',
      parentId: null,
      createdAt: Date.now(),
      file: new File(['glb'], 'frame000001.glb', { type: 'model/gltf-binary' }),
      url: 'blob:test',
      importProgress: 47.6,
      isImporting: true,
    };

    expect(getItemImportProgress(item)).toBe(48);
    expect(getItemImportProgress({ ...item, isImporting: false })).toBeNull();
  });
});
