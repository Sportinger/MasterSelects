import { afterEach, describe, expect, it } from 'vitest';
import {
  buildLayersAtTime,
  cleanupLayerBuilder,
  initializeLayerBuilder,
} from '../../src/engine/export/ExportLayerBuilder';
import type { ExportClipState, FrameContext } from '../../src/engine/export/types';

describe('ExportLayerBuilder', () => {
  afterEach(() => {
    cleanupLayerBuilder();
  });

  it('uses the current WebCodecs VideoFrame for sequential export layers', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as any;

    const videoElement = document.createElement('video');
    const currentFrame = {
      displayWidth: 1920,
      displayHeight: 1080,
    } as VideoFrame;

    const clip = {
      id: 'clip-1',
      name: 'Clip 1',
      trackId: 'track-1',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      source: {
        type: 'video',
        videoElement,
      },
      transform: {},
    } as any;

    const clipStates = new Map<string, ExportClipState>([
      ['clip-1', {
        clipId: 'clip-1',
        webCodecsPlayer: {
          getCurrentFrame: () => currentFrame,
        } as any,
        lastSampleIndex: 0,
        isSequential: true,
        preciseVideoElement: videoElement,
      }],
    ]);

    const ctx: FrameContext = {
      time: 0.5,
      fps: 30,
      frameTolerance: 50_000,
      clipsAtTime: [clip],
      trackMap: new Map([[track.id, track]]),
      clipsByTrack: new Map([[track.id, clip]]),
      getInterpolatedTransform: () => ({
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        opacity: 1,
        blendMode: 'normal',
      }),
      getInterpolatedEffects: () => [],
      getSourceTimeForClip: () => 0.5,
      getInterpolatedSpeed: () => 1,
    };

    initializeLayerBuilder([track]);

    const layers = buildLayersAtTime(ctx, clipStates, null, false);

    expect(layers).toHaveLength(1);
    expect(layers[0]?.source?.videoFrame).toBe(currentFrame);
    expect(layers[0]?.source?.webCodecsPlayer).toBe(clipStates.get('clip-1')?.webCodecsPlayer);
  });
});
