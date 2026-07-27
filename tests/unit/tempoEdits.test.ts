import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TEMPO_BPM,
  MAX_EDITABLE_TEMPO_BPM,
  MIN_EDITABLE_TEMPO_BPM,
  PROJECT_TEMPO_EVENT_ID,
  clampTimeSignatureDenominator,
  createTempoEventId,
  insertTempoEvent,
  normalizeTempoMap,
  removeTempoEvent,
  tempoEventAt,
  tempoMapsEqual,
  updateTempoEvent,
} from '../../src/timeline/tempo/tempoEdits';
import { secondsToBarBeat } from '../../src/timeline/tempo/TempoMap';
import type { TempoMap } from '../../src/types/timeline';

function map(...events: Array<Partial<TempoMap['events'][number]>>): TempoMap {
  return normalizeTempoMap({ events });
}

describe('tempoEdits — invariants', () => {
  it('an empty or missing map falls back to one 4/4 @ 60 BPM event at 0', () => {
    for (const input of [undefined, null, { events: [] }, { events: null }]) {
      const result = normalizeTempoMap(input);
      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toMatchObject({
        id: PROJECT_TEMPO_EVENT_ID, time: 0, bpm: DEFAULT_TEMPO_BPM, numerator: 4, denominator: 4,
      });
    }
  });

  it('sorts events ascending by time', () => {
    const result = map(
      { time: 8, bpm: 90, numerator: 4, denominator: 4 },
      { time: 0, bpm: 60, numerator: 4, denominator: 4 },
      { time: 4, bpm: 120, numerator: 4, denominator: 4 },
    );
    expect(result.events.map(e => e.time)).toEqual([0, 4, 8]);
  });

  it('pins the first event at time 0 even when the data starts later', () => {
    const result = map({ time: 12, bpm: 100, numerator: 3, denominator: 4 });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].time).toBe(0);
    expect(result.events[0].bpm).toBe(100);
  });

  it('dedupes by time, keeping the later event at that position', () => {
    const result = map(
      { time: 0, bpm: 60, numerator: 4, denominator: 4 },
      { time: 4, bpm: 90, numerator: 4, denominator: 4 },
      { time: 4, bpm: 140, numerator: 7, denominator: 8 },
    );
    expect(result.events).toHaveLength(2);
    expect(result.events[1]).toMatchObject({ time: 4, bpm: 140, numerator: 7, denominator: 8 });
  });

  it('backfills missing ids and repairs duplicates', () => {
    const result = map(
      { time: 0, bpm: 60, numerator: 4, denominator: 4 },
      { id: 'dup', time: 4, bpm: 90, numerator: 4, denominator: 4 },
      { id: 'dup', time: 8, bpm: 90, numerator: 4, denominator: 4 },
    );
    const ids = result.events.map(e => e.id);
    expect(ids.every(id => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('createTempoEventId returns unique ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createTempoEventId()));
    expect(ids.size).toBe(50);
  });
});

describe('tempoEdits — clamping', () => {
  // Guards against reusing MIN/MAX_TEMPO_BPM (60/200) from beatGridEstimation,
  // which are detection bins, not an authoring range.
  it('accepts a 40 BPM largo and a 240 BPM drum\'n\'bass tempo unchanged', () => {
    expect(map({ time: 0, bpm: 40, numerator: 4, denominator: 4 }).events[0].bpm).toBe(40);
    expect(map({ time: 0, bpm: 240, numerator: 4, denominator: 4 }).events[0].bpm).toBe(240);
  });

  it('clamps BPM to the editable range and repairs non-finite values', () => {
    expect(map({ time: 0, bpm: 5, numerator: 4, denominator: 4 }).events[0].bpm)
      .toBe(MIN_EDITABLE_TEMPO_BPM);
    expect(map({ time: 0, bpm: 5000, numerator: 4, denominator: 4 }).events[0].bpm)
      .toBe(MAX_EDITABLE_TEMPO_BPM);
    expect(map({ time: 0, bpm: Number.NaN, numerator: 4, denominator: 4 }).events[0].bpm)
      .toBe(DEFAULT_TEMPO_BPM);
  });

  it('clamps the numerator to >= 1 and rounds it', () => {
    expect(map({ time: 0, bpm: 60, numerator: 0, denominator: 4 }).events[0].numerator).toBe(1);
    expect(map({ time: 0, bpm: 60, numerator: 3.4, denominator: 4 }).events[0].numerator).toBe(3);
  });

  it('snaps an illegal denominator to the nearest legal note value', () => {
    expect(clampTimeSignatureDenominator(7)).toBe(8);
    expect(clampTimeSignatureDenominator(3)).toBe(4);
    expect(clampTimeSignatureDenominator(64)).toBe(32);
    expect(clampTimeSignatureDenominator(0)).toBe(4);
  });

  it('drops events with a non-finite time', () => {
    const result = map(
      { time: 0, bpm: 60, numerator: 4, denominator: 4 },
      { time: Number.NaN, bpm: 90, numerator: 4, denominator: 4 },
    );
    expect(result.events).toHaveLength(1);
  });
});

describe('tempoEdits — insert', () => {
  const base = map({ id: 'a', time: 0, bpm: 60, numerator: 3, denominator: 8 });

  it('inserts a new event and inherits the meter in effect at that time', () => {
    const { map: next, event, changed } = insertTempoEvent(base, { time: 6, bpm: 120 });
    expect(changed).toBe(true);
    expect(event).toMatchObject({ time: 6, bpm: 120, numerator: 3, denominator: 8 });
    expect(next.events.map(e => e.time)).toEqual([0, 6]);
  });

  it('an explicit meter overrides the inherited one', () => {
    const { event } = insertTempoEvent(base, { time: 6, bpm: 120, numerator: 5, denominator: 4 });
    expect(event).toMatchObject({ numerator: 5, denominator: 4 });
  });

  it('inserting onto an occupied position replaces it and keeps its id', () => {
    const twoEvents = insertTempoEvent(base, { time: 6, bpm: 120 }).map;
    const existingId = twoEvents.events[1].id;

    const { map: next, event } = insertTempoEvent(twoEvents, { time: 6, bpm: 90 });
    expect(next.events).toHaveLength(2);
    expect(event?.id).toBe(existingId);
    expect(next.events[1].bpm).toBe(90);
  });

  it('inserting at 0 edits the project tempo instead of adding an event', () => {
    const { map: next, event } = insertTempoEvent(base, { time: 0, bpm: 150 });
    expect(next.events).toHaveLength(1);
    expect(event?.id).toBe('a');
    expect(next.events[0].bpm).toBe(150);
  });

  it('reports changed=false when the insert changes nothing', () => {
    const { changed } = insertTempoEvent(base, { time: 0, bpm: 60 });
    expect(changed).toBe(false);
  });
});

describe('tempoEdits — update', () => {
  const base = map(
    { id: 'a', time: 0, bpm: 60, numerator: 4, denominator: 4 },
    { id: 'b', time: 8, bpm: 120, numerator: 4, denominator: 4 },
  );

  it('patches bpm and meter without touching the others', () => {
    const { map: next, changed } = updateTempoEvent(base, 'b', { bpm: 90, numerator: 6 });
    expect(changed).toBe(true);
    expect(next.events[1]).toMatchObject({ id: 'b', time: 8, bpm: 90, numerator: 6 });
    expect(next.events[0]).toMatchObject({ id: 'a', bpm: 60 });
  });

  it('moves a non-pinned event and re-sorts', () => {
    const { map: next } = updateTempoEvent(base, 'b', { time: 2 });
    expect(next.events.map(e => e.id)).toEqual(['a', 'b']);
    expect(next.events[1].time).toBe(2);
  });

  it('never moves the project tempo off 0, but does apply its BPM patch', () => {
    const { map: next } = updateTempoEvent(base, 'a', { time: 30, bpm: 132 });
    expect(next.events[0]).toMatchObject({ id: 'a', time: 0, bpm: 132 });
  });

  it('refuses to drag a later event onto the project tempo, keeping both', () => {
    const { map: next } = updateTempoEvent(base, 'b', { time: 0, bpm: 100 });
    expect(next.events.map(e => e.id)).toEqual(['a', 'b']);
    expect(next.events[1]).toMatchObject({ time: 8, bpm: 100 });
  });

  it('moving onto another occupied position replaces that event', () => {
    const three = insertTempoEvent(base, { time: 16, bpm: 80 }).map;
    const { map: next } = updateTempoEvent(three, 'b', { time: 16 });
    expect(next.events).toHaveLength(2);
    expect(next.events.map(e => e.id)).toEqual(['a', 'b']);
    expect(next.events[1]).toMatchObject({ time: 16, bpm: 120 });
  });

  it('is a no-op for an unknown id', () => {
    const result = updateTempoEvent(base, 'missing', { bpm: 200 });
    expect(result.changed).toBe(false);
    expect(result.event).toBeNull();
  });
});

describe('tempoEdits — remove', () => {
  const base = map(
    { id: 'a', time: 0, bpm: 60, numerator: 4, denominator: 4 },
    { id: 'b', time: 8, bpm: 120, numerator: 4, denominator: 4 },
  );

  it('removes a tempo change', () => {
    const { map: next, event, changed } = removeTempoEvent(base, 'b');
    expect(changed).toBe(true);
    expect(event?.id).toBe('b');
    expect(next.events.map(e => e.id)).toEqual(['a']);
  });

  it('refuses to delete the project tempo — the map is never empty', () => {
    const result = removeTempoEvent(base, 'a');
    expect(result.changed).toBe(false);
    expect(result.map.events).toHaveLength(2);
  });

  it('is a no-op for an unknown id', () => {
    expect(removeTempoEvent(base, 'missing').changed).toBe(false);
  });
});

describe('tempoEdits — helpers', () => {
  const base = map(
    { id: 'a', time: 0, bpm: 60, numerator: 4, denominator: 4 },
    { id: 'b', time: 8, bpm: 120, numerator: 3, denominator: 4 },
  );

  it('tempoEventAt returns the event in effect at a time', () => {
    expect(tempoEventAt(base, 0).id).toBe('a');
    expect(tempoEventAt(base, 7.9).id).toBe('a');
    expect(tempoEventAt(base, 8).id).toBe('b');
    expect(tempoEventAt(base, 100).id).toBe('b');
  });

  it('tempoMapsEqual compares by value, not identity', () => {
    expect(tempoMapsEqual(base, normalizeTempoMap(base))).toBe(true);
    expect(tempoMapsEqual(base, updateTempoEvent(base, 'b', { bpm: 121 }).map)).toBe(false);
  });
});

// Issue #299: 'ramp' means the tempo is REACHED by interpolation from the
// previous event rather than by an instant step.
describe('tempoEdits — curve', () => {
  it('defaults every event to jump', () => {
    const base = map({ id: 'a', time: 0, bpm: 60, numerator: 4, denominator: 4 });
    expect(base.events[0].curve).toBe('jump');
    expect(insertTempoEvent(base, { time: 8, bpm: 120 }).event?.curve).toBe('jump');
  });

  it('round-trips a ramp through normalization', () => {
    const result = map(
      { id: 'a', time: 0, bpm: 60, numerator: 4, denominator: 4 },
      { id: 'b', time: 8, bpm: 120, numerator: 4, denominator: 4, curve: 'ramp' },
    );
    expect(result.events[1].curve).toBe('ramp');
  });

  it('forces the project tempo to jump — nothing precedes it to ramp from', () => {
    const result = map({ id: 'a', time: 0, bpm: 60, numerator: 4, denominator: 4, curve: 'ramp' });
    expect(result.events[0].curve).toBe('jump');
  });

  it('toggles the curve through updateTempoEvent', () => {
    const base = map(
      { id: 'a', time: 0, bpm: 60, numerator: 4, denominator: 4 },
      { id: 'b', time: 8, bpm: 120, numerator: 4, denominator: 4 },
    );
    const ramped = updateTempoEvent(base, 'b', { curve: 'ramp' });
    expect(ramped.changed).toBe(true);
    expect(ramped.map.events[1].curve).toBe('ramp');

    const back = updateTempoEvent(ramped.map, 'b', { curve: 'jump' });
    expect(back.map.events[1].curve).toBe('jump');
  });

  it('treats a curve change as a real change for history', () => {
    const base = map(
      { id: 'a', time: 0, bpm: 60, numerator: 4, denominator: 4 },
      { id: 'b', time: 8, bpm: 120, numerator: 4, denominator: 4 },
    );
    expect(updateTempoEvent(base, 'b', { curve: 'jump' }).changed).toBe(false);
    expect(updateTempoEvent(base, 'b', { curve: 'ramp' }).changed).toBe(true);
  });
});

// Issue #299: a tempo mark is a MUSICAL object — "90 BPM at bar 11". Editing an
// earlier tempo, or making this one a ramp, changes how long the interval before
// it takes, so its SECONDS must move to keep its BAR. Storing seconds without
// re-anchoring is what let a ramp flag drift to bar 11.5.
describe('tempoEdits — events stay on their bar', () => {
  // 60 BPM 4/4 => 4 s bars, so bar 11 is at 40 s.
  const base = map(
    { id: 'a', time: 0, bpm: 60, numerator: 4, denominator: 4 },
    { id: 'b', time: 40, bpm: 90, numerator: 4, denominator: 4 },
  );
  const barOf = (m: TempoMap, id: string) =>
    secondsToBarBeat(m, m.events.find(e => e.id === id)!.time);

  it('turning an event into a ramp keeps it on its bar', () => {
    expect(barOf(base, 'b')).toEqual({ bar: 11, beat: 1 });

    const ramped = updateTempoEvent(base, 'b', { curve: 'ramp' }).map;
    // 40 quarters covered at the average of 60 and 90 BPM = 75 => 32 s.
    expect(ramped.events[1].time).toBeCloseTo(32, 9);
    expect(barOf(ramped, 'b')).toEqual({ bar: 11, beat: 1 });
  });

  it('and turning it back restores the original seconds', () => {
    const ramped = updateTempoEvent(base, 'b', { curve: 'ramp' }).map;
    const back = updateTempoEvent(ramped, 'b', { curve: 'jump' }).map;
    expect(back.events[1].time).toBeCloseTo(40, 9);
  });

  it('changing an EARLIER tempo keeps later events on their bars', () => {
    const faster = updateTempoEvent(base, 'a', { bpm: 120 }).map;
    // Bars are now 2 s, so bar 11 sits at 20 s.
    expect(faster.events[1].time).toBeCloseTo(20, 9);
    expect(barOf(faster, 'b')).toEqual({ bar: 11, beat: 1 });
  });

  it('a meter change moves no event at all', () => {
    const threeFour = updateTempoEvent(base, 'a', { numerator: 3 }).map;
    expect(threeFour.events[1].time).toBeCloseTo(40, 9);
  });

  it('deleting an event keeps the ones after it on their bars', () => {
    const three = insertTempoEvent(base, { time: 60, bpm: 60 }).map;
    const lastBar = barOf(three, three.events[2].id);

    const without = removeTempoEvent(three, 'b').map;
    expect(barOf(without, without.events[1].id)).toEqual(lastBar);
  });

  it('a DRAG still lands exactly where it was dropped', () => {
    // The dropped position is what the user pointed at, so it wins over the
    // musical address — otherwise the flag would slide out from under the cursor.
    const moved = updateTempoEvent(base, 'b', { time: 24 }).map;
    expect(moved.events[1].time).toBeCloseTo(24, 9);
  });

  it('an inserted event lands exactly where it was placed', () => {
    const inserted = insertTempoEvent(base, { time: 16, bpm: 140 });
    expect(inserted.event?.time).toBeCloseTo(16, 9);
  });
});
