import { fireEvent, render } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TimelineNavigator } from '../../src/components/timeline/TimelineNavigator';

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
});

afterAll(() => vi.unstubAllGlobals());

describe('TimelineNavigator', () => {
  it('does not turn a zoom-handle release into a track jump', () => {
    const onScrollChange = vi.fn();
    const { container } = render(
      <TimelineNavigator
        duration={60}
        scrollX={200}
        zoom={100}
        viewportWidth={1000}
        minZoom={1}
        maxZoom={1000}
        onScrollChange={onScrollChange}
        onZoomChange={vi.fn()}
      />,
    );

    fireEvent.click(container.querySelector('.timeline-navigator-handle-left')!, { clientX: 100 });

    expect(onScrollChange).not.toHaveBeenCalled();
  });
});
