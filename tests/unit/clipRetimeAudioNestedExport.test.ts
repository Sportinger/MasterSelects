import { describe, expect, it, vi } from 'vitest';
import type { Keyframe, TimelineClip } from '../../src/types';
import { createBuffer } from '../../src/engine/audio/audioBufferFactory';
import { ClipAudioRenderService } from '../../src/services/audio/ClipAudioRenderService';
import { trimNestedAudioSourceRange } from '../../src/engine/audio/exportPipeline/nestedAudioSourceRange';
import { AudioExportSourceStage } from '../../src/engine/audio/exportPipeline/sourceStage';

const mixdown = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../src/services/timeline/compositionAudioMixdownCache', () => ({ requestCompositionAudioMixdown: mixdown.request }));
vi.mock('../../src/services/timeline/compositionAudioMixdownTimelineState', () => ({ applyCompositionAudioMixdownToTimelineClip: vi.fn() }));
vi.mock('../../src/services/export/audioExportMediaStoreAdapter', () => ({ readAudioExportMediaFiles: () => [] }));

function parent(patch: Partial<TimelineClip> = {}): TimelineClip {
  return { id: 'nested-audio', name: 'Nested', compositionId: 'child', isComposition: true,
    trackId: 'audio', startTime: 10, duration: 2, inPoint: 1, outPoint: 5, speed: 2,
    reversed: true, preservesPitch: false, effects: [], source: { type: 'audio' }, ...patch } as TimelineClip;
}
function ramp() {
  const buffer = createBuffer(1, 64, 8);
  buffer.getChannelData(0).set(Float32Array.from({ length: 64 }, (_, i) => i / 64));
  return buffer;
}

describe('nested parent audio source admission', () => {
  it.each([{ speed: 2, reversed: true }, { speed: -2, reversed: false }])('keeps the high endpoint for $speed / reversed=$reversed', async patch => {
    const clip = parent(patch);
    mixdown.request.mockResolvedValue({ buffer: ramp(), hasAudio: true });
    const preTrimmed = new Set<string>();
    const stage = new AudioExportSourceStage({ extractor: {} as never, sampleRate: 8,
      shouldCancel: () => false, preTrimmedClipIds: preTrimmed, clipKeyframes: new Map(),
      retainSourceBuffer: vi.fn(), suspendPreviewAudioBuffer: vi.fn() });
    // Export only the first 0.5 seconds. Backward audio still starts near source 5s.
    const sources = await stage.extract([clip], [], undefined, 10.5);
    const source = sources.get(clip.id)!;
    expect(source.duration).toBe(4);
    expect(preTrimmed.has(clip.id)).toBe(true);
    const rendered = await new ClipAudioRenderService().render({ clip, sourceBuffer: source, sourceIsClipRange: true });
    expect(rendered.buffer.duration).toBe(2);
    expect(Array.from(rendered.buffer.getChannelData(0).slice(0, 4))).toEqual([39, 37, 35, 33].map(value => value / 64));
  });
  it('bounds a forward 2x prefix and keeps conservative bounds for a direction-changing curve', () => {
    const clip = parent({ reversed: false });
    expect(trimNestedAudioSourceRange(clip, ramp(), [], 10.5).duration).toBe(1);
    const keys: Keyframe[] = [
      { id: 's0', clipId: clip.id, property: 'speed', time: 0, value: -2, hold: true, easing: 'linear' },
      { id: 's1', clipId: clip.id, property: 'speed', time: 1, value: 2, easing: 'linear' },
    ];
    const source = trimNestedAudioSourceRange(clip, ramp(), keys, 10.5);
    expect(source.duration).toBe(4);
    expect(source.getChannelData(0)[31]).toBe(39 / 64);
  });
});
