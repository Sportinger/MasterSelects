import { act, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePickWhipDrag } from '../../src/components/timeline/hooks/usePickWhipDrag';
import type { TimelineClip, TimelineTrack } from '../../src/types';

const tracks = [
  { id: 'video-a', type: 'video', locked: false },
  { id: 'video-b', type: 'video', locked: false },
] as TimelineTrack[];

const clips = [
  { id: 'child', trackId: 'video-a', name: 'Child' },
  { id: 'parent', trackId: 'video-b', name: 'Parent' },
] as TimelineClip[];

function setHitTarget(clipId: string) {
  const target = document.createElement('div');
  target.dataset.clipId = clipId;
  document.body.appendChild(target);
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: vi.fn(() => target),
  });
}

afterEach(() => {
  document.body.replaceChildren();
  Reflect.deleteProperty(document, 'elementFromPoint');
});

describe('usePickWhipDrag', () => {
  it('commits a valid parent exactly once on pointer release', () => {
    const setClipParent = vi.fn();
    setHitTarget('parent');
    const { result } = renderHook(() => usePickWhipDrag({
      clips,
      tracks,
      setClipParent,
      setTrackParent: vi.fn(),
    }));

    act(() => result.current.handlePickWhipDragStart('child', 10, 20));
    fireEvent.pointerMove(window, { clientX: 80, clientY: 30 });
    expect(result.current.pickWhipDrag).toMatchObject({
      sourceClipId: 'child',
      targetClipId: 'parent',
      status: 'valid',
    });

    fireEvent.pointerUp(window, { clientX: 80, clientY: 30 });
    expect(setClipParent).toHaveBeenCalledTimes(1);
    expect(setClipParent).toHaveBeenCalledWith('child', 'parent');
    expect(result.current.pickWhipDrag).toBeNull();
  });

  it('shows a blocked state and does not mutate on a cyclic target', () => {
    const setClipParent = vi.fn();
    setHitTarget('parent');
    const cyclicClips = [clips[0], { ...clips[1], parentClipId: 'child' }];
    const { result } = renderHook(() => usePickWhipDrag({
      clips: cyclicClips,
      tracks,
      setClipParent,
      setTrackParent: vi.fn(),
    }));

    act(() => result.current.handlePickWhipDragStart('child', 10, 20));
    fireEvent.pointerMove(window, { clientX: 80, clientY: 30 });
    expect(result.current.pickWhipDrag?.status).toBe('blocked');
    expect(result.current.pickWhipDrag?.diagnostic).toContain('cycle');

    fireEvent.pointerUp(window, { clientX: 80, clientY: 30 });
    expect(setClipParent).not.toHaveBeenCalled();
  });
});
