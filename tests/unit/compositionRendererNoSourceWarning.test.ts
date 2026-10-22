import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { compositionRenderer } from '../../src/services/compositionRenderer';
import { Logger } from '../../src/services/logger';
import { useMediaStore } from '../../src/stores/mediaStore';
import { DEFAULT_TRANSFORM } from '../../src/stores/timeline/constants';
import type { Composition } from '../../src/stores/mediaStore/types';
import type { SerializableClip, TimelineTrack } from '../../src/types/timeline';
import type { TimelineSourceType } from '../../src/types/timelineSource';

function makeClip(id: string, sourceType: TimelineSourceType, mediaFileId: string): SerializableClip {
  return {
    id,
    trackId: sourceType === 'audio' ? 'audio-1' : 'video-1',
    name: id,
    mediaFileId,
    startTime: 0,
    duration: 10,
    inPoint: 0,
    outPoint: 10,
    sourceType,
    transform: structuredClone(DEFAULT_TRANSFORM),
    effects: [],
  };
}

function makeComposition(id: string, clips: SerializableClip[]): Composition {
  const tracks: TimelineTrack[] = [
    { id: 'video-1', name: 'Video 1', type: 'video', height: 60, muted: false, visible: true, solo: false },
    { id: 'audio-1', name: 'Audio 1', type: 'audio', height: 60, muted: false, visible: true, solo: false },
  ];
  return {
    id,
    name: id,
    type: 'composition',
    parentId: null,
    createdAt: 1,
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: 10,
    backgroundColor: '#000000',
    timelineData: {
      tracks,
      clips,
      playheadPosition: 0,
      duration: 10,
      zoom: 50,
      scrollX: 0,
      inPoint: null,
      outPoint: null,
      loopPlayback: false,
    },
  };
}

function mockMedia(composition: Composition, files: unknown[]): void {
  vi.mocked(useMediaStore.getState).mockReturnValue({
    activeCompositionId: 'other-active-composition',
    compositions: [composition],
    files,
    proxyEnabled: false,
  } as unknown as ReturnType<typeof useMediaStore.getState>);
}

function rendererWarnings(): string[] {
  return Logger.getBuffer('WARN')
    .filter(entry => entry.module === 'CompositionRenderer')
    .map(entry => entry.message);
}

describe('compositionRenderer "no sources loaded" warning', () => {
  beforeEach(() => {
    Logger.clear();
  });

  afterEach(() => {
    compositionRenderer.invalidateAll();
    vi.mocked(useMediaStore.getState).mockReset();
  });

  it('does not warn for audio-only compositions, which this renderer never loads', async () => {
    const composition = makeComposition('audio-only', [makeClip('clip-audio-1', 'audio', 'media-wma')]);
    mockMedia(composition, [{ id: 'media-wma', name: 'tone.wma', file: new File(['x'], 'tone.wma') }]);

    for (let pass = 0; pass < 4; pass += 1) {
      compositionRenderer.invalidateComposition(composition.id);
      expect(await compositionRenderer.prepareComposition(composition.id)).toBe(true);
    }

    expect(rendererWarnings()).toEqual([]);
  });

  it('warns once per clip set for visual clips without a source, with their real ids', async () => {
    const composition = makeComposition('broken-visuals', [
      makeClip('clip-video-1', 'video', 'media-missing'),
      makeClip('clip-audio-1', 'audio', 'media-wma'),
    ]);
    mockMedia(composition, [{ id: 'media-wma', name: 'tone.wma', file: new File(['x'], 'tone.wma') }]);

    for (let pass = 0; pass < 3; pass += 1) {
      compositionRenderer.invalidateComposition(composition.id);
      await compositionRenderer.prepareComposition(composition.id);
    }

    const noSourceWarnings = Logger.getBuffer('WARN')
      .filter(entry => entry.module === 'CompositionRenderer' && entry.message.includes('no sources loaded'));
    expect(noSourceWarnings).toHaveLength(1);
    expect(noSourceWarnings[0].message).toContain('1 visual clips');
    expect(noSourceWarnings[0].data).toMatchObject({
      compositionId: 'broken-visuals',
      clips: [{ clipId: 'clip-video-1', sourceType: 'video', mediaFileId: 'media-missing' }],
    });
    expect(rendererWarnings().some(message => message.includes('clip-audio-1'))).toBe(false);

    // A changed clip set is a new situation and warns again.
    const changed = makeComposition('broken-visuals', [
      makeClip('clip-video-1', 'video', 'media-missing'),
      makeClip('clip-video-2', 'video', 'media-missing-2'),
    ]);
    mockMedia(changed, []);
    compositionRenderer.invalidateComposition(changed.id);
    await compositionRenderer.prepareComposition(changed.id);
    expect(Logger.getBuffer('WARN')
      .filter(entry => entry.module === 'CompositionRenderer' && entry.message.includes('no sources loaded')))
      .toHaveLength(2);
  });
});
