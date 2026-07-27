// Metronome click engine (issue #299, Packet 5).
//
// The schedule is asserted through the pure `collectMetronomeClicks`, and the
// voice through a stub AudioContext — neither needs a real audio device.

import { describe, it, expect, vi } from 'vitest';

import { collectMetronomeClicks } from '../../src/services/audio/metronomeScheduler';
import { scheduleClick } from '../../src/engine/audio/metronomeVoice';
import { normalizeTempoMap } from '../../src/timeline/tempo/tempoEdits';

// 120 BPM 4/4: beats every 0.5 s, bars every 2 s.
const AT_120 = normalizeTempoMap({
  events: [{ id: 'a', time: 0, bpm: 120, numerator: 4, denominator: 4 }],
});

describe('collectMetronomeClicks', () => {
  it('clicks every 0.5 s at 120 BPM with a downbeat every 4', () => {
    const clicks = collectMetronomeClicks(AT_120, 0, 4, 'beats');

    expect(clicks.map(c => c.time)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]);
    expect(clicks.filter(c => c.isDownbeat).map(c => c.time)).toEqual([0, 2, 4]);
  });

  it('bars mode drops the off-beats', () => {
    const clicks = collectMetronomeClicks(AT_120, 0, 8, 'bars');

    expect(clicks.map(c => c.time)).toEqual([0, 2, 4, 6, 8]);
    expect(clicks.every(c => c.isDownbeat)).toBe(true);
  });

  it('follows the meter — 3/4 puts the downbeat every 3 beats', () => {
    const threeFour = normalizeTempoMap({
      events: [{ id: 'a', time: 0, bpm: 120, numerator: 3, denominator: 4 }],
    });
    const clicks = collectMetronomeClicks(threeFour, 0, 3, 'beats');
    expect(clicks.filter(c => c.isDownbeat).map(c => c.time)).toEqual([0, 1.5, 3]);
  });

  it('shifts subsequent clicks after a mid-window tempo change', () => {
    const changing = normalizeTempoMap({
      events: [
        { id: 'a', time: 0, bpm: 120, numerator: 4, denominator: 4 },
        { id: 'b', time: 2, bpm: 240, numerator: 4, denominator: 4 },
      ],
    });
    // 0.5 s spacing before the change, 0.25 s after it.
    expect(collectMetronomeClicks(changing, 0, 3, 'beats').map(c => c.time))
      .toEqual([0, 0.5, 1, 1.5, 2, 2.25, 2.5, 2.75, 3]);
  });

  it('accelerates through a RAMP instead of stepping', () => {
    const ramp = normalizeTempoMap({
      events: [
        { id: 'a', time: 0, bpm: 60, numerator: 4, denominator: 4 },
        { id: 'b', time: 8, bpm: 120, numerator: 4, denominator: 4, curve: 'ramp' },
      ],
    });
    const gaps = collectMetronomeClicks(ramp, 0, 8, 'beats')
      .map(c => c.time)
      .map((time, index, times) => (index === 0 ? null : time - times[index - 1]))
      .filter((gap): gap is number => gap !== null);

    expect(gaps.length).toBeGreaterThan(4);
    expect(gaps.every((gap, i) => i === 0 || gap < gaps[i - 1] + 1e-9)).toBe(true);
  });

  it('emits nothing for an inverted or negative-only window', () => {
    expect(collectMetronomeClicks(AT_120, 4, 2, 'beats')).toEqual([]);
    expect(collectMetronomeClicks(AT_120, -5, -1, 'beats')).toEqual([]);
  });

  it('only emits inside the requested window, so look-ahead does not double up', () => {
    const first = collectMetronomeClicks(AT_120, 0, 1, 'beats').map(c => c.time);
    const second = collectMetronomeClicks(AT_120, 1.0001, 2, 'beats').map(c => c.time);
    expect(first).toEqual([0, 0.5, 1]);
    expect(second).toEqual([1.5, 2]);
  });
});

// A stub just rich enough for the voice: records what it built and when.
function createStubContext(currentTime = 0) {
  const oscillators: Array<{ type: string; frequency: number; start: number; stop: number }> = [];
  const gains: Array<{ ramps: Array<[number, number]> }> = [];
  const destination = { kind: 'destination' } as unknown as AudioNode;

  const context = {
    currentTime,
    destination,
    createOscillator: () => {
      const record = { type: 'sine', frequency: 0, start: 0, stop: 0 };
      oscillators.push(record);
      return {
        set type(value: string) { record.type = value; },
        frequency: { setValueAtTime: (value: number) => { record.frequency = value; } },
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: (when: number) => { record.start = when; },
        stop: (when: number) => { record.stop = when; },
        onended: null,
      };
    },
    createGain: () => {
      const record = { ramps: [] as Array<[number, number]> };
      gains.push(record);
      return {
        gain: {
          setValueAtTime: (value: number, when: number) => { record.ramps.push([when, value]); },
          exponentialRampToValueAtTime: (value: number, when: number) => {
            record.ramps.push([when, value]);
          },
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
    },
  } as unknown as BaseAudioContext;

  return { context, destination, oscillators, gains };
}

describe('scheduleClick', () => {
  it('pitches and levels the downbeat above the other beats', () => {
    const down = createStubContext();
    scheduleClick(down.context, down.destination, 1, { isDownbeat: true, volume: 1 });

    const beat = createStubContext();
    scheduleClick(beat.context, beat.destination, 1, { isDownbeat: false, volume: 1 });

    expect(down.oscillators[0].frequency).toBe(1000);
    expect(beat.oscillators[0].frequency).toBe(800);

    const peakOf = (gains: ReturnType<typeof createStubContext>['gains']) =>
      Math.max(...gains[0].ramps.map(([, value]) => value));
    expect(peakOf(down.gains)).toBeGreaterThan(peakOf(beat.gains));
  });

  it('is a short one-shot — starts at `when` and stops shortly after', () => {
    const stub = createStubContext();
    scheduleClick(stub.context, stub.destination, 2, { isDownbeat: true, volume: 1 });

    expect(stub.oscillators[0].start).toBe(2);
    expect(stub.oscillators[0].stop).toBeGreaterThan(2);
    expect(stub.oscillators[0].stop).toBeLessThan(2.1);
  });

  it('fires immediately rather than dropping a click already in the past', () => {
    const stub = createStubContext(5);
    scheduleClick(stub.context, stub.destination, 1, { isDownbeat: true, volume: 1 });
    expect(stub.oscillators[0].start).toBe(5);
  });

  it('builds nothing at zero volume', () => {
    const stub = createStubContext();
    scheduleClick(stub.context, stub.destination, 1, { isDownbeat: true, volume: 0 });
    expect(stub.oscillators).toHaveLength(0);
    expect(stub.gains).toHaveLength(0);
  });

  it('scales with the user volume', () => {
    const loud = createStubContext();
    scheduleClick(loud.context, loud.destination, 1, { isDownbeat: true, volume: 1 });
    const quiet = createStubContext();
    scheduleClick(quiet.context, quiet.destination, 1, { isDownbeat: true, volume: 0.25 });

    const peakOf = (stub: ReturnType<typeof createStubContext>) =>
      Math.max(...stub.gains[0].ramps.map(([, value]) => value));
    expect(peakOf(quiet)).toBeLessThan(peakOf(loud));
  });
});
