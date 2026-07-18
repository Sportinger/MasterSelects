import { describe, expect, it } from 'vitest';

import {
  isAudioFile,
  isMediaFile,
  isModelFile,
  isVideoFile,
} from '../../src/components/timeline/utils/fileTypeHelpers';

describe('timeline file type helpers', () => {
  it('treats model files as model media for timeline drag and drop', () => {
    const glbFile = new File(['glb'], 'frame000001.glb', { type: 'model/gltf-binary' });
    const fbxFile = new File(['fbx'], 'scene.FBX', { type: 'application/octet-stream' });

    expect(isModelFile(glbFile)).toBe(true);
    expect(isMediaFile(glbFile)).toBe(true);
    expect(isAudioFile(glbFile)).toBe(false);
    expect(isVideoFile(glbFile)).toBe(false);
    expect(isModelFile(fbxFile)).toBe(true);
    expect(isMediaFile(fbxFile)).toBe(true);
    expect(isAudioFile(fbxFile)).toBe(false);
    expect(isVideoFile(fbxFile)).toBe(false);
  });
});
