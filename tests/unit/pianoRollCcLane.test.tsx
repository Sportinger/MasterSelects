import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { useTimelineStore } from '../../src/stores/timeline';
import type { TimelineClip } from '../../src/types';
import { PianoRollCcLane } from '../../src/components/pianoRoll/controllerLanes/PianoRollCcLane';
import {
  getLaneType,
  laneDisplayValue,
  laneValueRange,
} from '../../src/components/pianoRoll/controllerLanes/pianoRollLaneTypes';

function midiClip(): TimelineClip {
  return {
    id: 'clip-midi-1', trackId: 'midi-1', name: 'MIDI Clip',
    file: new File([], 'midi-clip.dat'),
    startTime: 0, duration: 4, inPoint: 0, outPoint: 4,
    source: { type: 'midi', naturalDuration: 4 },
    transform: {} as TimelineClip['transform'],
    effects: [],
    midiData: { notes: [] },
  };
}

const effWindow = { startTime: 0, duration: 4, inPoint: 0, outPoint: 4 };

describe('lane value helpers', () => {
  it('maps normalized values to display and knows bipolar ranges', () => {
    expect(laneValueRange(getLaneType('cc-cutoff')!)).toEqual([0, 1]);
    expect(laneValueRange(getLaneType('cc-pitchbend')!)).toEqual([-1, 1]);
    expect(laneDisplayValue(getLaneType('cc-cutoff')!, 1)).toBe(127);
    expect(laneDisplayValue(getLaneType('cc-pitchbend')!, -1)).toBe(-100);
  });
});

describe('PianoRollCcLane (integration smoke)', () => {
  beforeEach(() => {
    useTimelineStore.setState({ clips: [midiClip()], selectedClipIds: new Set() });
  });

  it('adds a breakpoint at the clicked position via the real coordinate mapping', () => {
    // jsdom getBoundingClientRect returns zeros, so clientX/Y map straight to local x/y.
    const { container } = render(
      <PianoRollCcLane
        clipId="clip-midi-1" lane={getLaneType('cc-cutoff')!} effWindow={effWindow}
        pxPerSec={100} marginPx={0} laneInnerH={100} gridWidth={400}
      />,
    );
    const svg = container.querySelector('svg') as SVGSVGElement;
    fireEvent.mouseDown(svg, { button: 0, clientX: 100, clientY: 50 });

    const pts = useTimelineStore.getState().clips[0].automation?.cutoff?.points ?? [];
    expect(pts).toHaveLength(1);
    expect(pts[0].time).toBeCloseTo(1, 3);   // 100px / 100pxps = 1s content time
    expect(pts[0].value).toBeCloseTo(0.5, 3); // y=50 of 100 → mid = 0.5
  });
});
