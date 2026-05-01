import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { RefObject } from 'react';
import { TimelineKeyframes } from '../../src/components/timeline/TimelineKeyframes';
import type { TimelineKeyframesProps } from '../../src/components/timeline/types';
import { createMockClip, createMockKeyframe } from '../helpers/mockData';

describe('TimelineKeyframes', () => {
  let timelineEl: HTMLDivElement;

  beforeEach(() => {
    timelineEl = document.createElement('div');
    document.body.appendChild(timelineEl);
  });

  afterEach(() => {
    timelineEl.remove();
    vi.restoreAllMocks();
  });

  function renderKeyframes({
    isRowHovered = false,
    onKeyframeRowHover = vi.fn(),
    onMoveKeyframe = vi.fn(),
    onToggleCurveExpanded = vi.fn(),
  }: {
    isRowHovered?: boolean;
    onKeyframeRowHover?: ReturnType<typeof vi.fn>;
    onMoveKeyframe?: ReturnType<typeof vi.fn>;
    onToggleCurveExpanded?: ReturnType<typeof vi.fn>;
  } = {}) {
    const clip = createMockClip({ id: 'clip-1', trackId: 'video-1', startTime: 0, duration: 5 });
    const leftKeyframe = createMockKeyframe({
      id: 'kf-left',
      clipId: clip.id,
      property: 'opacity',
      time: 1,
      value: 0.25,
      easing: 'linear',
    });
    const rightKeyframe = createMockKeyframe({
      id: 'kf-right',
      clipId: clip.id,
      property: 'opacity',
      time: 4,
      value: 0.75,
      easing: 'ease-in',
    });
    const clipKeyframes: TimelineKeyframesProps['clipKeyframes'] = new Map([[clip.id, [leftKeyframe, rightKeyframe]]]);
    const onUpdateKeyframe = vi.fn();

    const renderResult = render(
      <TimelineKeyframes
        trackId="video-1"
        property="opacity"
        clips={[clip]}
        selectedKeyframeIds={new Set()}
        clipKeyframes={clipKeyframes}
        clipDrag={null}
        scrollX={0}
        timelineRef={{ current: timelineEl } as RefObject<HTMLDivElement | null>}
        onSelectKeyframe={vi.fn()}
        onMoveKeyframe={onMoveKeyframe}
        onUpdateKeyframe={onUpdateKeyframe}
        onToggleCurveExpanded={onToggleCurveExpanded}
        timeToPixel={(time) => time * 20}
        pixelToTime={(pixel) => pixel / 20}
        isRowHovered={isRowHovered}
        onKeyframeRowHover={onKeyframeRowHover}
      />
    );

    return {
      ...renderResult,
      leftKeyframe,
      onKeyframeRowHover,
      onMoveKeyframe,
      onToggleCurveExpanded,
      onUpdateKeyframe,
    };
  }

  it('applies last-keyframe easing changes to the visible incoming segment', () => {
    const { container, onUpdateKeyframe, leftKeyframe } = renderKeyframes();
    const diamonds = container.querySelectorAll('.keyframe-diamond');

    fireEvent.contextMenu(diamonds[1], { clientX: 80, clientY: 40 });
    fireEvent.click(screen.getByText('Ease Out'));

    expect(onUpdateKeyframe).toHaveBeenCalledWith(leftKeyframe.id, { easing: 'ease-out' });
  });

  it('highlights every visible keyframe when its property row is hovered', () => {
    const { container } = renderKeyframes({ isRowHovered: true });
    const diamonds = container.querySelectorAll('.keyframe-diamond');

    expect(diamonds).toHaveLength(2);
    diamonds.forEach((diamond) => {
      expect(diamond).toHaveClass('row-highlighted');
    });
  });

  it('reports keyframe hover so the matching property row can highlight', () => {
    const onKeyframeRowHover = vi.fn();
    const { container } = renderKeyframes({ onKeyframeRowHover });
    const diamond = container.querySelector('.keyframe-diamond') as HTMLElement;

    fireEvent.mouseEnter(diamond);
    expect(onKeyframeRowHover).toHaveBeenLastCalledWith('video-1', 'opacity', true);

    fireEvent.mouseLeave(diamond);
    expect(onKeyframeRowHover).toHaveBeenLastCalledWith('video-1', 'opacity', false);
  });

  it('snaps a dragged keyframe to another keyframe in the same clip while shift is held', () => {
    const onMoveKeyframe = vi.fn();
    const { container } = renderKeyframes({ onMoveKeyframe });
    const diamonds = container.querySelectorAll('.keyframe-diamond');

    fireEvent.mouseDown(diamonds[0], { button: 0, clientX: 20 });
    fireEvent.mouseMove(window, { clientX: 78, shiftKey: true });

    expect(onMoveKeyframe).toHaveBeenLastCalledWith('kf-left', 4);
  });

  it('toggles the curve editor on left double-clicking a keyframe', () => {
    const onToggleCurveExpanded = vi.fn();
    const { container } = renderKeyframes({ onToggleCurveExpanded });
    const diamond = container.querySelector('.keyframe-diamond') as HTMLElement;

    fireEvent.doubleClick(diamond, { button: 0 });

    expect(onToggleCurveExpanded).toHaveBeenCalledWith('video-1', 'opacity');
  });

  it('keeps the menu onscreen and blocks document mousedown handlers during easing changes', async () => {
    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;
    const documentMouseDown = vi.fn();

    try {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 100 });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 100 });

      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 1;
      });
      vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
      vi.spyOn(HTMLDivElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
        if (this.classList.contains('keyframe-context-menu')) {
          return {
            x: 0,
            y: 0,
            width: 140,
            height: 80,
            top: 0,
            right: 140,
            bottom: 80,
            left: 0,
            toJSON: () => ({}),
          } as DOMRect;
        }

        return {
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          toJSON: () => ({}),
        } as DOMRect;
      });

      const { container, onUpdateKeyframe } = renderKeyframes();
      const diamonds = container.querySelectorAll('.keyframe-diamond');

      fireEvent.contextMenu(diamonds[1], { clientX: 95, clientY: 90 });

      const menu = document.querySelector('.keyframe-context-menu') as HTMLDivElement;
      await waitFor(() => expect(menu.style.left).toBe('8px'));

      document.addEventListener('mousedown', documentMouseDown);

      const option = screen.getByText('Ease In');
      fireEvent.mouseDown(option);
      expect(documentMouseDown).not.toHaveBeenCalled();

      fireEvent.click(option);
      expect(onUpdateKeyframe).toHaveBeenCalled();
    } finally {
      document.removeEventListener('mousedown', documentMouseDown);
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight });
    }
  });
});
