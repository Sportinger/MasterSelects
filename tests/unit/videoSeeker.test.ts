import { describe, expect, it, vi } from 'vitest';
import { seekAllClipsToTime } from '../../src/engine/export/VideoSeeker';
import type { ExportClipState, FrameContext } from '../../src/engine/export/types';
import type { TimelineClip, TimelineTrack } from '../../src/stores/timeline/types';

function createTransform() {
  return {
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: { x: 0, y: 0, z: 0 },
    opacity: 1,
    blendMode: 'normal' as const,
  };
}

describe('VideoSeeker', () => {
  it('seeks sequential WebCodecs export clips without an HTML video element', async () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
    } as TimelineTrack;
    const clip = {
      id: 'clip-1',
      name: 'Clip 1',
      trackId: track.id,
      startTime: 10,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      source: { type: 'video' },
      transform: createTransform(),
      effects: [],
    } as unknown as TimelineClip;
    const seekDuringExport = vi.fn(async () => undefined);
    const clipStates = new Map<string, ExportClipState>([[
      clip.id,
      {
        clipId: clip.id,
        webCodecsPlayer: {
          seekDuringExport,
        } as unknown as NonNullable<ExportClipState['webCodecsPlayer']>,
        lastSampleIndex: 0,
        isSequential: true,
      },
    ]]);
    const ctx: FrameContext = {
      time: 11.25,
      fps: 30,
      frameTolerance: 50_000,
      clipsAtTime: [clip],
      renderClipsAtTime: [clip],
      trackMap: new Map([[track.id, track]]),
      clipsByTrack: new Map([[track.id, clip]]),
      getInterpolatedTransform: createTransform,
      getInterpolatedEffects: () => [],
      getInterpolatedColorCorrection: () => undefined,
      getInterpolatedVectorAnimationSettings: () => ({}),
      getInterpolatedTextBounds: () => undefined,
      getSourceTimeForClip: (_clipId, localTime) => localTime,
      getInterpolatedSpeed: () => 1,
    };

    await seekAllClipsToTime(ctx, clipStates, null, false);

    expect(seekDuringExport).toHaveBeenCalledWith(1.25);
  });

  it('awaits an exact backend-neutral export frame provider without HTML video', async () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
    } as TimelineTrack;
    const clip = {
      id: 'clip-prores',
      name: 'ProRes',
      trackId: track.id,
      startTime: 0,
      duration: 5,
      inPoint: 1,
      outPoint: 6,
      source: { type: 'video' },
      transform: createTransform(),
      effects: [],
    } as unknown as TimelineClip;
    const seekExact = vi.fn(async () => undefined);
    const clipStates = new Map<string, ExportClipState>([[clip.id, {
      clipId: clip.id,
      frameProvider: { seekExact } as unknown as NonNullable<ExportClipState['frameProvider']>,
      webCodecsPlayer: null,
      lastSampleIndex: 0,
      isSequential: false,
    }]]);
    const ctx = {
      time: 2.25,
      fps: 30,
      frameTolerance: 50_000,
      clipsAtTime: [clip],
      renderClipsAtTime: [clip],
      trackMap: new Map([[track.id, track]]),
      clipsByTrack: new Map([[track.id, clip]]),
      getInterpolatedTransform: createTransform,
      getInterpolatedEffects: () => [],
      getInterpolatedColorCorrection: () => undefined,
      getInterpolatedVectorAnimationSettings: () => ({}),
      getInterpolatedTextBounds: () => undefined,
      getSourceTimeForClip: (_clipId: string, localTime: number) => localTime,
      getInterpolatedSpeed: () => 1,
    } as FrameContext;

    await seekAllClipsToTime(ctx, clipStates, null, false);

    expect(seekExact).toHaveBeenCalledWith(3.25);
  });
});
