import { describe, expect, it, vi } from 'vitest';
import type { Keyframe, TimelineClip } from '../../src/types';
import { createBuffer } from '../../src/engine/audio/audioBufferFactory';
import { ProcessedAudioPreviewCache, processedAudioPreviewKey, processedAudioPreviewPosition } from '../../src/services/audio/preview/ProcessedAudioPreviewCache';
import { ProcessedAudioPreviewPlayer } from '../../src/services/audio/preview/ProcessedAudioPreviewPlayer';

vi.mock('../../src/services/audioRoutingManager', () => ({ audioRoutingManager: {} }));

const clip = { id: 'reverse', inPoint: 1, outPoint: 5, duration: 2, speed: 2,
  reversed: true, mediaFileId: 'media', effects: [], preservesPitch: true } as TimelineClip;
const key: Keyframe = { id: 'speed', clipId: clip.id, property: 'speed', time: 0, value: 2, easing: 'linear' };
const pcm = (seconds = 1) => createBuffer(1, seconds * 16, 16);
const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };

describe('processed audio render identity', () => {
  const mutations: Partial<TimelineClip>[] = [
    { mediaFileId: 'replacement' }, { source: { type: 'audio', mediaFileId: 'other' } },
    { inPoint: 2 }, { outPoint: 6 }, { duration: 3 }, { speed: -2 }, { reversed: false },
    { preservesPitch: false }, { videoInspectorSections: { speedChange: false } },
    { audioState: { editStack: [{ id: 'gain', type: 'gain', enabled: true, gainDb: 3 }] } } as Partial<TimelineClip>,
    { audioState: { sourceAudioRevisionId: 'revision-2' } },
    { audioState: { effectStack: [{ id: 'vol', descriptorId: 'audio-volume', enabled: true, params: { volume: 0.5 } }] } },
    { effects: [{ id: 'vol', type: 'audio-volume', name: 'Volume', enabled: true, params: { volume: 0.5 } }] },
    { compositionId: 'nested', isComposition: true }, { nestedContentHash: 'content-2' },
    { transitionSourceHold: true }, { transitionSourceTimeOverride: 3 },
    { transitionSourceMap: { version: 1, segments: [{ kind: 'linear', compStart: 0, compEnd: 2, sourceStart: 5, sourceEnd: 1 }] } },
  ];
  it.each(mutations.map((patch, index) => ({ patch, index })))('invalidates input mutation $index', ({ patch }) => {
    expect(processedAudioPreviewKey({ ...clip, ...patch }, [key], 'bytes-1'))
      .not.toBe(processedAudioPreviewKey(clip, [key], 'bytes-1'));
  });
  it('includes keyframe shape, holds, output gain and external source revisions', () => {
    const base = processedAudioPreviewKey(clip, [key], 'bytes-1');
    for (const patch of [{ value: -2 }, { time: 1 }, { hold: true }, { easing: 'ease-in' }]) {
      expect(processedAudioPreviewKey(clip, [{ ...key, ...patch } as Keyframe], 'bytes-1')).not.toBe(base);
    }
    expect(processedAudioPreviewKey(clip, [key, { ...key, id: 'volume', property: 'effect.vol.volume', value: 0.5 }], 'bytes-1')).not.toBe(base);
    expect(processedAudioPreviewKey(clip, [key], 'bytes-2')).not.toBe(base);
  });
});

describe('bounded processed audio cache', () => {
  it('stays muted while pending and uses local time unchanged when ready', async () => {
    const cache = new ProcessedAudioPreviewCache();
    const entry = cache.request('clip', 'revision', 2, async () => pcm(2));
    expect(processedAudioPreviewPosition(entry, 1.25)).toMatchObject({ muted: true });
    await settle();
    expect(processedAudioPreviewPosition(entry, 1.25)).toMatchObject({ muted: false, offset: 1.25 });
  });
  it('evicts least recently used clips under both count and duration budgets', async () => {
    const cache = new ProcessedAudioPreviewCache({ maxClips: 2, maxSeconds: 3, maxBytes: 10_000_000 });
    const render = async () => pcm();
    cache.request('a', 'a1', 1, render); cache.request('b', 'b1', 1, render);
    await settle();
    cache.request('a', 'a1', 1, render);
    cache.request('c', 'c1', 1, render);
    expect(cache.peek('b')).toBeUndefined();
    await settle();
    cache.request('long', 'long1', 3, async () => pcm(3));
    expect(cache.peek('a')).toBeUndefined();
    expect(cache.peek('c')).toBeUndefined();
    await settle();
    expect(cache.peek('long')?.status).toBe('ready');
  });
  it('aborts invalidated work, discards stale completion, and serializes preparations', async () => {
    const cache = new ProcessedAudioPreviewCache();
    let finish!: (buffer: AudioBuffer) => void;
    let oldSignal!: AbortSignal;
    cache.request('a', 'old', 1, signal => {
      oldSignal = signal;
      return new Promise(resolve => { finish = resolve; });
    });
    await settle();
    const replacement = vi.fn(async () => pcm(2));
    cache.request('a', 'new', 2, replacement);
    expect(oldSignal.aborted).toBe(true);
    expect(replacement).not.toHaveBeenCalled();
    finish(pcm());
    await settle();
    expect(cache.peek('a')).toMatchObject({ key: 'new', status: 'ready', buffer: { duration: 2 } });
    cache.reconcile(new Map());
    expect(cache.peek('a')).toBeUndefined();
  });
  it('rejects oversized preparations without invoking the renderer', () => {
    const cache = new ProcessedAudioPreviewCache({ maxClips: 1, maxSeconds: 2, maxBytes: 1_000_000 });
    const render = vi.fn(async () => pcm(3));
    expect(cache.request('large', 'v1', 3, render).status).toBe('error');
    expect(render).not.toHaveBeenCalled();
  });
});

it('starts ready PCM in the existing Web Audio route at local offset and unity playback rate', () => {
  const source = { playbackRate: { value: 9 }, start: vi.fn(), stop: vi.fn(), disconnect: vi.fn() };
  const context = { currentTime: 20, createBufferSource: () => source };
  const routing = { ensureSharedContext: () => context, applyNodeEffects: vi.fn(), removeNodeRoute: vi.fn() };
  const player = new ProcessedAudioPreviewPlayer(routing as never);
  const route = { volume: 1, eqGains: [], processors: [], pan: 0, muted: false,
    master: { volume: 1, eqGains: [], processors: [] } };
  expect(player.sync('clip', 'ready', pcm(2), 1.25, true, false, route)).toBe(true);
  expect(source.start).toHaveBeenCalledWith(20, 1.25, undefined);
  expect(source.playbackRate.value).toBe(1);
  expect(routing.applyNodeEffects).toHaveBeenCalledOnce();
  player.sync('clip', 'ready', pcm(2), 1.25, false, false, route);
  expect(source.stop).toHaveBeenCalledOnce();
});
