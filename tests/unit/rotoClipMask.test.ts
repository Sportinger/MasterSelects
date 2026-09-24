import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: {} }));
vi.mock('../../src/stores/historyStore', () => ({ useHistoryStore: {} }));
vi.mock('../../src/stores/mediaStore', () => ({ useMediaStore: {} }));
import { rotoMaskVertices } from '../../src/services/roto/rotoContour';
import { bakeRotoClipMask } from '../../src/services/roto/rotoClipMask';
import { trackingTimelineTime } from '../../src/services/planarTracking/trackingTimelineTime';
import { getInterpolatedMaskPathValue } from '../../src/stores/timeline/keyframes/pathKeyframeValues';
import type { TimelineClip } from '../../src/types/timeline';
import type { RotoMask } from '../../src/services/roto/rotoTypes';
import type { Keyframe } from '../../src/types/keyframes';

const edges = { offset: 0, softness: 0 };
const clip = { id: 'clip', startTime: 4, duration: 2, inPoint: 10, outPoint: 12, speed: 1 } as TimelineClip;
const frame = (time: number, duration = .25): RotoMask => ({ time, duration, width: 2, height: 2, data: Uint8Array.of(255, 0, 0, 0) });
function winding(points: { x: number; y: number }[], x: number, y: number) {
  let value = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const cross = (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y);
    if (a.y <= y && b.y > y && cross > 0) value++;
    if (a.y > y && b.y <= y && cross < 0) value--;
  }
  return value !== 0;
}
describe('Roto conversion to editable clip masks', () => {
  it('preserves every pixel of holes, islands, diagonal contacts and border selections', () => {
    const patterns = ['11111/10001/10101/10001/11111', '101/010/101', '000/000/000', '111/111/111'];
    for (const pattern of patterns) {
      const rows = pattern.split('/'), width = rows[0].length, height = rows.length;
      const data = Uint8Array.from(rows.join(''), v => v === '1' ? 255 : 0);
      const vertices = rotoMaskVertices({ time: 0, duration: 1, width, height, data }, edges, 'mask');
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
        expect(winding(vertices, (x + .5) / width, (y + .5) / height)).toBe(data[y * width + x] > 0);
    }
  });
  it('creates held paths with empty coverage before, between and after tracked frames', () => {
    const result = bakeRotoClipMask(clip, [frame(10.5), frame(11.25)], { offset: 0, softness: 2 }, 4, [], 'mask');
    expect(result.mask.mode).toBe('intersect'); expect(result.mask.feather).toBe(2);
    for (const time of [0, .5, .75, 1.25, 1.5]) {
      const path = getInterpolatedMaskPathValue(result.keys, 'mask.mask.path', time, { closed: true, vertices: [] });
      expect(winding(path.vertices, .25, .25)).toBe(time === .5 || time === 1.25);
    }
    expect(result.keys.every(k => k.hold)).toBe(true);
  });
  it('bakes reverse playback and speed keyframes using source timestamps', () => {
    const reverse = { ...clip, speed: -1 };
    const result = bakeRotoClipMask(reverse, [frame(11.25)], edges, 4, [], 'mask');
    expect(result.keys.find(k => k.pathValue!.vertices[0].x >= 0)?.time).toBe(.75);
    const speedKeys = [{ id: 'speed', clipId: 'clip', property: 'speed', time: 0, value: 2, easing: 'linear' }] as Keyframe[];
    const fast = bakeRotoClipMask(clip, [frame(10.5)], edges, 4, speedKeys, 'mask');
    expect(fast.keys.find(k => k.pathValue!.vertices[0].x >= 0)?.time).toBe(.25);
  });
  it('refuses empty coverage and excessively long clips before applying edits', () => {
    expect(() => bakeRotoClipMask(clip, [frame(1)], edges, 30, [], 'mask')).toThrow('No tracked');
    expect(() => bakeRotoClipMask({ ...clip, duration: 1000 }, [], edges, 30, [], 'mask')).toThrow('18,000');
  });
  it('follows forward and backward source frames at the correct timeline position', () => {
    expect(trackingTimelineTime(clip, frame(10.5), [], 4, 4)).toBe(4.5);
    expect(trackingTimelineTime({ ...clip, speed: -1 }, frame(11.25), [], 4, 4)).toBe(4.75);
  });
});
