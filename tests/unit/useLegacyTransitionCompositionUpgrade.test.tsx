import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/timeline/transitionCompositionService', () => ({
  openTransitionComposition: vi.fn(),
  upgradeLegacyTransitionCompositionForPair: vi.fn(),
}));

vi.mock('../../src/stores/historyStore', () => ({
  startBatch: vi.fn(),
  endBatch: vi.fn(),
}));

vi.mock('../../src/components/timeline/TimelineControls', () => ({
  TimelineControls: () => <div />,
}));

import { endBatch, startBatch } from '../../src/stores/historyStore';
import { TimelineToolbarChrome } from '../../src/components/timeline/components/TimelineToolbarChrome';
import { upgradeLegacyTransitionCompositionForPair } from '../../src/services/timeline/transitionCompositionService';
import { useMediaStore, type Composition } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type { TimelineClip } from '../../src/types/timeline';

const upgradeMock = vi.mocked(upgradeLegacyTransitionCompositionForPair);
const startBatchMock = vi.mocked(startBatch);
const endBatchMock = vi.mocked(endBatch);
const mockedUseMediaStore = useMediaStore as unknown as ReturnType<typeof vi.fn> & {
  getState: ReturnType<typeof vi.fn>;
  setState: ReturnType<typeof vi.fn>;
};

type MediaState = {
  compositions: Composition[];
  activeCompositionId: string | null;
  openCompositionTab: ReturnType<typeof vi.fn>;
  createComposition: ReturnType<typeof vi.fn>;
  updateComposition: ReturnType<typeof vi.fn>;
};

function parentClips(compositionId = 'legacy'): TimelineClip[] {
  const transition = { id: 'transition-1', type: 'crossfade', duration: 1, linkedClipId: 'in', compositionId };
  return [
    {
      id: 'out', trackId: 'track-1', name: 'Out', startTime: 0, duration: 5, inPoint: 0, outPoint: 5,
      source: { type: 'video', mediaFileId: 'out-file', naturalDuration: 5 }, effects: [],
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }, transitionOut: transition,
    },
    {
      id: 'in', trackId: 'track-1', name: 'In', startTime: 5, duration: 5, inPoint: 0, outPoint: 5,
      source: { type: 'video', mediaFileId: 'in-file', naturalDuration: 5 }, effects: [],
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      transitionIn: { ...transition, linkedClipId: 'out' },
    },
  ] as TimelineClip[];
}

function parentComposition(clips = parentClips()): Composition {
  return {
    id: 'parent', name: 'Parent', type: 'composition', parentId: null, createdAt: 1,
    width: 1920, height: 1080, frameRate: 30, duration: 10, backgroundColor: '#000000',
    timelineData: { tracks: [], clips, duration: 10 },
  } as Composition;
}

function transitionComposition(sourceLayout?: 'mapped-v3' | 'legacy-segmented'): Composition {
  return {
    id: 'legacy', name: 'Transition', type: 'composition', parentId: null, createdAt: 2,
    width: 1920, height: 1080, frameRate: 30, duration: 1, backgroundColor: '#000000',
    transitionComp: {
      kind: 'transition-comp', ...(sourceLayout ? { sourceLayout } : {}),
      parentCompositionId: 'parent', parentTransitionId: 'transition-1',
      parentOutgoingClipId: 'out', parentIncomingClipId: 'in',
      linkedOutgoingClipId: 'transition-out', linkedIncomingClipId: 'transition-in', innerTransitionId: 'inner',
      paddingBefore: 0, paddingAfter: 0, bodyStart: 0, bodyEnd: 1,
    },
  };
}

function renderToolbar() {
  return render(
    <TimelineToolbarChrome
      duration={10}
      formatTime={(seconds) => String(seconds)}
      hasInOutDisplayRange={false}
      inOutDisplayDuration={0}
      isEditingTimelineDuration={false}
      onTimelineDurationClick={() => undefined}
      onTimelineDurationInputChange={() => undefined}
      onTimelineDurationKeyDown={() => undefined}
      onTimelineDurationSubmit={() => undefined}
      onTimelineTimeDoubleClick={() => undefined}
      slotGridProgress={0}
      timelineControlsProps={{} as never}
      timelineCurrentFrame={0}
      timelineDurationInputRef={{ current: null }}
      timelineDurationInputValue="10"
      timelineFpsValue="30"
      timelineRulerCurrentTime={0}
      timelineTimeDisplayMode="time"
      timelineTotalFrames={300}
    />,
  );
}

describe('useLegacyTransitionCompositionUpgrade', () => {
  let mediaState: MediaState;

  beforeEach(() => {
    const parent = parentComposition();
    const legacy = transitionComposition('legacy-segmented');
    mediaState = {
      compositions: [parent, legacy],
      activeCompositionId: legacy.id,
      createComposition: vi.fn(),
      updateComposition: vi.fn(),
      openCompositionTab: vi.fn((id: string) => {
        mediaState.activeCompositionId = id;
        if (id === parent.id) useTimelineStore.setState({ clips: parentClips() });
      }),
    };
    mockedUseMediaStore.mockImplementation((selector: (state: MediaState) => unknown) => selector(mediaState));
    mockedUseMediaStore.getState.mockImplementation(() => mediaState);
    mockedUseMediaStore.setState.mockImplementation((partial) => {
      const patch = typeof partial === 'function' ? partial(mediaState) : partial;
      Object.assign(mediaState, patch);
    });
    useTimelineStore.setState({ clips: [] });
    upgradeMock.mockReset();
    startBatchMock.mockReset();
    endBatchMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows Upgrade sources only for an active legacy transition composition', () => {
    const { rerender } = renderToolbar();
    expect(screen.getByRole('button', { name: 'Upgrade sources' })).toBeTruthy();

    mediaState.activeCompositionId = 'parent';
    rerender(<div />);
    renderToolbar();
    expect(screen.queryByRole('button', { name: 'Upgrade sources' })).toBeNull();

    mediaState.activeCompositionId = 'legacy';
    mediaState.compositions = [parentComposition(), transitionComposition('mapped-v3')];
    renderToolbar();
    expect(screen.queryByRole('button', { name: 'Upgrade sources' })).toBeNull();
  });

  it('upgrades through the parent once and retains the legacy backup', async () => {
    const parent = parentComposition();
    const legacy = transitionComposition('legacy-segmented');
    const mapped = {
      ...legacy,
      id: 'mapped',
      timelineData: {
        tracks: [],
        duration: 1,
        clips: [
          { id: 'transition-out', startTime: 0, duration: 1, transitionSourceMap: { version: 2 } },
          { id: 'transition-in', startTime: 0, duration: 1, transitionSourceMap: { version: 2 } },
        ],
      },
      transitionComp: { ...legacy.transitionComp!, sourceLayout: 'mapped-v3' as const, legacyBackupCompositionId: legacy.id },
    } as Composition;
    upgradeMock.mockImplementation((input) => {
      const updatedParent = {
        ...parent,
        timelineData: { ...parent.timelineData!, clips: parentClips(mapped.id) },
      };
      input.replaceCompositions([updatedParent, legacy, mapped]);
      return mapped.id;
    });
    renderToolbar();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Upgrade sources' }));
    await waitFor(() => expect(upgradeMock).toHaveBeenCalledOnce());

    expect(upgradeMock).toHaveBeenCalledOnce();
    expect(startBatchMock).toHaveBeenCalledOnce();
    expect(endBatchMock).toHaveBeenCalledOnce();
    expect(mediaState.openCompositionTab).toHaveBeenNthCalledWith(1, 'parent', { skipAnimation: true });
    expect(mediaState.openCompositionTab).toHaveBeenNthCalledWith(2, 'mapped', { skipAnimation: true, playFromTime: 0 });
    expect(mediaState.compositions).toEqual(expect.arrayContaining([legacy, mapped]));
    expect(mapped.transitionComp?.legacyBackupCompositionId).toBe(legacy.id);
    const mappedSources = mapped.timelineData!.clips.filter((clip) =>
      clip.id === 'transition-out' || clip.id === 'transition-in',
    );
    expect(mappedSources).toHaveLength(2);
    expect(mappedSources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'transition-out', startTime: 0, duration: 1 }),
      expect.objectContaining({ id: 'transition-in', startTime: 0, duration: 1 }),
    ]));
  });

  it('returns to the legacy composition when the explicit upgrade fails', async () => {
    upgradeMock.mockReturnValue(null);
    renderToolbar();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Upgrade sources' }));
    await waitFor(() => expect(mediaState.activeCompositionId).toBe('legacy'));

    expect(startBatchMock).not.toHaveBeenCalled();
    expect(mediaState.openCompositionTab).toHaveBeenNthCalledWith(1, 'parent', { skipAnimation: true });
    expect(mediaState.openCompositionTab).toHaveBeenNthCalledWith(2, 'legacy', {
      skipAnimation: true,
      playFromTime: 0,
    });
    expect(mediaState.activeCompositionId).toBe('legacy');
  });
});
