import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/timeline/transitionCompositionService', () => ({
  openTransitionComposition: vi.fn(),
  upgradeLegacyTransitionCompositionForPair: vi.fn(),
}));

vi.mock('../../src/stores/historyStore', () => ({
  startBatch: vi.fn(),
  endBatch: vi.fn(),
}));

import { endBatch, startBatch } from '../../src/stores/historyStore';
import { useTransitionCompositionOpen } from '../../src/components/timeline/hooks/useTransitionCompositionOpen';
import {
  openTransitionComposition,
  upgradeLegacyTransitionCompositionForPair,
} from '../../src/services/timeline/transitionCompositionService';
import { useMediaStore, type Composition } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type { TimelineClip } from '../../src/types/timeline';

const openTransitionCompositionMock = vi.mocked(openTransitionComposition);
const upgradeLegacyTransitionCompositionMock = vi.mocked(upgradeLegacyTransitionCompositionForPair);
const startBatchMock = vi.mocked(startBatch);
const endBatchMock = vi.mocked(endBatch);
const mockedUseMediaStore = useMediaStore as unknown as ReturnType<typeof vi.fn> & {
  getState: ReturnType<typeof vi.fn>;
  setState: ReturnType<typeof vi.fn>;
};

type MediaState = {
  compositions: Composition[];
  activeCompositionId: string | null;
  createComposition: ReturnType<typeof vi.fn>;
  updateComposition: ReturnType<typeof vi.fn>;
  openCompositionTab: ReturnType<typeof vi.fn>;
};

function createClips(compositionId?: string): TimelineClip[] {
  const transition = {
    id: 'transition-1',
    type: 'crossfade',
    duration: 1,
    linkedClipId: 'in',
    ...(compositionId ? { compositionId } : {}),
  };
  return [
    {
      id: 'out', trackId: 'track-1', name: 'Out', startTime: 0, duration: 5, inPoint: 0, outPoint: 5,
      source: { type: 'video', mediaFileId: 'out-file', naturalDuration: 5 }, effects: [],
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      transitionOut: transition,
    },
    {
      id: 'in', trackId: 'track-1', name: 'In', startTime: 5, duration: 5, inPoint: 0, outPoint: 5,
      source: { type: 'video', mediaFileId: 'in-file', naturalDuration: 5 }, effects: [],
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      transitionIn: { ...transition, linkedClipId: 'out' },
    },
  ] as TimelineClip[];
}

function createParent(): Composition {
  return {
    id: 'parent', name: 'Parent', type: 'composition', parentId: null, createdAt: 1,
    width: 1920, height: 1080, frameRate: 30, duration: 10, backgroundColor: '#000000',
    timelineData: { tracks: [], clips: [], duration: 10 },
  };
}

function createTransitionComposition(sourceLayout?: 'mapped-v3' | 'legacy-segmented'): Composition {
  return {
    id: 'transition-comp', name: 'Transition', type: 'composition', parentId: null, createdAt: 2,
    width: 1920, height: 1080, frameRate: 30, duration: 1, backgroundColor: '#000000',
    transitionComp: {
      kind: 'transition-comp',
      ...(sourceLayout ? { sourceLayout } : {}),
      parentCompositionId: 'parent',
      parentTransitionId: 'transition-1',
      parentOutgoingClipId: 'out',
      parentIncomingClipId: 'in',
      linkedOutgoingClipId: 'transition-out',
      linkedIncomingClipId: 'transition-in',
      innerTransitionId: 'inner-transition',
      paddingBefore: 0,
      paddingAfter: 0,
      bodyStart: 0.25,
      bodyEnd: 1.25,
    },
  };
}

describe('useTransitionCompositionOpen', () => {
  let mediaState: MediaState;

  beforeEach(() => {
    const parent = createParent();
    const transitionComposition = createTransitionComposition('mapped-v3');
    mediaState = {
      compositions: [parent, transitionComposition],
      activeCompositionId: parent.id,
      createComposition: vi.fn(),
      updateComposition: vi.fn(),
      openCompositionTab: vi.fn(),
    };
    mockedUseMediaStore.mockImplementation((selector: (state: MediaState) => unknown) => selector(mediaState));
    vi.mocked(useMediaStore.getState).mockImplementation(() => mediaState as ReturnType<typeof useMediaStore.getState>);
    vi.mocked(useMediaStore.setState).mockImplementation((partial) => {
      const patch = typeof partial === 'function'
        ? partial(mediaState as ReturnType<typeof useMediaStore.getState>)
        : partial;
      Object.assign(mediaState, patch);
    });
    useTimelineStore.setState({ clips: createClips(transitionComposition.id) });
    openTransitionCompositionMock.mockReset();
    upgradeLegacyTransitionCompositionMock.mockReset();
    startBatchMock.mockReset();
    endBatchMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens an attached mapped-v3 composition directly', () => {
    const confirm = vi.spyOn(window, 'confirm');
    openTransitionCompositionMock.mockReturnValue('transition-comp');
    const { result } = renderHook(() => useTransitionCompositionOpen());

    act(() => result.current('out', 'transition-1'));

    expect(confirm).not.toHaveBeenCalled();
    expect(openTransitionCompositionMock).toHaveBeenCalledTimes(1);
    expect(upgradeLegacyTransitionCompositionMock).not.toHaveBeenCalled();
  });

  it('materializes and opens a mapped-v3 composition when the transition has no compositionId', () => {
    useTimelineStore.setState({ clips: createClips() });
    openTransitionCompositionMock.mockImplementation((input) => {
      input.openCompositionTab('mapped-v3', { skipAnimation: true, playFromTime: 0 });
      return 'mapped-v3';
    });
    const { result } = renderHook(() => useTransitionCompositionOpen());

    act(() => result.current('out', 'transition-1'));

    expect(openTransitionCompositionMock).toHaveBeenCalledOnce();
    expect(openTransitionCompositionMock.mock.calls[0]?.[0].timelineClips.find((clip) => clip.id === 'out')?.transitionOut)
      .not.toHaveProperty('compositionId');
    expect(mediaState.openCompositionTab).toHaveBeenCalledWith('mapped-v3', {
      skipAnimation: true,
      playFromTime: 0,
    });
  });

  it('upgrades a confirmed legacy composition in one history batch before opening it', () => {
    const parent = createParent();
    const legacy = createTransitionComposition('legacy-segmented');
    const upgraded = { ...legacy, id: 'mapped', transitionComp: { ...legacy.transitionComp!, sourceLayout: 'mapped-v3' as const } };
    mediaState.compositions = [parent, legacy];
    useTimelineStore.setState({ clips: createClips(legacy.id) });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    upgradeLegacyTransitionCompositionMock.mockImplementation((input) => {
      input.replaceCompositions([parent, legacy, upgraded]);
      return upgraded.id;
    });
    const { result } = renderHook(() => useTransitionCompositionOpen());

    act(() => result.current('out', 'transition-1'));

    expect(window.confirm).toHaveBeenCalledWith(
      'Upgrade this legacy transition to mapped sources?\n\nOK: upgrade and open the new composition.\nCancel: open the legacy composition unchanged.',
    );
    expect(startBatchMock).toHaveBeenCalledOnce();
    expect(startBatchMock).toHaveBeenCalledWith('Upgrade transition composition');
    expect(endBatchMock).toHaveBeenCalledOnce();
    expect(mediaState.compositions).toEqual([parent, legacy, upgraded]);
    expect(mediaState.openCompositionTab).toHaveBeenCalledWith('mapped', { skipAnimation: true, playFromTime: 0 });
    expect(endBatchMock.mock.invocationCallOrder[0]).toBeLessThan(
      mediaState.openCompositionTab.mock.invocationCallOrder[0],
    );
  });

  it('opens a missing-layout legacy composition unchanged when upgrade is cancelled', () => {
    const parent = createParent();
    const legacy = createTransitionComposition();
    mediaState.compositions = [parent, legacy];
    useTimelineStore.setState({ clips: createClips(legacy.id) });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { result } = renderHook(() => useTransitionCompositionOpen());

    act(() => result.current('out', 'transition-1'));

    expect(upgradeLegacyTransitionCompositionMock).not.toHaveBeenCalled();
    expect(startBatchMock).not.toHaveBeenCalled();
    expect(mediaState.openCompositionTab).toHaveBeenCalledWith(legacy.id, {
      skipAnimation: true,
      playFromTime: 0.25,
    });
  });

  it('opens the legacy composition unchanged when upgrade preflight fails', () => {
    const parent = createParent();
    const legacy = createTransitionComposition('legacy-segmented');
    mediaState.compositions = [parent, legacy];
    useTimelineStore.setState({ clips: createClips(legacy.id) });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    upgradeLegacyTransitionCompositionMock.mockReturnValue(null);
    const { result } = renderHook(() => useTransitionCompositionOpen());

    act(() => result.current('out', 'transition-1'));

    expect(startBatchMock).not.toHaveBeenCalled();
    expect(endBatchMock).not.toHaveBeenCalled();
    expect(mediaState.openCompositionTab).toHaveBeenCalledWith(legacy.id, {
      skipAnimation: true,
      playFromTime: 0.25,
    });
  });
});
