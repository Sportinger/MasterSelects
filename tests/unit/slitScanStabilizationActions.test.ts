import { beforeEach, expect, it, vi } from 'vitest';
import type { ClipMask } from '../../src/types/masks';
import type { SurfaceQuad } from '../../src/types/planarTracking';
import type { TimelineClip } from '../../src/types/timeline';

const runtime = vi.hoisted(() => ({ timeline: {} as any, media: {} as any, track: vi.fn(),
  startBatch: vi.fn(), endBatch: vi.fn(), render: vi.fn() }));
vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: { getState: () => runtime.timeline } }));
vi.mock('../../src/stores/mediaStore', () => ({ useMediaStore: { getState: () => runtime.media } }));
vi.mock('../../src/stores/historyStore', () => ({ useHistoryStore: { getState: () => runtime } }));
vi.mock('../../src/services/planarTracking/trackSurface', () => ({ trackSurface: runtime.track }));
vi.mock('../../src/services/render/renderHostPort', () => ({ renderHostPort: { requestRender: runtime.render } }));

import { trackSlitScanObject } from '../../src/services/planarTracking/slitScanStabilizationActions';
import { slitScanProtectionMask } from '../../src/services/planarTracking/slitScanProtectionMask';
import { useTrackingStore } from '../../src/stores/trackingStore';

const quad: SurfaceQuad = [{ x: .2, y: .2 }, { x: .5, y: .2 }, { x: .5, y: .6 }, { x: .2, y: .6 }];
const sample = (time: number) => ({ time, duration: 1 / 30, quad, confidence: 1 });

function clip(): TimelineClip { return runtime.timeline.clips[0]; }
const params = () => clip().effects[0].params;
const run = (signal = new AbortController().signal) => trackSlitScanObject('clip', 'slit', 30, signal, vi.fn());

beforeEach(() => {
  vi.clearAllMocks(); runtime.track.mockReset();
  useTrackingStore.getState().reset();
  const mask = { id: 'selection', ...slitScanProtectionMask(quad, 0), compositeEnabled: true } as ClipMask;
  runtime.timeline = {
    clips: [{ id: 'clip', name: 'Video', source: { type: 'video', mediaFileId: 'media' },
      inPoint: 0, outPoint: 2, duration: 2, startTime: 10, trackId: 'video', masks: [mask],
      effects: [{ id: 'slit', type: 'slit-scan', params: { protectionMask: 'selection' } }] }],
    tracks: [{ id: 'video', locked: false }], playheadPosition: 11, isExporting: false,
    pause: vi.fn(), getClipKeyframes: () => [], getInterpolatedMasks: () => clip().masks,
    updateClipEffect: vi.fn((_clip, _effect, patch) => Object.assign(params(), patch)),
    updateMask: vi.fn((_clip, id, patch) => Object.assign(clip().masks!.find(m => m.id === id)!, patch)),
    addMask: vi.fn((_clip, data) => { clip().masks!.push({ id: 'protection', ...data }); return 'protection'; }),
  };
  runtime.media = { files: [{ id: 'media', width: 1920, height: 1080, fps: 30, url: 'blob:source' }],
    activeCompositionId: 'comp', compositions: [{ id: 'comp' }] };
  let batchOpen = false;
  runtime.startBatch.mockImplementation(() => { const opened = !batchOpen; batchOpen = true; return { opened }; });
  runtime.endBatch.mockImplementation(() => { batchOpen = false; });
  runtime.track.mockImplementation(async request => ({ samples: request.to > request.from
    ? [sample(1), sample(2)] : [sample(0), sample(1)] }));
});

it('tracks both directions automatically and publishes one reference mask with the canonical asset', async () => {
  expect(await run()).toContain('3 frames tracked');
  expect(runtime.track.mock.calls.map(([r]) => [r.from, r.to])).toEqual([[1, 2], [1, 0]]);
  const asset = useTrackingStore.getState().assets[0];
  expect(asset.track.samples.map(s => s.time)).toEqual([0, 1, 2]);
  expect(asset.track.referenceTime).toBe(1);
  expect(asset.track.enabled).toBe(false); // No visible tracking-marker overlay.
  expect(params()).toMatchObject({ stabilizationAssetId: asset.id, stabilizationReference: 1,
    protectionMask: 'protection', maskStrength: 1 });
  expect(clip().masks).toHaveLength(2);
  expect(clip().masks![0].compositeEnabled).toBe(false);
  expect(clip().masks![1]).toMatchObject({ feather: 30, compositeEnabled: false, enabled: true });
  expect(runtime.endBatch).toHaveBeenCalledOnce();
});

it('publishes nothing when tracking is cancelled', async () => {
  const controller = new AbortController();
  runtime.track.mockImplementation(async () => { controller.abort(); throw new DOMException('Cancelled', 'AbortError'); });
  await expect(run(controller.signal)).rejects.toThrow('Cancelled');
  expect(runtime.timeline.addMask).not.toHaveBeenCalled();
  expect(runtime.timeline.updateClipEffect).not.toHaveBeenCalled();
  expect(useTrackingStore.getState().assets).toEqual([]);
  expect(runtime.startBatch).not.toHaveBeenCalled();
});

it('keeps concurrent selection edits instead of publishing a stale tracking result', async () => {
  runtime.track.mockImplementation(async () => {
    clip().masks![0].position = { x: .1, y: 0 };
    return { samples: [sample(1), sample(2)] };
  });
  await expect(run()).rejects.toThrow(/selection.*changed/);
  expect(clip().masks![0].position.x).toBe(.1);
  expect(runtime.timeline.updateClipEffect).not.toHaveBeenCalled();
  expect(useTrackingStore.getState().assets).toEqual([]);
});

it('reports partial coverage and refuses to edit locked or exporting clips', async () => {
  runtime.timeline.tracks[0].locked = true;
  await expect(run()).rejects.toThrow(/locked/);
  runtime.timeline.tracks[0].locked = false;
  runtime.timeline.isExporting = true;
  await expect(run()).rejects.toThrow(/exported/);
  expect(runtime.track).not.toHaveBeenCalled();
  runtime.timeline.isExporting = false;
  runtime.track.mockResolvedValue({ samples: [sample(1), sample(2)], stopped: 'Object lost' });
  expect(await run()).toContain('Coverage stopped: Object lost');
});

it('rejects an animated selection change even when the base mask stays the same', async () => {
  runtime.track.mockImplementation(async () => {
    runtime.timeline.getInterpolatedMasks = () => [{ ...clip().masks![0], rotation: 45 }];
    return { samples: [sample(1), sample(2)] };
  });
  await expect(run()).rejects.toThrow(/selection.*changed/);
  expect(useTrackingStore.getState().assets).toEqual([]);
});
