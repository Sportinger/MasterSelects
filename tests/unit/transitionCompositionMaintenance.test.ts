import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMediaStore, type Composition, type MediaFile } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import { DEFAULT_TRACKS } from '../../src/stores/timeline/constants';
import { ensureTransitionCompositionsForActiveTimeline } from '../../src/stores/timeline/editOperations/transitionCompositionMaintenance';
import { installFakeMediaStore } from '../helpers/fakeMediaStore';
import { createMockClip, createMockTrack } from '../helpers/mockData';

vi.mock('../../src/services/compositionRenderer', () => ({
  compositionRenderer: { invalidateCompositionAndParents: vi.fn() },
}));

function mediaFile(id: string): MediaFile {
  return {
    id,
    name: `${id}.mp4`,
    type: 'video',
    file: new File([], `${id}.mp4`),
    url: `blob:${id}`,
    duration: 4,
    size: 0,
    importedAt: 1,
    thumbnail: '',
  };
}

function activeParentComposition(id: string): Composition {
  const timelineData = useTimelineStore.getState().getSerializableState();
  return {
    id,
    name: 'Parent',
    type: 'composition',
    parentId: null,
    createdAt: 1,
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: timelineData.duration,
    backgroundColor: '#000000',
    timelineData,
  };
}

function installBrokenTransitionTimeline(): void {
  const track = createMockTrack({ id: 'video-1', type: 'video' });
  const outgoing = createMockClip({
    id: 'out',
    trackId: track.id,
    startTime: 0,
    duration: 2,
    inPoint: 0,
    outPoint: 2,
    mediaFileId: 'out-media',
    source: { type: 'video', mediaFileId: 'out-media', naturalDuration: 4 },
    transitionOut: {
      id: 'transition-1',
      type: 'crossfade',
      duration: 1,
      linkedClipId: 'in',
      compositionId: 'missing-transition-comp',
    },
  });
  const incoming = createMockClip({
    id: 'in',
    trackId: track.id,
    startTime: 2,
    duration: 2,
    inPoint: 0,
    outPoint: 2,
    mediaFileId: 'in-media',
    source: { type: 'video', mediaFileId: 'in-media', naturalDuration: 4 },
    transitionIn: {
      id: 'transition-1',
      type: 'crossfade',
      duration: 1,
      linkedClipId: 'out',
      compositionId: 'missing-transition-comp',
    },
  });

  useTimelineStore.setState({
    tracks: [track],
    clips: [outgoing, incoming],
    duration: 4,
  });
}

describe('transition composition maintenance', () => {
  beforeEach(() => {
    useTimelineStore.setState({
      tracks: DEFAULT_TRACKS,
      clips: [],
      clipKeyframes: new Map(),
      markers: [],
      duration: 60,
      playheadPosition: 0,
      selectedClipIds: new Set(),
      primarySelectedClipId: null,
      propertiesSelection: null,
      isPlaying: false,
    });
    installFakeMediaStore();
  });

  it('recreates a missing hidden transition comp for the active timeline before render', () => {
    installBrokenTransitionTimeline();
    const parent = activeParentComposition('parent-comp');
    installFakeMediaStore({
      files: [mediaFile('out-media'), mediaFile('in-media')],
      compositions: [parent],
      activeCompositionId: parent.id,
      openCompositionIds: [parent.id],
    });

    expect(ensureTransitionCompositionsForActiveTimeline(
      useTimelineStore.setState,
      useTimelineStore.getState,
    )).toBe(true);

    const mediaState = useMediaStore.getState();
    const transitionComp = mediaState.compositions.find((composition) =>
      composition.transitionComp?.kind === 'transition-comp'
    );
    expect(transitionComp).toBeDefined();
    expect(transitionComp?.id).not.toBe('missing-transition-comp');

    const [nextOut, nextIn] = useTimelineStore.getState().clips;
    expect(nextOut.transitionOut?.compositionId).toBe(transitionComp?.id);
    expect(nextIn.transitionIn?.compositionId).toBe(transitionComp?.id);

    const storedParent = mediaState.compositions.find((composition) => composition.id === parent.id);
    expect(storedParent?.timelineData?.clips.find((clip) => clip.id === 'out')?.transitionOut?.compositionId)
      .toBe(transitionComp?.id);
    expect(storedParent?.timelineData?.clips.find((clip) => clip.id === 'in')?.transitionIn?.compositionId)
      .toBe(transitionComp?.id);
  });

  it('repairs missing transition comps for the root timeline when no composition tab is active', () => {
    installBrokenTransitionTimeline();
    installFakeMediaStore({
      files: [mediaFile('out-media'), mediaFile('in-media')],
      compositions: [],
      activeCompositionId: null,
      openCompositionIds: [],
    });

    expect(ensureTransitionCompositionsForActiveTimeline(
      useTimelineStore.setState,
      useTimelineStore.getState,
    )).toBe(true);

    const transitionComp = useMediaStore.getState().compositions.find((composition) =>
      composition.transitionComp?.kind === 'transition-comp'
    );
    expect(transitionComp?.transitionComp?.parentCompositionId).toBe('default');
    expect(useTimelineStore.getState().clips[0]?.transitionOut?.compositionId).toBe(transitionComp?.id);
    expect(useTimelineStore.getState().clips[1]?.transitionIn?.compositionId).toBe(transitionComp?.id);
  });
});
