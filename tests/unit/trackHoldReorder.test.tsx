import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const reorderTrack = vi.fn();
vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: (selector: (state: { reorderTrack: typeof reorderTrack }) => unknown) => selector({ reorderTrack }),
}));

import { TRACK_HOLD_TO_REORDER_MS, trackReorderSection, useTrackReorderDrag } from '../../src/components/timeline/hooks/useTrackReorderDrag';
import type { TimelineTrack } from '../../src/types';

function Header({ track, onSelect }: { track: TimelineTrack; onSelect: () => void }) {
  const { onHoldPointerDown } = useTrackReorderDrag(track);
  return (
    <div data-track-reorder-id={track.id} data-track-reorder-section={trackReorderSection(track)}>
      <div data-testid={`top-${track.id}`} onPointerDown={onHoldPointerDown} onClick={onSelect}>
        <button type="button">S</button>
      </div>
    </div>
  );
}

const track = (id: string) => ({ id, type: 'video', name: id, locked: false }) as unknown as TimelineTrack;

afterEach(() => { reorderTrack.mockReset(); vi.useRealTimers(); });

describe('hold to reorder a track', () => {
  it('picks the track up after holding still, moves it with its clips and swallows the release click', () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    const { getByTestId } = render(<><Header track={track('a')} onSelect={onSelect} /><Header track={track('b')} onSelect={vi.fn()} /></>);
    const target = getByTestId('top-b').parentElement!;
    target.getBoundingClientRect = () => ({ top: 100, height: 40, bottom: 140, left: 0, right: 200, width: 200, x: 0, y: 100, toJSON: () => ({}) });
    document.elementFromPoint = () => getByTestId('top-b');

    fireEvent.pointerDown(getByTestId('top-a'), { button: 0, clientX: 10, clientY: 20 });
    act(() => { vi.advanceTimersByTime(TRACK_HOLD_TO_REORDER_MS); });
    expect(getByTestId('top-a').parentElement!.classList.contains('track-reordering')).toBe(true);

    fireEvent.pointerMove(window, { clientX: 10, clientY: 130 });
    fireEvent.pointerUp(window, { clientX: 10, clientY: 130 });
    fireEvent.click(getByTestId('top-a'));
    expect(reorderTrack).toHaveBeenCalledWith('a', 'b', true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('keeps clicks, quick drags and header buttons as they were', () => {
    vi.useFakeTimers();
    const { getByTestId, getAllByRole } = render(<Header track={track('a')} onSelect={vi.fn()} />);
    fireEvent.pointerDown(getByTestId('top-a'), { button: 0, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(window, { clientX: 30, clientY: 20 });
    act(() => { vi.advanceTimersByTime(TRACK_HOLD_TO_REORDER_MS); });
    expect(getByTestId('top-a').parentElement!.classList.contains('track-reordering')).toBe(false);

    fireEvent.pointerDown(getAllByRole('button')[0]!, { button: 0, clientX: 10, clientY: 20 });
    act(() => { vi.advanceTimersByTime(TRACK_HOLD_TO_REORDER_MS); });
    expect(getByTestId('top-a').parentElement!.classList.contains('track-reordering')).toBe(false);
    expect(reorderTrack).not.toHaveBeenCalled();
  });
});
