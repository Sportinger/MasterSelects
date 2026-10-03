import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Keyframe, TimelineClip } from '../../src/types';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { AudioExportSourceStage } from '../../src/engine/audio/exportPipeline/sourceStage';
import { renderExportClipAudioEffects } from '../../src/engine/audio/exportPipeline/effectStage';
import { getExportClipSourceRange } from '../../src/engine/audio/exportPipeline/clipSourceRange';
import { ClipAudioRenderService } from '../../src/services/audio/ClipAudioRenderService';
import { renderAudioGraph } from '../../src/engine/audio/AudioGraphRenderer';
import { createBuffer } from '../../src/engine/audio/audioBufferFactory';
import { createClipSpeedSource, resolveClipSourceTime } from '../../src/services/timeline/retime/clipRetime';

const fixture = vi.hoisted(() => ({ wav: new ArrayBuffer(0), files: [] as unknown[], read: vi.fn(), nested: vi.fn() }));
vi.mock('../../src/services/export/audioExportMediaStoreAdapter', () => ({ readAudioExportMediaFiles: () => fixture.files }));
vi.mock('../../src/services/timeline/compositionAudioMixdownCache', () => ({ requestCompositionAudioMixdown: fixture.nested }));
vi.mock('../../src/services/timeline/compositionAudioMixdownTimelineState', () => ({ applyCompositionAudioMixdownToTimelineClip: vi.fn() }));
vi.mock('../../src/engine/audio/exportPipeline/WavPcmRangeReader', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/engine/audio/exportPipeline/WavPcmRangeReader')>(),
  createUrlAudioByteRangeSource: () => ({ size: fixture.wav.byteLength, read: async (start: number, end: number) => fixture.wav.slice(start, end) }),
}));
vi.mock('../../src/engine/audio/exportPipeline/MediaAudioRangeReader', () => ({
  MediaAudioRangeReader: class { read = fixture.read; dispose() {} },
}));

const rate = 32;
const track = createMockTrack({ id: 'audio', type: 'audio' });
function sourceBuffer() {
  const buffer = createBuffer(1, rate * 12, rate);
  buffer.getChannelData(0).set(Float32Array.from({ length: buffer.length }, (_, i) => i / 512));
  return buffer;
}
function createWav() {
  const source = sourceBuffer();
  const data = new ArrayBuffer(44 + source.length * 4), view = new DataView(data);
  const text = (offset: number, value: string) => [...value].forEach((letter, i) => view.setUint8(offset + i, letter.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, data.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 3, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 32, true);
  text(36, 'data'); view.setUint32(40, source.length * 4, true);
  source.getChannelData(0).forEach((sample, i) => view.setFloat32(44 + i * 4, sample, true));
  return data;
}
function clip(patch: Partial<TimelineClip> = {}) {
  return createMockClip({ id: 'audio', name: 'Retime audio', trackId: track.id, startTime: 5,
    duration: 7, inPoint: 2, outPoint: 4, speed: 1, preservesPitch: false,
    mediaFileId: 'media', source: { type: 'audio', naturalDuration: 12, mediaFileId: 'media' }, ...patch });
}
beforeEach(() => {
  vi.clearAllMocks();
  fixture.wav = createWav();
  fixture.files = [{ id: 'media', name: 'audio.wav', duration: 12, audioProxyStatus: 'ready', audioProxyUrl: '/test.wav' }];
  fixture.nested.mockResolvedValue({ buffer: sourceBuffer(), hasAudio: true });
  fixture.read.mockImplementation(async (start: number, end: number) => {
    const source = sourceBuffer(), first = Math.floor(start * rate), last = Math.ceil(end * rate);
    const result = createBuffer(1, Math.max(1, last - first), rate);
    result.getChannelData(0).set(source.getChannelData(0).subarray(first, last));
    return result;
  });
});

async function acquireAndRender(c: TimelineClip, keys: Keyframe[] = []) {
  const preTrimmedClipIds = new Set<string>(), sourceBufferStarts = new Map<string, number>();
  const extractor = { createSilentBuffer: vi.fn(), extractAudio: vi.fn(), extractFromElement: vi.fn() };
  const stage = new AudioExportSourceStage({ extractor: extractor as never, sampleRate: rate,
    shouldCancel: () => false, preTrimmedClipIds, sourceBufferStarts, clipKeyframes: new Map([[c.id, keys]]),
    retainSourceBuffer: vi.fn(), suspendPreviewAudioBuffer: vi.fn() });
  // Even a short export prefix needs the whole clip source window: rendering owns
  // the complete clip clock, and output cropping happens later in the mixer.
  const buffers = await stage.extract([c], [track], undefined, c.startTime + 0.25);
  const renderer = new ClipAudioRenderService();
  const render = vi.spyOn(renderer, 'render');
  const output = await renderExportClipAudioEffects({ clips: [c], buffers, preTrimmedClipIds, sourceBufferStarts,
    clipKeyframes: new Map([[c.id, keys]]), audioGraphPlan: renderAudioGraph({ clips: [c], tracks: [track], mode: 'export' }),
    clipAudioRenderer: renderer, graphEffectRenderer: {} as never, shouldCancel: () => false,
    assertAudioBufferAdmission: vi.fn(), reportAudioBuffer: () => true });
  expect(extractor.createSilentBuffer).not.toHaveBeenCalled();
  expect(render).toHaveBeenCalledWith(expect.objectContaining({ sourceBufferStart: sourceBufferStarts.get(c.id), sourceIsClipRange: true }));
  return { buffer: output.get(c.id)!, acquired: buffers.get(c.id)!, origin: sourceBufferStarts.get(c.id)! };
}

describe('contract-driven export audio acquisition', () => {
  it.each(['proxy', 'direct', 'nested'])('renders a Warp backward segment outside in/out via %s acquisition', async transport => {
    const c = clip({ timeRemap: { kind: 'warp', points: [
      { time: 0, source: 6.25 }, { time: 2, source: 8.25 }, { time: 4, source: 1.25 }, { time: 6, source: 1.25 },
    ] } });
    if (transport === 'direct') fixture.files = [{ id: 'media', duration: 1000, file: new File(['audio'], 'long.mp4') }];
    if (transport === 'nested') c.isComposition = true;
    const result = await acquireAndRender(c);
    expect(result.origin).toBe(1.25);
    expect(result.acquired.duration).toBe(7 + 1 / rate);
    expect(result.buffer.duration).toBe(c.duration);
    for (let i = 0; i < result.buffer.length; i++) {
      const sample = resolveClipSourceTime(c, i / rate);
      const expected = sample.isHold ? 0 : (sample.sourceTime * rate - (sample.sourceRate < 0 ? 1 : 0)) / 512;
      expect(result.buffer.getChannelData(0)[i]).toBeCloseTo(expected, 6);
    }
  });

  it.each([false, true])('exports repeated audio beyond its source window (reverse=%s)', async reversed => {
    const c = clip({ duration: 9, reversed, timeRemap: { kind: 'loop', phase: 0.5 } });
    const result = await acquireAndRender(c);
    expect(result.origin).toBe(2);
    expect(result.acquired.duration).toBe(2);
    expect(result.buffer.duration).toBe(9);
    for (let i = 0; i < result.buffer.length; i++) {
      const sample = resolveClipSourceTime(c, i / rate);
      const offset = ((sample.sourceTime * rate - 64 - (sample.sourceRate < 0 ? 1 : 0)) % 64 + 64) % 64;
      expect(result.buffer.getChannelData(0)[i]).toBeCloseTo((64 + offset) / 512, 6);
    }
  });

  it('acquires speed-curve extrema and preserves a nonzero buffer origin during resampling', async () => {
    const c = clip({ duration: 3 });
    const keys: Keyframe[] = [
      { id: 's0', clipId: c.id, property: 'speed', time: 0, value: 1, easing: 'linear' },
      { id: 's1', clipId: c.id, property: 'speed', time: 3, value: 2, easing: 'linear' },
    ];
    expect(getExportClipSourceRange(c, keys)).toEqual({ start: 2, end: 4 });
    const result = await acquireAndRender(c, keys), source = createClipSpeedSource(c, keys);
    for (let i = 0; i < result.buffer.length; i++) {
      const sample = resolveClipSourceTime(c, i / rate, source);
      expect(result.buffer.getChannelData(0)[i]).toBeCloseTo(sample.isHold ? 0 : Math.min(sample.sourceTime * rate, 4 * rate - 1) / 512, 6);
    }
  });

  it('renders frozen output silence without decoding its held source', async () => {
    const result = await acquireAndRender(clip({ timeRemap: { kind: 'freeze', sourceTime: 10 } }));
    expect(result.origin).toBe(10);
    expect(result.acquired.length).toBe(1);
    expect(result.buffer.getChannelData(0).every(value => value === 0)).toBe(true);
  });
});
