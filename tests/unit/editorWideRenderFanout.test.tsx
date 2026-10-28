import { Profiler, type ReactNode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DockTabPane } from '../../src/components/dock/DockTabPane';
import { MulticamDialog } from '../../src/components/timeline/MulticamDialog';
import { useClipPanelSync } from '../../src/hooks/useClipPanelSync';
import { useLiveInputFeedbackCoordinator } from '../../src/hooks/useLiveInputFeedbackCoordinator';
import { liveInputRuntime } from '../../src/services/mediaRuntime/liveInputRuntime';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type { DockTabGroup } from '../../src/types/dock';
import type { TimelineClip } from '../../src/types/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

// An inspector drag replaces the clips array on every sample. Editor-wide components that only need
// a name, an existence check or nothing at all (a closed dialog) must not re-render for it.

vi.mock('../../src/components/dock/tabPane/PanelContentHost', () => ({
  PanelContentHost: () => <div data-testid="panel-content" />,
}));

const TAB_GROUP: DockTabGroup = {
  kind: 'tab-group',
  id: 'editor-wide-fanout-group',
  panels: [
    { id: 'properties-panel', type: 'clip-properties', title: 'Properties' },
    { id: 'media-panel', type: 'media', title: 'Media' },
  ],
  activeIndex: 0,
};

const initialTimelineState = useTimelineStore.getState();
const track = createMockTrack({ id: 'video-1' });

function videoClip(id: string, overrides: Partial<TimelineClip> = {}): TimelineClip {
  return createMockClip({ id, trackId: track.id, mediaFileId: `media-${id}`, ...overrides });
}

function editClip(clipId: string, edit: (clip: TimelineClip) => TimelineClip) {
  act(() => useTimelineStore.setState(state => ({
    clips: state.clips.map(clip => (clip.id === clipId ? edit(clip) : clip)),
  })));
}

function dragOpacity(clipId: string, samples: number) {
  for (let sample = 1; sample <= samples; sample += 1) {
    editClip(clipId, clip => ({ ...clip, transform: { ...clip.transform, opacity: 1 - sample / 100 } }));
  }
}

function Counted({ id, onCommit, children }: { id: string; onCommit: (id: string) => void; children: ReactNode }) {
  return <Profiler id={id} onRender={() => onCommit(id)}>{children}</Profiler>;
}

function commitCounter() {
  const counts: Record<string, number> = {};
  const onCommit = (id: string) => { counts[id] = (counts[id] ?? 0) + 1; };
  const reset = () => { for (const key of Object.keys(counts)) counts[key] = 0; };
  return { counts, onCommit, reset };
}

function AppHooks() {
  useClipPanelSync();
  useLiveInputFeedbackCoordinator();
  return null;
}

beforeEach(() => {
  const mediaState = {
    activeCompositionId: null,
    compositions: [],
    files: [],
    selectedSlotCompositionId: null,
    getOpenCompositions: () => [],
    setActiveComposition: vi.fn(),
    closeCompositionTab: vi.fn(),
    reorderCompositionTabs: vi.fn(),
  };
  vi.mocked(useMediaStore).mockImplementation(((selector: (state: typeof mediaState) => unknown) => (
    selector(mediaState)
  )) as typeof useMediaStore);
  useTimelineStore.setState({
    ...initialTimelineState,
    tracks: [track],
    clips: [videoClip('clip-a', { name: 'Interview A' }), videoClip('clip-b', { name: 'Interview B', startTime: 10 })],
    clipKeyframes: new Map(),
    selectedClipIds: new Set(['clip-a']),
    primarySelectedClipId: 'clip-a',
    propertiesSelection: { kind: 'clip', clipId: 'clip-a' },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  act(() => useTimelineStore.setState(initialTimelineState));
});

describe('editor-wide render fan-out of an inspector drag', () => {
  it('does not re-render the App hooks, the dock panes or a closed Multicam dialog per drag sample', () => {
    const { counts, onCommit, reset } = commitCounter();
    render(
      <>
        <Counted id="app" onCommit={onCommit}><AppHooks /></Counted>
        <Counted id="pane" onCommit={onCommit}><DockTabPane group={TAB_GROUP} /></Counted>
        <Counted id="multicam" onCommit={onCommit}>
          <MulticamDialog open={false} onClose={vi.fn()} selectedClipIds={new Set(['clip-a'])} />
        </Counted>
      </>,
    );
    reset();

    dragOpacity('clip-a', 20);
    dragOpacity('clip-b', 10);
    act(() => useTimelineStore.setState({ playheadPosition: 3 }));

    expect(counts).toEqual({ app: 0, pane: 0, multicam: 0 });
  });

  it('still follows the name of the inspected clip that the pane passes to its tab strip', () => {
    const { counts, onCommit, reset } = commitCounter();
    render(<Counted id="pane" onCommit={onCommit}><DockTabPane group={TAB_GROUP} /></Counted>);
    reset();

    editClip('clip-a', clip => ({ ...clip, name: 'Close-up' }));
    expect(counts.pane).toBe(1);

    editClip('clip-b', clip => ({ ...clip, name: 'Wide' }));
    expect(counts.pane).toBe(1);

    act(() => useTimelineStore.setState({ propertiesSelection: { kind: 'clip', clipId: 'clip-b' } }));
    expect(counts.pane).toBe(2);
  });

  it('re-checks the live inputs the clips use when one is added, not on every clip edit', () => {
    const setReconnectRequiredIds = vi.spyOn(liveInputRuntime, 'setReconnectRequiredIds');
    render(<AppHooks />);
    setReconnectRequiredIds.mockClear();

    dragOpacity('clip-a', 10);
    expect(setReconnectRequiredIds).not.toHaveBeenCalled();

    editClip('clip-b', clip => ({ ...clip, source: { ...clip.source, liveInputId: 'live-1' } as TimelineClip['source'] }));
    expect(setReconnectRequiredIds).toHaveBeenCalledTimes(1);
  });
});
