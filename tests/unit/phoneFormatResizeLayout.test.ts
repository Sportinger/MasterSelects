import { afterEach, describe, expect, it } from 'vitest';

import { relativeResizeScaleFactor } from '../../src/stores/mediaStore/slices/composition/resizeTransforms';
import { createCompositionCrudActions } from '../../src/stores/mediaStore/slices/composition/crudActions';
import type { MediaState } from '../../src/stores/mediaStore/types';
import { useTimelineStore } from '../../src/stores/timeline';
import type { Composition, MediaFile } from '../../src/stores/mediaStore/types';
import { calculateFitToFrameScale } from '../../src/utils/sourcePixelScale';
import { createMockClip, createMockTrack } from '../helpers/mockData';

// Editor root change for the phone format sheet: updateComposition(id, size, { resizeLayout: 'relative' })
// keeps the layout's proportions; the default keeps pixel sizes and offsets as before.
// The global test setup mocks useMediaStore, so the real crud actions run on a small local state.

const originalTimeline = useTimelineStore.getState();
let media: MediaState;
const useMediaStore = {
  getState: () => ({
    ...media,
    ...createCompositionCrudActions(
      (update: unknown) => {
        const patch = typeof update === 'function' ? (update as (state: MediaState) => Partial<MediaState>)(media) : update as Partial<MediaState>;
        media = { ...media, ...patch };
      },
      () => media,
      {} as never,
    ),
  }),
};

function setup(): { compId: string } {
  const comp = { id: 'comp', name: 'Comp', type: 'composition', width: 1080, height: 1920, frameRate: 30, duration: 60, backgroundColor: '#000000', parentId: null, createdAt: 0 } as Composition;
  const file = { id: 'file', name: 'clip.mp4', type: 'video', width: 360, height: 640, parentId: null, createdAt: 0 } as unknown as MediaFile;
  media = { compositions: [comp], files: [file], activeCompositionId: 'comp', openCompositionIds: ['comp'] } as unknown as MediaState;
  const fit = calculateFitToFrameScale(360, 640, 1080, 1920);
  useTimelineStore.setState({
    tracks: [createMockTrack({ id: 't', type: 'video' })],
    clips: [
      createMockClip({ id: 'main', trackId: 't', mediaFileId: 'file', transform: { opacity: 1, blendMode: 'normal', position: { x: 0, y: 0, z: 0 }, scale: { x: fit, y: fit }, rotation: { x: 0, y: 0, z: 0 } } }),
      createMockClip({ id: 'pip', trackId: 't', mediaFileId: 'file', transform: { opacity: 1, blendMode: 'normal', position: { x: 0.4, y: -0.5, z: 0 }, scale: { all: 0.5, x: -fit, y: fit }, rotation: { x: 0, y: 0, z: 0 } } }),
    ],
    clipKeyframes: new Map([['main', [{ id: 'k', clipId: 'main', time: 0, property: 'scale.x', value: fit, easing: 'linear' }]]]),
  } as never);
  return { compId: 'comp' };
}

describe('composition resize layout', () => {
  afterEach(() => {
    useTimelineStore.setState(originalTimeline, true);
  });

  it('relative: a fitted clip still fits, a PiP keeps its share and position, flips and keyframes follow', () => {
    const { compId } = setup();
    useMediaStore.getState().updateComposition(compId, { width: 1920, height: 1080 }, { resizeLayout: 'relative' });
    const newFit = calculateFitToFrameScale(360, 640, 1920, 1080);
    const [main, pip] = useTimelineStore.getState().clips;
    expect(main.transform.scale.x).toBeCloseTo(newFit, 9);
    expect(main.transform.scale.y).toBeCloseTo(newFit, 9);
    expect(pip.transform.scale.x).toBeCloseTo(-newFit, 9);
    expect(pip.transform.scale.all).toBe(0.5);
    expect(pip.transform.position).toEqual({ x: 0.4, y: -0.5, z: 0 });
    expect(useTimelineStore.getState().clipKeyframes.get('main')![0].value).toBeCloseTo(newFit, 9);
    expect(useMediaStore.getState().compositions[0]).toMatchObject({ width: 1920, height: 1080 });
  });

  it('relative resizes chain back to the exact start', () => {
    const { compId } = setup();
    const before = structuredClone(useTimelineStore.getState().clips.map((clip) => clip.transform));
    const update = useMediaStore.getState().updateComposition;
    update(compId, { width: 1920, height: 1080 }, { resizeLayout: 'relative' });
    update(compId, { width: 2520, height: 1080 }, { resizeLayout: 'relative' });
    update(compId, { width: 1080, height: 1920 }, { resizeLayout: 'relative' });
    useTimelineStore.getState().clips.forEach((clip, index) => {
      expect(clip.transform.scale.x).toBeCloseTo(before[index].scale.x, 9);
      expect(clip.transform.position.x).toBeCloseTo(before[index].position.x, 9);
    });
  });

  it('default keeps pixel sizes and pixel offsets (desktop composition settings)', () => {
    const { compId } = setup();
    const fit = calculateFitToFrameScale(360, 640, 1080, 1920);
    useMediaStore.getState().updateComposition(compId, { width: 1920, height: 1080 });
    const pip = useTimelineStore.getState().clips[1];
    expect(pip.transform.scale.x).toBeCloseTo(-fit, 9);
    expect(pip.transform.position.x).toBeCloseTo(0.4 * 1080 / 1920, 9);
    expect(pip.transform.position.y).toBeCloseTo(-0.5 * 1920 / 1080, 9);
  });

  it('a factor without a known source keeps the share of the frame area and is invertible', () => {
    const portrait = { width: 1080, height: 1920 }, landscape = { width: 1920, height: 1080 }, square = { width: 1080, height: 1080 };
    expect(relativeResizeScaleFactor(null, portrait, landscape)).toBeCloseTo(1, 12);
    expect(relativeResizeScaleFactor(null, portrait, square)).toBeCloseTo(Math.sqrt(1080 / 1920), 12);
    for (const [a, b] of [[portrait, landscape], [portrait, square], [square, { width: 2520, height: 1080 }]] as const) {
      expect(relativeResizeScaleFactor(null, a, b) * relativeResizeScaleFactor(null, b, a)).toBeCloseTo(1, 12);
    }
    expect(relativeResizeScaleFactor({ width: 1920, height: 1080 }, portrait, landscape)).toBeCloseTo(1920 / 1080, 9);
  });

  it('A -> B -> A restores the exact scale of a title (raster size) and a solid (no known size)', () => {
    const { compId } = setup();
    // A title made in the 9:16 canvas: its generated raster is what the compositor fits.
    const textCanvas = document.createElement('canvas');
    textCanvas.width = 1080;
    textCanvas.height = 1920;
    const transform = (scale: number) => ({ opacity: 1, blendMode: 'normal' as const, position: { x: 0.1, y: -0.3, z: 0 }, scale: { x: scale, y: scale }, rotation: { x: 0, y: 0, z: 0 } });
    useTimelineStore.setState({
      clips: [
        { ...createMockClip({ id: 'title', trackId: 't', transform: transform(0.8) }), source: { type: 'text', textCanvas } },
        { ...createMockClip({ id: 'solid', trackId: 't', transform: transform(1) }), source: { type: 'solid' } },
      ],
      clipKeyframes: new Map([['title', [{ id: 'ts', clipId: 'title', time: 0, property: 'scale.x', value: 0.8, easing: 'linear' }]]]),
    } as never);
    const update = useMediaStore.getState().updateComposition;
    update(compId, { width: 1920, height: 1080 }, { resizeLayout: 'relative' });
    const [title, solid] = useTimelineStore.getState().clips;
    // The 9:16 title is fitted into 16:9 like a 9:16 picture; the solid keeps its share of the area.
    expect(title.transform.scale.x).toBeCloseTo(0.8 * 1080 / 1920, 9);
    expect(solid.transform.scale.x).toBeCloseTo(1, 9);
    for (const size of [{ width: 1080, height: 1920 }, { width: 1920, height: 1080 }, { width: 1080, height: 1080 }, { width: 1080, height: 1920 }]) {
      update(compId, size, { resizeLayout: 'relative' });
    }
    const [titleBack, solidBack] = useTimelineStore.getState().clips;
    expect(titleBack.transform.scale.x).toBeCloseTo(0.8, 9);
    expect(titleBack.transform.scale.y).toBeCloseTo(0.8, 9);
    expect(solidBack.transform.scale.x).toBeCloseTo(1, 9);
    expect(titleBack.transform.position).toEqual({ x: 0.1, y: -0.3, z: 0 });
    expect(useTimelineStore.getState().clipKeyframes.get('title')![0].value).toBeCloseTo(0.8, 9);
  });
});
