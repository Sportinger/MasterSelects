import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/components/timeline/hooks/usePlaybackLoop', () => ({
  usePlaybackLoop: vi.fn(),
}));

import { EditorPlaybackRuntimeHost } from '../../src/components/common/EditorPlaybackRuntimeHost';
import { useTimelineStore } from '../../src/stores/timeline';

describe('EditorPlaybackRuntimeHost keyboard playback', () => {
  const play = vi.fn(async () => {
    useTimelineStore.setState({ isPlaying: true });
  });
  const pause = vi.fn(() => {
    useTimelineStore.setState({ isPlaying: false });
  });

  beforeEach(() => {
    play.mockClear();
    pause.mockClear();
    useTimelineStore.setState({ isPlaying: false, pause, play });
  });

  afterEach(cleanup);

  it('toggles playback with Space without a full Timeline mounted', () => {
    render(<EditorPlaybackRuntimeHost />);

    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    expect(play).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('leaves Space available while the user is typing', () => {
    render(
      <>
        <EditorPlaybackRuntimeHost />
        <input aria-label="Color value" />
      </>,
    );
    const input = screen.getByRole('textbox', { name: 'Color value' });
    input.focus();

    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'Space',
      key: ' ',
    });
    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(play).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
  });
});
