import { describe, expect, it } from 'vitest';
// @ts-expect-error The tutorial pipeline is plain ESM JavaScript without type declarations.
import { cameraSegments, timeMap, zoomedShare } from '../../scripts/tutorialCut.mjs';
// @ts-expect-error The tutorial pipeline is plain ESM JavaScript without type declarations.
import { cameraKeyframes } from '../../scripts/tutorial-ms-cut.mjs';
// @ts-expect-error The tutorial pipeline is plain ESM JavaScript without type declarations.
import { musicCopies, musicVolumeKeys } from '../../scripts/tutorial-ms-finish.mjs';

const viewport = { width: 2560, height: 1440 };

describe('tutorial camera in MasterSelects', () => {
  it('turns the take camera into eased moves in output time, kept inside the picture', () => {
    const recording = { viewport, camera: [
      { t: 0, ms: 0, cx: 1500, cy: 600, zoom: 1.33 },
      { t: 4, ms: 1000, cx: 2500, cy: 720, zoom: 1.25 },
    ], fast: [{ from: 1, to: 3, factor: 2 }] };
    const segments = cameraSegments(recording, timeMap(recording.fast));
    expect(segments[0]).toMatchObject({ at: 0, ms: 0, to: { cx: 1500, cy: 600, zoom: 1.33 } });
    // 4 s of recording are 3 s of output after a 2 s wait played twice as fast.
    expect(segments[1].at).toBeCloseTo(3);
    expect(segments[1].ms).toBe(1000);
    expect(segments[1].from).toMatchObject({ cx: 1500, cy: 600, zoom: 1.33 });
    // A frame 2048 px wide (2560 / 1.25) cannot be centred at 2500: it stops at the picture's edge.
    expect(segments[1].to.cx).toBeCloseTo(2560 - 1024);
  });

  it('places the framed point in the middle of the composition at the base scale times the zoom', () => {
    const keys = cameraKeyframes([
      { at: 0, ms: 0, from: { cx: 1280, cy: 720, zoom: 1 }, to: { cx: 1600, cy: 540, zoom: 1.33 } },
      { at: 11, ms: 2600, from: { cx: 1600, cy: 540, zoom: 1.33 }, to: { cx: 1280, cy: 720, zoom: 1 } },
    ], { viewport, base: 0.75 });
    expect(keys['scale.x']).toEqual([[0, 0.9975, 'hold'], [11, 0.9975, 'cubic-in-out'], [13.6, 0.75, 'hold']]);
    expect(keys['position.x'][0]).toEqual([0, -319.2, 'hold']);
    expect(keys['position.y'][0]).toEqual([0, 179.55, 'hold']);
    expect(keys['position.x'].at(-1)[1]).toBeCloseTo(0);
  });

  it('starts at the whole picture when the take has no camera', () => {
    expect(cameraKeyframes([], { viewport, base: 0.75 })['scale.x']).toEqual([[0, 0.75, 'hold']]);
  });
});

describe('tutorial music in MasterSelects', () => {
  it('fills the episode with copies of the music, the last one trimmed', () => {
    expect(musicCopies(40, 56)).toEqual([{ at: 0, length: 40 }, { at: 40, length: 16 }]);
    expect(musicCopies(165, 56)).toEqual([{ at: 0, length: 56 }]);
  });

  it('fades the music in at the start and out at the end of the episode', () => {
    expect(musicVolumeKeys({ at: 0, length: 18 }, { level: 0.08, first: true, last: true }))
      .toEqual([[0, 0, 'linear'], [0.6, 0.08, 'hold'], [15.5, 0.08, 'linear'], [18, 0, 'hold']]);
    expect(musicVolumeKeys({ at: 40, length: 16 }, { level: 0.08, first: false, last: false })).toEqual([[0, 0.08, 'hold']]);
  });

  it('measures how much of a take is zoomed in', () => {
    const rest = { cx: 1280, cy: 720, zoom: 1 };
    expect(zoomedShare([], rest, 10)).toBe(0);
    const share = zoomedShare([
      { t: 2, ms: 0, cx: 1000, cy: 700, zoom: 1.3 },
      { t: 6, ms: 0, ...rest },
    ], rest, 10);
    expect(share).toBeGreaterThan(0.35);
    expect(share).toBeLessThan(0.45);
  });

  it('counts a sped-up wait for its short length when it measures the zoom', () => {
    const rest = { cx: 1280, cy: 720, zoom: 1 };
    const keys = [{ t: 0, ms: 0, cx: 1000, cy: 700, zoom: 1.3 }, { t: 10, ms: 0, ...rest }];
    expect(zoomedShare(keys, rest, 20)).toBeCloseTo(0.5, 1);
    expect(zoomedShare(keys, rest, 20, { fast: [{ from: 0, to: 10, factor: 5 }] })).toBeCloseTo(1 / 6, 1);
  });
});
