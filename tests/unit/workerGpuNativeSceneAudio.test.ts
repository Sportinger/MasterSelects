import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerGpuNativeSceneAudio } from '../../src/services/render/WorkerGpuNativeSceneAudio';
import { WorkerFlockAudioUrlCache } from '../../src/services/render/WorkerFlockAudioUrlCache';
import { flockAudioCurveFingerprint, sampleFlockAudioCurve } from '../../src/engine/flock/runtime/flockAudioCurve';
import { encodeLoudnessCurvePayload } from '../../src/services/audio/loudnessEnvelopeManifest';
import type { TimelineLoudnessCurve } from '../../src/services/audio/timelineLoudnessEnvelopeCache';
import { nativeSceneFixture } from '../fixtures/workerNativeScene';
import { validateWorkerGpuFrameStackContract } from '../../src/services/render/workerGpuFrameStackContract';

const curve: TimelineLoudnessCurve = { metric: 'momentary-lufs', windowDuration: 0.4, hopDuration: 0.1,
  pointCount: 5, values: new Float32Array([-60, -30, 0, -15, -Infinity]) };
const bytes = encodeLoudnessCurvePayload({ header: { schemaVersion: 1, metric: curve.metric,
  windowDuration: curve.windowDuration, hopDuration: curve.hopDuration, pointCount: curve.pointCount,
  valueLayout: 'time-series', valueEncoding: 'db' }, values: curve.values });
function fixture(offset = 0) {
  const fixture = nativeSceneFixture();
  const input = { clipId: 'music', sourceOffset: offset, curve: { url: 'blob:https://localhost/audio',
    fingerprint: flockAudioCurveFingerprint(curve), byteLength: bytes.byteLength } };
  Object.assign(fixture.payload.layers[0], { audioInputs: [input] });
  return { ...fixture, input };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Worker audio snapshots', () => {
  it('matches main sampling and smoothing through different source placements and reverse seeks', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, arrayBuffer: async () => bytes }));
    vi.stubGlobal('fetch', fetchMock);
    const owner = new WorkerGpuNativeSceneAudio();
    const data = fixture(0.1);
    expect(validateWorkerGpuFrameStackContract(data.stack, data.admission).ok).toBe(true);
    await owner.prepare(data.payload.layers, () => {});
    const sample = owner.sampler('particles');
    for (const time of [-1, 0, 0.4, 0.2, 0.05, 1]) for (const smoothing of [0, 0.05, 0.3, 8]) {
      expect(sample('music', time, smoothing)).toBe(sampleFlockAudioCurve(curve, time + 0.1, smoothing));
    }
    const fingerprint = owner.fingerprint('particles', ['music']);
    data.input.sourceOffset = 0.2;
    await owner.prepare(data.payload.layers, () => {});
    expect(owner.fingerprint('particles', ['music'])).not.toBe(fingerprint);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sample('music', 0, 0)).toBe(1);
    owner.dispose();
    expect(sample('music', 0, 0)).toBeNull();
  });

  it('accepts explicitly unavailable analysis but rejects an omitted required input', async () => {
    const data = fixture(); Object.assign(data.input, { curve: null });
    const owner = new WorkerGpuNativeSceneAudio();
    await owner.prepare(data.payload.layers, () => {});
    expect(() => owner.require('particles', ['music'])).not.toThrow();
    expect(owner.sampler('particles')('music', 0.1, 0)).toBeNull();
    expect(() => owner.require('particles', ['missing'])).toThrow('not projected');
  });

  it('rejects corrupt or substituted analysis content', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => bytes })));
    const data = fixture(); data.input.curve.fingerprint = 'wrong';
    await expect(new WorkerGpuNativeSceneAudio().prepare(data.payload.layers, () => {})).rejects.toThrow('fingerprint mismatch');
    data.input.curve.byteLength++;
    await expect(new WorkerGpuNativeSceneAudio().prepare(data.payload.layers, () => {})).rejects.toThrow('length mismatch');
  });

  it.each(['offset', 'duplicate', 'url', 'size'])('rejects malformed audio admission: %s', kind => {
    const data = fixture();
    if (kind === 'offset') data.input.sourceOffset = NaN;
    if (kind === 'duplicate') Object.assign(data.payload.layers[0], { audioInputs: [data.input, data.input] });
    if (kind === 'url') data.input.curve.url = 'https://example.com/audio';
    if (kind === 'size') data.input.curve.byteLength = 1e10;
    expect(validateWorkerGpuFrameStackContract(data.stack, data.admission).ok).toBe(false);
  });

  it('retains host URLs until the last referencing frame expires and reuses immutable curves', () => {
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() }));
    const cache = new WorkerFlockAudioUrlCache();
    const a = cache.reference(curve, 1000), b = cache.reference(curve, 3000);
    expect(a).toBe(b);
    cache.prune(2001);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    cache.prune(4001);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });
});
