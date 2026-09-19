import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineClip } from '../../src/stores/timeline/types';
import type { Layer } from '../../src/types/layers';

const liveInputMocks = vi.hoisted(() => ({
  getVideoElement: vi.fn(),
  getPresentationCanvas: vi.fn(),
  getVideoPresentation: vi.fn(),
}));

vi.mock('../../src/services/mediaRuntime/liveInputRuntime', () => ({
  liveInputRuntime: liveInputMocks,
}));

import {
  hasLiveInputClip,
  requireLiveInputExportVideo,
  waitForLiveInputExportTime,
} from '../../src/engine/export/liveInputExport';
import { buildVideoLayer } from '../../src/engine/export/layerBuilder/videoLayers';

function liveClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'clip-live-1',
    trackId: 'video-1',
    name: 'DeckLink 1',
    file: new File([], 'live-input.dat'),
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: {
      type: 'video',
      liveInputId: 'live-1',
      mediaFileId: 'live-1',
    },
    transform: {
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      opacity: 1,
      blendMode: 'normal',
    },
    effects: [],
    ...overrides,
  } as TimelineClip;
}

const baseLayer = {
  id: 'export-layer-1',
  name: 'DeckLink 1',
  sourceClipId: 'clip-live-1',
  visible: true,
  opacity: 1,
  blendMode: 'normal',
  effects: [],
  position: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  rotation: { x: 0, y: 0, z: 0 },
} satisfies Omit<Layer, 'source'>;

describe('live input export', () => {
  beforeEach(() => {
    liveInputMocks.getVideoElement.mockReset();
    liveInputMocks.getPresentationCanvas.mockReset();
    liveInputMocks.getVideoPresentation.mockReset();
  });

  it('detects live inputs nested inside a composition', () => {
    const nestedLive = liveClip();
    const composition = liveClip({
      id: 'composition-clip',
      source: null,
      isComposition: true,
      nestedClips: [nestedLive],
    });

    expect(hasLiveInputClip([composition])).toBe(true);
  });

  it('reports a reconnect action when the runtime stream is missing', () => {
    liveInputMocks.getVideoElement.mockReturnValue(null);

    expect(() => requireLiveInputExportVideo(liveClip())).toThrow(
      'Reconnect it in Properties > Live before exporting.',
    );
  });

  it('builds a current-frame video layer without timeline media time', () => {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    liveInputMocks.getVideoElement.mockReturnValue(video);
    liveInputMocks.getPresentationCanvas.mockReturnValue(canvas);
    liveInputMocks.getVideoPresentation.mockReturnValue({
      width: 1920,
      height: 1080,
      rotation: 0,
    });

    const layer = buildVideoLayer(
      liveClip(),
      baseLayer,
      3,
      new Map(),
      null,
      true,
      3,
    );

    expect(layer?.source).toMatchObject({
      type: 'video',
      videoElement: video,
      isLiveInput: true,
      canvasElement: canvas,
      intrinsicWidth: 1920,
      intrinsicHeight: 1080,
      videoRotation: 0,
    });
    expect(layer?.source.mediaTime).toBeUndefined();
    expect(liveInputMocks.getVideoElement).toHaveBeenCalledWith('live-1', true);
  });

  it('waits until the live timeline reaches the requested wall-clock time', async () => {
    vi.useFakeTimers();
    let now = 1_000;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);

    try {
      const pending = waitForLiveInputExportTime({
        startedAtMs: 1_000,
        elapsedSeconds: 0.25,
      });
      await Promise.resolve();
      expect(vi.getTimerCount()).toBe(1);

      now = 1_250;
      await vi.runOnlyPendingTimersAsync();
      await expect(pending).resolves.toBeUndefined();
    } finally {
      nowSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
