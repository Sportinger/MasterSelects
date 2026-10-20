import { describe, expect, it, vi } from 'vitest';

import { findAudioCrossfadePairs } from '../../src/services/audio/audioCrossfadePlanning';
import { prepareExportAudioCrossfades } from '../../src/engine/audio/exportPipeline/exportAudioCrossfades';
import {
  getAudioCrossfadeEnvelopeGain,
  scheduleCrossfadeEnvelopes,
} from '../../src/engine/audio/exportPipeline/audioCrossfadeGainCurve';
import { prepareExportTrackData } from '../../src/engine/audio/exportPipeline/trackDataPlanning';
import { AudioTrackCrossfadeTransitionSync } from '../../src/services/layerBuilder/audioTrackCrossfadeTransitions';
import type { FrameContext } from '../../src/services/layerBuilder/types';
import type { AudioGraphRenderPlan } from '../../src/engine/audio/AudioGraphTypes';
import type { Keyframe, TimelineClip, TimelineTrack } from '../../src/types';

const MEDIA_DURATION = 20;

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
    const clips = [clip('a1', 0, 'audio', { transitionOut: crossfade('a2') }), clip('a2', 4, 'audio')];
    const prepared = prepareExportAudioCrossfades({
      clips, clipKeyframes: new Map([['a2', [volume]]]), startTime: 0, endTime: 10, getMediaDuration,
    });
    const [outgoing, incoming] = prepared.clips;

    expect(outgoing).toMatchObject({ startTime: 0, duration: 5, inPoint: 2, outPoint: 7 });
    expect(incoming).toMatchObject({ startTime: 3, duration: 5, inPoint: 1, outPoint: 6 });
    // Clip-local keyframes move with the earlier start, so they stay on the same sound.
    expect(prepared.clipKeyframes.get('a2')).toEqual([{ ...volume, time: 2 }]);
    expect(prepared.envelopes.get('a1')).toEqual([{ role: 'outgoing', bodyStart: 3, bodyEnd: 5 }]);
    expect(prepared.envelopes.get('a2')).toEqual([{ role: 'incoming', bodyStart: 3, bodyEnd: 5 }]);
    expect(prepared.notes).toEqual([]);
  });

  it('uses only the footage that exists and fades retimed clips without extending them', () => {
    const noHandles = prepareExportAudioCrossfades({
      clips: [
        clip('a1', 0, 'audio', { inPoint: 16, outPoint: 20, transitionOut: crossfade('a2') }),
        clip('a2', 4, 'audio', { inPoint: 0, outPoint: 4 }),
      ],
      clipKeyframes: new Map(), startTime: 0, endTime: 10, getMediaDuration,
    });
    expect(noHandles.clips.map((candidate) => [candidate.startTime, candidate.duration])).toEqual([[0, 4], [4, 4]]);
    expect(noHandles.envelopes.size).toBe(2);

    const retimed = prepareExportAudioCrossfades({
      clips: [clip('a1', 0, 'audio', { speed: 2, transitionOut: crossfade('a2') }), clip('a2', 4, 'audio')],
      clipKeyframes: new Map(), startTime: 0, endTime: 10, getMediaDuration,
    });
    expect(retimed.clips[0]).toMatchObject({ duration: 4, outPoint: 6 });
    expect(retimed.notes).toEqual([{ transitionId: 'x-a2', junctionTime: 4, reason: 'retimed-clip' }]);

    const outside = prepareExportAudioCrossfades({
      clips: [clip('a1', 0, 'audio', { transitionOut: crossfade('a2') }), clip('a2', 4, 'audio')],
      clipKeyframes: new Map(), startTime: 6, endTime: 10, getMediaDuration,
    });
    expect(outside.envelopes.size).toBe(0);
    expect(outside.clips[1]).toMatchObject({ startTime: 4 });
  });

  it('applies equal-power gains in the mixer, also when the export starts mid-crossfade', () => {
    const outgoing = { role: 'outgoing' as const, bodyStart: 3, bodyEnd: 5 };
    expect(getAudioCrossfadeEnvelopeGain(outgoing, 2)).toBe(1);
    expect(getAudioCrossfadeEnvelopeGain(outgoing, 4)).toBeCloseTo(Math.SQRT1_2);
    expect(getAudioCrossfadeEnvelopeGain({ ...outgoing, role: 'incoming' }, 4.5)).toBeCloseTo(Math.sin(0.75 * Math.PI / 2));

    const buffer = { duration: 5, length: 5 * 48000, sampleRate: 48000, numberOfChannels: 2 } as AudioBuffer;
    const plan = {
      clips: [{ clipId: 'a1', active: true }],
      tracks: [{ trackId: 'a1', active: true, muted: false, solo: false, volumeDb: 0, pan: 0, sends: [{ id: 's1', enabled: true, targetBusId: 'bus', gainDb: -6, preFader: false }] }],
    } as unknown as AudioGraphRenderPlan;
    const [main, send] = prepareExportTrackData(
      [clip('a1', 0, 'audio')], new Map([['a1', buffer]]), [{ id: 'a1', type: 'audio' } as TimelineTrack], 4, plan,
      new Map([['a1', [outgoing]]]),
    );
    expect(main.crossfadeEnvelopes).toEqual([{ role: 'outgoing', bodyStart: -1, bodyEnd: 1 }]);
    expect(send.crossfadeEnvelopes).toEqual(main.crossfadeEnvelopes);

    const param = { setValueCurveAtTime: vi.fn(), setValueAtTime: vi.fn() };
    expect(scheduleCrossfadeEnvelopes(param, main.crossfadeEnvelopes, 0.5, 6)).toBe(1);
    const [curve, from, duration] = param.setValueCurveAtTime.mock.calls[0] as [Float32Array, number, number];
    expect([from, duration]).toEqual([0, 1]);
    expect(curve[0]).toBeCloseTo(0.5 * Math.SQRT1_2);
    expect(curve[curve.length - 1]).toBeCloseTo(0);
    expect(param.setValueAtTime).toHaveBeenCalledWith(0.5, 1);
  });

  it('plays the same equal-power gains in preview', () => {
    const clips = [clip('a1', 0, 'audio', { transitionOut: crossfade('a2') }), clip('a2', 4, 'audio')];
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
      playheadPosition: 4.5,
      mediaFileById: new Map(),
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
    // Progress 0.75 at 4.5 s in the 3–5 s body.
    expect(synced.map((entry) => entry.clipId)).toEqual(['a1', 'a2']);
    expect(synced[0].volume).toBeCloseTo(Math.cos(0.75 * Math.PI / 2));
    expect(synced[1].volume).toBeCloseTo(Math.sin(0.75 * Math.PI / 2));
  });
});
