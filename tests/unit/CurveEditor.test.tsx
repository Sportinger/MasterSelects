import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CurveEditor } from '../../src/components/timeline/CurveEditor';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockKeyframe } from '../helpers/mockData';

function createOpacityKeyframes() {
  return [
    createMockKeyframe({
      id: 'kf-left',
      clipId: 'clip-1',
      property: 'opacity',
      time: 0,
      value: 0.5,
      easing: 'bezier',
    }),
    createMockKeyframe({
      id: 'kf-right',
      clipId: 'clip-1',
      property: 'opacity',
      time: 2,
      value: 0.75,
      easing: 'linear',
    }),
  ];
}

describe('CurveEditor behavior', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useTimelineStore.getState().setCurveEditorHeight(250);
  });

  it('keeps dragging a bezier handle after leaving the editor and caps movement at the edge', () => {
    useTimelineStore.getState().setCurveEditorHeight(100);
    vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      top: 0,
      right: 200,
      bottom: 100,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect);

    const onUpdateBezierHandle = vi.fn();
    const keyframes = createOpacityKeyframes();

    const { container } = render(
      <CurveEditor
        trackId="video-1"
        clipId="clip-1"
        property="opacity"
        keyframes={keyframes}
        clipStartTime={0}
        clipDuration={2}
        width={200}
        selectedKeyframeIds={new Set(['kf-left'])}
        onSelectKeyframe={vi.fn()}
        onMoveKeyframe={vi.fn()}
        onUpdateBezierHandle={onUpdateBezierHandle}
        timeToPixel={(time) => time * 100}
        pixelToTime={(pixel) => pixel / 100}
      />,
    );

    const svg = container.querySelector('.curve-editor-svg') as SVGSVGElement;
    const handle = container.querySelector('.curve-editor-handle') as SVGCircleElement;

    fireEvent.mouseDown(handle, { button: 0, clientX: 66, clientY: 50, buttons: 1 });
    fireEvent.mouseLeave(svg);
    fireEvent.mouseMove(window, { clientX: 500, clientY: -50, buttons: 1 });

    expect(onUpdateBezierHandle).toHaveBeenLastCalledWith('kf-left', 'out', expect.objectContaining({
      x: 2,
    }));

    fireEvent.mouseMove(window, { clientX: 100, clientY: 50, buttons: 1 });

    expect(onUpdateBezierHandle).toHaveBeenLastCalledWith('kf-left', 'out', expect.objectContaining({
      x: 1,
    }));
  });

  it('resizes on shift wheel without bubbling to the timeline wheel handler', () => {
    useTimelineStore.getState().setCurveEditorHeight(100);
    const timelineWheel = vi.fn();

    const { container } = render(
      <div>
        <CurveEditor
          trackId="video-1"
          clipId="clip-1"
          property="opacity"
          keyframes={createOpacityKeyframes()}
          clipStartTime={0}
          clipDuration={2}
          width={200}
          selectedKeyframeIds={new Set(['kf-left'])}
          onSelectKeyframe={vi.fn()}
          onMoveKeyframe={vi.fn()}
          onUpdateBezierHandle={vi.fn()}
          timeToPixel={(time) => time * 100}
          pixelToTime={(pixel) => pixel / 100}
        />
      </div>,
    );

    const parent = container.firstElementChild as HTMLDivElement;
    const svg = container.querySelector('.curve-editor-svg') as SVGSVGElement;
    parent.addEventListener('wheel', timelineWheel);

    fireEvent.wheel(svg, { shiftKey: true, deltaY: 100 });

    expect(useTimelineStore.getState().curveEditorHeight).toBe(120);
    expect(timelineWheel).not.toHaveBeenCalled();

    parent.removeEventListener('wheel', timelineWheel);
  });

  it('snaps a dragged curve keyframe to another clip keyframe while shift is held', () => {
    useTimelineStore.getState().setCurveEditorHeight(100);
    vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      top: 0,
      right: 200,
      bottom: 100,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect);

    const onMoveKeyframe = vi.fn();

    const { container } = render(
      <CurveEditor
        trackId="video-1"
        clipId="clip-1"
        property="opacity"
        keyframes={createOpacityKeyframes()}
        clipStartTime={0}
        clipDuration={2}
        width={200}
        selectedKeyframeIds={new Set(['kf-left'])}
        onSelectKeyframe={vi.fn()}
        onMoveKeyframe={onMoveKeyframe}
        onUpdateBezierHandle={vi.fn()}
        timeToPixel={(time) => time * 100}
        pixelToTime={(pixel) => pixel / 100}
      />,
    );

    const keyframe = container.querySelector('.curve-editor-keyframe') as SVGCircleElement;

    fireEvent.mouseDown(keyframe, { button: 0, clientX: 0, clientY: 50, buttons: 1 });
    fireEvent.mouseMove(window, { clientX: 192, clientY: 45, buttons: 1, shiftKey: true });

    expect(onMoveKeyframe).toHaveBeenLastCalledWith('kf-left', 2, 0.5);
  });
});
