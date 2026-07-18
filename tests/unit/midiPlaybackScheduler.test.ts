import { describe, expect, it } from 'vitest';
import { sortMidiScheduleEventsByStart } from '../../src/services/audio/midiPlaybackScheduler';

describe('MIDI playback scheduling order', () => {
  it('schedules moved and append-ordered notes by timeline start with stable ties', () => {
    const events = [
      { id: 'later', absStart: 2 },
      { id: 'tie-a', absStart: 1 },
      { id: 'earlier', absStart: 0.5 },
      { id: 'tie-b', absStart: 1 },
    ];

    expect(sortMidiScheduleEventsByStart(events).map((event) => event.id)).toEqual([
      'earlier',
      'tie-a',
      'tie-b',
      'later',
    ]);
  });
});
