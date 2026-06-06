import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineClip } from '../../src/types';

vi.mock('../../src/engine/scene/runtime/SharedSplatRuntimeCache', () => ({
  prewarmGaussianSplatRuntime: vi.fn(),
}));

import { createModelClipPlaceholder, loadModelMedia } from '../../src/stores/timeline/clip/addModelClip';
import {
  createGaussianSplatClipPlaceholder,
  loadGaussianSplatMedia,
} from '../../src/stores/timeline/clip/addGaussianSplatClip';
import { revokeAllMediaObjectUrls } from '../../src/services/project/mediaObjectUrlManager';

describe('spatial clip media-owned URL fallback', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    revokeAllMediaObjectUrls();
  });

  it('uses a media-owned primary url for direct model clips with a media file id', () => {
    const modelFile = new File(['model'], 'hero.glb', { type: 'model/gltf-binary' });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/model-primary');
    const updates: Partial<TimelineClip>[] = [];
    const clip = createModelClipPlaceholder({
      trackId: 'video-1',
      file: modelFile,
      startTime: 0,
      estimatedDuration: 10,
      mediaFileId: 'media-model',
    });

    loadModelMedia({
      clip,
      updateClip: (_id, update) => updates.push(update),
    });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(updates.at(-1)?.source).toEqual(expect.objectContaining({
      type: 'model',
      mediaFileId: 'media-model',
      modelUrl: 'blob:http://localhost/model-primary',
      modelFileName: 'hero.glb',
    }));
  });

  it('uses a media-owned primary url for direct gaussian splat clips with a media file id', () => {
    const splatFile = new File(['splat'], 'scan.ply', { type: 'application/octet-stream' });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/splat-primary');
    const updates: Partial<TimelineClip>[] = [];
    const clip = createGaussianSplatClipPlaceholder({
      trackId: 'video-1',
      file: splatFile,
      startTime: 0,
      estimatedDuration: 30,
      mediaFileId: 'media-splat',
    });

    loadGaussianSplatMedia({
      clip,
      updateClip: (_id, update) => updates.push(update),
    });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(updates.at(-1)?.source).toEqual(expect.objectContaining({
      type: 'gaussian-splat',
      mediaFileId: 'media-splat',
      gaussianSplatUrl: 'blob:http://localhost/splat-primary',
      gaussianSplatFileName: 'scan.ply',
    }));
  });
});
