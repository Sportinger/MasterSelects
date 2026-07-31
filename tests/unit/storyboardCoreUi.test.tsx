import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PropertiesPanel } from '../../src/components/panels/properties';
import { StoryboardPropertiesPanel } from '../../src/components/properties/storyboard';
import { TimelineEmptyContextMenu } from '../../src/components/timeline/TimelineEmptyContextMenu';
import { TimelineCanvasClipRenameInput } from '../../src/components/timeline/components/TimelineCanvasClipRenameInput';
import { createStoryboardTimelineClip } from '../../src/services/storyboard/core';
import {
  initHistoryStoreRefs,
  setHistoryCallbacks,
  useHistoryStore,
} from '../../src/stores/historyStore';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type { TimelineTrack } from '../../src/types/timeline';

const videoTrack: TimelineTrack = {
  id: 'video-storyboard-ui',
  name: 'Storyboard',
  type: 'video',
  height: 80,
  muted: false,
  visible: true,
  solo: false,
};

function createCard(id: string, startTime: number) {
  return createStoryboardTimelineClip({
    trackId: videoTrack.id,
    planId: 'plan-ui',
    sceneId: 'scene-ui',
    clipId: id,
    startTime,
    durationSeconds: 5,
    targetDurationSeconds: 7,
    title: 'Opening',
    description: 'Establish the location.',
  });
}

describe('storyboard visible editor hooks', () => {
  beforeEach(() => {
    const mediaState = {
      files: [],
      compositions: [],
      slotAssignments: {},
      selectedSlotCompositionId: null,
      selectSlotComposition: vi.fn(),
      ensureSlotClipSettings: vi.fn(),
    };
    vi.mocked(useMediaStore).mockImplementation(((
      selector: (state: typeof mediaState) => unknown,
    ) => selector(mediaState)) as typeof useMediaStore);
    vi.mocked(useMediaStore.getState).mockReturnValue(
      mediaState as unknown as ReturnType<typeof useMediaStore.getState>,
    );
    setHistoryCallbacks({
      flushPendingCapture: () => undefined,
      suppressCaptures: () => undefined,
    });
    initHistoryStoreRefs({
      timeline: {
        getState: useTimelineStore.getState,
        setState: useTimelineStore.setState,
      },
      media: {
        getState: () => ({
          files: [],
          compositions: [],
          folders: [],
          selectedIds: [],
          expandedFolderIds: [],
          textItems: [],
          solidItems: [],
          mathSceneItems: [],
          motionShapeItems: [],
          signalAssets: [],
          signalArtifacts: [],
          signalGraphs: [],
          signalOperators: [],
        }),
        setState: () => undefined,
      },
      dock: {
        getState: () => ({ layout: null }),
        setState: () => undefined,
      },
    });
    useHistoryStore.getState().clearHistory();
    useTimelineStore.setState({
      tracks: [videoTrack],
      clips: [createCard('card-a', 0), createCard('card-b', 8)],
      selectedClipIds: new Set(['card-a']),
      primarySelectedClipId: 'card-a',
      propertiesSelection: { kind: 'clip', clipId: 'card-a' },
      isExporting: false,
    });
  });

  afterEach(cleanup);

  it('shows the scene editor and synchronizes title edits across cards with the same scene ID', () => {
    render(<StoryboardPropertiesPanel clipId="card-a" />);
    expect(screen.getByRole('region', { name: 'Storyboard scene properties' })).toBeTruthy();
    expect(screen.getByLabelText('Actual duration')).toHaveTextContent('5.00 s');
    expect(screen.getByLabelText('Target duration')).toHaveValue(7);

    const title = screen.getByLabelText('Title');
    fireEvent.change(title, { target: { value: 'Opening revised' } });
    fireEvent.blur(title);

    expect(useTimelineStore.getState().clips.map(clip => clip.storyboardProperties?.title))
      .toEqual(['Opening revised', 'Opening revised']);
  });

  it('routes a selected card to the visible Scene properties tab', async () => {
    render(<PropertiesPanel />);
    expect(await screen.findByRole('button', { name: 'Scene' })).toHaveClass('active');
    expect(await screen.findByRole('region', { name: 'Storyboard scene properties' })).toBeTruthy();
  });

  it('shows Add Scene Card only for an empty video-track context and executes its coordinates', () => {
    const onAddStoryboardScene = vi.fn();
    render(
      <TimelineEmptyContextMenu
        menu={{ x: 20, y: 30, time: 12.5, trackId: videoTrack.id }}
        onClose={vi.fn()}
        onAddStoryboardScene={onAddStoryboardScene}
        onEraseGap={vi.fn()}
        onEraseLayerGaps={vi.fn()}
        onEraseAllGaps={vi.fn()}
        onFitCompToWindow={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Add Scene Card'));
    expect(onAddStoryboardScene).toHaveBeenCalledWith(12.5, videoTrack.id);
  });

  it('commits inline card rename through stable scene identity', () => {
    const clip = useTimelineStore.getState().clips[0];
    render(
      <TimelineCanvasClipRenameInput
        clip={clip}
        geometry={{
          clip: { x: 0, y: 0, width: 240, height: 70 },
          visibleClip: { x: 0, y: 0, width: 240, height: 70 },
          track: { x: 0, y: 0, width: 600, height: 80 },
          viewport: { x: 0, y: 0, width: 600, height: 80 },
          trimHandles: {},
          fadeHandles: {},
          keyframeRows: [],
        }}
      />,
    );

    const rename = screen.getByDisplayValue('Opening');
    fireEvent.change(rename, { target: { value: 'Inline revised' } });
    fireEvent.keyDown(rename, { key: 'Enter' });

    expect(useTimelineStore.getState().clips.map(card => card.name))
      .toEqual(['Inline revised', 'Inline revised']);
  });
});
