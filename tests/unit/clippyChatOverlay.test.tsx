import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClippyChatOverlay } from '../../src/components/common/clippyChat/ClippyChatOverlay';
import { takeLandingEntryRequest } from '../../src/marketing/landingEntryRequest';

const { activatePanelType } = vi.hoisted(() => ({ activatePanelType: vi.fn() }));
vi.mock('../../src/stores/dockStore', () => ({
  useDockStore: { getState: () => ({ activatePanelType }) },
}));

beforeEach(() => {
  sessionStorage.clear();
  takeLandingEntryRequest();
  activatePanelType.mockClear();
});
afterEach(cleanup);

describe('Clippy chat overlay', () => {
  it('hands the typed draft to the existing chat composer only after submission', () => {
    render(<ClippyChatOverlay />);
    expect(screen.getByRole('button', { name: 'Continue in AI chat' })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('inside me'), { target: { value: '  Add a title  ' } });
    expect(takeLandingEntryRequest()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continue in AI chat' }));
    expect(activatePanelType).toHaveBeenCalledWith('media');
    expect(takeLandingEntryRequest()).toMatchObject({ mode: 'chat', prompt: 'Add a title' });
    expect(screen.getByRole('button', { name: 'Open Clippy chat' })).toBeInTheDocument();
  });

  it('preserves an unsent draft across closing and reopening, and remembers dismissal', () => {
    const view = render(<ClippyChatOverlay />);
    fireEvent.change(screen.getByPlaceholderText('inside me'), { target: { value: 'Keep this draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close Clippy chat' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Clippy chat' }));
    expect(screen.getByPlaceholderText('inside me')).toHaveValue('Keep this draft');
    fireEvent.click(screen.getByRole('button', { name: 'Close Clippy chat' }));
    view.unmount();
    render(<ClippyChatOverlay />);
    expect(screen.queryByPlaceholderText('inside me')).not.toBeInTheDocument();
  });

  it('keeps typing available when the video cannot load', () => {
    render(<ClippyChatOverlay videoSrc="/unavailable.webm" />);
    fireEvent.error(screen.getByLabelText('Clippy introduction'));
    expect(screen.getByRole('img', { name: 'Clippy' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('inside me')).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Replay Clippy' })).not.toBeInTheDocument();
  });

  it('does not hand off Shift+Enter or IME composition and closes on Escape', () => {
    render(<ClippyChatOverlay />);
    const input = screen.getByPlaceholderText('inside me');
    fireEvent.change(input, { target: { value: 'Draft' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(takeLandingEntryRequest()).toBeNull();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Open Clippy chat' })).toBeInTheDocument();
  });
});
