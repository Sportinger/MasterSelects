import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrackContextMenu, type TrackContextMenuState } from '../../src/components/timeline/TrackContextMenu';
import type { TimelineClip, TimelineTrack } from '../../src/types';

const timelineStore = vi.hoisted(() => ({
  current: {
    tracks: [] as TimelineTrack[],
    clips: [] as TimelineClip[],
    addTrack: vi.fn(),
    removeTrack: vi.fn(),
  },
}));

vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: {
    getState: () => timelineStore.current,
  },
}));

function audioTrack(id: string, name: string): TimelineTrack {
  return {
    id,
    name,
    type: 'audio',
    height: 40,
    muted: false,
    solo: false,
    visible: true,
  } as TimelineTrack;
}

function renderTrackMenu(onClose = vi.fn()) {
  const menu: TrackContextMenuState = {
    x: 24,
    y: 32,
    trackId: 'audio-2',
    trackType: 'audio',
    trackName: 'Audio 2',
  };

  render(
    <>
      <button type="button">outside</button>
      <div
        data-testid="timeline-surface"
        onPointerDown={(event) => event.stopPropagation()}
      />
      <TrackContextMenu menu={menu} onClose={onClose} />
    </>,
  );

  return { onClose };
}

async function waitForDismissListeners(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe('TrackContextMenu', () => {
  beforeEach(() => {
    timelineStore.current = {
      tracks: [
        audioTrack('audio-1', 'Audio 1'),
        audioTrack('audio-2', 'Audio 2'),
      ],
      clips: [],
      addTrack: vi.fn(),
      removeTrack: vi.fn(),
    };
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('closes when pointer-down happens outside the menu', async () => {
    const { onClose } = renderTrackMenu();
    await waitForDismissListeners();

    fireEvent.pointerDown(screen.getByText('outside'));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes from capture phase even when the timeline surface stops bubbling', async () => {
    const { onClose } = renderTrackMenu();
    await waitForDismissListeners();

    fireEvent.pointerDown(screen.getByTestId('timeline-surface'));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps the menu open for pointer-down inside the menu', async () => {
    const { onClose } = renderTrackMenu();
    await waitForDismissListeners();

    fireEvent.pointerDown(screen.getByText('+ Add Audio Track'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    const { onClose } = renderTrackMenu();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledOnce();
  });
});
