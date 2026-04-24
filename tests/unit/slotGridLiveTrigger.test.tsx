import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createJSONStorage } from 'zustand/middleware';
import { SlotGrid } from '../../src/components/timeline/SlotGrid';
import { flags } from '../../src/engine/featureFlags';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useDockStore } from '../../src/stores/dockStore';
import { useMIDIStore } from '../../src/stores/midiStore';
import { layerPlaybackManager } from '../../src/services/layerPlaybackManager';
import type { SlotClipSettings, SlotDeckState } from '../../src/stores/mediaStore/types';

vi.mock('../../src/services/layerBuilder', () => ({
  playheadState: {
    position: 0,
    isUsingInternalPosition: false,
  },
}));

vi.mock('../../src/services/layerPlaybackManager', () => ({
  layerPlaybackManager: {
    activateLayer: vi.fn(),
    deactivateLayer: vi.fn(),
    buildLayersForLayer: vi.fn(),
    getLayerPlaybackInfo: vi.fn(() => null),
  },
}));

vi.mock('../../src/components/timeline/MiniTimeline', () => ({
  MiniTimeline: () => <div data-testid="mini-timeline" />,
}));

vi.mock('../../src/components/timeline/slotGridAnimation', () => ({
  animateSlotGrid: vi.fn(),
}));

vi.mock('../../src/services/slotDeckManager', () => ({
  slotDeckManager: {
    prepareSlot: vi.fn(),
    disposeSlot: vi.fn(),
    disposeAll: vi.fn(),
    adoptDeckToLayer: vi.fn(),
    getSlotState: vi.fn(),
    getPreparedDeck: vi.fn(),
    releaseLayerPin: vi.fn(),
  },
}));

vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: Object.assign(vi.fn(() => ({})), {
    getState: vi.fn(() => ({
      playheadPosition: 0,
      clips: [],
      stop: vi.fn(),
      setPlayheadPosition: vi.fn(),
      getSerializableState: vi.fn(() => ({
        tracks: [],
        clips: [],
        playheadPosition: 0,
        duration: 60,
        zoom: 50,
        scrollX: 0,
        inPoint: null,
        outPoint: null,
        loopPlayback: false,
      })),
      setActiveComposition: vi.fn(),
    })),
    setState: vi.fn(),
    subscribe: vi.fn(),
  }),
}));

type MockFn = ReturnType<typeof vi.fn>;

type MockMediaStore = MockFn & {
  getState: MockFn;
  setState: MockFn;
  subscribe: MockFn;
};

type MockComposition = {
  id: string;
  name: string;
  type: 'composition';
  parentId: null;
  createdAt: number;
  width: number;
  height: number;
  frameRate: number;
  duration: number;
  backgroundColor: string;
  timelineData: {
    tracks: unknown[];
    clips: unknown[];
    playheadPosition: number;
    duration: number;
    zoom: number;
    scrollX: number;
    inPoint: null;
    outPoint: null;
    loopPlayback: false;
  };
};

type MockMediaState = {
  activeCompositionId: string | null;
  slotAssignments: Record<string, number>;
  slotClipSettings: Record<string, SlotClipSettings>;
  activeLayerSlots: Record<number, string | null>;
  slotDeckStates: Record<number, SlotDeckState>;
  openCompositionTab: ReturnType<typeof vi.fn>;
  deactivateLayer: ReturnType<typeof vi.fn>;
  activateColumn: ReturnType<typeof vi.fn>;
  triggerLiveSlot: ReturnType<typeof vi.fn>;
  triggerLiveColumn: ReturnType<typeof vi.fn>;
  moveSlot: ReturnType<typeof vi.fn>;
  unassignSlot: ReturnType<typeof vi.fn>;
  assignMediaFileToSlot: ReturnType<typeof vi.fn>;
  getSlotMap: ReturnType<typeof vi.fn>;
  layerOpacities: Record<number, number>;
  setLayerOpacity: ReturnType<typeof vi.fn>;
  compositions: MockComposition[];
  files: Array<{ id: string; thumbnailUrl?: string }>;
  activateOnLayer: ReturnType<typeof vi.fn>;
  ensureSlotClipSettings: ReturnType<typeof vi.fn>;
  setActiveComposition: ReturnType<typeof vi.fn>;
};

const mockedUseMediaStore = useMediaStore as unknown as MockMediaStore;
const mockedLayerPlaybackManager = layerPlaybackManager as unknown as {
  activateLayer: MockFn;
  deactivateLayer: MockFn;
  getLayerPlaybackInfo: MockFn;
};

function createComposition(id = 'comp-1', name = 'Comp 1'): MockComposition {
  return {
    id,
    name,
    type: 'composition',
    parentId: null,
    createdAt: 1,
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 60,
    backgroundColor: '#000000',
    timelineData: {
      tracks: [],
      clips: [],
      playheadPosition: 0,
      duration: 60,
      zoom: 50,
      scrollX: 0,
      inPoint: null,
      outPoint: null,
      loopPlayback: false,
    },
  };
}

describe('SlotGrid live trigger flag', () => {
  let mediaState: MockMediaState;

  beforeEach(() => {
    flags.useLiveSlotTrigger = false;
    flags.useWarmSlotDecks = false;
    mockedLayerPlaybackManager.activateLayer.mockClear();
    mockedLayerPlaybackManager.deactivateLayer.mockClear();
    mockedLayerPlaybackManager.getLayerPlaybackInfo.mockReturnValue(null);
    useMIDIStore.persist.setOptions({
      storage: createJSONStorage(() => ({
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      })),
    });
    useMIDIStore.setState({
      learnTarget: null,
      slotBindings: {},
      transportBindings: {
        playPause: null,
        stop: null,
      },
    });

    const comp = createComposition();
    const slotMap = new Array(48).fill(null);
    slotMap[0] = comp;

    mediaState = {
      activeCompositionId: null,
      slotAssignments: { [comp.id]: 0 },
      slotClipSettings: {
        [comp.id]: {
          trimIn: 0,
          trimOut: 60,
          endBehavior: 'loop',
        },
      },
      activeLayerSlots: {},
      slotDeckStates: {},
      openCompositionTab: vi.fn(),
      deactivateLayer: vi.fn(),
      activateColumn: vi.fn(),
      triggerLiveSlot: vi.fn(),
      triggerLiveColumn: vi.fn(),
      moveSlot: vi.fn(),
      unassignSlot: vi.fn(),
      assignMediaFileToSlot: vi.fn(),
      getSlotMap: vi.fn(() => slotMap),
      layerOpacities: {},
      setLayerOpacity: vi.fn(),
      compositions: [comp],
      files: [],
      activateOnLayer: vi.fn(),
      ensureSlotClipSettings: vi.fn((compositionId: string, duration: number) => {
        mediaState.slotClipSettings[compositionId] ??= {
          trimIn: 0,
          trimOut: duration,
          endBehavior: 'loop',
        };
      }),
      setActiveComposition: vi.fn(),
    };

    mockedUseMediaStore.mockImplementation((selector: (state: MockMediaState) => unknown) => selector(mediaState));
    mockedUseMediaStore.getState.mockImplementation(() => mediaState);
    mockedUseMediaStore.setState.mockImplementation((update: Partial<MockMediaState> | ((state: MockMediaState) => Partial<MockMediaState>)) => {
      const next = typeof update === 'function' ? update(mediaState) : update;
      mediaState = { ...mediaState, ...next };
    });
    mockedUseMediaStore.subscribe.mockImplementation(() => () => {});
  });

  it('keeps the existing editor-first click path when the flag is off', () => {
    const { container } = render(<SlotGrid opacity={1} />);
    const slot = container.querySelector('[data-comp-id="comp-1"]') as HTMLElement;

    fireEvent.click(slot);

    expect(mediaState.openCompositionTab).toHaveBeenCalledWith('comp-1', {
      skipAnimation: true,
      playFromStart: true,
      playFromTime: 0,
    });
    expect(mediaState.activateOnLayer).toHaveBeenCalledWith('comp-1', 0);
    expect(mediaState.triggerLiveSlot).not.toHaveBeenCalled();
  });

  it('opens the slot editor playback at the configured slot range start', () => {
    mediaState.slotClipSettings['comp-1'] = {
      trimIn: 12,
      trimOut: 40,
      endBehavior: 'loop',
    };

    const { container } = render(<SlotGrid opacity={1} />);
    const slot = container.querySelector('[data-comp-id="comp-1"]') as HTMLElement;

    fireEvent.click(slot);

    expect(mediaState.openCompositionTab).toHaveBeenCalledWith('comp-1', {
      skipAnimation: true,
      playFromStart: true,
      playFromTime: 12,
    });
  });

  it('routes slot click through live triggering without opening the editor when the flag is on', () => {
    flags.useLiveSlotTrigger = true;

    const { container } = render(<SlotGrid opacity={1} />);
    const slot = container.querySelector('[data-comp-id="comp-1"]') as HTMLElement;

    fireEvent.click(slot);

    expect(mediaState.triggerLiveSlot).toHaveBeenCalledWith('comp-1', 0);
    expect(mediaState.openCompositionTab).not.toHaveBeenCalled();
    expect(mediaState.activateOnLayer).not.toHaveBeenCalled();
  });

  it('routes column header click through live triggering without opening the editor when the flag is on', () => {
    flags.useLiveSlotTrigger = true;

    render(<SlotGrid opacity={1} />);
    fireEvent.click(screen.getByTitle('Activate column 1'));

    expect(mediaState.triggerLiveColumn).toHaveBeenCalledWith(0);
    expect(mediaState.openCompositionTab).not.toHaveBeenCalled();
    expect(mediaState.activateColumn).not.toHaveBeenCalled();
  });

  it('starts slotted layer playback from the slot range start instead of the saved editor playhead', () => {
    mediaState.activeLayerSlots = { 0: 'comp-1' };
    mediaState.compositions[0].timelineData.playheadPosition = 17;

    render(<SlotGrid opacity={1} />);

    expect(mockedLayerPlaybackManager.activateLayer).toHaveBeenCalledWith(
      0,
      'comp-1',
      undefined,
      { slotIndex: 0 }
    );
  });

  it('re-clicking an active live slot restarts layer playback at the slot range start', () => {
    flags.useLiveSlotTrigger = true;
    mediaState.activeLayerSlots = { 0: 'comp-1' };

    const { container } = render(<SlotGrid opacity={1} />);
    mockedLayerPlaybackManager.activateLayer.mockClear();
    const slot = container.querySelector('[data-comp-id="comp-1"]') as HTMLElement;

    fireEvent.click(slot);

    expect(mediaState.triggerLiveSlot).toHaveBeenCalledWith('comp-1', 0);
    expect(mockedLayerPlaybackManager.activateLayer).toHaveBeenCalledWith(
      0,
      'comp-1',
      undefined,
      { slotIndex: 0 }
    );
  });

  it('keeps an explicit editor-open action available through the slot context menu', () => {
    flags.useLiveSlotTrigger = true;

    const { container } = render(<SlotGrid opacity={1} />);
    const slot = container.querySelector('[data-comp-id="comp-1"]') as HTMLElement;

    fireEvent.contextMenu(slot, { clientX: 16, clientY: 24 });
    fireEvent.click(screen.getByText('Open in Editor'));

    expect(mediaState.openCompositionTab).toHaveBeenCalledWith('comp-1', {
      skipAnimation: true,
      playFromStart: true,
      playFromTime: 0,
    });
  });

  it('arms MIDI learn for a filled slot from the context menu and opens the mapping panel', () => {
    const activatePanelType = vi
      .spyOn(useDockStore.getState(), 'activatePanelType')
      .mockImplementation(() => undefined);

    const { container } = render(<SlotGrid opacity={1} />);
    const slot = container.querySelector('[data-comp-id="comp-1"]') as HTMLElement;

    fireEvent.contextMenu(slot, { clientX: 16, clientY: 24 });
    fireEvent.click(screen.getByText('Map MIDI to Slot A1'));

    expect(activatePanelType).toHaveBeenCalledWith('midi-mapping');
    expect(useMIDIStore.getState().learnTarget).toMatchObject({
      kind: 'slot',
      slotIndex: 0,
      slotLabel: 'A1',
      compositionId: 'comp-1',
      compositionName: 'Comp 1',
    });

    activatePanelType.mockRestore();
  });

  it('renders slot deck readiness badges from transient slotDeckStates', () => {
    flags.useWarmSlotDecks = true;
    mediaState.slotDeckStates = {
      0: {
        slotIndex: 0,
        compositionId: 'comp-1',
        status: 'warm',
        preparedClipCount: 2,
        readyClipCount: 2,
        firstFrameReady: true,
        decoderMode: 'webcodecs',
        lastPreparedAt: 10,
        lastActivatedAt: 20,
        lastError: null,
        pinnedLayerIndex: 0,
      },
    };

    const { container } = render(<SlotGrid opacity={1} />);

    const badge = screen.getByLabelText('Slot 1 deck warm');
    expect(badge).toHaveAttribute('data-slot-deck-status', 'warm');
    expect(container.querySelector('.slot-grid-deck-badge-warm')).toBeTruthy();
  });
});
