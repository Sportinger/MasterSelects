import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFlockAudioSampler, getFlockAudioFingerprint, resolveFlockAudioInput } from '../../src/engine/flock/runtime/flockAudioSampler';

const state = vi.hoisted(() => ({ clips: [] as any[], envelope: null as any }));
vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: { getState: () => ({ clips: state.clips }) } }));
vi.mock('../../src/stores/mediaStore', () => ({ useMediaStore: { getState: () => ({ files: [{ id: 'media', audioAnalysisRefs: { loudnessEnvelopeId: 'analysis' } }] }) } }));
vi.mock('../../src/services/render/renderHostPort', () => ({ renderHostPort: { requestRender: vi.fn() } }));
vi.mock('../../src/services/audio/timelineLoudnessEnvelopeCache', () => ({ getCachedTimelineLoudnessEnvelope: () => state.envelope, loadTimelineLoudnessEnvelope: async () => null }));

describe('Flock audio placement', () => {
  beforeEach(() => {
    state.clips = [{ id: 'flock', startTime: 10, inPoint: 2 }, { id: 'music', startTime: 5, inPoint: 1, mediaFileId: 'media' }];
    state.envelope = { curves: [{ metric: 'momentary-lufs', hopDuration: 1, windowDuration: 1, pointCount: 8,
      values: new Float32Array([-60, -60, -60, -60, -60, -60, -30, 0]) }] };
  });
  it('maps Flock source time through both clip trims and smooths previous samples', () => {
    const sample = createFlockAudioSampler('flock');
    expect(sample('music', 2, 0)).toBe(0.5);
    expect(sample('music', 3, 0)).toBe(1);
    expect(sample('music', 2, 2)).toBe(0.25);
  });
  it('uses explicit nested placements without reading the root timeline', () => {
    const nested = [{ id: 'flock', startTime: 0, inPoint: 0 }, { id: 'music', startTime: 3, inPoint: 1, mediaFileId: 'media' }] as any;
    expect(resolveFlockAudioInput('flock', 'music', nested).sourceOffset).toBe(-2);
  });
  it('changes cache identity for placement or analysis replacement and reports missing analysis', () => {
    const a = getFlockAudioFingerprint('flock', ['music']);
    state.clips[1].startTime++;
    const b = getFlockAudioFingerprint('flock', ['music']);
    expect(b).not.toBe(a);
    state.envelope.curves = [{ ...state.envelope.curves[0], values: new Float32Array(8).fill(-60) }];
    expect(getFlockAudioFingerprint('flock', ['music'])).not.toBe(b);
    state.envelope = null;
    expect(createFlockAudioSampler('flock', { loadMissing: false })('music', 2, 0)).toBeNull();
    expect(createFlockAudioSampler('flock')('unknown', 2, 0)).toBeNull();
  });
});
