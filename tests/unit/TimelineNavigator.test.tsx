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
  it('includes end padding in thumb size and right-edge scroll position', () => {
    const { container } = render(
      <TimelineNavigator
        duration={10}
        scrollX={100}
        zoom={100}
        viewportWidth={1000}
        minZoom={1}
        maxZoom={1000}
        onScrollChange={vi.fn()}
        onZoomChange={vi.fn()}
      />,
    );

    expect(container.querySelector('.timeline-navigator')).toHaveAttribute(
      'data-guided-target',
      'timeline-navigator',
    );
    const thumb = container.querySelector<HTMLElement>('.timeline-navigator-thumb')!;
    expect(Number.parseFloat(thumb.style.width)).toBeCloseTo(181.82, 2);
    expect(Number.parseFloat(thumb.style.left)).toBeCloseTo(18.18, 2);
  });

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
