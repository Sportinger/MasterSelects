import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ assets: [] as any[], resolve: vi.fn() }));
vi.mock('../../src/stores/mediaStore', () => ({ useMediaStore: { getState: () => ({ proxyEnabled: true, files: [{ id: 'media', type: 'video', width: 100, height: 100 }] }) } }));
vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: { getState: () => ({ isPlaying: true }) } }));
vi.mock('../../src/stores/trackingStore', () => ({ useTrackingStore: { getState: () => ({ assets: state.assets }) } }));
vi.mock('../../src/effects/time/SlitScanMaskRuntime', () => ({ SlitScanMaskRuntime: class { destroy() {} } }));
vi.mock('../../src/effects/time/TimeMapMediaRuntime', () => ({ TimeMapMediaRuntime: class { destroy() {} } }));
vi.mock('../../src/effects/time/SourceTemporalRuntime', async importOriginal => ({
  ...await importOriginal<any>(), SourceTemporalRuntime: class { resolve = state.resolve; destroy() {} },
}));
import { TemporalEffectResources } from '../../src/effects/time/TemporalEffectResources';
import { collectTemporalPreparations, getTemporalStatus, recordTemporalPreparation } from '../../src/effects/time/temporalResourcePreparation';

afterEach(() => vi.clearAllMocks());
it('keeps Slit Scan active after a track edit removes the reference and resumes correction when restored', () => {
  const quad = [{ x: .2, y: .2 }, { x: .4, y: .2 }, { x: .4, y: .4 }, { x: .2, y: .4 }];
  const sample = { time: 2, duration: 1, quad, confidence: 1 };
  const track = { enabled: true, fps: 1, sourceId: 'media', referenceTime: 2, samples: [sample] };
  state.assets = [{ id: 'track', sourceMediaId: 'media', revision: 2, track }];
  const effect = { id: 'effect', type: 'slit-scan', params: { delay: 0, stabilizationAssetId: 'track', stabilizationReference: 5 } };
  const source = { mediaId: 'media', localTime: 2, duration: 10, inPoint: 0, outPoint: 10, speed: 1, speedKeyframes: [] };
  const input = { view: {} as GPUTextureView, width: 100, height: 100 };
  const history = { atlas: { view: {} }, ages: { view: {} } };
  state.resolve.mockReturnValue(history);
  const resources = new TemporalEffectResources({} as GPUDevice);
  const render = () => resources.resolveNative(effect, 'clip', source, {} as GPUCommandEncoder, input);
  for (let i = 0; i < 3; i++) {
    expect(render()?.current?.view).toBe(input.view);
    expect(state.resolve.mock.calls.at(-1)![0].stabilization).toBeUndefined();
    expect(getTemporalStatus('effect')).toContain('Slit Scan remains active');
  }
  // No attempted stabilized allocation may invalidate the fallback cache.
  expect(state.resolve).toHaveBeenCalledTimes(3);
  const finish = collectTemporalPreparations();
  try {
    expect(render()?.current?.view).toBe(input.view);
    expect(state.resolve.mock.calls.at(-1)![0].stabilization).toBeUndefined();
  } finally { finish(); }
  track.samples.push({ ...sample, time: 5 });
  state.assets[0].revision++;
  render();
  expect(state.resolve.mock.calls.at(-1)![0].stabilization).toBeDefined();
  resources.destroy();
});

it('exports an uncovered sample window with the same fallback and retains the frame preparation barrier', async () => {
  const quad = [{ x: .2, y: .2 }, { x: .4, y: .2 }, { x: .4, y: .4 }, { x: .2, y: .4 }];
  state.assets = [{ id: 'track', sourceMediaId: 'media', revision: 1, track: {
    enabled: true, fps: 30, sourceId: 'media', referenceTime: 0,
    samples: [{ time: 0, duration: 1, quad, confidence: 1 }],
  } }];
  const prepared = Promise.resolve();
  state.resolve.mockImplementation(() => {
    recordTemporalPreparation(prepared);
    return { atlas: { view: {} }, ages: { view: {} } };
  });
  const resources = new TemporalEffectResources({} as GPUDevice);
  const input = { view: {} as GPUTextureView, width: 100, height: 100 };
  const finish = collectTemporalPreparations();
  try {
    const result = resources.resolveNative({ id: 'gap', type: 'slit-scan', params: { stabilizationAssetId: 'track', delay: 1 } },
      'clip', { mediaId: 'media', localTime: 3.625, duration: 10, inPoint: 0, outPoint: 10, speed: 1, speedKeyframes: [] },
      {} as GPUCommandEncoder, input);
    expect(result?.current?.view).toBe(input.view);
    expect(state.resolve.mock.calls.at(-1)![0]).toMatchObject({ stabilization: undefined, useProxy: false });
    expect(getTemporalStatus('gap')).toContain('sample-gap');
  } finally {
    const pending = finish();
    expect(pending).toEqual([prepared]);
    await Promise.all(pending);
    resources.destroy();
  }
});
