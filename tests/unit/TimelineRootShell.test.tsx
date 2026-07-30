import { fireEvent, render } from '@testing-library/react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { TimelineRootShell } from '../../src/components/timeline/components/TimelineRootShell';

function renderTimelineRoot(
  onMouseDownCapture: () => void,
  childMouseDown?: (event: ReactMouseEvent) => void,
) {
  return render(
    <TimelineRootShell
      activeTrackResizeId={null}
      audioDisplayMode="detailed"
      audioFocusMode={false}
      clipInteractionActive={false}
      effectiveAudioLayerAdvancedMode={false}
      isHeaderWidthResizing={false}
      onMouseDownCapture={onMouseDownCapture}
      openCompositionCount={1}
      splitDragSmoothing={false}
      splitDragVideoHeight={null}
      trackFocusMode="balanced"
      trackHeaderWidth={220}
    >
      <button onMouseDown={childMouseDown}>Timeline child</button>
    </TimelineRootShell>,
  );
}

describe('TimelineRootShell preview priority', () => {
  it('handles timeline mouse-down before a child can stop propagation', () => {
    const dismissSourceMonitor = vi.fn();
    const childMouseDown = vi.fn((event: ReactMouseEvent) => {
      event.stopPropagation();
    });
    const { getByRole } = renderTimelineRoot(dismissSourceMonitor, childMouseDown);

    fireEvent.mouseDown(getByRole('button', { name: 'Timeline child' }));

    expect(dismissSourceMonitor).toHaveBeenCalledTimes(1);
    expect(childMouseDown).toHaveBeenCalledTimes(1);
    expect(dismissSourceMonitor.mock.invocationCallOrder[0])
      .toBeLessThan(childMouseDown.mock.invocationCallOrder[0]);
  });
});
