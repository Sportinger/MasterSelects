import { describe, expect, it } from 'vitest';

import {
  isAudioFile,
  isMediaFile,
  isModelFile,
  isVideoFile,
} from '../../src/components/timeline/utils/fileTypeHelpers';

describe('timeline file type helpers', () => {
  it('treats glb files as model media for timeline drag and drop', () => {
    const glbFile = new File(['glb'], 'frame000001.glb', { type: 'model/gltf-binary' });

    expect(isModelFile(glbFile)).toBe(true);
    expect(isMediaFile(glbFile)).toBe(true);
    expect(isAudioFile(glbFile)).toBe(false);
    expect(isVideoFile(glbFile)).toBe(false);
  });
});
