import { act, cleanup, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { TimelineSectionTrackRows } from '../../src/components/timeline/components/TimelineSectionTrackRows';

vi.mock('../../src/stores/settingsStore', () => ({
  useSettingsStore: (select: (state: { theme: string }) => unknown) => select({ theme: 'dark' }),
}));
vi.mock('../../src/components/timeline/TimelineTrack', () => ({
  TimelineTrack: ({ track }: { track: { id: string } }) => (
    <div data-track-id={track.id}><canvas data-resource-owner={track.id} /></div>
  ),
}));

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function setup(count: number, type: 'video' | 'audio' = 'video') {
  const visibility = new Map<string, (visible: boolean) => void>();
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private callback: IntersectionObserverCallback) {}
    observe(element: HTMLElement) {
      const id = element.querySelector('[data-track-id]')!.getAttribute('data-track-id')!;
      visibility.set(id, (isIntersecting) => this.callback(
        [{ isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver,
      ));
    }
    disconnect() {}
  });
  const props = {
    sectionKind: type,
    sectionTracks: Array.from({ length: count }, (_, i) => ({ id: `${type}-${i}`, type, name: `Track ${i}` })),
    clips: [], clipMap: new Map(), clipDrag: null, clipDragPreview: null, clipTrim: null,
    selectedClipIds: new Set(), selectedKeyframeIds: new Set(),
    getSectionTrackHeight: () => 64,
    getSectionTrackBaseHeight: () => 64,
    isTrackExpandedForRender: () => false,
  } as unknown as ComponentProps<typeof TimelineSectionTrackRows>;
  return { props, visibility };
}

it.each([1, 2, 8, 9])('only mounts visible resource owners in a section of %i tracks', (count) => {
  vi.useFakeTimers();
  const { props, visibility } = setup(count);
  const view = render(<TimelineSectionTrackRows {...props} />);
  expect(view.container.querySelectorAll('canvas')).toHaveLength(0);
  expect(view.container.querySelectorAll('[data-virtualized="true"]')).toHaveLength(count);
  act(() => visibility.get('video-0')!(true));
  expect(view.container.querySelectorAll('canvas')).toHaveLength(1);
  act(() => visibility.get('video-0')!(false));
  act(() => vi.advanceTimersByTime(200));
  expect(view.container.querySelectorAll('canvas')).toHaveLength(0);
  expect(view.container.querySelector('[data-track-id="video-0"]')?.parentElement?.style.height).toBe('64px');
});

it('pins the resized audio row while keeping its offscreen neighbours unmounted', () => {
  const { props } = setup(4, 'audio');
  const view = render(<TimelineSectionTrackRows {...props} activeTrackResizeId="audio-2" />);
  expect(view.container.querySelectorAll('canvas')).toHaveLength(1);
  expect(view.container.querySelector('canvas')?.getAttribute('data-resource-owner')).toBe('audio-2');
  view.rerender(<TimelineSectionTrackRows {...props} activeTrackResizeId={null} />);
  expect(view.container.querySelectorAll('canvas')).toHaveLength(0);
});
