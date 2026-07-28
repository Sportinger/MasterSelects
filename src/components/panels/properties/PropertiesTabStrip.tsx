import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

const OVERFLOW_EPSILON_PX = 1;
const HOVER_ADVANCE_INTERVAL_MS = 500;
const CLICK_AUTO_ADVANCE_PAUSE_MS = 2_000;

interface PropertiesTabStripProps {
  children: ReactNode;
}

interface OverflowState {
  activeDirection: 'left' | 'right' | null;
  left: boolean;
  right: boolean;
}

function getTabButtons(container: HTMLDivElement): HTMLElement[] {
  return Array.from(container.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains('tab-btn'),
  );
}

function clampScrollLeft(container: HTMLDivElement, value: number): number {
  return Math.max(0, Math.min(value, container.scrollWidth - container.clientWidth));
}

export function PropertiesTabStrip({ children }: PropertiesTabStripProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const autoAdvanceIntervalRef = useRef<number | null>(null);
  const autoAdvanceResumeRef = useRef<number | null>(null);
  const hoveredDirectionRef = useRef<'left' | 'right' | null>(null);
  const [overflow, setOverflow] = useState<OverflowState>({
    activeDirection: null,
    left: false,
    right: false,
  });

  const updateOverflow = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const viewportStart = scroller.scrollLeft;
    const viewportEnd = viewportStart + scroller.clientWidth;
    const activeTab = getTabButtons(scroller).find(tab => tab.classList.contains('active'));
    const activeDirection: OverflowState['activeDirection'] = activeTab
      && activeTab.offsetLeft + activeTab.offsetWidth <= viewportStart + OVERFLOW_EPSILON_PX
      ? 'left'
      : activeTab && activeTab.offsetLeft >= viewportEnd - OVERFLOW_EPSILON_PX
        ? 'right'
        : null;
    const next = {
      activeDirection,
      left: scroller.scrollLeft > OVERFLOW_EPSILON_PX,
      right: scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - OVERFLOW_EPSILON_PX,
    };
    setOverflow(current => (
      current.activeDirection === next.activeDirection
        && current.left === next.left
        && current.right === next.right
        ? current
        : next
    ));
  }, []);

  const scrollTo = useCallback((left: number) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    scroller.scrollTo({
      behavior: 'smooth',
      left: clampScrollLeft(scroller, left),
    });
  }, []);

  const showPreviousTab = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const previousTab = getTabButtons(scroller)
      .toReversed()
      .find(tab => tab.offsetLeft < scroller.scrollLeft - OVERFLOW_EPSILON_PX);
    if (previousTab) scrollTo(previousTab.offsetLeft);
  }, [scrollTo]);

  const showNextTab = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const viewportEnd = scroller.scrollLeft + scroller.clientWidth;
    const nextTab = getTabButtons(scroller)
      .find(tab => tab.offsetLeft + tab.offsetWidth > viewportEnd + OVERFLOW_EPSILON_PX);
    if (nextTab) {
      scrollTo(nextTab.offsetLeft + nextTab.offsetWidth - scroller.clientWidth);
    }
  }, [scrollTo]);

  const clearAutoAdvanceTimers = useCallback(() => {
    if (autoAdvanceIntervalRef.current !== null) {
      window.clearInterval(autoAdvanceIntervalRef.current);
      autoAdvanceIntervalRef.current = null;
    }
    if (autoAdvanceResumeRef.current !== null) {
      window.clearTimeout(autoAdvanceResumeRef.current);
      autoAdvanceResumeRef.current = null;
    }
  }, []);

  const advanceInDirection = useCallback((direction: 'left' | 'right') => {
    if (direction === 'left') {
      showPreviousTab();
    } else {
      showNextTab();
    }
  }, [showNextTab, showPreviousTab]);

  const startHoverAutoAdvance = useCallback((direction: 'left' | 'right') => {
    hoveredDirectionRef.current = direction;
    clearAutoAdvanceTimers();
    autoAdvanceIntervalRef.current = window.setInterval(
      () => advanceInDirection(direction),
      HOVER_ADVANCE_INTERVAL_MS,
    );
  }, [advanceInDirection, clearAutoAdvanceTimers]);

  const stopHoverAutoAdvance = useCallback(() => {
    hoveredDirectionRef.current = null;
    clearAutoAdvanceTimers();
  }, [clearAutoAdvanceTimers]);

  const handleDirectionClick = useCallback((direction: 'left' | 'right') => {
    advanceInDirection(direction);
    clearAutoAdvanceTimers();

    if (hoveredDirectionRef.current !== direction) return;
    autoAdvanceResumeRef.current = window.setTimeout(() => {
      if (hoveredDirectionRef.current !== direction) return;
      advanceInDirection(direction);
      autoAdvanceIntervalRef.current = window.setInterval(
        () => advanceInDirection(direction),
        HOVER_ADVANCE_INTERVAL_MS,
      );
    }, CLICK_AUTO_ADVANCE_PAUSE_MS);
  }, [advanceInDirection, clearAutoAdvanceTimers]);

  useEffect(() => {
    const direction = hoveredDirectionRef.current;
    if (
      (direction === 'left' && !overflow.left)
      || (direction === 'right' && !overflow.right)
    ) {
      stopHoverAutoAdvance();
    }
  }, [overflow.left, overflow.right, stopHoverAutoAdvance]);

  useEffect(() => clearAutoAdvanceTimers, [clearAutoAdvanceTimers]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    updateOverflow();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(scroller);
    getTabButtons(scroller).forEach(tab => observer.observe(tab));
    return () => observer.disconnect();
  }, [children, updateOverflow]);

  return (
    <div className="properties-tabs-shell">
      <button
        aria-hidden={!overflow.left}
        aria-label="Show previous property tab"
        className={`properties-tabs-nav properties-tabs-nav--previous ${overflow.left ? 'properties-tabs-nav--visible' : ''} ${overflow.activeDirection === 'left' ? 'properties-tabs-nav--active-hidden' : ''}`}
        disabled={!overflow.left}
        onClick={() => handleDirectionClick('left')}
        onPointerEnter={() => startHoverAutoAdvance('left')}
        onPointerLeave={stopHoverAutoAdvance}
        tabIndex={overflow.left ? 0 : -1}
        title="Previous tab"
        type="button"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="m10 3-5 5 5 5" />
        </svg>
      </button>
      <div className="properties-tabs" onScroll={updateOverflow} ref={scrollerRef}>
        {children}
      </div>
      <button
        aria-hidden={!overflow.right}
        aria-label="Show next property tab"
        className={`properties-tabs-nav properties-tabs-nav--next ${overflow.right ? 'properties-tabs-nav--visible' : ''} ${overflow.activeDirection === 'right' ? 'properties-tabs-nav--active-hidden' : ''}`}
        disabled={!overflow.right}
        onClick={() => handleDirectionClick('right')}
        onPointerEnter={() => startHoverAutoAdvance('right')}
        onPointerLeave={stopHoverAutoAdvance}
        tabIndex={overflow.right ? 0 : -1}
        title="Next tab"
        type="button"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="m6 3 5 5-5 5" />
        </svg>
      </button>
    </div>
  );
}
