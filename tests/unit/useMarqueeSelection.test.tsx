import { fireEvent, render, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTimelineStore } from '../../src/stores/timeline';
import type { AnimatableProperty, TimelineClip, TimelineTrack } from '../../src/types';
import { useMarqueeSelection } from '../../src/components/timeline/hooks/useMarqueeSelection';

const rect = (left: number, top: number, width: number, height: number): DOMRect => ({
  x: left,
  y: top,
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
  toJSON: () => ({}),
} as DOMRect);

const clip: TimelineClip = {
  id: 'clip-video',
  trackId: 'track-video',
  name: 'Clip',
  file: new File([], 'clip.mp4'),
  startTime: 2,
  duration: 4,
  inPoint: 0,
  outPoint: 4,
  source: { type: 'video', mediaFileId: 'media-video', naturalDuration: 4 },
  effects: [],
  transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
} as TimelineClip;

const track: TimelineTrack = {
  id: 'track-video',
  name: 'Video 1',
  type: 'video',
  height: 64,
  visible: true,
  muted: false,
  solo: false,
  locked: false,
} as TimelineTrack;

function MarqueeHarness({
  selectKeyframe,
  deselectAllKeyframes,
  selectClip = vi.fn(),
  selectClips = vi.fn(),
  geometryX,
  timeToPixel = (time) => time * 10,
}: {
  selectKeyframe: (keyframeId: string, addToSelection?: boolean) => void;
  deselectAllKeyframes: () => void;
  selectClip?: (clipId: string | null, addToSelection?: boolean) => void;
  selectClips?: (clipIds: string[]) => void;
  geometryX?: number;
  timeToPixel?: (time: number) => number;
}) {
  const trackLanesRef = useRef<HTMLDivElement>(null);
  const clipKeyframes = new Map([
    [
      'clip-video',
      [
        {
          id: 'keyframe-opacity',
          clipId: 'clip-video',
          time: 1,
          property: 'opacity' as AnimatableProperty,
          value: 0.5,
          easing: 'linear',
        },
        {
          id: 'keyframe-opacity-2',
          clipId: 'clip-video',
          time: 2,
          property: 'opacity' as AnimatableProperty,
          value: 0.75,
          easing: 'linear',
        },
      ],
    ],
  ]);

  const { marquee, handleMarqueeMouseDown } = useMarqueeSelection({
    trackLanesRef,
    scrollX: 0,
    clips: [clip],
    tracks: [track],
    selectedClipIds: new Set(['clip-video']),
    selectedKeyframeIds: new Set(),
    clipKeyframes,
    activeTimelineToolId: 'select',
    clipDrag: null,
    clipTrim: null,
    markerDrag: null,
    isDraggingPlayhead: false,
    selectClip,
    selectClips,
    selectKeyframe,
    deselectAllKeyframes,
    setTimelineRangeSelection: vi.fn(),
    clearTimelineRangeSelection: vi.fn(),
    timeToPixel,
    pixelToTime: (pixel) => pixel / 10,
    isTrackExpanded: () => true,
    getTrackBaseHeight: () => 64,
    getExpandedTrackHeight: () => 82,
  });

  return (
    <div
      ref={trackLanesRef}
      data-testid="timeline-lanes"
      onMouseDown={handleMarqueeMouseDown}
    >
      <div className="track-lane" data-track-id="track-video">
        <div className="track-clip-row" />
        <div className="track-property-tracks">
          <div
            className="keyframe-track-row flat"
            data-track-id="track-video"
            data-keyframe-property="opacity"
            data-geometry-x={geometryX}
          >
            <div className="keyframe-track">
              <div className="keyframe-track-line" />
            </div>
          </div>
        </div>
      </div>
      <div data-testid="marquee-state">{marquee?.mode ?? 'none'}</div>
    </div>
  );
}

describe('useMarqueeSelection', () => {
  beforeEach(() => {
    useTimelineStore.setState({
      selectedClipIds: new Set(['clip-video']),
      selectedKeyframeIds: new Set(),
      timelineRangeSelection: null,
    });
  });

  it('marquee-selects multiple keyframes from row data without rendered diamond nodes', async () => {
    const selectKeyframe = vi.fn();
    const deselectAllKeyframes = vi.fn();
    const { container, getByTestId } = render(
      <MarqueeHarness
        selectKeyframe={selectKeyframe}
        deselectAllKeyframes={deselectAllKeyframes}
      />,
    );

    const lanes = getByTestId('timeline-lanes');
    const clipRow = container.querySelector<HTMLElement>('.track-clip-row');
    const keyframeTrack = container.querySelector<HTMLElement>('.keyframe-track');

    lanes.getBoundingClientRect = () => rect(0, 0, 1_000, 200);
    if (clipRow) clipRow.getBoundingClientRect = () => rect(0, 0, 1_000, 64);
    if (keyframeTrack) keyframeTrack.getBoundingClientRect = () => rect(0, 64, 1_000, 18);

    expect(container.querySelector('.keyframe-diamond')).toBeNull();

    fireEvent.mouseDown(keyframeTrack as HTMLElement, { button: 0, clientX: 20, clientY: 70 });
    await waitFor(() => expect(getByTestId('marquee-state').textContent).toBe('marquee'));

    fireEvent.mouseMove(document, { clientX: 40, clientY: 80 });

    await waitFor(() => {
      expect(deselectAllKeyframes).toHaveBeenCalled();
      expect(selectKeyframe).toHaveBeenCalledWith('keyframe-opacity', true);
      expect(selectKeyframe).toHaveBeenCalledWith('keyframe-opacity-2', true);
    });
  });

  it('uses kernel clip geometry for marquee clip hit testing', async () => {
    useTimelineStore.setState({
      selectedClipIds: new Set(),
      selectedKeyframeIds: new Set(),
      timelineRangeSelection: null,
    });
    const selectClip = vi.fn();
    const selectClips = vi.fn();
    const { container, getByTestId } = render(
      <MarqueeHarness
        selectClip={selectClip}
        selectClips={selectClips}
        selectKeyframe={vi.fn()}
        deselectAllKeyframes={vi.fn()}
        timeToPixel={(time) => (time === 1 ? 10 : time * 1000)}
      />,
    );

    const lanes = getByTestId('timeline-lanes');
    const clipRow = container.querySelector<HTMLElement>('.track-clip-row');

    lanes.getBoundingClientRect = () => rect(0, 0, 1_000, 200);
    if (clipRow) clipRow.getBoundingClientRect = () => rect(0, 0, 1_000, 64);

    fireEvent.mouseDown(clipRow as HTMLElement, { button: 0, clientX: 10, clientY: 10 });
    await waitFor(() => expect(getByTestId('marquee-state').textContent).toBe('marquee'));

    fireEvent.mouseMove(document, { clientX: 35, clientY: 30 });

    await waitFor(() => {
      expect(selectClips).toHaveBeenCalledWith(['clip-video']);
    });
  });

  it('offsets kernel row geometry by the timeline content origin', async () => {
    const selectKeyframe = vi.fn();
    const deselectAllKeyframes = vi.fn();
    const { container, getByTestId } = render(
      <MarqueeHarness
        selectKeyframe={selectKeyframe}
        deselectAllKeyframes={deselectAllKeyframes}
        geometryX={4}
      />,
    );

    const lanes = getByTestId('timeline-lanes');
    const clipRow = container.querySelector<HTMLElement>('.track-clip-row');
    const keyframeTrack = container.querySelector<HTMLElement>('.keyframe-track');

    lanes.getBoundingClientRect = () => rect(0, 0, 1_000, 200);
    if (clipRow) clipRow.getBoundingClientRect = () => rect(120, 0, 1_000, 64);
    if (keyframeTrack) keyframeTrack.getBoundingClientRect = () => rect(120, 64, 1_000, 18);

    fireEvent.mouseDown(keyframeTrack as HTMLElement, { button: 0, clientX: 145, clientY: 70 });
    await waitFor(() => expect(getByTestId('marquee-state').textContent).toBe('marquee'));

    fireEvent.mouseMove(document, { clientX: 166, clientY: 80 });

    await waitFor(() => {
      expect(deselectAllKeyframes).toHaveBeenCalled();
      expect(selectKeyframe).toHaveBeenCalledWith('keyframe-opacity', true);
      expect(selectKeyframe).toHaveBeenCalledWith('keyframe-opacity-2', true);
    });
  });
});
