import { describe, expect, it, vi } from 'vitest';
import type { TimelineClip } from '../../src/types';
import type { VectorAnimationMetadata } from '../../src/types/vectorAnimation';
import { createLottieClipPlaceholder, loadLottieMedia } from '../../src/stores/timeline/clip/addLottieClip';
import { createRiveClipPlaceholder, loadRiveMedia } from '../../src/stores/timeline/clip/addRiveClip';

function getLastUpdate(updates: Partial<TimelineClip>[]): Partial<TimelineClip> {
  const update = updates.at(-1);
  if (!update) {
    throw new Error('Expected update');
  }
  return update;
}

describe('vector user-action data-only loading', () => {
  it('loads Lottie metadata without storing a runtime canvas on the clip source', async () => {
    const file = new File(['{}'], 'anim.lottie', { type: 'application/json' });
    const metadata: VectorAnimationMetadata = {
      provider: 'lottie',
      width: 1280,
      height: 720,
      duration: 6,
    };
    const clip = createLottieClipPlaceholder({
      trackId: 'video-1',
      file,
      startTime: 0,
      estimatedDuration: 10,
      mediaFileId: 'media-lottie',
      metadata,
    });
    const createElement = vi.spyOn(document, 'createElement');
    const updates: Partial<TimelineClip>[] = [];

    await loadLottieMedia({
      clip,
      file,
      mediaFileId: 'media-lottie',
      metadata,
      updateClip: (_id, update) => updates.push(update),
    });

    const update = getLastUpdate(updates);
    expect(createElement).not.toHaveBeenCalledWith('canvas');
    expect(update.source).toEqual(expect.objectContaining({
      type: 'lottie',
      mediaFileId: 'media-lottie',
      naturalDuration: 6,
    }));
    expect(update.source).not.toHaveProperty('textCanvas');
    expect(clip.transform.scale).toEqual({ x: 1, y: 1 });
    expect(update.transform).toBeUndefined();
    expect(update.isLoading).toBe(false);
  });

  it('loads Rive metadata without storing a runtime canvas on the clip source', async () => {
    const file = new File(['rive'], 'anim.riv', { type: 'application/octet-stream' });
    const metadata: VectorAnimationMetadata = {
      provider: 'rive',
      width: 640,
      height: 480,
      duration: 4,
    };
    const clip = createRiveClipPlaceholder({
      trackId: 'video-1',
      file,
      startTime: 0,
      estimatedDuration: 10,
      mediaFileId: 'media-rive',
      metadata,
    });
    const createElement = vi.spyOn(document, 'createElement');
    const updates: Partial<TimelineClip>[] = [];

    await loadRiveMedia({
      clip,
      file,
      mediaFileId: 'media-rive',
      metadata,
      updateClip: (_id, update) => updates.push(update),
    });

    const update = getLastUpdate(updates);
    expect(createElement).not.toHaveBeenCalledWith('canvas');
    expect(update.source).toEqual(expect.objectContaining({
      type: 'rive',
      mediaFileId: 'media-rive',
      naturalDuration: 4,
    }));
    expect(update.source).not.toHaveProperty('textCanvas');
    expect(clip.transform.scale).toEqual({ x: 1, y: 1 });
    expect(update.transform).toBeUndefined();
    expect(update.isLoading).toBe(false);
  });
});
