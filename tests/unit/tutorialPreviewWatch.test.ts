import { describe, expect, it } from 'vitest';
// @ts-expect-error The tutorial pipeline is plain ESM JavaScript without type declarations.
import { playingStretches, slowPreview } from '../../scripts/tutorialPreviewWatch.mjs';

const steady = (from: number, to: number, fps: number) => Array.from({ length: Math.round((to - from) * fps) }, (_, index) => from + index / fps);

describe('tutorial preview watch', () => {
  it('finds a second in which the playing preview showed fewer than 16 new pictures', () => {
    // 25 pictures per second, with a 0.6 s hang at 4 s.
    const changes = [...steady(1, 4, 25), ...steady(4.6, 8, 25)];
    const slow = slowPreview(changes, [{ from: 1, to: 8 }]);
    expect(slow).toHaveLength(1);
    expect(slow[0].from).toBeGreaterThan(3.4);
    expect(slow[0].to).toBeLessThan(5.7);
    expect(slow[0].fps).toBeLessThan(16);
  });

  it('accepts a steady preview and a short hitch that keeps the second above 16', () => {
    expect(slowPreview(steady(0, 6, 24), [{ from: 0, to: 6 }])).toEqual([]);
    // 0.2 s without a picture still leaves 20 in every second.
    expect(slowPreview([...steady(0, 3, 25), ...steady(3.2, 6, 25)], [{ from: 0, to: 6 }])).toEqual([]);
  });

  it('judges only while the timeline plays, after its first half second', () => {
    expect(slowPreview(steady(1.4, 5, 25), [{ from: 1, to: 5 }])).toEqual([]);
    expect(playingStretches([
      { t: 0, playing: false }, { t: 0.25, playing: true }, { t: 0.5, playing: true }, { t: 2, playing: true },
      { t: 2.25, playing: false }, { t: 3, playing: true }, { t: 3.25, playing: false },
    ])).toEqual([{ from: 0.25, to: 2 }]);
  });
});
