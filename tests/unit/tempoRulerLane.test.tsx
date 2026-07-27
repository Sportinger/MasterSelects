// Tempo editor lane (issue #299, Packet 3).
//
// The lane renders flags from the tempo map and writes back through the store's
// tempo actions. Those actions are stubbed here so the assertions are about the
// LANE's behaviour — the actions themselves are covered by tempoSlice.test.ts.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { TempoRulerLane } from '../../src/components/timeline/components/TempoRulerLane';
import { useTimelineStore } from '../../src/stores/timeline';
import { normalizeTempoMap } from '../../src/timeline/tempo/tempoEdits';

// 120 BPM 4/4 => 2 s bars. Zoom 100 px/s => 200 px per bar.
const ZOOM = 100;
const tempoMap = normalizeTempoMap({
  events: [
    { id: 'project', time: 0, bpm: 120, numerator: 4, denominator: 4 },
    { id: 'later', time: 8, bpm: 90, numerator: 3, denominator: 4 },
  ],
});

const addTempoChange = vi.fn();
const updateTempoChange = vi.fn();
const removeTempoChange = vi.fn();

// The label is split into meter / separator / bpm spans so only the edited value
// becomes a field, so tests match on the flag's text content, not one text node.
function flagWithText(container: HTMLElement, text: string): HTMLElement {
  const match = Array.from(container.querySelectorAll<HTMLElement>('.tempo-flag'))
    .find((flag) => flag.textContent?.includes(text));
  if (!match) throw new Error(`No tempo flag containing "${text}"`);
  return match;
}

// Editing is menu-driven: right-click the flag, then pick the entry.
function openFlagMenu(container: HTMLElement, text: string, entry: string): void {
  fireEvent.contextMenu(flagWithText(container, text));
  fireEvent.click(screen.getByText(entry));
}

function renderLane(overrides: Partial<Parameters<typeof TempoRulerLane>[0]> = {}) {
  return render(
    <TempoRulerLane
      tempoMap={tempoMap}
      zoom={ZOOM}
      duration={60}
      visibleStartTime={0}
      visibleEndTime={40}
      devicePixelRatio={1}
      {...overrides}
    />,
  );
}

describe('TempoRulerLane', () => {
  beforeEach(() => {
    addTempoChange.mockReset();
    updateTempoChange.mockClear();
    removeTempoChange.mockClear();
    useTimelineStore.setState({ addTempoChange, updateTempoChange, removeTempoChange });
  });

  it('renders one flag per event, labelled "meter - BPM = n"', () => {
    const { container } = renderLane();
    const flags = container.querySelectorAll('.tempo-flag');
    expect(flags[0].textContent).toBe('4/4 - BPM = 120');
    expect(flags[1].textContent).toBe('3/4 - BPM = 90');
  });

  it('keeps the rest of the label visible while editing one value', () => {
    const { container } = renderLane();
    openFlagMenu(container, 'BPM = 90', 'Change tempo');

    const flag = container.querySelectorAll('.tempo-flag')[1];
    // The meter and the "BPM =" caption survive; only the number is a field.
    expect(flag.querySelector('.tempo-flag-meter')?.textContent).toBe('3/4');
    expect(flag.textContent).toContain('BPM =');
    expect(flag.querySelector('input.bpm')).toBeTruthy();
    expect(flag.querySelector('.tempo-flag-bpm')).toBeNull();
  });

  it('"Change time signature" edits the meter, not the BPM', () => {
    const { container } = renderLane();
    openFlagMenu(container, 'BPM = 90', 'Change time signature');

    expect(screen.getByLabelText('Time signature')).toBeTruthy();
    expect(screen.queryByLabelText('Tempo in BPM')).toBeNull();
    // The BPM half stays readable.
    expect(container.querySelectorAll('.tempo-flag')[1].textContent).toContain('90');
  });

  it('positions flags at time * zoom', () => {
    const { container } = renderLane();
    const flags = container.querySelectorAll<HTMLElement>('.tempo-flag');
    expect(flags[0].style.left).toBe('0px');
    expect(flags[1].style.left).toBe(`${8 * ZOOM}px`);
  });

  it('renders only events inside the visible window', () => {
    const { container } = renderLane({ visibleStartTime: 0, visibleEndTime: 4 });
    const flags = container.querySelectorAll('.tempo-flag');
    expect(flags).toHaveLength(1);
    expect(flags[0].textContent).toBe('4/4 - BPM = 120');
  });

  it('marks the project tempo as distinct and non-draggable', () => {
    const { container } = renderLane();
    const flags = container.querySelectorAll('.tempo-flag');
    expect(flags[0].className).toContain('is-project-tempo');
    expect(flags[1].className).not.toContain('is-project-tempo');
  });

  it('"Change tempo" opens an inline BPM editor that commits on Enter', () => {
    const { container } = renderLane();
    openFlagMenu(container, 'BPM = 90', 'Change tempo');

    const input = screen.getByLabelText('Tempo in BPM') as HTMLInputElement;
    expect(input.value).toBe('90');

    fireEvent.change(input, { target: { value: '140' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(updateTempoChange).toHaveBeenCalledWith('later', { bpm: 140 });
  });

  it('Escape cancels the inline editor without writing', () => {
    const { container } = renderLane();
    openFlagMenu(container, 'BPM = 90', 'Change tempo');
    const input = screen.getByLabelText('Tempo in BPM');
    fireEvent.change(input, { target: { value: '200' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(updateTempoChange).not.toHaveBeenCalled();
    expect(flagWithText(container, 'BPM = 90').textContent).toBe('3/4 - BPM = 90');
  });

  it('right-click offers Change tempo / Change time signature / Delete', () => {
    const { container } = renderLane();
    fireEvent.contextMenu(flagWithText(container, 'BPM = 90'));

    expect(screen.getByText('Change tempo')).toBeTruthy();
    expect(screen.getByText('Change time signature')).toBeTruthy();
    fireEvent.click(screen.getByText('Delete'));
    expect(removeTempoChange).toHaveBeenCalledWith('later');
  });

  it('refuses to delete the project tempo', () => {
    const { container } = renderLane();
    fireEvent.contextMenu(flagWithText(container, 'BPM = 120'));

    const deleteButton = screen.getByText('Delete') as HTMLButtonElement;
    expect(deleteButton.disabled).toBe(true);
    fireEvent.click(deleteButton);
    expect(removeTempoChange).not.toHaveBeenCalled();
  });

  it('the time-signature editor parses "5/8" and rejects an illegal denominator', () => {
    const { container } = renderLane();
    openFlagMenu(container, 'BPM = 90', 'Change time signature');

    const input = screen.getByLabelText('Time signature');
    fireEvent.change(input, { target: { value: '5/8' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(updateTempoChange).toHaveBeenCalledWith('later', { numerator: 5, denominator: 8 });

    // 7 is not a legal note value, so the edit is dropped rather than clamped
    // silently to something the user did not type.
    updateTempoChange.mockClear();
    openFlagMenu(container, 'BPM = 90', 'Change time signature');
    const rejected = screen.getByLabelText('Time signature');
    fireEvent.change(rejected, { target: { value: '5/7' } });
    fireEvent.keyDown(rejected, { key: 'Enter' });
    expect(updateTempoChange).not.toHaveBeenCalled();
  });

  it('right-clicking the lane offers "Add tempo change" at the nearest bar', () => {
    const { container } = renderLane();
    const surface = container.querySelector('.tempo-lane-surface')!;
    // jsdom gives a zero-width rect, so clientX maps straight to seconds/zoom.
    fireEvent.contextMenu(surface, { clientX: 4.4 * ZOOM });

    fireEvent.click(screen.getByText('Add tempo change'));
    // 4.4 s snaps to bar 3 (4 s) and inherits the 120 BPM in effect there.
    expect(addTempoChange).toHaveBeenCalledWith(4, 120);
  });

  it('the lane menu offers insertion only — never Delete', () => {
    const { container } = renderLane();
    fireEvent.contextMenu(container.querySelector('.tempo-lane-surface')!, { clientX: 0 });

    expect(screen.getByText('Add tempo change')).toBeTruthy();
    expect(screen.getByText('Add time signature change')).toBeTruthy();
    expect(screen.queryByText('Delete')).toBeNull();
    expect(screen.queryByText('Change tempo')).toBeNull();
  });

  // Adding is always followed by typing, so the new flag opens armed.
  it('"Add tempo change" arms the BPM editor with the inherited value selected', () => {
    addTempoChange.mockReturnValue('inserted');
    const withInserted = normalizeTempoMap({
      events: [
        { id: 'project', time: 0, bpm: 120, numerator: 4, denominator: 4 },
        { id: 'inserted', time: 4, bpm: 120, numerator: 4, denominator: 4 },
      ],
    });
    const { container, rerender } = renderLane();
    fireEvent.contextMenu(container.querySelector('.tempo-lane-surface')!, { clientX: 4 * ZOOM });
    fireEvent.click(screen.getByText('Add tempo change'));
    expect(addTempoChange).toHaveBeenCalledWith(4, 120);

    // The store would now hold the new event; re-render with it present.
    rerender(
      <TempoRulerLane
        tempoMap={withInserted}
        zoom={ZOOM}
        duration={60}
        visibleStartTime={0}
        visibleEndTime={40}
        devicePixelRatio={1}
      />,
    );

    const input = screen.getByLabelText('Tempo in BPM') as HTMLInputElement;
    expect(input.value).toBe('120');
    // Typing replaces rather than appends.
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(3);
  });

  it('"Add time signature change" arms the METER editor instead', () => {
    addTempoChange.mockReturnValue('inserted');
    const withInserted = normalizeTempoMap({
      events: [
        { id: 'project', time: 0, bpm: 120, numerator: 4, denominator: 4 },
        { id: 'inserted', time: 4, bpm: 120, numerator: 4, denominator: 4 },
      ],
    });
    const { container, rerender } = renderLane();
    fireEvent.contextMenu(container.querySelector('.tempo-lane-surface')!, { clientX: 4 * ZOOM });
    fireEvent.click(screen.getByText('Add time signature change'));

    rerender(
      <TempoRulerLane
        tempoMap={withInserted}
        zoom={ZOOM}
        duration={60}
        visibleStartTime={0}
        visibleEndTime={40}
        devicePixelRatio={1}
      />,
    );

    const input = screen.getByLabelText('Time signature') as HTMLInputElement;
    expect(input.value).toBe('4/4');
    expect(screen.queryByLabelText('Tempo in BPM')).toBeNull();
  });

  it('closes on a press outside, even where mousedown is stopped', () => {
    const { container } = renderLane();
    fireEvent.contextMenu(flagWithText(container, 'BPM = 90'));
    expect(screen.getByText('Change tempo')).toBeTruthy();

    // A flag stops mousedown propagation, so only a CAPTURE-phase listener
    // sees this — the bug that left the menu stuck open.
    fireEvent.mouseDown(flagWithText(container, 'BPM = 120'));
    expect(screen.queryByText('Change tempo')).toBeNull();
  });

  it('closes on Escape', () => {
    const { container } = renderLane();
    fireEvent.contextMenu(flagWithText(container, 'BPM = 90'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Change tempo')).toBeNull();
  });

  it('a press inside the menu does not dismiss it before the click lands', () => {
    const { container } = renderLane();
    fireEvent.contextMenu(flagWithText(container, 'BPM = 90'));
    const entry = screen.getByText('Change tempo');

    fireEvent.mouseDown(entry);
    fireEvent.click(entry);
    expect(screen.getByLabelText('Tempo in BPM')).toBeTruthy();
  });

  // Issue #299: a ramp is REACHED by interpolation, and has to be visible as
  // such without opening a menu.
  it('offers a Jump/Ramp toggle, disabled on the project tempo', () => {
    const { container } = renderLane();

    fireEvent.contextMenu(flagWithText(container, 'BPM = 90'));
    const toggle = screen.getByText(/Ramp from previous tempo/).closest('button')!;
    expect(toggle.disabled).toBe(false);
    fireEvent.click(toggle);
    expect(updateTempoChange).toHaveBeenCalledWith('later', { curve: 'ramp' });

    fireEvent.contextMenu(flagWithText(container, 'BPM = 120'));
    const pinned = screen.getByText(/Ramp from previous tempo/).closest('button')!;
    expect(pinned.disabled).toBe(true);
  });

  it('turns a ramp back into a jump', () => {
    const ramped = normalizeTempoMap({
      events: [
        { id: 'project', time: 0, bpm: 120, numerator: 4, denominator: 4 },
        { id: 'later', time: 8, bpm: 90, numerator: 3, denominator: 4, curve: 'ramp' },
      ],
    });
    const { container } = renderLane({ tempoMap: ramped });

    fireEvent.contextMenu(flagWithText(container, 'BPM = 90'));
    fireEvent.click(screen.getByText(/Ramp from previous tempo/).closest('button')!);
    expect(updateTempoChange).toHaveBeenCalledWith('later', { curve: 'jump' });
  });

  it('draws a sloped indicator and an arrow for a ramp, and nothing for a jump', () => {
    const jumps = renderLane();
    expect(jumps.container.querySelector('.tempo-ramp-indicator')).toBeNull();
    expect(jumps.container.querySelector('.tempo-flag-ramp')).toBeNull();
    jumps.unmount();

    // 120 -> 90 is a slow-down, so the indicator falls and the arrow points down.
    const ramped = normalizeTempoMap({
      events: [
        { id: 'project', time: 0, bpm: 120, numerator: 4, denominator: 4 },
        { id: 'later', time: 8, bpm: 90, numerator: 3, denominator: 4, curve: 'ramp' },
      ],
    });
    const { container } = renderLane({ tempoMap: ramped });

    const indicator = container.querySelector<SVGElement>('.tempo-ramp-indicator')!;
    expect(indicator).toBeTruthy();
    // Spans the interval it ramps over: from the previous event to this one.
    expect(indicator.style.left).toBe('0px');
    expect(indicator.style.width).toBe(`${8 * ZOOM}px`);

    const line = indicator.querySelector('line')!;
    expect(Number(line.getAttribute('y1'))).toBeLessThan(Number(line.getAttribute('y2')));
    expect(container.querySelector('.tempo-flag-ramp')?.textContent).toBe('↘');
    expect(container.querySelectorAll('.tempo-flag')[1].className).toContain('is-ramp');
  });

  it('points the arrow up for a speed-up', () => {
    const ramped = normalizeTempoMap({
      events: [
        { id: 'project', time: 0, bpm: 90, numerator: 4, denominator: 4 },
        { id: 'later', time: 8, bpm: 140, numerator: 4, denominator: 4, curve: 'ramp' },
      ],
    });
    const { container } = renderLane({ tempoMap: ramped });

    const line = container.querySelector('.tempo-ramp-indicator line')!;
    expect(Number(line.getAttribute('y1'))).toBeGreaterThan(Number(line.getAttribute('y2')));
    expect(container.querySelector('.tempo-flag-ramp')?.textContent).toBe('↗');
  });

  it('right-clicking a flag offers editing, not insertion', () => {
    const { container } = renderLane();
    fireEvent.contextMenu(flagWithText(container, 'BPM = 90'));

    expect(screen.queryByText('Add tempo change')).toBeNull();
    expect(screen.getByText('Change tempo')).toBeTruthy();
  });
});
