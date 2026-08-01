import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ParentChildLink } from '../../src/components/timeline/ParentChildLink';
import type { TimelineClip, TimelineTrack } from '../../src/types';

const tracks: TimelineTrack[] = [
  { id: 'video-1', name: 'Video 1', type: 'video', height: 80, muted: false, visible: true, solo: false },
  { id: 'video-2', name: 'Video 2', type: 'video', height: 80, muted: false, visible: true, solo: false },
];

function createClip(id: string, trackId: string, startTime: number): TimelineClip {
  return {
    id,
    trackId,
    name: id,
    file: new File([], `${id}.mp4`, { type: 'video/mp4' }),
    startTime,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: null,
    transform: {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    effects: [],
  };
}

describe('ParentChildLink', () => {
  let nextFrameId: number;
  let pendingFrames: Map<number, FrameRequestCallback>;

  beforeEach(() => {
    nextFrameId = 1;
    pendingFrames = new Map();

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const id = nextFrameId++;
      pendingFrames.set(id, callback);
      return id;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      pendingFrames.delete(id);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function flushUntilRest(maxFrames = 500): number {
    let flushedFrames = 0;

    while (pendingFrames.size > 0 && flushedFrames < maxFrames) {
      const frames = Array.from(pendingFrames.entries());
      pendingFrames.clear();
      act(() => {
        for (const [id, callback] of frames) {
          callback(id);
        }
      });
      flushedFrames += frames.length;
    }

    return flushedFrames;
  }

  function renderLink(childClip: TimelineClip) {
    return render(
      <svg>
        <ParentChildLink
          childClip={childClip}
          parentClip={createClip('parent', 'video-2', 5)}
          tracks={tracks}
          zoom={20}
          scrollX={0}
          trackHeaderWidth={200}
          getTrackYPosition={(trackId) => trackId === 'video-1' ? 40 : 120}
        />
      </svg>
    );
  }

  it('stops requesting animation frames once the cable reaches rest', () => {
    renderLink(createClip('child', 'video-1', 1));

    expect(pendingFrames.size).toBe(1);
    const flushedFrames = flushUntilRest();

    expect(flushedFrames).toBeGreaterThan(1);
    expect(flushedFrames).toBeLessThan(500);
    expect(pendingFrames.size).toBe(0);
  });

  it('restarts the simulation when an endpoint moves after reaching rest', () => {
    const childClip = createClip('child', 'video-1', 1);
    const { container, rerender } = renderLink(childClip);
    flushUntilRest();
    const restingPath = container.querySelector('.parent-child-link')?.getAttribute('d');

    rerender(
      <svg>
        <ParentChildLink
          childClip={{ ...childClip, startTime: 3 }}
          parentClip={createClip('parent', 'video-2', 5)}
          tracks={tracks}
          zoom={20}
          scrollX={0}
          trackHeaderWidth={200}
          getTrackYPosition={(trackId) => trackId === 'video-1' ? 40 : 120}
        />
      </svg>
    );

    expect(pendingFrames.size).toBe(1);
    const flushedFrames = flushUntilRest();

    expect(flushedFrames).toBeGreaterThan(1);
    expect(flushedFrames).toBeLessThan(500);
    expect(pendingFrames.size).toBe(0);
    expect(container.querySelector('.parent-child-link')?.getAttribute('d')).not.toBe(restingPath);
  });
});
