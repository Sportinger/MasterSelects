import { beforeEach, expect, it, vi } from 'vitest';
import type { ImageOperatorExternalResource } from '../../src/services/operators/imageOperatorExternalResources';
import type { TemporalClipSource } from '../../src/effects/time/temporalClipSource';
const state = vi.hoisted(() => ({ caches: [] as { destroy: ReturnType<typeof vi.fn>; pending: Promise<void> }[] }));
vi.mock('../../src/effects/time/ResidentTemporalRuntime', () => ({ ResidentTemporalRuntime: class {
  resolve() { return { motion: {} }; } release() {} pin() {} destroy() {}
} }));
vi.mock('../../src/effects/time/DisMotionCache', () => ({ DisMotionCache: class {
  pending = new Promise<void>(() => {});
  progress = 'analysing';
  destroy = vi.fn();
  constructor() { state.caches.push(this); }
  resolve() { return undefined; }
} }));
vi.mock('../../src/stores/mediaStore', () => ({ useMediaStore: { getState: () => ({ files: [
  { id: 'video', type: 'video', width: 320, height: 180, fps: 24 },
] }) } }));
vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: { getState: () => ({ isPlaying: false }) } }));
vi.mock('../../src/stores/trackingStore', () => ({ useTrackingStore: { getState: () => ({ assets: [] }) } }));
import { SourceMotionHistory } from '../../src/effects/time/SourceMotionHistory';

beforeEach(() => { state.caches.length = 0; });
it.each([['__slit_geometry_motion', 'motion-band'], ['__slit_geometry_motion', 'motion-surface'], ['motion-scan-dis-source', 'motion-band']])('stops a disabled pending %s in %s, but preserves it across auxiliary graph passes', (owner, mode) => {
  const history = new SourceMotionHistory({ limits: { maxTextureDimension2D: 8192 } } as GPUDevice);
  const source = { mediaId: 'video', duration: 10, inPoint: 0, outPoint: 10, speed: 1, speedKeyframes: [] } as unknown as TemporalClipSource;
  const descriptor: ImageOperatorExternalResource = { id: 'flow', kind: 'source-motion', owner, part: 'atlas',
    lookback: 1, timeFactor: 1, denseInverseSearch: true };
  const resolve = (descriptors: ImageOperatorExternalResource[], active: boolean) => history.resolve(new Map(), descriptors,
    'preview', { id: 'effect', params: { geometryMode: active ? mode : '2d', scanSmoothing: active ? 1 : 0 } },
    source, {} as GPUCommandEncoder, { view: {} as GPUTextureView, width: 320, height: 180 });
  resolve([descriptor],true);
  expect(state.caches).toHaveLength(1);
  resolve([],true);
  expect(state.caches[0].destroy).not.toHaveBeenCalled();
  resolve([],false);
  expect(state.caches[0].destroy).toHaveBeenCalledOnce();
  history.destroy();
});

it('replaces a pending oversized window when Delay changes, but not when playback advances', () => {
  const history = new SourceMotionHistory({ limits: { maxTextureDimension2D: 8192 } } as GPUDevice);
  const descriptor: ImageOperatorExternalResource = { id: 'flow', kind: 'source-motion', owner: '__slit_geometry_motion',
    part: 'atlas', lookback: 60, timeFactor: 1, denseInverseSearch: true };
  const resolve = (lookback: number, localTime: number) => history.resolve(new Map(), [{ ...descriptor, lookback }],
    'preview', { id: 'effect', params: { geometryMode: 'motion-surface' } },
    { mediaId: 'video', localTime, duration: 200, inPoint: 0, outPoint: 200, speed: 1, speedKeyframes: [] },
    {} as GPUCommandEncoder, { view: {} as GPUTextureView, width: 320, height: 180 });
  resolve(60, 100); resolve(60, 101);
  expect(state.caches).toHaveLength(1);
  expect(state.caches[0].destroy).not.toHaveBeenCalled();
  resolve(.5, 101);
  expect(state.caches[0].destroy).toHaveBeenCalledOnce();
  expect(state.caches).toHaveLength(2);
  history.resolve(new Map(), [], 'preview', { id: 'effect', params: { geometryMode: '2d' } }, undefined, {} as GPUCommandEncoder, undefined);
  expect(state.caches[1].destroy).toHaveBeenCalledOnce();
  history.destroy();
});
