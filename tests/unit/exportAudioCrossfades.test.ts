import { describe, expect, it, vi } from 'vitest';

import { findAudioCrossfadePairs, resolveAudioCrossfadeFromClip } from '../../src/services/audio/audioCrossfadePlanning';
import {
  applyAudioCrossfadeEnvelopes,
  getAudioCrossfadeEnvelopeGain,
  type AudioCrossfadeGainEnvelope,
} from '../../src/services/audio/audioCrossfadeGains';
import { ClipAudioRenderService } from '../../src/services/audio/ClipAudioRenderService';
import { createBuffer } from '../../src/engine/audio/audioBufferFactory';
import { prepareExportAudioCrossfades } from '../../src/engine/audio/exportPipeline/exportAudioCrossfades';
import { AudioTrackCrossfadeTransitionSync } from '../../src/services/layerBuilder/audioTrackCrossfadeTransitions';
import type { FrameContext } from '../../src/services/layerBuilder/types';
import type { Keyframe } from '../../src/types/keyframes';
import type { ClipAudioEditOperation, TimelineClip, TimelineTrack } from '../../src/types/timeline';

const MEDIA_DURATION = 20;
/** −40 dB: the most a gain may jump where a clip's sound starts or ends. */
const SILENT = 0.01;

function clip(id: string, startTime: number, type: 'audio' | 'video', extra: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id, trackId: type === 'audio' ? 'a1' : 'v1', name: id, startTime, duration: 4, inPoint: 2, outPoint: 6,
    mediaFileId: `${id}-media`, source: { type, mediaFileId: `${id}-media` }, effects: [], ...extra,
  } as unknown as TimelineClip;
}

function crossfade(linkedClipId: string, extra: Record<string, unknown> = {}) {
  return { id: `x-${linkedClipId}`, type: 'crossfade' as const, duration: 2, linkedClipId, ...extra };
}

const getMediaDuration = () => MEDIA_DURATION;

function prepare(clips: TimelineClip[], clipKeyframes = new Map<string, Keyframe[]>()) {
  return prepareExportAudioCrossfades({ clips, clipKeyframes, startTime: 0, endTime: 10, getMediaDuration });
}

function gainAt(envelopes: readonly AudioCrossfadeGainEnvelope[] | undefined, time: number): number {
  return (envelopes ?? []).reduce((gain, envelope) => gain * getAudioCrossfadeEnvelopeGain(envelope, time), 1);
}

function deClick(id: string, edge: 'in' | 'out', clipInPoint: number, clipOutPoint: number): ClipAudioEditOperation {
  return {
    id, type: 'gain', enabled: true, createdAt: 1,
    params: { label: 'Automatic cut de-click', gainDb: -120 },
    timeRange: edge === 'in' ? { start: clipInPoint, end: clipInPoint + 0.012 } : { start: clipOutPoint - 0.012, end: clipOutPoint },
  } as ClipAudioEditOperation;
}

describe('audio crossfades in export', () => {
  it('finds the same crossfades preview plays: audio clips, and linked audio on one track with Include audio', () => {
    const clips = [
      clip('a1', 0, 'audio', { transitionOut: crossfade('a2') }),
      clip('a2', 4, 'audio'),
      clip('v1', 10, 'video', { linkedClipId: 'va1', transitionOut: crossfade('v2', { params: { includeAudio: true }, offset: 0.5 }) }),
      clip('v2', 14, 'video', { linkedClipId: 'va2' }),
      clip('va1', 10, 'audio', { linkedClipId: 'v1' }),
      clip('va2', 14, 'audio', { linkedClipId: 'v2' }),
      // Include audio off: the picture dissolves, the sound cuts.
      clip('w1', 20, 'video', { linkedClipId: 'wa1', transitionOut: crossfade('w2', { params: { includeAudio: false } }) }),
      clip('w2', 24, 'video', { linkedClipId: 'wa2' }),
      clip('wa1', 20, 'audio', { linkedClipId: 'w1' }),
      clip('wa2', 24, 'audio', { linkedClipId: 'w2' }),
      // Linked audio on different tracks has nothing to crossfade with.
      clip('u1', 30, 'video', { linkedClipId: 'ua1', transitionOut: crossfade('u2', { params: { includeAudio: true } }) }),
      clip('u2', 34, 'video', { linkedClipId: 'ua2' }),
      clip('ua1', 30, 'audio', { linkedClipId: 'u1' }),
      clip('ua2', 34, 'audio', { linkedClipId: 'u2', trackId: 'a2' }),
    ];
    const pairs = findAudioCrossfadePairs(clips, { getMediaDuration });
    expect(pairs.map((pair) => [pair.kind, pair.outgoingClip.id, pair.incomingClip.id, pair.plan.bodyStart, pair.plan.bodyEnd]))
      .toEqual([['audio-clips', 'a1', 'a2', 3, 5], ['linked-audio', 'va1', 'va2', 13.5, 15.5]]);
    // Include audio on with nothing to blend says why (Properties shows it under the checkbox).
    expect(resolveAudioCrossfadeFromClip(clips[10], clips, { getMediaDuration }))
      .toEqual({ pair: null, skipReason: 'linked-audio-on-different-tracks' });
    const lonely = clip('n1', 40, 'video', { transitionOut: crossfade('n2', { params: { includeAudio: true } }) });
    expect(resolveAudioCrossfadeFromClip(lonely, [lonely, clip('n2', 44, 'video')], { getMediaDuration }).skipReason)
      .toBe('no-linked-audio');

    // Preview picks the same pair for the audio track.
    const sync = new AudioTrackCrossfadeTransitionSync({
      isAudioSourceClip: (candidate) => candidate.source?.type === 'audio',
    } as unknown as ConstructorParameters<typeof AudioTrackCrossfadeTransitionSync>[0]);
    const ctx = { clips, playheadPosition: 14, mediaFileById: new Map([['va1-media', { duration: MEDIA_DURATION }], ['va2-media', { duration: MEDIA_DURATION }]]) } as unknown as FrameContext;
    expect(sync.getActiveForTrack(ctx, { id: 'a1' } as TimelineTrack)?.outgoingClip.id).toBe('va1');
    expect(sync.getActiveForTrack({ ...ctx, playheadPosition: 34 } as FrameContext, { id: 'a1' } as TimelineTrack)).toBeNull();
  });

  it('continues the outgoing clip into its tail handle and starts the incoming clip early from its head handle', () => {
    const volume: Keyframe = { id: 'kf_volume', clipId: 'a2', property: 'volume' as Keyframe['property'], time: 1, value: 0.5, easing: 'linear' };
    const prepared = prepare([clip('a1', 0, 'audio', { transitionOut: crossfade('a2') }), clip('a2', 4, 'audio')], new Map([['a2', [volume]]]));
    const [outgoing, incoming] = prepared.clips;

    expect(outgoing).toMatchObject({ startTime: 0, duration: 5, inPoint: 2, outPoint: 7 });
    expect(incoming).toMatchObject({ startTime: 3, duration: 5, inPoint: 1, outPoint: 6 });
    // Clip-local keyframes move with the earlier start, so they stay on the same sound.
    expect(prepared.clipKeyframes.get('a2')).toEqual([{ ...volume, time: 2 }]);
    expect(prepared.envelopes.get('a1')).toEqual([{ role: 'outgoing', start: 3, end: 5, curve: 'equal-power' }]);
    expect(prepared.envelopes.get('a2')).toEqual([{ role: 'incoming', start: 3, end: 5, curve: 'equal-power' }]);
    expect(prepared.notes).toEqual([]);
    expect(gainAt(prepared.envelopes.get('a1'), 4)).toBeCloseTo(Math.SQRT1_2);
  });

  it('fades only where both clips have sound: short handles shorten the fade, none gives a de-click', () => {
    // 0.1 s of extra sound on each side of a 2 s crossfade.
    const short = prepare([
      clip('a1', 0, 'audio', { inPoint: 15.9, outPoint: 19.9, transitionOut: crossfade('a2') }),
      clip('a2', 4, 'audio', { inPoint: 0.1, outPoint: 4.1 }),
    ]);
    expect(short.clips.map((candidate) => [candidate.startTime, Number((candidate.startTime + candidate.duration).toFixed(6))]))
      .toEqual([[0, 4.1], [3.9, 8]]);
    const [outgoingFade] = short.envelopes.get('a1')!;
    const [incomingFade] = short.envelopes.get('a2')!;
    expect([outgoingFade.start, outgoingFade.end, incomingFade.start, incomingFade.end].map((value) => Number(value.toFixed(6))))
      .toEqual([3.9, 4.1, 3.9, 4.1]);
    // No jump where a sound starts or ends: full level before, silent at the clip boundaries.
    expect(gainAt(short.envelopes.get('a1'), 3.5)).toBe(1);
    expect(gainAt(short.envelopes.get('a1'), 4.1)).toBeLessThan(SILENT);
    expect(gainAt(short.envelopes.get('a2'), 3.9)).toBeLessThan(SILENT);
    expect(gainAt(short.envelopes.get('a2'), 4.5)).toBe(1);

    const none = prepare([
      clip('a1', 0, 'audio', { inPoint: 16, outPoint: 20, transitionOut: crossfade('a2') }),
      clip('a2', 4, 'audio', { inPoint: 0, outPoint: 4 }),
    ]);
    expect(none.clips.map((candidate) => [candidate.startTime, candidate.duration])).toEqual([[0, 4], [4, 4]]);
    // Without extra sound both play at full level up to the edit, with 5 ms fades instead of a 1 s dip.
    expect(gainAt(none.envelopes.get('a1'), 3.5)).toBe(1);
    expect(gainAt(none.envelopes.get('a1'), 3.99)).toBe(1);
    expect(gainAt(none.envelopes.get('a1'), 4)).toBeLessThan(SILENT);
    expect(gainAt(none.envelopes.get('a2'), 4)).toBeLessThan(SILENT);
    expect(gainAt(none.envelopes.get('a2'), 4.01)).toBe(1);
  });

  it('meets retimed clips at the edit with a de-click and logs a note', () => {
    const retimed = prepare([clip('a1', 0, 'audio', { speed: 2, transitionOut: crossfade('a2') }), clip('a2', 4, 'audio')]);
    expect(retimed.clips[0]).toMatchObject({ duration: 4, outPoint: 6 });
    expect(retimed.notes).toEqual([{ transitionId: 'x-a2', junctionTime: 4, reason: 'retimed-clip' }]);
    expect(gainAt(retimed.envelopes.get('a1'), 3.99)).toBe(1);
    expect(gainAt(retimed.envelopes.get('a1'), 4)).toBeLessThan(SILENT);

    const outside = prepareExportAudioCrossfades({
      clips: [clip('a1', 0, 'audio', { transitionOut: crossfade('a2') }), clip('a2', 4, 'audio')],
      clipKeyframes: new Map(), startTime: 6, endTime: 10, getMediaDuration,
    });
    expect(outside.envelopes.size).toBe(0);
    expect(outside.clips[1]).toMatchObject({ startTime: 4 });
  });

  it('uses the Equal gain curve when chosen', () => {
    const prepared = prepare([clip('a1', 0, 'audio', { transitionOut: crossfade('a2', { params: { audioCurve: 'equal-gain' } }) }), clip('a2', 4, 'audio')]);
    expect(gainAt(prepared.envelopes.get('a1'), 4)).toBeCloseTo(0.5);
    expect(gainAt(prepared.envelopes.get('a2'), 4.5)).toBeCloseTo(0.75);
  });

  it('leaves out the automatic cut de-clicks at the crossfaded edges', () => {
    const keep = { ...deClick('keep', 'in', 2, 6) };
    const prepared = prepare([
      clip('a1', 0, 'audio', { transitionOut: crossfade('a2'), audioState: { editStack: [keep, deClick('out-edge', 'out', 2, 6)] } as TimelineClip['audioState'] }),
      clip('a2', 4, 'audio', { audioState: { editStack: [deClick('in-edge', 'in', 2, 6), deClick('end', 'out', 2, 6)] } as TimelineClip['audioState'] }),
    ]);
    expect(prepared.clips[0].audioState?.editStack?.map((operation) => operation.id)).toEqual(['keep']);
    expect(prepared.clips[1].audioState?.editStack?.map((operation) => operation.id)).toEqual(['end']);
  });

  it('applies the gains before the clip effects, so an effect tail decays from the faded sound', async () => {
    const rate = 100;
    const source = createBuffer(1, 2 * rate, rate);
    source.getChannelData(0).fill(1);
    const received: Float32Array[] = [];
    const effectRenderer = {
      renderEffectInstances: vi.fn(async (buffer: AudioBuffer) => {
        received.push(buffer.getChannelData(0).slice());
        return buffer;
      }),
    };
    const outgoing = clip('a1', 0, 'audio', {
      duration: 2, inPoint: 0, outPoint: 2, speed: 1,
      audioState: { effectStack: [{ id: 'verb', descriptorId: 'audio-volume', enabled: true, params: { volume: 1 } }] } as TimelineClip['audioState'],
    });
    const envelope: AudioCrossfadeGainEnvelope = { role: 'outgoing', start: 1, end: 2, curve: 'equal-power' };
    await new ClipAudioRenderService({
      effectRenderer,
      extractor: { trimBuffer: (buffer: AudioBuffer) => buffer },
    }).render({ clip: outgoing, sourceBuffer: source, sourceIsClipRange: true, crossfadeEnvelopes: [envelope], effectTailSeconds: 1 });

    expect(effectRenderer.renderEffectInstances).toHaveBeenCalledTimes(1);
    const [input] = received;
    expect(input.length).toBe(3 * rate);
    expect(input[50]).toBe(1);
    expect(input[150]).toBeCloseTo(Math.cos(0.5 * Math.PI / 2), 2);
    expect(input[199]).toBeLessThan(0.02);
    // The effect tail starts from silence instead of a full-level sound snapping back.
    expect(input.slice(200).every((sample) => sample === 0)).toBe(true);

    // Unchanged clips keep their buffer.
    expect(applyAudioCrossfadeEnvelopes(source, [], 0)).toBe(source);
    expect(applyAudioCrossfadeEnvelopes(source, [{ ...envelope, start: 5, end: 6 }], 0)).toBe(source);
  });

  it('plays the same gains in preview, silent where a clip has no sound', () => {
    const run = (clips: TimelineClip[], playheadPosition: number) => {
      const synced: Array<{ clipId: string; volume: number }> = [];
      const element = { src: 'blob:audio', readyState: 4, paused: false, pause: vi.fn() } as unknown as HTMLAudioElement;
      const sync = new AudioTrackCrossfadeTransitionSync({
        getClipAudioElement: () => element,
        getAudioProxyElementForClip: () => null,
        getClipSourceMediaFileId: () => undefined,
        isAudioSourceClip: (candidate) => candidate.source?.type === 'audio',
        pauseAudioTrackProxy: vi.fn(),
        stopStemBufferMixer: vi.fn(),
        pauseStemAudioElements: vi.fn(),
        syncPreviewAudioElement: (target) => { synced.push({ clipId: target.clip.id, volume: target.volume }); },
      });
      const track = { id: 'a1', type: 'audio' } as TimelineTrack;
      const ctx = {
        clips,
        playheadPosition,
        mediaFileById: new Map(clips.map((candidate) => [candidate.mediaFileId, { duration: MEDIA_DURATION }])),
        unmutedAudioTrackIds: new Set(['a1']),
        getInterpolatedEffects: () => [],
        getInterpolatedSpeed: () => 1,
        getSourceTimeForClip: (_clipId: string, local: number) => local,
        isPlaying: false,
      } as unknown as FrameContext;
      const activeTransition = sync.getActiveForTrack(ctx, track)!;
      sync.sync({
        ctx,
        state: { masterSet: true } as Parameters<AudioTrackCrossfadeTransitionSync['sync']>[0]['state'],
        track,
        activeTransition,
        activeTransitionAudioClipIds: new Set(),
        regionGainPreview: null,
      });
      return synced;
    };
    // Progress 0.75 at 4.5 s in the 3–5 s fade.
    const full = run([clip('a1', 0, 'audio', { transitionOut: crossfade('a2') }), clip('a2', 4, 'audio')], 4.5);
    expect(full.map((entry) => entry.clipId)).toEqual(['a1', 'a2']);
    expect(full[0].volume).toBeCloseTo(Math.cos(0.75 * Math.PI / 2));
    expect(full[1].volume).toBeCloseTo(Math.sin(0.75 * Math.PI / 2));

    // With 0.1 s handles the incoming clip stays silent (its held frame) until 3.9 s.
    const short = [
      clip('a1', 0, 'audio', { inPoint: 15.9, outPoint: 19.9, transitionOut: crossfade('a2') }),
      clip('a2', 4, 'audio', { inPoint: 0.1, outPoint: 4.1 }),
    ];
    expect(run(short, 3.5)).toEqual([{ clipId: 'a1', volume: 1 }]);
    expect(run(short, 4.5)).toEqual([{ clipId: 'a2', volume: 1 }]);
  });
});
