import { afterEach, describe, expect, it, vi } from 'vitest';

import { compositionRenderer } from '../../src/services/compositionRenderer';
import { textRenderer } from '../../src/services/textRenderer';
import { useMediaStore } from '../../src/stores/mediaStore';
import {
  DEFAULT_TEXT_PROPERTIES,
  DEFAULT_TRANSFORM,
} from '../../src/stores/timeline/constants';
import type { Composition } from '../../src/stores/mediaStore/types';
import type { SerializableClip, TimelineTrack } from '../../src/types/timeline';

function makeTextClip(id: string, trackId: string, text: string): SerializableClip {
  return {
    id,
    trackId,
    name: text,
    mediaFileId: '',
    startTime: 0,
    duration: 10,
    inPoint: 0,
    outPoint: 10,
    sourceType: 'text',
    transform: structuredClone(DEFAULT_TRANSFORM),
    effects: [],
    textProperties: {
      ...structuredClone(DEFAULT_TEXT_PROPERTIES),
      text,
    },
  };
}

describe('compositionRenderer serialized text sources', () => {
  afterEach(() => {
    compositionRenderer.invalidateAll();
    vi.mocked(useMediaStore.getState).mockReset();
    vi.mocked(textRenderer.createCanvas).mockReset();
    vi.mocked(textRenderer.render).mockReset();
  });

  it('keeps a distinct composition-sized canvas for every text layer', async () => {
    const tracks: TimelineTrack[] = [
      { id: 'video-2', name: 'Video 2', type: 'video', height: 60, muted: false, visible: true, solo: false },
      { id: 'video-1', name: 'Video 1', type: 'video', height: 60, muted: false, visible: true, solo: false },
    ];
    const composition: Composition = {
      id: 'preview-text-composition',
      name: 'Preview Text Composition',
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
        clips: [
          makeTextClip('text-red', 'video-2', 'Red'),
          makeTextClip('text-cyan', 'video-1', 'Cyan'),
        ],
        playheadPosition: 0,
        duration: 10,
        zoom: 50,
        scrollX: 0,
        inPoint: null,
        outPoint: null,
        loopPlayback: false,
      },
    };
    vi.mocked(useMediaStore.getState).mockReturnValue({
      activeCompositionId: 'different-active-composition',
      compositions: [composition],
      files: [],
      proxyEnabled: false,
    } as ReturnType<typeof useMediaStore.getState>);
    vi.mocked(textRenderer.createCanvas).mockImplementation((width = 1920, height = 1080) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    });
    vi.mocked(textRenderer.render).mockImplementation((_properties, canvas) => canvas!);

    expect(await compositionRenderer.prepareComposition(composition.id)).toBe(true);
    const layers = compositionRenderer.evaluateAtTime(composition.id, 0);
    const canvases = layers.map((layer) => layer.source?.textCanvas).filter(Boolean);

    expect(layers.map((layer) => layer.clipId)).toEqual(['text-red', 'text-cyan']);
    expect(canvases).toHaveLength(2);
    expect(canvases[0]).not.toBe(canvases[1]);
    expect(canvases.map((canvas) => [canvas!.width, canvas!.height])).toEqual([
      [1280, 720],
      [1280, 720],
    ]);
  });
});
