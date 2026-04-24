import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SlotClipTab } from '../../src/components/panels/properties/SlotClipTab';
import { layerPlaybackManager } from '../../src/services/layerPlaybackManager';
import { useMediaStore } from '../../src/stores/mediaStore';
import type { Composition, SlotClipSettings } from '../../src/stores/mediaStore';

vi.mock('../../src/services/layerPlaybackManager', () => ({
  layerPlaybackManager: {
    activateLayer: vi.fn(),
    pauseLayer: vi.fn(),
    stopLayer: vi.fn(),
    getLayerPlaybackInfo: vi.fn(() => null),
  },
}));

vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: Object.assign(vi.fn(), {
    getState: vi.fn(),
  }),
}));

type MockFn = ReturnType<typeof vi.fn>;

type MockMediaState = {
  slotClipSettings: Record<string, SlotClipSettings>;
  activeLayerSlots: Record<number, string | null>;
  updateSlotClipSettings: MockFn;
  activateOnLayer: MockFn;
};

const mockedUseMediaStore = useMediaStore as unknown as MockFn & {
  getState: MockFn;
};
const mockedLayerPlaybackManager = layerPlaybackManager as unknown as {
  activateLayer: MockFn;
  pauseLayer: MockFn;
  stopLayer: MockFn;
  getLayerPlaybackInfo: MockFn;
};

function createComposition(): Composition {
  return {
    id: 'comp-1',
    name: 'Slot Comp',
    type: 'composition',
    parentId: null,
    createdAt: 1,
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 60,
    backgroundColor: '#000000',
    timelineData: {
      tracks: [
        { id: 'v1', name: 'Video 1', type: 'video', height: 80, muted: false, visible: true, solo: false },
        { id: 'a1', name: 'Audio 1', type: 'audio', height: 60, muted: false, visible: true, solo: false },
      ],
      clips: [
        {
          id: 'clip-v',
          trackId: 'v1',
          name: 'Intro Video',
          mediaFileId: 'file-v',
          startTime: 5,
          duration: 20,
          inPoint: 0,
          outPoint: 20,
          sourceType: 'video',
          transform: {} as any,
          effects: [],
        },
        {
          id: 'clip-a',
          trackId: 'a1',
          name: 'Intro Audio',
          mediaFileId: 'file-a',
          startTime: 5,
          duration: 20,
          inPoint: 0,
          outPoint: 20,
          sourceType: 'audio',
          transform: {} as any,
          effects: [],
        },
      ],
      playheadPosition: 17,
      duration: 60,
      zoom: 50,
      scrollX: 0,
      inPoint: null,
      outPoint: null,
      loopPlayback: false,
    },
  };
}

describe('SlotClipTab', () => {
  let mediaState: MockMediaState;

  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    mockedLayerPlaybackManager.activateLayer.mockClear();
    mockedLayerPlaybackManager.pauseLayer.mockClear();
    mockedLayerPlaybackManager.stopLayer.mockClear();
    mockedLayerPlaybackManager.getLayerPlaybackInfo.mockReturnValue(null);

    mediaState = {
      slotClipSettings: {
        'comp-1': {
          trimIn: 10,
          trimOut: 30,
          endBehavior: 'loop',
        },
      },
      activeLayerSlots: {},
      updateSlotClipSettings: vi.fn(),
      activateOnLayer: vi.fn(),
    };

    mockedUseMediaStore.mockImplementation((selector: (state: MockMediaState) => unknown) => selector(mediaState));
    mockedUseMediaStore.getState.mockImplementation(() => mediaState);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a track-aware slot timeline with the configured range', () => {
    const { container } = render(<SlotClipTab composition={createComposition()} slotIndex={0} />);

    expect(screen.getByText('Range')).toBeInTheDocument();
    expect(screen.getByText('Slot Comp')).toBeInTheDocument();
    expect(screen.getByText('A1')).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getByText('In')).toBeInTheDocument();
    expect(screen.getByText('Out')).toBeInTheDocument();
    expect(screen.getByText('Length')).toBeInTheDocument();
    expect(container.querySelectorAll('.slot-clip-clip')).toHaveLength(2);
    expect(container.querySelector('.slot-clip-range-window')).toHaveStyle({
      left: '16.666666666666664%',
      width: '33.333333333333336%',
    });
  });

  it('restarts an active slot from its range start', () => {
    mediaState.activeLayerSlots = { 0: 'comp-1' };

    render(<SlotClipTab composition={createComposition()} slotIndex={0} />);
    fireEvent.click(screen.getByText('Restart'));

    expect(mockedLayerPlaybackManager.activateLayer).toHaveBeenCalledWith(
      0,
      'comp-1',
      10,
      { slotIndex: 0 }
    );
  });

  it('activates the layer when launching an inactive slot', () => {
    render(<SlotClipTab composition={createComposition()} slotIndex={0} />);
    fireEvent.click(screen.getByText('Launch'));

    expect(mediaState.activateOnLayer).toHaveBeenCalledWith('comp-1', 0);
    expect(mockedLayerPlaybackManager.activateLayer).toHaveBeenCalledWith(
      0,
      'comp-1',
      10,
      { slotIndex: 0 }
    );
  });
});
