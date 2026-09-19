import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Composition } from '../../src/stores/mediaStore/types';
import type { SerializableClip, TimelineClip } from '../../src/types/timeline';

const { loadNestedClips, scheduleNestedClipSegmentBuild } = vi.hoisted(() => ({
  loadNestedClips: vi.fn(),
  scheduleNestedClipSegmentBuild: vi.fn(),
}));

vi.mock('../../src/services/project/relinkMedia', () => ({ mediaNeedsRelink: () => false }));
vi.mock('../../src/stores/timeline/nestedCompositionLoader', () => ({
  calculateNestedClipBoundaries: vi.fn(() => [.5]),
  loadNestedClips,
  scheduleNestedClipSegmentBuild,
}));
vi.mock('../../src/stores/timeline/nestedRestore', () => ({ restorePersistedClipVideoState: () => undefined }));
vi.mock('../../src/services/nodeGraph', () => ({ cloneClipNodeGraph: () => undefined }));
vi.mock('../../src/transitions', () => ({ normalizeTransitionInstanceParams: (value: unknown) => value }));

import { restoreLoadStateCompositionClip } from '../../src/stores/timeline/serialization/loadStateCompositionClipRestore';

const transform: SerializableClip['transform'] = {
  position: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  rotation: { x: 0, y: 0, z: 0 },
  opacity: 1,
  blendMode: 'normal',
};

function compositionClip(compositionId: string): SerializableClip {
  return {
    id: 'outer-card',
    trackId: 'track',
    name: 'Generated card',
    mediaFileId: '',
    sourceType: 'video',
    startTime: 0,
    duration: 1,
    inPoint: 0,
    outPoint: 1,
    naturalDuration: 1,
    transform,
    effects: [],
    isComposition: true,
    compositionId,
  };
}

function composition(id: string, clips: SerializableClip[]): Composition {
  return {
    id,
    name: id,
    type: 'composition',
    parentId: null,
    createdAt: 1,
    width: 512,
    height: 184,
    frameRate: 30,
    duration: 1,
    backgroundColor: '#00000000',
    timelineData: {
      tracks: [{ id: 'track', name: 'Video', type: 'video', height: 60, muted: false, visible: true, solo: false }],
      clips,
      playheadPosition: 0,
      duration: 1,
      zoom: 50,
      scrollX: 0,
      inPoint: null,
      outPoint: null,
      loopPlayback: false,
    },
  };
}

function generatedTextClip(): SerializableClip {
  return {
    ...compositionClip('unused'),
    id: 'card-title',
    isComposition: false,
    compositionId: undefined,
    sourceType: 'text',
    textProperties: {
      text: 'L 1 GRIP',
      fontFamily: 'monospace',
      fontSize: 42,
      fontWeight: 400,
      fontStyle: 'normal',
      color: '#14e8ff',
      textAlign: 'left',
      verticalAlign: 'middle',
      lineHeight: 1.2,
      letterSpacing: 0,
      strokeEnabled: false,
      strokeColor: '#000000',
      strokeWidth: 0,
      shadowEnabled: false,
      shadowColor: '#000000',
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      shadowBlur: 0,
      pathEnabled: false,
      pathPoints: [],
    },
  };
}

describe('batched generated composition restore', () => {
  beforeEach(() => {
    loadNestedClips.mockReset();
    scheduleNestedClipSegmentBuild.mockReset();
  });

  it('keeps generated-only clips and nested keyframes buffered until one shared publish', async () => {
    const card = composition('card', [generatedTextClip()]);
    const serializedClip = compositionClip(card.id);
    const buffered: TimelineClip[] = [];
    const flush = vi.fn();
    const set = vi.fn();
    const keyframes = new Map([['outer-card::card-title', [{
      id: 'opacity-key', clipId: 'outer-card::card-title', property: 'opacity', time: 0, value: 1, easing: 'linear',
    }]]]);
    const pushKeyframes = vi.fn();
    loadNestedClips.mockImplementation(async (params) => {
      params.deferNestedKeyframeMerge?.(keyframes);
      return [{ id: 'nested-title' } as TimelineClip];
    });

    const result = await restoreLoadStateCompositionClip({
      serializedClip,
      mediaStore: { files: [], compositions: [card] } as never,
      get: () => ({ thumbnailsEnabled: false } as never),
      set,
      pushRestoredClip: clip => buffered.push(clip),
      flushRestoredClipBuffer: flush,
      patchRestoredClip: (clipId, updater) => {
        const index = buffered.findIndex(clip => clip.id === clipId);
        if (index < 0) return false;
        buffered[index] = updater(buffered[index]);
        return true;
      },
      pushRestoredNestedKeyframes: pushKeyframes,
      isCurrentTimelineSession: () => true,
      wakePreviewAfterRestore: vi.fn(),
      restoreSourceThumbnails: vi.fn(),
    });

    expect(result).toBe('handled');
    expect(flush).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(pushKeyframes).toHaveBeenCalledWith(keyframes);
    expect(buffered[0]).toMatchObject({ isLoading: false, nestedClips: [{ id: 'nested-title' }] });
    expect(scheduleNestedClipSegmentBuild).not.toHaveBeenCalled();
  });

  it('retains eager placeholder publication for compositions with media sources', async () => {
    const mediaChild = { ...generatedTextClip(), sourceType: 'image', mediaFileId: 'image' } as SerializableClip;
    const card = composition('media-card', [mediaChild]);
    loadNestedClips.mockResolvedValue([]);
    const flush = vi.fn();

    await restoreLoadStateCompositionClip({
      serializedClip: compositionClip(card.id),
      mediaStore: { files: [], compositions: [card] } as never,
      get: () => ({ thumbnailsEnabled: false } as never),
      set: vi.fn(),
      pushRestoredClip: vi.fn(),
      flushRestoredClipBuffer: flush,
      patchRestoredClip: vi.fn(() => true),
      pushRestoredNestedKeyframes: vi.fn(),
      isCurrentTimelineSession: () => true,
      wakePreviewAfterRestore: vi.fn(),
      restoreSourceThumbnails: vi.fn(),
    });

    expect(flush).toHaveBeenCalledOnce();
    expect(loadNestedClips.mock.calls[0][0].deferNestedKeyframeMerge).toBeUndefined();
  });
});
