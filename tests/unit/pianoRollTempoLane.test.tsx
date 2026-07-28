// Tempo lane in the piano roll (issue #299).
//
// A read-only mirror of the timeline's tempo lane, so the tempo driving these
// bars is visible while writing notes. Inline-styled: the piano roll is a
// detached popup with no access to the app's CSS classes in dev.

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import { PianoRollRuler, pianoRollRulerHeight } from '../../src/components/pianoRoll/PianoRollRuler';
import { normalizeTempoMap } from '../../src/timeline/tempo/tempoEdits';

const TICKS = { bars: [], time: [] };
const PX_PER_SEC = 100;

function renderRuler(tempoEvents?: ReturnType<typeof normalizeTempoMap>['events']) {
  return render(
    <PianoRollRuler
      rulerTicks={TICKS}
      tempoEvents={tempoEvents}
      clipStartTime={0}
      clipDuration={10}
      pxPerSec={PX_PER_SEC}
      marginPx={0}
      onResizeStart={() => {}}
    />,
  );
}

const events = normalizeTempoMap({
  events: [
    { id: 'project', time: 0, bpm: 120, numerator: 4, denominator: 4 },
    { id: 'later', time: 8, bpm: 90, numerator: 3, denominator: 4, curve: 'ramp' },
  ],
}).events;

describe('piano roll tempo lane', () => {
  it('adds a lane row worth of height, and none when hidden', () => {
    expect(pianoRollRulerHeight(3) - pianoRollRulerHeight(2)).toBe(31);
  });

  it('renders nothing extra when no tempo events are passed', () => {
    const { container } = renderRuler();
    expect(container.textContent).toBe('StartEnd');
  });

  it('renders a flag per event, labelled like the timeline', () => {
    const { container } = renderRuler(events);
    expect(container.textContent).toContain('4/4 - BPM = 120');
    expect(container.textContent).toContain('3/4 - BPM = 90');
  });

  it('positions flags in clip-local pixels', () => {
    const { container } = renderRuler(events);
    const flags = Array.from(container.querySelectorAll<HTMLElement>('div[title*="BPM"]'));
    expect(flags[0].style.left).toBe('0px');
    expect(flags[1].style.left).toBe(`${8 * PX_PER_SEC}px`);
  });

  it('shows the ramp arrow and a sloped indicator spanning the ramped interval', () => {
    const { container } = renderRuler(events);
    // 120 -> 90 is a slow-down.
    expect(container.textContent).toContain('↘');

    const indicator = container.querySelector<SVGElement>('svg')!;
    expect(indicator).toBeTruthy();
    expect(indicator.style.left).toBe('0px');
    expect(indicator.style.width).toBe(`${8 * PX_PER_SEC}px`);
  });

  it('draws no indicator for a map of plain jumps', () => {
    const jumps = normalizeTempoMap({
      events: [
        { id: 'project', time: 0, bpm: 120, numerator: 4, denominator: 4 },
        { id: 'later', time: 8, bpm: 90, numerator: 4, denominator: 4 },
      ],
    }).events;
    const { container } = renderRuler(jumps);
    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).not.toContain('↘');
  });

  it('is read-only — flags never swallow ruler scrubbing', () => {
    const { container } = renderRuler(events);
    const flags = Array.from(container.querySelectorAll<HTMLElement>('div[title*="BPM"]'));
    expect(flags.every((flag) => flag.style.pointerEvents === 'none')).toBe(true);
  });
});
