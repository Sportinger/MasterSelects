import { fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';

import { useTimelineSplitDividerDrag } from '../../src/components/timeline/hooks/useTimelineSplitDividerDrag';

function makePointerEvent(type: string, pointerId: number, clientY: number): PointerEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: type === 'pointerdown' ? 1 : 0,
    clientY,
  }) as PointerEvent;
  Object.defineProperties(event, {
    isPrimary: { value: true },
    pointerId: { value: pointerId },
    pointerType: { value: 'touch' },
  });
  return event;
}

function Harness() {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [splitDragVideoHeight, setSplitDragVideoHeight] = useState<number | null>(null);
  const [, setVideoScrollY] = useState(0);
  const onPointerDown = useTimelineSplitDividerDrag({
    scrollWrapperRef: wrapperRef,
    trackFocusMode: 'balanced',
    clampSplitDragVideoHeight: (height, availableHeight) => (
      Math.max(0, Math.min(availableHeight, height))
    ),
    expandedVideoSectionContentHeight: 1_000,
    videoSectionContentHeight: 1_000,
    isVideoBottomVisible: () => false,
    setTimelineSplitRatio: () => undefined,
    setTrackFocusMode: () => undefined,
    setVideoScrollY,
    setSplitDragVideoHeight,
    setSplitDragSmoothing: () => undefined,
    setSplitDragPinVideoBottom: () => undefined,
    setForceVideoBottomScroll: () => undefined,
  });

  return (
    <div
      ref={(node) => {
        wrapperRef.current = node;
        if (node) {
          node.getBoundingClientRect = () => ({
            bottom: 400,
            height: 400,
            left: 0,
            right: 600,
            top: 0,
            width: 600,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          });
        }
      }}
    >
      <div
        data-testid="timeline-divider"
        data-dragging={splitDragVideoHeight === null ? 'false' : 'true'}
        onPointerDown={onPointerDown}
      />
    </div>
  );
}

describe('timeline split divider drag', () => {
  it.each(['lostpointercapture', 'pagehide'])(
    'clears the highlighted drag state on %s',
    (terminalEvent) => {
      render(<Harness />);
      const divider = screen.getByTestId('timeline-divider');

      fireEvent(divider, makePointerEvent('pointerdown', 41, 200));
      expect(divider).toHaveAttribute('data-dragging', 'true');

      if (terminalEvent === 'lostpointercapture') {
        fireEvent(document, makePointerEvent(terminalEvent, 41, 200));
      } else {
        fireEvent(window, new Event(terminalEvent));
      }

      expect(divider).toHaveAttribute('data-dragging', 'false');
    },
  );
});
