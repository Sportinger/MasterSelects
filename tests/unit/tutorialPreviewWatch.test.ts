import { describe, expect, it } from 'vitest';
// @ts-expect-error The tutorial pipeline is plain ESM JavaScript without type declarations.
import { playingStretches, previewRuns, slowPreview, withLeadIn } from '../../scripts/tutorialPreviewWatch.mjs';

const steady = (from: number, to: number, fps: number) => Array.from({ length: Math.round((to - from) * fps) }, (_, index) => from + index / fps);

describe('tutorial preview watch', () => {
  it('finds the stretches the timeline played through, broken at a loop and at a hold', () => {
    const box = { x: 1, y: 2, width: 3, height: 4 };
    const samples = [
      { t: 0, playing: false, playhead: 4.8, box },
      // Plays from 4.8 at 1 s per s.
      { t: 1, playing: true, playhead: 4.8, box }, { t: 2, playing: true, playhead: 5.8, box }, { t: 3, playing: true, playhead: 6.8, box },
      // The loop jumps back.
      { t: 4, playing: true, playhead: 4.5, box }, { t: 5, playing: true, playhead: 5.5, box },
      // Paused, then a hold too short to count.
      { t: 6, playing: false, playhead: 5.5, box }, { t: 7, playing: true, playhead: 5.5, box },
    ];
    expect(previewRuns(samples)).toEqual([
      { from: 1, to: 3, playhead: 4.8, box },
      { from: 4, to: 5, playhead: 4.5, box },
    ]);
  });

  it('keeps a hold in the stretch and counts the playhead back from where it ran', () => {
    const box = { x: 1, y: 2, width: 3, height: 4 };
    const samples = [
      { t: 0, playing: false, playhead: 5.4, box },
      // Play at 1 s: the playhead holds for 0.75 s, then runs.
      { t: 1, playing: true, playhead: 5.4, box }, { t: 1.25, playing: true, playhead: 5.4, box },
      { t: 1.5, playing: true, playhead: 5.4, box }, { t: 1.75, playing: true, playhead: 5.4, box },
      { t: 2.75, playing: true, playhead: 6.4, box }, { t: 3.75, playing: true, playhead: 7.4, box },
    ];
    const runs = previewRuns(samples);
    expect(runs).toHaveLength(1);
    expect(runs[0].from).toBe(1);
    expect(runs[0].to).toBe(3.75);
    // The picture at the Play is the one 0.75 s before the playhead started to move.
    expect(runs[0].playhead).toBeCloseTo(4.65);
  });

  it('begins a stretch at the seek before it and at the start of a part', () => {
    const box = { x: 1, y: 2, width: 3, height: 4 };
    const steps = [{ label: 'click ruler:5.4', start: 9, end: 10 }, { label: 'click aria:Play@preview-group', start: 10, end: 11 }];
    const [first, second] = withLeadIn([{ from: 0.75, to: 5, playhead: 7, box }, { from: 11.5, to: 14, playhead: 5.4, box }], steps);
    expect(first).toMatchObject({ from: 0, playhead: 6.25 });
    expect(second.from).toBeCloseTo(9.7);
    expect(second.playhead).toBeCloseTo(3.6);
    // A stretch far from any seek stays as it is.
    expect(withLeadIn([{ from: 20, to: 22, playhead: 5, box }], steps)[0]).toMatchObject({ from: 20, playhead: 5 });
  });

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
