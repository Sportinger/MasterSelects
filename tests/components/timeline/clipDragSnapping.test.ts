import { describe, expect, it } from 'vitest';
import { findSweptClipSnap, type ClipDragSnapResult } from '../../../src/components/timeline/utils/clipDragSnapping';

function createSnapper(...targets: number[]) {
  return (_clipId: string, desiredStartTime: number, _trackId: string): ClipDragSnapResult => {
    const target = targets.find(candidate => Math.abs(candidate - desiredStartTime) < 0.15);
    return target === undefined
      ? { startTime: desiredStartTime, snapped: false, snapEdgeTime: 0 }
      : { startTime: target, snapped: true, snapEdgeTime: target };
  };
}

describe('clipDragSnapping', () => {
  it('detects a snap point crossed between mousemove events', () => {
    const result = findSweptClipSnap({
      clipId: 'clip-1',
      previousX: 0,
      currentX: 50,
      trackId: 'video-1',
      pixelToTime: pixel => pixel / 10,
      getSnappedPosition: createSnapper(2),
    });

    expect(result).toMatchObject({
      startTime: 2,
      snapped: true,
      snapEdgeTime: 2,
    });
  });

  it('uses the latest crossed snap point in the drag direction', () => {
    const result = findSweptClipSnap({
      clipId: 'clip-1',
      previousX: 0,
      currentX: 50,
      trackId: 'video-1',
      pixelToTime: pixel => pixel / 10,
      getSnappedPosition: createSnapper(2, 4),
    });

    expect(result?.startTime).toBe(4);
  });

  it('returns null when the swept drag path does not cross a snap point', () => {
    const result = findSweptClipSnap({
      clipId: 'clip-1',
      previousX: 0,
      currentX: 10,
      trackId: 'video-1',
      pixelToTime: pixel => pixel / 10,
      getSnappedPosition: createSnapper(4),
    });

    expect(result).toBeNull();
  });
});
