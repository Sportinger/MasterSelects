import { act, cleanup, render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { TimelineTrackViewport } from '../../src/components/timeline/components/TimelineTrackViewport';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('releases offscreen lane resources while preserving scroll geometry and remounts on entry', () => {
  vi.useFakeTimers();
  let notify: IntersectionObserverCallback = () => {};
  const release = vi.fn();
  const acquire = vi.fn();
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { notify = callback; }
    observe() {}
    disconnect() {}
  });
  function ResourceOwner() { useEffect(() => { acquire(); return release; }, []); return <canvas />; }
  const view = render(<TimelineTrackViewport enabled forceVisible={false} height={64} trackId="video-1"><ResourceOwner /></TimelineTrackViewport>);
  expect(acquire).not.toHaveBeenCalled();
  expect((view.container.firstChild as HTMLElement).style.height).toBe('64px');
  const visibility = (isIntersecting: boolean) => act(() => notify([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver));
  visibility(true);
  expect(acquire).toHaveBeenCalledTimes(1);
  visibility(false);
  expect(release).not.toHaveBeenCalled();
  visibility(true);
  act(() => vi.advanceTimersByTime(250));
  expect(acquire).toHaveBeenCalledTimes(1);
  expect(release).not.toHaveBeenCalled();
  visibility(false);
  act(() => vi.advanceTimersByTime(200));
  expect(release).toHaveBeenCalledTimes(1);
  expect(view.container.querySelector('[data-track-id="video-1"]')).not.toBeNull();
  visibility(true);
  expect(acquire).toHaveBeenCalledTimes(2);
});

it('keeps offscreen lanes interactive during gestures and falls back without IntersectionObserver', () => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  const view = render(<TimelineTrackViewport enabled forceVisible height={30} trackId="video-1"><button>Clip</button></TimelineTrackViewport>);
  expect(view.getByText('Clip')).toBeTruthy();
  vi.stubGlobal('IntersectionObserver', undefined);
  view.rerender(<TimelineTrackViewport enabled forceVisible={false} height={30} trackId="video-1"><button>Clip</button></TimelineTrackViewport>);
  expect(view.getByText('Clip')).toBeTruthy();
});

it('pins a dragged lane without allocating render resources for its offscreen neighbours', () => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  let liveResources = 0;
  function ResourceOwner() {
    useEffect(() => { liveResources++; return () => { liveResources--; }; }, []);
    return <canvas />;
  }
  const rows = (dragged: number | null) => Array.from({ length: 100 }, (_, index) => (
    <TimelineTrackViewport key={index} enabled forceVisible={index === dragged}
      height={30} trackId={`track-${index}`}><ResourceOwner /></TimelineTrackViewport>
  ));
  const view = render(<>{rows(null)}</>);
  expect(liveResources).toBe(0);
  view.rerender(<>{rows(50)}</>);
  expect(liveResources).toBe(1);
  expect(view.container.querySelectorAll('[data-track-id]')).toHaveLength(99);
  view.rerender(<>{rows(null)}</>);
  expect(liveResources).toBe(0);
});
