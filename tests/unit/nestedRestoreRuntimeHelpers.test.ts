import { afterEach, describe, expect, it, vi } from 'vitest';
import { vectorAnimationRuntimeManager } from '../../src/services/vectorAnimation/VectorAnimationRuntimeManager';
import {
  patchNestedClipInCompositionClip,
} from '../../src/stores/timeline/nestedRestore';
import { startRestoredVectorRuntimeRestore } from '../../src/stores/timeline/vectorRuntimeRestore';
import type { SerializableClip, TimelineClip } from '../../src/types';

const transform = {
  opacity: 1,
  blendMode: 'normal' as const,
  position: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  rotation: { x: 0, y: 0, z: 0 },
};

function timelineClip(id: string, overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id,
    trackId: 'track-video',
    name: id,
    file: new File([], `${id}.dat`),
    startTime: 0,
    duration: 4,
    inPoint: 0,
    outPoint: 4,
    source: null,
    transform,
    effects: [],
    isLoading: true,
    ...overrides,
  } as TimelineClip;
}

function serializedVectorClip(id: string): SerializableClip {
  return {
    id,
    trackId: 'track-video',
    name: `${id}.lottie`,
    mediaFileId: `media-${id}`,
    sourceType: 'lottie',
    startTime: 0,
    duration: 4,
    inPoint: 0,
    outPoint: 4,
    naturalDuration: 4,
    transform,
    effects: [],
  } as SerializableClip;
}

describe('nested restore runtime helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('patches deeply nested clips inside a composition clip immutably', () => {
    const nestedImage = timelineClip('nested-image');
    const nestedComp = timelineClip('nested-comp', {
      isComposition: true,
      nestedClips: [nestedImage],
    });
    const parent = timelineClip('parent-comp', {
      isComposition: true,
      nestedClips: [nestedComp],
    });
    const sibling = timelineClip('sibling');
    const topLevelClips = [parent, sibling];

    const result = patchNestedClipInCompositionClip(
      topLevelClips,
      parent.id,
      nestedImage.id,
      { isLoading: false, source: { type: 'image' } },
    );

    expect(result.patched).toBe(true);
    expect(result.clips).not.toBe(topLevelClips);
    expect(result.clips[1]).toBe(sibling);
    expect(result.clips[0]).not.toBe(parent);
    expect(result.clips[0].nestedClips?.[0]).not.toBe(nestedComp);
    expect(result.clips[0].nestedClips?.[0].nestedClips?.[0]).not.toBe(nestedImage);
    expect(result.clips[0].nestedClips?.[0].nestedClips?.[0].source).toEqual({ type: 'image' });
    expect(result.clips[0].nestedClips?.[0].nestedClips?.[0].isLoading).toBe(false);
  });

  it('destroys the stale vector runtime when no newer restore has superseded it', async () => {
    const clip = timelineClip('vector-clip');
    const file = new File(['{}'], 'anim.lottie', { type: 'application/json' });
    const canvas = document.createElement('canvas');
    const applyPatch = vi.fn();
    const onStale = vi.fn();
    const destroySpy = vi.spyOn(vectorAnimationRuntimeManager, 'destroyClipRuntime').mockImplementation(() => undefined);
    const renderSpy = vi.spyOn(vectorAnimationRuntimeManager, 'renderClipAtTime').mockReturnValue(canvas);
    vi.spyOn(vectorAnimationRuntimeManager, 'prepareClipSource').mockResolvedValue({
      canvas,
      metadata: { provider: 'lottie', duration: 5 },
    });

    startRestoredVectorRuntimeRestore({
      clip,
      serializedClip: serializedVectorClip(clip.id),
      sourceType: 'lottie',
      file,
      isCurrentSession: () => false,
      applyPatch,
      onStale,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(applyPatch).not.toHaveBeenCalled();
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(destroySpy).toHaveBeenCalledWith(clip.id, 'lottie');
    expect(renderSpy).not.toHaveBeenCalled();
    expect(clip.source).toBeNull();
    expect(clip.isLoading).toBe(true);
  });

  it('does not mutate or render vector clips that become stale before prepare resolves', async () => {
    const clip = timelineClip('vector-clip');
    const file = new File(['{}'], 'anim.lottie', { type: 'application/json' });
    const canvas = document.createElement('canvas');
    const applyPatch = vi.fn();
    const onReady = vi.fn();
    const onStale = vi.fn();
    let isCurrent = true;
    let resolvePrepare!: (value: { canvas: HTMLCanvasElement; metadata: { provider: 'lottie'; duration: number } }) => void;
    const destroySpy = vi.spyOn(vectorAnimationRuntimeManager, 'destroyClipRuntime').mockImplementation(() => undefined);
    const renderSpy = vi.spyOn(vectorAnimationRuntimeManager, 'renderClipAtTime').mockReturnValue(canvas);
    vi.spyOn(vectorAnimationRuntimeManager, 'prepareClipSource').mockReturnValue(new Promise((resolve) => {
      resolvePrepare = resolve;
    }));

    startRestoredVectorRuntimeRestore({
      clip,
      serializedClip: serializedVectorClip(clip.id),
      sourceType: 'lottie',
      file,
      isCurrentSession: () => isCurrent,
      applyPatch,
      onReady,
      onStale,
    });

    isCurrent = false;
    resolvePrepare({ canvas, metadata: { provider: 'lottie', duration: 5 } });
    await Promise.resolve();
    await Promise.resolve();

    expect(applyPatch).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(destroySpy).toHaveBeenCalledWith(clip.id, 'lottie');
    expect(renderSpy).not.toHaveBeenCalled();
    expect(clip.source).toBeNull();
    expect(clip.isLoading).toBe(true);
  });

  it('does not let an older stale vector restore destroy a newer same-clip restore', async () => {
    const file = new File(['{}'], 'anim.lottie', { type: 'application/json' });
    const firstClip = timelineClip('vector-clip');
    const secondClip = timelineClip('vector-clip');
    const firstCanvas = document.createElement('canvas');
    const secondCanvas = document.createElement('canvas');
    const firstApplyPatch = vi.fn();
    const secondApplyPatch = vi.fn();
    const firstOnStale = vi.fn();
    const destroySpy = vi.spyOn(vectorAnimationRuntimeManager, 'destroyClipRuntime').mockImplementation(() => undefined);
    const renderSpy = vi.spyOn(vectorAnimationRuntimeManager, 'renderClipAtTime').mockImplementation((runtimeClip) => {
      return runtimeClip === firstClip ? firstCanvas : secondCanvas;
    });
    let resolveFirst!: (value: { canvas: HTMLCanvasElement; metadata: { provider: 'lottie'; duration: number } }) => void;
    let resolveSecond!: (value: { canvas: HTMLCanvasElement; metadata: { provider: 'lottie'; duration: number } }) => void;
    vi.spyOn(vectorAnimationRuntimeManager, 'prepareClipSource')
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveFirst = resolve;
      }))
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveSecond = resolve;
      }));

    startRestoredVectorRuntimeRestore({
      clip: firstClip,
      serializedClip: serializedVectorClip(firstClip.id),
      sourceType: 'lottie',
      file,
      isCurrentSession: () => false,
      applyPatch: firstApplyPatch,
      onStale: firstOnStale,
    });
    startRestoredVectorRuntimeRestore({
      clip: secondClip,
      serializedClip: serializedVectorClip(secondClip.id),
      sourceType: 'lottie',
      file,
      isCurrentSession: () => true,
      applyPatch: secondApplyPatch,
    });

    resolveFirst({ canvas: firstCanvas, metadata: { provider: 'lottie', duration: 5 } });
    await Promise.resolve();
    await Promise.resolve();

    expect(firstApplyPatch).not.toHaveBeenCalled();
    expect(firstOnStale).toHaveBeenCalledTimes(1);
    expect(destroySpy).not.toHaveBeenCalled();
    expect(renderSpy).not.toHaveBeenCalled();
    expect(firstClip.source).toBeNull();
    expect(firstClip.isLoading).toBe(true);

    resolveSecond({ canvas: secondCanvas, metadata: { provider: 'lottie', duration: 6 } });
    await Promise.resolve();
    await Promise.resolve();

    expect(secondApplyPatch).toHaveBeenCalledWith(expect.objectContaining({
      file,
      isLoading: false,
      source: expect.objectContaining({
        type: 'lottie',
        textCanvas: secondCanvas,
        naturalDuration: 6,
      }),
    }));
    expect(destroySpy).not.toHaveBeenCalled();
    expect(renderSpy).toHaveBeenCalledWith(secondClip, 0);
  });
});
