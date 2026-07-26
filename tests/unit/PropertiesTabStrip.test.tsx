import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PropertiesTabStrip } from '../../src/components/panels/properties/PropertiesTabStrip';

function setDimension(element: Element, name: string, value: number) {
  Object.defineProperty(element, name, {
    configurable: true,
    value,
  });
}

describe('PropertiesTabStrip', () => {
  it('shows only useful direction controls and advances by one hidden tab', () => {
    const { rerender } = render(
      <PropertiesTabStrip>
        <button className="tab-btn active">Transform</button>
        <button className="tab-btn">Color</button>
        <button className="tab-btn">Effects</button>
      </PropertiesTabStrip>,
    );

    const scroller = screen.getByText('Transform').parentElement as HTMLDivElement;
    const tabs = Array.from(scroller.children);
    setDimension(scroller, 'clientWidth', 200);
    setDimension(scroller, 'scrollWidth', 290);
    setDimension(tabs[0], 'offsetLeft', 0);
    setDimension(tabs[0], 'offsetWidth', 90);
    setDimension(tabs[1], 'offsetLeft', 90);
    setDimension(tabs[1], 'offsetWidth', 100);
    setDimension(tabs[2], 'offsetLeft', 190);
    setDimension(tabs[2], 'offsetWidth', 100);

    let scrollLeft = 0;
    Object.defineProperty(scroller, 'scrollLeft', {
      configurable: true,
      get: () => scrollLeft,
      set: value => {
        scrollLeft = value;
      },
    });
    const scrollTo = vi.fn(({ left }: ScrollToOptions) => {
      scrollLeft = left ?? scrollLeft;
    });
    scroller.scrollTo = scrollTo;

    fireEvent.scroll(scroller);
    const previous = screen.getByTitle('Previous tab');
    const next = screen.getByTitle('Next tab');
    expect(previous).toBeDisabled();
    expect(previous).not.toHaveClass('properties-tabs-nav--visible');
    expect(next).toBeEnabled();
    fireEvent.click(next);
    expect(scrollTo).toHaveBeenCalledWith({ behavior: 'smooth', left: 90 });

    fireEvent.scroll(scroller);
    expect(previous).toHaveClass('properties-tabs-nav--active-hidden', 'properties-tabs-nav--visible');
    expect(next).toBeDisabled();
    expect(next).not.toHaveClass('properties-tabs-nav--visible');

    rerender(
      <PropertiesTabStrip>
        <button className="tab-btn active">Transform</button>
        <button className="tab-btn">Color</button>
        <button className="tab-btn">Effects</button>
      </PropertiesTabStrip>,
    );
    expect(scroller.scrollLeft).toBe(90);

    fireEvent.click(previous);
    expect(scrollTo).toHaveBeenLastCalledWith({ behavior: 'smooth', left: 0 });
  });

  it('advances one tab every 500 ms while a direction control is hovered', () => {
    vi.useFakeTimers();
    const { unmount } = render(
      <PropertiesTabStrip>
        <button className="tab-btn active">Transform</button>
        <button className="tab-btn">Color</button>
        <button className="tab-btn">Effects</button>
        <button className="tab-btn">Masks</button>
      </PropertiesTabStrip>,
    );

    try {
      const scroller = screen.getByText('Transform').parentElement as HTMLDivElement;
      const tabs = Array.from(scroller.children);
      setDimension(scroller, 'clientWidth', 200);
      setDimension(scroller, 'scrollWidth', 390);
      [0, 90, 190, 290].forEach((left, index) => {
        setDimension(tabs[index], 'offsetLeft', left);
        setDimension(tabs[index], 'offsetWidth', index === 0 ? 90 : 100);
      });

      let scrollLeft = 0;
      Object.defineProperty(scroller, 'scrollLeft', {
        configurable: true,
        get: () => scrollLeft,
        set: value => {
          scrollLeft = value;
        },
      });
      const scrollTo = vi.fn(({ left }: ScrollToOptions) => {
        scrollLeft = left ?? scrollLeft;
      });
      scroller.scrollTo = scrollTo;

      fireEvent.scroll(scroller);
      const next = screen.getByLabelText('Show next property tab');
      fireEvent.pointerEnter(next);
      act(() => vi.advanceTimersByTime(1_000));

      expect(scrollTo).toHaveBeenNthCalledWith(1, { behavior: 'smooth', left: 90 });
      expect(scrollTo).toHaveBeenNthCalledWith(2, { behavior: 'smooth', left: 190 });

      fireEvent.pointerLeave(next);
      act(() => vi.advanceTimersByTime(500));
      expect(scrollTo).toHaveBeenCalledTimes(2);
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });

  it('pauses hover advance for two seconds after a manual click', () => {
    vi.useFakeTimers();
    const { unmount } = render(
      <PropertiesTabStrip>
        <button className="tab-btn active">Transform</button>
        <button className="tab-btn">Color</button>
        <button className="tab-btn">Effects</button>
        <button className="tab-btn">Masks</button>
        <button className="tab-btn">Transcript</button>
      </PropertiesTabStrip>,
    );

    try {
      const scroller = screen.getByText('Transform').parentElement as HTMLDivElement;
      const tabs = Array.from(scroller.children);
      setDimension(scroller, 'clientWidth', 200);
      setDimension(scroller, 'scrollWidth', 490);
      [0, 90, 190, 290, 390].forEach((left, index) => {
        setDimension(tabs[index], 'offsetLeft', left);
        setDimension(tabs[index], 'offsetWidth', index === 0 ? 90 : 100);
      });

      let scrollLeft = 0;
      Object.defineProperty(scroller, 'scrollLeft', {
        configurable: true,
        get: () => scrollLeft,
        set: value => {
          scrollLeft = value;
        },
      });
      const scrollTo = vi.fn(({ left }: ScrollToOptions) => {
        scrollLeft = left ?? scrollLeft;
      });
      scroller.scrollTo = scrollTo;

      fireEvent.scroll(scroller);
      const next = screen.getByTitle('Next tab');
      fireEvent.pointerEnter(next);
      fireEvent.click(next);
      expect(scrollTo).toHaveBeenLastCalledWith({ behavior: 'smooth', left: 90 });

      act(() => vi.advanceTimersByTime(1_999));
      expect(scrollTo).toHaveBeenCalledTimes(1);

      act(() => vi.advanceTimersByTime(1));
      expect(scrollTo).toHaveBeenLastCalledWith({ behavior: 'smooth', left: 190 });

      act(() => vi.advanceTimersByTime(500));
      expect(scrollTo).toHaveBeenLastCalledWith({ behavior: 'smooth', left: 290 });
      expect(scrollTo).toHaveBeenCalledTimes(3);
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });
});
