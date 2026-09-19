import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PropertiesPanel } from '../../src/components/panels/properties';
import { createLiveInputTimelineClip } from '../../src/services/liveInputTimeline';
import { useMediaStore, type MediaFile } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';

const initialTimelineState = useTimelineStore.getState();

function liveCamera(id: string, name: string): MediaFile {
  return {
    id,
    name,
    type: 'video',
    parentId: null,
    createdAt: 1,
    url: '',
    duration: 30,
    hasAudio: false,
    liveInput: {
      kind: 'video-device',
      deviceId: id,
      deviceLabel: name,
    },
  };
}

describe('live input Properties tab retention', () => {
  const firstItem = liveCamera('camera-a', 'Camera A');
  const secondItem = liveCamera('camera-b', 'Camera B');
  const firstClip = createLiveInputTimelineClip({
    item: firstItem,
    trackId: 'video-1',
    startTime: 0,
    id: 'clip-a',
  })!;
  const secondClip = createLiveInputTimelineClip({
    item: secondItem,
    trackId: 'video-1',
    startTime: 4,
    id: 'clip-b',
  })!;

  beforeEach(() => {
    const mediaState = {
      activeCompositionId: null,
      compositions: [],
      ensureSlotClipSettings: vi.fn(),
      files: [firstItem, secondItem],
      getActiveComposition: () => ({ width: 1920, height: 1080 }),
      selectSlotComposition: vi.fn(),
      selectedSlotCompositionId: null,
      slotAssignments: {},
      updateLiveInputSource: vi.fn(),
    };
    vi.mocked(useMediaStore).mockImplementation(((selector: (state: typeof mediaState) => unknown) => (
      selector(mediaState)
    )) as typeof useMediaStore);
    vi.mocked(useMediaStore.getState).mockReturnValue(mediaState as ReturnType<typeof useMediaStore.getState>);

    useTimelineStore.setState({
      ...initialTimelineState,
      clips: [firstClip, secondClip],
      tracks: [{
        id: 'video-1',
        name: 'Video 1',
        type: 'video',
        height: 70,
        muted: false,
        visible: true,
        solo: false,
      }],
      selectedClipIds: new Set([firstClip.id]),
      primarySelectedClipId: firstClip.id,
      propertiesSelection: { kind: 'clip', clipId: firstClip.id },
      clipKeyframes: new Map(),
    });
  });

  afterEach(() => {
    cleanup();
    act(() => useTimelineStore.setState(initialTimelineState));
  });

  it('keeps Color active when another live camera clip is selected', async () => {
    render(<PropertiesPanel />);

    const colorTab = await screen.findByRole('button', { name: 'Color' });
    fireEvent.click(colorTab);
    expect(colorTab).toHaveClass('active');

    act(() => useTimelineStore.getState().selectClip(secondClip.id));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Color' })).toHaveClass('active'));
  });
});
