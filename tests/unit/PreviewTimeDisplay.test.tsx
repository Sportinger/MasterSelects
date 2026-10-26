import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const setDuration = vi.hoisted(() => vi.fn());
vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: (selector: (state: { setDuration: typeof setDuration }) => unknown) => selector({ setDuration }),
}));
import { PreviewTimeDisplay } from '../../src/components/preview/PreviewTimeDisplay';
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const props = { duration: 300, playheadPosition: 12, inPoint: null, outPoint: null, frameRate: 25 };

describe('Preview composition clock', () => {
  it('shows time and duration, and switches to composition frames', () => {
    render(<PreviewTimeDisplay {...props} />);
    expect(screen.getByRole('button', { name: 'Edit composition duration' })).toHaveTextContent('05:00.00');
    const clock = screen.getByRole('button', { name: 'Current time; switch to frames' });
    expect(clock).toHaveTextContent('00:12.00');
    fireEvent.doubleClick(clock);
    expect(screen.getByRole('button', { name: 'Current frame; switch to time' })).toHaveTextContent('300');
    expect(screen.getByRole('button', { name: 'Edit composition duration' })).toHaveTextContent('7500');
  });
  it('applies edited duration on Enter and cancels on Escape', () => {
    render(<PreviewTimeDisplay {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit composition duration' }));
    const input = screen.getByRole('textbox', { name: 'Composition duration' });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: '01:30.50' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(setDuration).toHaveBeenCalledWith(90.5);
    setDuration.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Edit composition duration' }));
    const again = screen.getByRole('textbox');
    fireEvent.change(again, { target: { value: '99' } });
    fireEvent.keyDown(again, { key: 'Escape' });
    expect(setDuration).not.toHaveBeenCalled();
  });
  it('shows a bounded In/Out-relative position without editing the composition duration', () => {
    const { rerender } = render(<PreviewTimeDisplay {...props} inPoint={10} outPoint={20} />);
    expect(screen.getByRole('button')).toHaveTextContent('00:02.00');
    expect(screen.getByTitle('In/Out range duration')).toHaveTextContent('00:10.00');
    expect(screen.queryByRole('button', { name: 'Edit composition duration' })).toBeNull();
    rerender(<PreviewTimeDisplay {...props} playheadPosition={25} inPoint={10} outPoint={20} />);
    expect(screen.getByRole('button')).toHaveTextContent('00:10.00');
  });
});
