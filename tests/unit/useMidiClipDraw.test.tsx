// Regression test for issue #232 — drawing a MIDI clip with the pencil tool
// must create the clip exactly over the dragged region, not shifted later.
//
// The bug: useMidiClipDraw measured the drag against the outer `.timeline-track-stack`
// (which includes the trackHeaderWidth header column) instead of the lane's
// clip row. That shifted every new clip right by `trackHeaderWidth / zoom`
// seconds. Here we simulate a layout where the clip row's left edge (time-zero)
// sits HEADER_OFFSET px to the right of the viewport origin and assert the
// created clip's startTime/duration map purely from the row-relative pixels.

import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useMidiClipDraw } from '../../src/components/timeline/hooks/useMidiClipDraw';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockTrack } from '../helpers/mockData';

const ZOOM = 50; // px per second
const HEADER_OFFSET = 200; // px — simulates the track-header column width
const LANE_TOP = 100;
const LANE_HEIGHT = 80;

const pixelToTime = (px: number) => px / ZOOM;

function DrawHarness() {
  const tracks = useTimelineStore.getState().tracks;
  const { handleMidiDrawMouseDown } = useMidiClipDraw({
    tracks,
    activeTimelineToolId: 'midi-draw',
    pixelToTime,
  });
  return (
    <div
      className="track-lane midi"
      data-track-id="midi-1"
      onMouseDown={handleMidiDrawMouseDown}
    >
      <div className="track-clip-row" />
    </div>
  );
}

let rectSpy: { restore: () => void };

beforeEach(() => {
  useTimelineStore.setState({
    tracks: [createMockTrack({ id: 'midi-1', type: 'midi' })],
    clips: [],
    selectedClipIds: new Set(),
    primarySelectedClipId: null,
    playheadPosition: 0,
    isExporting: false,
    duration: 60,
  });

  // The clip row (time-zero origin) and the lane both start at HEADER_OFFSET.
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this.classList.contains('track-clip-row') || this.classList.contains('track-lane')) {
      return {
        left: HEADER_OFFSET,
        right: HEADER_OFFSET + 1000,
        top: LANE_TOP,
        bottom: LANE_TOP + LANE_HEIGHT,
        width: 1000,
        height: LANE_HEIGHT,
        x: HEADER_OFFSET,
        y: LANE_TOP,
        toJSON: () => ({}),
      } as DOMRect;
    }
    return original.call(this);
  };
  rectSpy = { restore: () => { Element.prototype.getBoundingClientRect = original; } };
});

afterEach(() => {
  rectSpy.restore();
});

describe('useMidiClipDraw — drawn clip matches the dragged region (issue #232)', () => {
  it('creates the clip over the dragged pixels, not shifted by the header width', () => {
    const { container } = render(<DrawHarness />);
    const lane = container.querySelector('.track-lane') as HTMLElement;

    // Drag from 100px to 300px *inside the lane* (i.e. clientX HEADER_OFFSET+100
    // to HEADER_OFFSET+300).
    const startClientX = HEADER_OFFSET + 100;
    const endClientX = HEADER_OFFSET + 300;

    fireEvent.mouseDown(lane, { button: 0, clientX: startClientX, clientY: LANE_TOP + 10 });
    fireEvent.mouseMove(document, { clientX: endClientX, clientY: LANE_TOP + 10 });
    fireEvent.mouseUp(document, { clientX: endClientX, clientY: LANE_TOP + 10 });

    const clips = useTimelineStore.getState().clips;
    expect(clips).toHaveLength(1);
    // Row-relative: 100px → 2s start, 200px span → 4s duration.
    expect(clips[0].startTime).toBeCloseTo(100 / ZOOM, 5);
    expect(clips[0].duration).toBeCloseTo(200 / ZOOM, 5);
    // Guard against the old bug, which ignored HEADER_OFFSET and produced 6s.
    expect(clips[0].startTime).not.toBeCloseTo((HEADER_OFFSET + 100) / ZOOM, 1);
  });

  it('creates a default-length clip on a plain click (no drag)', () => {
    const { container } = render(<DrawHarness />);
    const lane = container.querySelector('.track-lane') as HTMLElement;
    const clickClientX = HEADER_OFFSET + 250;

    fireEvent.mouseDown(lane, { button: 0, clientX: clickClientX, clientY: LANE_TOP + 10 });
    fireEvent.mouseUp(document, { clientX: clickClientX, clientY: LANE_TOP + 10 });

    const clips = useTimelineStore.getState().clips;
    expect(clips).toHaveLength(1);
    expect(clips[0].startTime).toBeCloseTo(250 / ZOOM, 5);
    expect(clips[0].duration).toBeCloseTo(4, 5); // DEFAULT_CLICK_CLIP_DURATION
  });
});
