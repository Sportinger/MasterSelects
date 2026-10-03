import { describe, expect, it } from 'vitest';
import type { TimelineClip, Keyframe } from '../../src/types';
import { createBuffer } from '../../src/engine/audio/audioBufferFactory';
import { ClipAudioRenderService } from '../../src/services/audio/ClipAudioRenderService';
import { createClipSpeedSource, resolveClipSourceTime } from '../../src/services/timeline/retime/clipRetime';
import { resolveAudioPreviewRetime } from '../../src/services/timeline/retime/clipAudioRetime';
import { prepareExportTrackData } from '../../src/engine/audio/exportPipeline/trackDataPlanning';

function clip(patch: Partial<TimelineClip> = {}): TimelineClip {
  return { id: 'audio-retime', name: 'Ramp', trackId: 'audio', startTime: 5,
    inPoint: 0, outPoint: 1, duration: 1, speed: 1, effects: [], preservesPitch: false,
    ...patch } as TimelineClip;
}
function key(time: number, value: number, hold = false): Keyframe {
  return { id: `speed-${time}`, clipId: 'audio-retime', property: 'speed', time,
    value, hold, easing: 'linear' };
}
function ramp(length = 1024, rate = 1024): AudioBuffer {
  const buffer = createBuffer(1, length, rate);
  buffer.getChannelData(0).set(Float32Array.from({ length }, (_, i) => i / rate));
  return buffer;
}
const renderer = new ClipAudioRenderService({ extractor: {
  trimBuffer(buffer, start, end) {
    const first = Math.floor(start * buffer.sampleRate);
    const last = Math.min(buffer.length, Math.ceil(end * buffer.sampleRate));
    const result = createBuffer(buffer.numberOfChannels, last - first, buffer.sampleRate);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      result.getChannelData(ch).set(buffer.getChannelData(ch).subarray(first, last));
    }
    return result;
  },
} });

describe('clip audio signed retime rendering', () => {
  it.each([false, true])('applies constant-speed XOR, reversed=%s', async reversed => {
    const source = ramp();
    for (const speed of [1, -1]) {
      const result = await renderer.render({ clip: clip({ reversed, speed }), sourceBuffer: source });
      const backwards = reversed !== (speed < 0);
      expect(Array.from(result.buffer.getChannelData(0))).toEqual(
        Array.from(source.getChannelData(0))[backwards ? 'toReversed' : 'slice']());
      expect(source.getChannelData(0)[0]).toBe(0);
    }
  });

  it('trims before reversing and preserves an impulse position', async () => {
    const source = createBuffer(1, 16, 8);
    source.getChannelData(0)[5] = 1;
    const result = await renderer.render({ clip: clip({ inPoint: 0.5, outPoint: 1.5, speed: -1 }), sourceBuffer: source });
    expect(Array.from(result.buffer.getChannelData(0))).toEqual([0, 0, 0, 0, 0, 0, 1, 0]);
  });

  it.each([2, -2])('renders speed %s at half duration', async speed => {
    const result = await renderer.render({ clip: clip({ speed, duration: 0.5 }), sourceBuffer: ramp() });
    expect(result.buffer.duration).toBe(0.5);
    expect(result.buffer.getChannelData(0)[128]).toBeCloseTo(speed > 0 ? 0.25 : 767 / 1024, 6);
  });

  it('uses the shared integral for a ramp with a held keyframe segment', async () => {
    const c = clip({ inPoint: 1, outPoint: 5, duration: 2 });
    const keys = [key(0, 1, true), key(0.5, 2), key(1.5, 1)];
    const source = createClipSpeedSource(c, keys);
    const result = await renderer.render({ clip: c, sourceBuffer: ramp(6144), keyframes: keys });
    for (const time of [0, 0.25, 0.5, 0.75, 1.25, 1.75]) {
      expect(result.buffer.getChannelData(0)[time * 1024]).toBeCloseTo(
        resolveClipSourceTime(c, time, source).sourceTime, 5);
    }
  });

  it('renders turns by signed source position and freezes as silence, even with Keep Pitch', async () => {
    const c = clip({ outPoint: 2, duration: 2, preservesPitch: true });
    const keys = [key(0, 1, true), key(0.5, -1, true), key(1, 0, true), key(1.5, 1)];
    const result = await renderer.render({ clip: c, sourceBuffer: ramp(2048), keyframes: keys });
    expect(result.buffer.duration).toBe(2);
    expect(result.buffer.getChannelData(0)[256]).toBeCloseTo(0.25, 6);
    expect(result.buffer.getChannelData(0)[768]).toBeCloseTo(0.25 - 1 / 1024, 6);
    expect(result.buffer.getChannelData(0)[1280]).toBe(0);
    expect(result.buffer.getChannelData(0)[1792]).toBeCloseTo(0.25, 6);
  });

  it('honors speed bypass without suppressing the reverse mirror', async () => {
    const result = await renderer.render({ clip: clip({ speed: -2, reversed: true,
      videoInspectorSections: { speedChange: false } }), sourceBuffer: ramp(),
      keyframes: [key(0, -2)] });
    expect(result.buffer.duration).toBe(1);
    expect(result.buffer.getChannelData(0)[0]).toBe(1023 / 1024);
  });

  it('does not apply speed twice to an export starting inside the rendered clip', async () => {
    const c = clip({ speed: -2, duration: 0.5 });
    const { buffer } = await renderer.render({ clip: c, sourceBuffer: ramp() });
    const tracks = [{ id: 'audio', name: 'Audio', type: 'audio', visible: true }] as Parameters<typeof prepareExportTrackData>[2];
    const data = prepareExportTrackData([c], new Map([[c.id, buffer]]), tracks, 5.25);
    expect(data[0].sourceOffsetTime).toBe(0.25);
    expect(data[0].buffer.getChannelData(0)[256]).toBe(511 / 1024);
  });
});

describe('audio preview contract and explicit mute policy', () => {
  it.each([1, 2, -1, -2])('shares seek time for speed %s and either mirror', speed => {
    for (const reversed of [false, true]) {
      const c = clip({ speed, reversed, inPoint: 2, outPoint: 6 });
      const source = createClipSpeedSource(c);
      for (const time of [0, 0.125, 0.5]) {
        const preview = resolveAudioPreviewRetime(c, time, source);
        expect(preview.sourceTime).toBe(resolveClipSourceTime(c, time, source).sourceTime);
        expect(Boolean(preview.mutedReason)).toBe(reversed !== (speed < 0));
      }
    }
  });
  it('mutes a curve only where source time is backward, held, or outside the supported rate', () => {
    const c = clip({ outPoint: 4 });
    const source = createClipSpeedSource(c, [key(0, 1, true), key(1, -1, true), key(2, 0)]);
    expect(resolveAudioPreviewRetime(c, 0.5, source).mutedReason).toBeUndefined();
    expect(resolveAudioPreviewRetime(c, 1.5, source).mutedReason).toContain('Backward audio');
    expect(resolveAudioPreviewRetime(c, 2.5, source).mutedReason).toContain('held');
    expect(resolveAudioPreviewRetime(clip({ speed: 8 }), 0).mutedReason).toContain('0.25x');
  });
});
