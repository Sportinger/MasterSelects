import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useTimelineZoom } from '../../src/components/timeline/hooks/useTimelineZoom';

function touchPointerEvent(type: string, clientX: number): PointerEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY: 160,
  }) as PointerEvent;
  Object.defineProperties(event, {
    pointerId: { value: 31 },
    pointerType: { value: 'touch' },
  });
  return event;
}

describe('empty timeline surface touch pan', () => {
  it('keeps the complete empty-section pointer stream under editor control', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/components/timeline/TimelineTracksLanes.css'),
      'utf8',
    );
    const emptySurfaceTouchRule = css.match(
      /\.timeline-track-stack,[\s\S]*?\.track-lanes-scroll\s*\{[\s\S]*?touch-action:\s*none;/,
    )?.[0];
    expect(emptySurfaceTouchRule).toContain('.timeline-section-content-row');
    expect(emptySurfaceTouchRule).toContain('.timeline-section-viewport');
    expect(emptySurfaceTouchRule).toContain('.timeline-section-tracks');

    const body = document.createElement('div');
    const laneReference = document.createElement('div');
    laneReference.className = 'timeline-lane-reference';
    Object.defineProperty(laneReference, 'clientWidth', { value: 800 });
    const section = document.createElement('div');
    section.className = 'timeline-track-section video';
    section.dataset.sectionKind = 'video';
    const viewport = document.createElement('div');
    viewport.className = 'timeline-section-viewport';
    const emptyTracksSurface = document.createElement('div');
    emptyTracksSurface.className = 'timeline-section-tracks';
    const emptyScrollableSurface = document.createElement('div');
    emptyScrollableSurface.className = 'track-lanes-scroll';
    emptyTracksSurface.appendChild(emptyScrollableSurface);
    viewport.appendChild(emptyTracksSurface);
    section.appendChild(viewport);
    body.append(laneReference, section);
    document.body.appendChild(body);
    const setScrollX = vi.fn();

    const { unmount } = renderHook(() => useTimelineZoom({
      timelineBodyRef: { current: body },
      zoom: 20,
      scrollX: 300,
      scrollY: 0,
      duration: 100,
      playheadPosition: 0,
      contentHeight: 0,
      viewportHeight: 0,
      trackSnapPositions: [],
      setZoom: vi.fn(),
      setScrollX,
      setScrollY: vi.fn(),
    }));

    emptyScrollableSurface.dispatchEvent(touchPointerEvent('pointerdown', 500));
    window.dispatchEvent(touchPointerEvent('pointermove', 450));
    window.dispatchEvent(touchPointerEvent('pointermove', 400));

    expect(setScrollX).toHaveBeenNthCalledWith(1, 350);
    expect(setScrollX).toHaveBeenNthCalledWith(2, 400);

    window.dispatchEvent(touchPointerEvent('pointerup', 400));
    unmount();
    body.remove();
  });
});
