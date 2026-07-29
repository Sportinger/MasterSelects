import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LandingPage, type LandingProjectMediaItem } from '../../src/marketing/LandingPage';
import { LandingPanel } from '../../src/marketing/LandingPanel';
import {
  FACTORY_START_LAYOUT_ID,
  FACTORY_VIDEO_EDIT_LAYOUT_ID,
  START_CHAT_EXIT_DURATION_MS,
  START_EDITOR_REVEAL_DURATION_MS,
  START_LAYOUT_OUTRO_DURATION_MS,
  START_LAYOUT_REVEAL_DURATION_MS,
  getFactoryDockLayouts,
  useDockStore,
} from '../../src/stores/dockStore';
import {
  DOCK_LAYOUT_TRANSITION_EVENT,
  START_CHROME_TRANSITION_EVENT,
} from '../../src/stores/dockStore/layoutTransition';

const { runLandingBackgroundCreationMock } = vi.hoisted(() => ({
  runLandingBackgroundCreationMock: vi.fn().mockResolvedValue({
    response: 'Done.',
  }),
}));

vi.mock('../../src/marketing/runLandingBackgroundCreation', () => ({
  LANDING_FINAL_OUTPUT_PREFIX: 'MasterSelects Final',
  runLandingBackgroundCreation: runLandingBackgroundCreationMock,
}));

const projectMedia: LandingProjectMediaItem[] = [
  { id: 'video-1', name: 'Interview.mp4', type: 'video', duration: 65, previewUrl: 'video-thumb.jpg' },
  { id: 'image-1', name: 'Poster.png', type: 'image', previewUrl: 'poster.png' },
  { id: 'audio-1', name: 'Theme.wav', type: 'audio', duration: 42 },
  { id: 'text-1', name: 'Opening title', type: 'text', textPreview: 'A film by MasterSelects' },
];

beforeEach(() => {
  useDockStore.setState({
    savedLayouts: getFactoryDockLayouts(),
    activeSavedLayoutId: FACTORY_START_LAYOUT_ID,
  });
});

afterEach(() => {
  cleanup();
  runLandingBackgroundCreationMock.mockClear();
  vi.useRealTimers();
});

describe('Start layout landing panel', () => {
  it('offers a compact Open action that starts the in-place editor reveal', () => {
    const onOpenEditor = vi.fn();
    render(<LandingPage onOpenEditor={onOpenEditor} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open MasterSelects editor' }));

    expect(onOpenEditor).toHaveBeenCalledTimes(1);
  });

  it('locks the Open action while the editor is opening', () => {
    render(<LandingPage isOpeningEditor onOpenEditor={() => undefined} />);

    const openButton = screen.getByRole('button', { name: 'Open MasterSelects editor' });
    expect(openButton).toBeDisabled();
    expect(openButton).toHaveTextContent('Opening');
  });

  it('renders the real project media as individual files', () => {
    render(<LandingPage projectMedia={projectMedia} />);

    expect(screen.getByRole('article', { name: 'Interview.mp4' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Poster.png' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Theme.wav' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Opening title' })).toBeInTheDocument();
  });

  it('forwards the landing prompt to the background AI runner', async () => {
    const onOpenChat = vi.fn();
    render(<LandingPage onOpenChat={onOpenChat} />);

    fireEvent.change(screen.getByLabelText('Message for AI Chat'), {
      target: { value: 'Make a quiet documentary intro' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create with AI' }));

    await waitFor(() => {
      expect(onOpenChat).toHaveBeenCalledWith(
        'Make a quiet documentary intro',
        expect.any(Function),
      );
    });
  });

  it('shows file duration and text previews in the project strip', () => {
    render(<LandingPage projectMedia={projectMedia} />);

    expect(screen.getByText('Interview.mp4')).toBeInTheDocument();
    expect(screen.getByText('1:05')).toBeInTheDocument();
    expect(screen.getByText('Opening title')).toBeInTheDocument();
    expect(screen.getByText('A film by MasterSelects')).toBeInTheDocument();
  });

  it('runs a typed message in the background without leaving the Start layout', async () => {
    render(<LandingPanel />);

    fireEvent.change(screen.getByLabelText('Message for AI Chat'), {
      target: { value: 'Help me plan a short film' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create with AI' }));

    await waitFor(() => {
      expect(runLandingBackgroundCreationMock).toHaveBeenCalledWith(
        'Help me plan a short film',
        expect.any(Function),
        expect.objectContaining({
          idempotencyKey: expect.stringMatching(/^landing-/),
          onPhaseChange: expect.any(Function),
          resumeFrom: 'preparing',
        }),
      );
    });
    expect(screen.getByRole('main')).not.toHaveClass('is-opening-editor');
    expect(useDockStore.getState().activeSavedLayoutId).toBe(FACTORY_START_LAYOUT_ID);
  });

  it('opens Video Edit through the shared three-second sequence transition', () => {
    vi.useFakeTimers();
    const listener = vi.fn<(event: Event) => void>();
    const chromeListener = vi.fn<(event: Event) => void>();
    window.addEventListener(DOCK_LAYOUT_TRANSITION_EVENT, listener);
    window.addEventListener(START_CHROME_TRANSITION_EVENT, chromeListener);
    render(<LandingPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Open MasterSelects editor' }));

    expect(screen.getByRole('main')).toHaveClass('is-opening-editor');
    expect(listener).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(START_CHAT_EXIT_DURATION_MS);
    });

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]?.[0] as CustomEvent<{
      durationMs: number;
      staggerMode: string;
      startTransitionDirection: string;
    }>;
    expect(event.detail.durationMs).toBe(START_EDITOR_REVEAL_DURATION_MS);
    expect(event.detail.staggerMode).toBe('sequence');
    expect(event.detail.startTransitionDirection).toBe('from-start');
    expect((chromeListener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      durationMs: START_EDITOR_REVEAL_DURATION_MS,
      direction: 'from-start',
    });
    expect(START_CHAT_EXIT_DURATION_MS + event.detail.durationMs).toBe(
      START_LAYOUT_REVEAL_DURATION_MS,
    );
    expect(useDockStore.getState().activeSavedLayoutId).toBe(FACTORY_VIDEO_EDIT_LAYOUT_ID);
    window.removeEventListener(DOCK_LAYOUT_TRANSITION_EVENT, listener);
    window.removeEventListener(START_CHROME_TRANSITION_EVENT, chromeListener);
  });

  it('uses the same sequence when the Start favorite is opened from the editor', () => {
    useDockStore.setState({ activeSavedLayoutId: FACTORY_VIDEO_EDIT_LAYOUT_ID });
    const listener = vi.fn<(event: Event) => void>();
    const chromeListener = vi.fn<(event: Event) => void>();
    window.addEventListener(DOCK_LAYOUT_TRANSITION_EVENT, listener);
    window.addEventListener(START_CHROME_TRANSITION_EVENT, chromeListener);

    useDockStore.getState().loadSavedLayout(FACTORY_START_LAYOUT_ID);

    const event = listener.mock.calls[0]?.[0] as CustomEvent<{
      durationMs: number;
      staggerMode: string;
      startTransitionDirection: string;
    }>;
    expect(event.detail).toEqual({
      durationMs: START_LAYOUT_OUTRO_DURATION_MS,
      staggerMode: 'sequence',
      startTransitionDirection: 'to-start',
    });
    expect((chromeListener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      durationMs: START_LAYOUT_OUTRO_DURATION_MS,
      direction: 'to-start',
    });
    expect(useDockStore.getState().activeSavedLayoutId).toBe(FACTORY_START_LAYOUT_ID);
    window.removeEventListener(DOCK_LAYOUT_TRANSITION_EVENT, listener);
    window.removeEventListener(START_CHROME_TRANSITION_EVENT, chromeListener);
  });
});
