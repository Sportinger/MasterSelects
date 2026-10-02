import { cleanup, fireEvent, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimelineTrackSectionSurfaceController } from '../../src/components/timeline/hooks/useTimelineTrackSectionSurfaceController';
import type { TimelineTrackSectionFrame } from '../../src/components/timeline/components/TimelineTrackSectionFrame';
import type { TimelineTrackSectionHeaderStack } from '../../src/components/timeline/components/TimelineTrackSectionHeaderStack';
import type { TimelineTrackSectionLaneStack } from '../../src/components/timeline/components/TimelineTrackSectionLaneStack';

const renders = vi.hoisted(() => ({ frame: vi.fn(), headers: vi.fn(), lanes: vi.fn() }));

// Keep the real host hooks, grouped props, section memo, and section layout.
// The expensive GPU/canvas leaves are represented by their observable inputs.
vi.mock('../../src/components/timeline/components/TimelineTrackSectionFrame', () => ({
  TimelineTrackSectionFrame: (props: ComponentProps<typeof TimelineTrackSectionFrame>) => {
    renders.frame();
    return <section data-testid={props.sectionKind} onWheel={props.onSectionWheel}
      data-scroll={props.scrollX} data-height={props.sectionHeight}>
      {props.headerContent}{props.lanesContent}
    </section>;
  },
}));
vi.mock('../../src/components/timeline/components/TimelineTrackSectionHeaderStack', () => ({
  TimelineTrackSectionHeaderStack: (props: ComponentProps<typeof TimelineTrackSectionHeaderStack>) => {
    renders.headers();
    return <span data-testid={`${props.sectionKind}-selection`}>{[...props.selectedClipIds].join(',')}</span>;
  },
}));
vi.mock('../../src/components/timeline/components/TimelineTrackSectionLaneStack', () => ({
  TimelineTrackSectionLaneStack: (props: ComponentProps<typeof TimelineTrackSectionLaneStack>) => {
    renders.lanes();
    return <>
      <span data-testid={`${props.sectionKind}-clips`}>{props.clips.map(clip => clip.name).join(',')}</span>
      <button onClick={() => props.onBakeRegion('region')}>Bake {props.sectionKind}</button>
    </>;
  },
}));

type Options = Parameters<typeof useTimelineTrackSectionSurfaceController>[0];

function options(): Options {
  // Other editing inputs are intentionally absent and remain unchanged.
  return {
    clips: [], clipKeyframes: new Map(), clipMap: new Map(), mediaFiles: [],
    selectedClipIds: new Set(), selectedKeyframeIds: new Set(),
    clipAnimationPhase: 'idle', clipDrag: null, marquee: null,
    gridPlan: { frameGridOpacity: 0, frameIntervalPixels: 1, mode: 'time', timeGridOpacity: 1 },
    audioScrollY: 0, videoScrollY: 0, scrollX: 0,
    audioSectionHeight: 150, videoSectionHeight: 200,
    audioSectionViewportRef: { current: null }, videoSectionViewportRef: { current: null },
    displayedAudioTracks: [], displayedVideoTracks: [],
    timelineViewAudioTracks: [], timelineViewVideoTracks: [],
    timelineViewTrackMap: new Map(), trackMap: new Map(),
    expandedVideoSectionContentHeight: 200, forceVideoBottomScroll: false,
    splitDragPinVideoBottom: false, isSectionCollapsed: () => false,
    getSectionTrackHeight: () => 50, getFocusContextTrackHeight: () => 50,
    onSectionWheel: vi.fn(), bakeCompositionVideoBakeRegion: vi.fn(),
  } as unknown as Options;
}

function Host({ time, input }: { time: number; input: Options }) {
  const sections = useTimelineTrackSectionSurfaceController(input);
  return <><output>{time}</output>{sections.renderVideoSection()}{sections.renderAudioSection()}</>;
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('timeline section isolation from the playback clock', () => {
  it('does not redraw static sections when the host clock advances', () => {
    const input = options();
    const view = render(<Host time={0} input={input} />);
    for (let frame = 1; frame <= 10; frame++) {
      view.rerender(<Host time={frame / 25} input={{ ...input }} />);
    }
    expect(view.getByRole('status').textContent).toBe('0.4');
    expect(renders.frame).toHaveBeenCalledTimes(2);
    expect(renders.headers).toHaveBeenCalledTimes(2);
    expect(renders.lanes).toHaveBeenCalledTimes(2);
  });

  it('still updates clips, selection, scrolling, and section layout', () => {
    const input = options();
    const view = render(<Host time={0} input={input} />);
    const edited = {
      ...input,
      clips: [{ id: 'clip', name: 'Trimmed take' }] as Options['clips'],
      selectedClipIds: new Set(['clip']),
      scrollX: 120,
      audioSectionHeight: 240,
    };
    view.rerender(<Host time={1} input={edited} />);
    expect(view.getByTestId('video-clips').textContent).toBe('Trimmed take');
    expect(view.getByTestId('audio-selection').textContent).toBe('clip');
    expect(view.getByTestId('video').getAttribute('data-scroll')).toBe('120');
    expect(view.getByTestId('audio').getAttribute('data-height')).toBe('240');
    expect(renders.frame).toHaveBeenCalledTimes(4);
  });

  it('uses replaced wheel and bake callbacks instead of retaining stale closures', () => {
    const input = options();
    const view = render(<Host time={0} input={input} />);
    const wheel = vi.fn();
    const bake = vi.fn();
    view.rerender(<Host time={1} input={{ ...input, onSectionWheel: wheel, bakeCompositionVideoBakeRegion: bake }} />);
    fireEvent.wheel(view.getByTestId('audio'), { deltaY: 10 });
    fireEvent.wheel(view.getByTestId('video'), { deltaY: 20 });
    fireEvent.click(view.getByRole('button', { name: 'Bake video' }));
    expect(wheel.mock.calls.map(call => call[1])).toEqual(['audio', 'video']);
    expect(bake).toHaveBeenCalledWith('region');
    expect(input.onSectionWheel).not.toHaveBeenCalled();
    expect(input.bakeCompositionVideoBakeRegion).not.toHaveBeenCalled();
  });
});
