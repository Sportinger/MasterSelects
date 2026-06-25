import { fireEvent, render, cleanup } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/timeline/transitionCompositionService', () => ({
  ensureTransitionCompositionForPair: vi.fn(),
  openTransitionComposition: vi.fn(),
}));

import { TransitionOverlays } from '../../src/components/timeline/components/TransitionOverlays';
import { openTransitionComposition } from '../../src/services/timeline/transitionCompositionService';
import { useMediaStore, type Composition, type MediaFile } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type { TimelineClip, TimelineTrack } from '../../src/types';

const openTransitionCompositionMock = vi.mocked(openTransitionComposition);
const mockedUseMediaStore = useMediaStore as unknown as ReturnType<typeof vi.fn> & {
  getState: ReturnType<typeof vi.fn>;
};

type TransitionOverlayMediaState = {
  files: MediaFile[];
  compositions: Composition[];
  activeCompositionId: string | null;
  createComposition: ReturnType<typeof vi.fn>;
  updateComposition: ReturnType<typeof vi.fn>;
  openCompositionTab: ReturnType<typeof vi.fn>;
};

function createTrack(): TimelineTrack {
  return {
    id: 'video-1',
    name: 'Video 1',
    type: 'video',
    height: 64,
    visible: true,
    muted: false,
    solo: false,
    locked: false,
  } as TimelineTrack;
}

function createVideoClip(overrides: Partial<TimelineClip>): TimelineClip {
  return {
    id: 'clip',
    trackId: 'video-1',
    name: 'Clip',
    startTime: 0,
    duration: 4,
    inPoint: 0,
    outPoint: 4,
    source: { type: 'video', mediaFileId: 'media', naturalDuration: 6 },
    effects: [],
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    ...overrides,
  } as TimelineClip;
}

function createTransitionClips(): TimelineClip[] {
  const transition = {
    id: 'transition-a',
    type: 'crossfade',
    duration: 1,
  };

  return [
    createVideoClip({
      id: 'clip-a',
      startTime: 0,
      duration: 5,
      inPoint: 1,
      outPoint: 6,
      source: { type: 'video', mediaFileId: 'media-a', naturalDuration: 6 },
      transitionOut: { ...transition, linkedClipId: 'clip-b' },
    }),
    createVideoClip({
      id: 'clip-b',
      startTime: 5,
      duration: 4,
      inPoint: 0,
      outPoint: 4,
      source: { type: 'video', mediaFileId: 'media-b', naturalDuration: 4 },
      transitionIn: { ...transition, linkedClipId: 'clip-a' },
    }),
  ];
}

function createTransitionComposition(): Composition {
  return {
    id: 'transition-comp-1',
    name: 'Transition - Crossfade',
    type: 'composition',
    parentId: null,
    createdAt: 0,
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 2,
    backgroundColor: '#000000',
    transitionComp: {
      kind: 'transition-comp',
      parentCompositionId: 'comp-1',
      parentTransitionId: 'transition-a',
      parentOutgoingClipId: 'clip-a',
      parentIncomingClipId: 'clip-b',
      linkedOutgoingClipId: 'transition-outgoing',
      linkedIncomingClipId: 'transition-incoming',
      innerTransitionId: 'inner-transition-a',
      paddingBefore: 0,
      paddingAfter: 0,
      bodyStart: 4.5,
      bodyEnd: 5.5,
    },
  };
}

describe('TransitionOverlays', () => {
  let mediaState: TransitionOverlayMediaState;

  beforeEach(() => {
    mediaState = {
      files: [],
      compositions: [{
        id: 'comp-1',
        name: 'Comp 1',
        type: 'composition',
        parentId: null,
        createdAt: 0,
        width: 1920,
        height: 1080,
        frameRate: 30,
        duration: 60,
        backgroundColor: '#000000',
      }],
      activeCompositionId: 'comp-1',
      createComposition: vi.fn(),
      updateComposition: vi.fn(),
      openCompositionTab: vi.fn(),
    };
    mockedUseMediaStore.mockImplementation((selector: (state: TransitionOverlayMediaState) => unknown) => selector(mediaState));
    mockedUseMediaStore.getState.mockImplementation(() => mediaState);
    openTransitionCompositionMock.mockReset();

    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      configurable: true,
      value: vi.fn(() => false),
    });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: vi.fn(),
    });

    useTimelineStore.setState({
      clips: createTransitionClips(),
      tracks: [createTrack()],
      propertiesSelection: null,
      timelineToolPreview: null,
      selectedClipIds: new Set(),
      primarySelectedClipId: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('resizes a selected transition body through the duration edit operation', () => {
    const clips = useTimelineStore.getState().clips;
    const tracks = useTimelineStore.getState().tracks;
    const { container } = render(
      <TransitionOverlays
        activeJunction={null}
        clips={clips}
        tracks={tracks}
        timeToPixel={(time) => time * 100}
        isTrackExpanded={() => false}
        getExpandedTrackHeight={(_, baseHeight) => baseHeight}
        getTrackHeight={(track) => track.height}
      />,
    );

    const handles = container.querySelectorAll<HTMLElement>('.timeline-transition-resize-handle');
    const handle = container.querySelector<HTMLElement>('.timeline-transition-resize-handle.start');
    const body = container.querySelector<HTMLElement>('.timeline-transition');

    expect(handles).toHaveLength(2);
    expect(handle).toBeTruthy();
    expect(body?.title).toContain('1.00s');
    expect(body?.style.left).toBe('450px');

    fireEvent.pointerDown(handle!, { pointerId: 1, clientX: 450, button: 0, buttons: 1 });
    expect(useTimelineStore.getState().propertiesSelection).toEqual({
      kind: 'transition',
      clipId: 'clip-a',
      edge: 'out',
      transitionId: 'transition-a',
    });
    expect(useTimelineStore.getState().timelineToolPreview).toMatchObject({
      startTime: 4.5,
      endTime: 5.5,
      ghostRanges: expect.arrayContaining([
        expect.objectContaining({
          startTime: 5,
          endTime: 5.5,
          label: '+0.5s hold',
          variant: 'transition-hold-fallback',
        }),
        expect.objectContaining({
          startTime: 4.5,
          endTime: 5,
          label: '+0.5s hold',
          variant: 'transition-hold-fallback',
        }),
      ]),
    });

    act(() => {
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 400, buttons: 1 });
    });
    expect(body?.title).toContain('2.00s');
    expect(body?.style.left).toBe('400px');
    expect(useTimelineStore.getState().timelineToolPreview).toMatchObject({
      startTime: 4,
      endTime: 6,
      ghostRanges: expect.arrayContaining([
        expect.objectContaining({
          startTime: 5,
          endTime: 6,
          label: '+1.0s hold',
          variant: 'transition-hold-fallback',
        }),
        expect.objectContaining({
          startTime: 4,
          endTime: 5,
          label: '+1.0s hold',
          variant: 'transition-hold-fallback',
        }),
      ]),
    });

    act(() => {
      fireEvent.pointerUp(window, { pointerId: 1, clientX: 400 });
    });

    const nextClips = useTimelineStore.getState().clips;
    expect(nextClips.find(clip => clip.id === 'clip-a')?.transitionOut?.duration).toBeCloseTo(2);
    expect(nextClips.find(clip => clip.id === 'clip-b')?.transitionIn?.duration).toBeCloseTo(2);
    expect(useTimelineStore.getState().timelineToolPreview).toBeNull();
  });

  it('resizes a selected transition from the right edge', () => {
    const clips = useTimelineStore.getState().clips;
    const tracks = useTimelineStore.getState().tracks;
    const { container } = render(
      <TransitionOverlays
        activeJunction={null}
        clips={clips}
        tracks={tracks}
        timeToPixel={(time) => time * 100}
        isTrackExpanded={() => false}
        getExpandedTrackHeight={(_, baseHeight) => baseHeight}
        getTrackHeight={(track) => track.height}
      />,
    );

    const handle = container.querySelector<HTMLElement>('.timeline-transition-resize-handle.end');
    const body = container.querySelector<HTMLElement>('.timeline-transition');

    expect(handle).toBeTruthy();
    expect(body?.style.left).toBe('450px');

    fireEvent.pointerDown(handle!, { pointerId: 2, clientX: 550, button: 0, buttons: 1 });

    act(() => {
      fireEvent.pointerMove(window, { pointerId: 2, clientX: 600, buttons: 1 });
    });
    expect(body?.title).toContain('2.00s');
    expect(body?.style.left).toBe('400px');
    expect(useTimelineStore.getState().timelineToolPreview).toMatchObject({
      startTime: 4,
      endTime: 6,
      ghostRanges: expect.arrayContaining([
        expect.objectContaining({
          startTime: 5,
          endTime: 6,
          label: '+1.0s hold',
          variant: 'transition-hold-fallback',
        }),
        expect.objectContaining({
          startTime: 4,
          endTime: 5,
          label: '+1.0s hold',
          variant: 'transition-hold-fallback',
        }),
      ]),
    });

    act(() => {
      fireEvent.pointerUp(window, { pointerId: 2, clientX: 600 });
    });

    const nextClips = useTimelineStore.getState().clips;
    expect(nextClips.find(clip => clip.id === 'clip-a')?.transitionOut?.duration).toBeCloseTo(2);
    expect(nextClips.find(clip => clip.id === 'clip-b')?.transitionIn?.duration).toBeCloseTo(2);
    expect(useTimelineStore.getState().timelineToolPreview).toBeNull();
  });

  it('opens a transition composition once from a double-click and reopens the attached comp', () => {
    const staleClips = useTimelineStore.getState().clips;
    const tracks = useTimelineStore.getState().tracks;
    const transitionComposition = createTransitionComposition();
    const openCompositionTab = vi.fn();
    openTransitionCompositionMock.mockReturnValue(transitionComposition.id);
    mediaState = { ...mediaState, openCompositionTab };

    const { container } = render(
      <TransitionOverlays
        activeJunction={null}
        clips={staleClips}
        tracks={tracks}
        timeToPixel={(time) => time * 100}
        isTrackExpanded={() => false}
        getExpandedTrackHeight={(_, baseHeight) => baseHeight}
        getTrackHeight={(track) => track.height}
      />,
    );

    const transition = container.querySelector<HTMLElement>('.timeline-transition');
    const transitionVisual = transition?.firstElementChild as HTMLElement | null;
    expect(transition).toBeTruthy();
    expect(transitionVisual).toBeTruthy();

    fireEvent.pointerDown(transitionVisual!, { pointerId: 3, clientX: 500, button: 0, buttons: 1, detail: 2 });
    fireEvent.doubleClick(transition!);

    expect(openTransitionCompositionMock).toHaveBeenCalledTimes(1);

    openTransitionCompositionMock.mockClear();
    useTimelineStore.setState((state) => ({
      clips: state.clips.map((clip) => {
        if (clip.id === 'clip-a' && clip.transitionOut?.id === 'transition-a') {
          return { ...clip, transitionOut: { ...clip.transitionOut, compositionId: transitionComposition.id } };
        }
        if (clip.id === 'clip-b' && clip.transitionIn?.id === 'transition-a') {
          return { ...clip, transitionIn: { ...clip.transitionIn, compositionId: transitionComposition.id } };
        }
        return clip;
      }),
    }));
    mediaState = {
      ...mediaState,
      compositions: [...mediaState.compositions, transitionComposition],
      openCompositionTab,
    };

    fireEvent.doubleClick(transition!);

    expect(openTransitionCompositionMock).toHaveBeenCalledTimes(1);
    const reopenInput = openTransitionCompositionMock.mock.calls[0]?.[0];
    expect(reopenInput?.timelineClips.find((clip) => clip.id === 'clip-a')?.transitionOut?.compositionId)
      .toBe(transitionComposition.id);
    expect(reopenInput?.compositions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: transitionComposition.id }),
    ]));
  });
});
