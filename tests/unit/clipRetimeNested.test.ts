import { describe, expect, it, vi } from 'vitest';
import { RamPreviewEngine, type RamPreviewRenderEngine } from '../../src/services/ramPreviewEngine';
import { seekRamPreviewVideoFrame } from '../../src/services/ramPreview/videoSeeking';
import { MAX_NESTING_DEPTH } from '../../src/stores/timeline/constants';
import type { TimelineClip } from '../../src/types/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { createClipSpeedSource, resolveClipSourceTime } from '../../src/services/timeline/retime/clipRetime';
import { visitNestedClipsAtTime, visitNestedClipsInWindow } from '../../src/services/timeline/retime/nestedClipRetime';
import { getNestedClipSourceTime as previewTime } from '../../src/services/layerBuilder/layerBuilderNestedSourceTiming';
import { getNestedClipSourceTime as exportTime } from '../../src/engine/export/layerBuilder/nestedLayers';
import { getNestedRamPreviewClipTime } from '../../src/services/ramPreview/clipTiming';
import { collectNestedVideoClips } from '../../src/engine/export/clipPreparation/nestedVideoClips';

vi.mock('../../src/engine/export/layerBuilder/baseLayers', () => ({
  getClipKeyframes: (clip: { keyframes?: unknown[] }) => clip.keyframes ?? [],
  buildNestedBaseLayer: vi.fn(),
}));

vi.mock('../../src/services/ramPreview/videoSeeking', () => ({
  seekRamPreviewVideoFrame: vi.fn(async () => true),
}));

const track = createMockTrack({ id: 'v', type: 'video', visible: true });
function fixture(parentReverse: boolean, childReverse: boolean) {
  const leaf = createMockClip({ id: 'leaf', trackId: 'v', startTime: 0,
    duration: 20, inPoint: 3, outPoint: 13, speed: 0.5, reversed: true,
    source: { type: 'video', naturalDuration: 20 } });
  const child = createMockClip({ id: 'child', trackId: 'v', isComposition: true,
    startTime: 2, duration: 16, inPoint: 2, outPoint: 10, speed: 0.5,
    reversed: childReverse, nestedClips: [leaf], nestedTracks: [track] });
  const parent = createMockClip({ id: 'parent', trackId: 'v', isComposition: true,
    startTime: 10, duration: 6, inPoint: 3, outPoint: 15, speed: 2,
    reversed: parentReverse, nestedClips: [child], nestedTracks: [track] });
  return { parent, child, leaf };
}

function chain(clips: TimelineClip[], local: number, sample: typeof previewTime): number {
  let time = sample(clips[0], local);
  for (const clip of clips.slice(1)) time = sample(clip, time - clip.startTime);
  return time;
}

describe('nested composition retime parity', () => {
  it.each([[false, false], [true, false], [false, true], [true, true]])(
    'composes two levels: parent reverse=%s, child reverse=%s', (pr, cr) => {
      const { parent, child, leaf } = fixture(pr, cr);
      for (const local of [0.01, 0.5, 1, 2.25, 4, 5.99]) {
        const expected = chain([parent, child, leaf], local,
          (clip, t) => resolveClipSourceTime(clip, t).sourceTime);
        // Nested video clocks include the sub-frame backward-selection bias.
        expect(chain([parent, child, leaf], local, previewTime)).toBeCloseTo(expected, 4);
        expect(chain([parent, child, leaf], local, exportTime)).toBeCloseTo(expected, 4);
        const parentTiming = resolveClipSourceTime(parent, local);
        const childTiming = resolveClipSourceTime(child, parentTiming.sourceTime - child.startTime);
        expect(getNestedRamPreviewClipTime(childTiming.sourceTime, leaf)).toBeCloseTo(expected, 4);
        const visited: number[] = [];
        visitNestedClipsAtTime(parent, parentTiming.sourceTime, (_clip, timing) => {
          visited.push(timing.sourceTime);
          expect(timing.sourceRate).toBeCloseTo(parentTiming.sourceRate * childTiming.sourceRate * -0.5);
        }, parentTiming.sourceRate);
        expect(visited).toHaveLength(1);
        expect(visited[0]).toBeCloseTo(expected, 4);
      }
    },
  );

  it('prefetch reaches leaves when both ancestor clocks run backwards', () => {
    const { parent } = fixture(true, true);
    const ids: string[] = [];
    visitNestedClipsInWindow(parent, 14, 4, clip => ids.push(clip.id));
    expect(ids).toEqual(['leaf']);
  });

  it('export preparation composes affine placement for a reversed fast parent', () => {
    const { parent, child, leaf } = fixture(true, true);
    const [entry] = collectNestedVideoClips(parent);
    expect(entry.clip.id).toBe(leaf.id);
    // Invert the two affine composition clocks, independently of collection.
    const childSourceToParent = (t: number) => child.startTime + (child.outPoint - t) / 0.5;
    const parentSourceToMain = (t: number) => parent.startTime + (parent.outPoint - t) / 2;
    const start = parentSourceToMain(childSourceToParent(leaf.startTime));
    const end = parentSourceToMain(childSourceToParent(leaf.startTime + leaf.duration));
    expect(entry.mainTimelineStart).toBeCloseTo(Math.min(start, end));
    expect(entry.mainTimelineDuration).toBeCloseTo(Math.abs(end - start));
  });
});


describe('RAM preview nested renderer', () => {
  async function renderFrame(root: TimelineClip, time: number) {
    const renderer = { render: vi.fn<RamPreviewRenderEngine['render']>(), cacheCompositeFrame: vi.fn(async () => undefined) };
    const speed = createClipSpeedSource(root);
    await new RamPreviewEngine(renderer).generate({ compositionId: 'ram-test',
      start: time, end: time, centerTime: time, clips: [root], tracks: [track],
    }, {
      isCancelled: () => false, isFrameCached: () => false,
      getSourceTimeForClip: (_id, local) => speed.integrate(local),
      getInterpolatedSpeed: (_id, local) => speed.speedAt(local),
      getCompositionDimensions: () => ({ width: 1920, height: 1080 }),
      onFrameCached: vi.fn(), onProgress: vi.fn(),
    });
    return renderer;
  }

  it('seeks a video through two reversed, retimed composition clocks', async () => {
    vi.mocked(seekRamPreviewVideoFrame).mockClear();
    const { parent, leaf } = fixture(true, true);
    leaf.source = { ...leaf.source!, videoElement: document.createElement('video') };
    const renderer = await renderFrame(parent, 11);
    // Parent: 15 - 2*1 = 13; child: 10 - 0.5*(13-2) = 4.5; leaf: 13 - 0.5*4.5.
    // Preserve the single-seek assertion; only video sample precision changes.
    expect(seekRamPreviewVideoFrame).toHaveBeenCalledTimes(1);
    expect(vi.mocked(seekRamPreviewVideoFrame).mock.calls[0][0].targetTime).toBeCloseTo(10.75, 4);
    const rootLayer = renderer.render.mock.calls[0][0][0];
    expect(rootLayer.source.nestedComposition!.currentTime).toBeCloseTo(13, 4);
    const childLayer = rootLayer.source.nestedComposition!.layers[0];
    expect(childLayer.source.nestedComposition!.currentTime).toBeCloseTo(4.5, 4);
    expect(childLayer.source.nestedComposition!.layers[0].source.videoElement).toBe(leaf.source.videoElement);
  });

  it.each([5, MAX_NESTING_DEPTH])('observes the central RAM nesting limit at depth %s', async depth => {
    vi.mocked(seekRamPreviewVideoFrame).mockClear();
    let root = createMockClip({ id: 'ram-leaf', trackId: track.id, duration: 1, inPoint: 0, outPoint: 1,
      source: { type: 'video', videoElement: document.createElement('video') } });
    for (let index = 0; index <= depth; index++) {
      root = createMockClip({ id: `ram-wrapper-${index}`, trackId: track.id,
        duration: 1, inPoint: 0, outPoint: 1, isComposition: true,
        nestedClips: [root], nestedTracks: [track] });
    }
    const renderer = await renderFrame(root, 0.5);
    if (depth < MAX_NESTING_DEPTH) {
      expect(seekRamPreviewVideoFrame).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ targetTime: 0.5 }));
      expect(renderer.render.mock.calls[0][0]).toHaveLength(1);
    } else {
      expect(seekRamPreviewVideoFrame).not.toHaveBeenCalled();
      expect(renderer.render.mock.calls[0][0]).toEqual([]);
    }
  });
});
