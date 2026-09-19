import { describe, expect, it, vi } from 'vitest';
import { createAutomaticCutDeClickOperation } from '../../../src/services/audio/automaticCutDeClick';
import { scheduleAutomaticCutFades } from '../../../src/services/audio/automaticCutFadePlayback';
import { getClipAudioEditPreviewVolumeMultiplier } from '../../../src/services/audio/clipAudioEditPreview';
import { syncMediaCutFades } from '../../../src/services/audio/routing/mediaCutFades';
import { createMockClip } from '../../helpers/mockData';

function fixture() {
  const clip = createMockClip({ inPoint: 2, outPoint: 3, duration: 1, startTime: 0 });
  clip.audioState = { editStack: (['in', 'out'] as const).map(edge => (
    createAutomaticCutDeClickOperation(clip, edge, 0.008, { id: edge, createdAt: 0 })!
  )) };
  const events: { value: number; time: number }[] = [];
  const gain = {
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn((value, time) => events.push({ value, time })),
    linearRampToValueAtTime: vi.fn((value, time) => events.push({ value, time })),
  } as unknown as AudioParam;
  return { clip, gain, events };
}

describe('automatic fade playback on the audio clock', () => {
  it('schedules both complete 8ms fades even with no subsequent display frame', () => {
    const { clip, gain, events } = fixture();
    scheduleAutomaticCutFades(gain, clip, 2, 10);
    expect(events[0]).toEqual({ value: 0, time: 10 });
    expect(events.some(event => Math.abs(event.time - 10.004) < 1e-8 && Math.abs(event.value - 0.5) < 1e-8)).toBe(true);
    expect(events.some(event => Math.abs(event.time - 10.996) < 1e-8 && Math.abs(event.value - 0.5) < 1e-8)).toBe(true);
    expect(events.at(-1)).toEqual({ value: 0, time: 11 });
    expect(getClipAudioEditPreviewVolumeMultiplier(clip, 2, null, true)).toBe(1);
    expect(getClipAudioEditPreviewVolumeMultiplier(clip, 2)).toBe(0);
  });

  it('respects playback speed and protects starts that occur after the original fade', () => {
    const { clip, gain, events } = fixture();
    scheduleAutomaticCutFades(gain, clip, 2.1, 10, 2, true);
    expect(events[0]).toEqual({ value: 0, time: 10 });
    expect(events[1].time).toBeCloseTo(10.003, 8);
    expect(events[1].value).toBeCloseTo(1, 8);
    expect(events.at(-1)?.time).toBeCloseTo(10.45, 8);
    expect(events.at(-1)?.value).toBe(0);
  });

  it('keeps scheduled automation across frames and replaces it after a seek or pause', () => {
    const { clip, gain } = fixture();
    const context = { currentTime: 10 } as AudioContext;
    const element = { currentTime: 2, playbackRate: 1, paused: false, seeking: false } as HTMLMediaElement;
    syncMediaCutFades(gain, context, element, clip);
    const initialCalls = vi.mocked(gain.cancelScheduledValues).mock.calls.length;
    Object.assign(context, { currentTime: 10.02 });
    element.currentTime = 2.02;
    syncMediaCutFades(gain, context, element, clip);
    expect(gain.cancelScheduledValues).toHaveBeenCalledTimes(initialCalls);
    element.currentTime = 2.5;
    syncMediaCutFades(gain, context, element, clip);
    expect(gain.cancelScheduledValues).toHaveBeenCalledTimes(initialCalls + 1);
    syncMediaCutFades(gain, context, element, null);
    expect(gain.setValueAtTime).toHaveBeenLastCalledWith(1, 10.02);
  });
});
