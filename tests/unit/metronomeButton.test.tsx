// Metronome toggle + settings popover (issue #299, Packet 6).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { MetronomeButton } from '../../src/components/timeline/MetronomeButton';
import { useTimelineStore } from '../../src/stores/timeline';

const toggleMetronome = vi.fn();
const setMetronomeVolume = vi.fn();
const setMetronomeMode = vi.fn();

function setState(overrides: Partial<{
  metronomeEnabled: boolean;
  metronomeVolume: number;
  metronomeMode: 'beats' | 'bars';
}> = {}) {
  useTimelineStore.setState({
    metronomeEnabled: false,
    metronomeVolume: 0.6,
    metronomeMode: 'beats',
    toggleMetronome,
    setMetronomeVolume,
    setMetronomeMode,
    ...overrides,
  });
}

describe('MetronomeButton', () => {
  beforeEach(() => {
    toggleMetronome.mockClear();
    setMetronomeVolume.mockClear();
    setMetronomeMode.mockClear();
    setState();
  });

  it('toggles the click and reflects the state', () => {
    const { rerender } = render(<MetronomeButton />);
    const button = screen.getByLabelText('Metronome');

    expect(button.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button);
    expect(toggleMetronome).toHaveBeenCalledTimes(1);

    setState({ metronomeEnabled: true });
    rerender(<MetronomeButton />);
    expect(screen.getByLabelText('Metronome').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText('Metronome').className).toContain('btn-active');
  });

  it('keeps settings behind a separate caret, so toggling never opens it', () => {
    render(<MetronomeButton />);
    fireEvent.click(screen.getByLabelText('Metronome'));
    expect(screen.queryByLabelText('Metronome volume')).toBeNull();

    fireEvent.click(screen.getByLabelText('Metronome settings'));
    expect(screen.getByLabelText('Metronome volume')).toBeTruthy();
    // Opening the settings must not have toggled the click.
    expect(toggleMetronome).toHaveBeenCalledTimes(1);
  });

  it('sets the volume from the slider and shows it as a percentage', () => {
    setState({ metronomeVolume: 0.4 });
    render(<MetronomeButton />);
    fireEvent.click(screen.getByLabelText('Metronome settings'));

    expect(screen.getByText('40%')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Metronome volume'), { target: { value: '0.85' } });
    expect(setMetronomeVolume).toHaveBeenCalledWith(0.85);
  });

  it('switches between every beat and bars only', () => {
    render(<MetronomeButton />);
    fireEvent.click(screen.getByLabelText('Metronome settings'));

    fireEvent.click(screen.getByText('Bars only'));
    expect(setMetronomeMode).toHaveBeenCalledWith('bars');

    fireEvent.click(screen.getByText('Every beat'));
    expect(setMetronomeMode).toHaveBeenCalledWith('beats');
  });

  it('marks the active mode', () => {
    setState({ metronomeMode: 'bars' });
    render(<MetronomeButton />);
    fireEvent.click(screen.getByLabelText('Metronome settings'));

    expect(screen.getByText('Bars only').closest('.view-dropdown-item')!.className)
      .toContain('active');
    expect(screen.getByText('Every beat').closest('.view-dropdown-item')!.className)
      .not.toContain('active');
  });

  it('closes the popover on an outside press', () => {
    render(<MetronomeButton />);
    fireEvent.click(screen.getByLabelText('Metronome settings'));
    expect(screen.getByLabelText('Metronome volume')).toBeTruthy();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByLabelText('Metronome volume')).toBeNull();
  });
});
