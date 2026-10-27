// Phone Sound range sheet: the pure range rules (target clip, touch to selection, channel mask),
// the shared split/cut commands it runs (also used by the desktop waveform), the punch range rule
// and the rescue-list filter.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  phoneRegionAll, phoneRegionChannelMask, phoneRegionFromTimes, phoneRegionMoved, phoneRegionPercent,
  phoneRegionResized, phoneRegionTimeAt, resolvePhoneRegionTarget,
} from '../../src/components/mobileSkin/audioRegions/phoneAudioRegionModel';
import { findSelectedPhoneScoreClip } from '../../src/components/mobileSkin/audioRegions/phoneScoreModel';
import { resolvePhonePunchProblem } from '../../src/components/mobileSkin/audio/usePhonePunchRecording';
import { rescuablePhoneRecoveryEntries } from '../../src/components/mobileSkin/audio/phoneRecordingModel';
import { cutAudioRegionOfClip, splitAudioRegionOfClip } from '../../src/components/timeline/utils/audioRegionClipCommands';
import { useTimelineStore } from '../../src/stores/timeline';
import type { TimelineClip } from '../../src/types';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const audioFile = () => new File([], 'tone.wav', { type: 'audio/wav' });

function toneClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return createMockClip({ id: 'tone', trackId: 'audio-1', startTime: 2, duration: 4, inPoint: 1, outPoint: 5, file: audioFile(), effects: [], ...overrides });
}

describe('phone sound range target', () => {
  const tracks = [createMockTrack({ id: 'audio-1', type: 'audio' }), createMockTrack({ id: 'video-1', type: 'video' })];

  it('edits the selected audio clip', () => {
    const target = resolvePhoneRegionTarget([toneClip()], tracks, ['tone']);
    expect(target.kind).toBe('ready');
    expect(target.kind === 'ready' && target.clip.id).toBe('tone');
  });

  it('edits the linked sound of a selected video and says so', () => {
    const video = createMockClip({ id: 'video', trackId: 'video-1', linkedClipId: 'tone', file: new File([], 'v.mp4', { type: 'video/mp4' }) });
    const target = resolvePhoneRegionTarget([video, toneClip()], tracks, ['video']);
    expect(target).toMatchObject({ kind: 'ready', viaLinkedVideo: true });
  });

  it('explains an empty selection and a clip without sound', () => {
    expect(resolvePhoneRegionTarget([toneClip()], tracks, [])).toMatchObject({ kind: 'none' });
    const silent = createMockClip({ id: 'pic', trackId: 'video-1', file: new File([], 'p.png', { type: 'image/png' }) });
    const target = resolvePhoneRegionTarget([silent], tracks, ['pic']);
    expect(target.kind === 'none' && target.reason.length).toBeGreaterThan(20);
  });

  it('marks a clip on a locked track', () => {
    const locked = [createMockTrack({ id: 'audio-1', type: 'audio', locked: true })];
    expect(resolvePhoneRegionTarget([toneClip()], locked, ['tone'])).toMatchObject({ kind: 'ready', locked: true });
  });
});

describe('phone sound range selection', () => {
  const clip = toneClip();

  it('maps timeline times to the source range of the clip', () => {
    const range = phoneRegionFromTimes(clip, 4, 3);
    expect(range).toMatchObject({ clipId: 'tone', trackId: 'audio-1', startTime: 3, endTime: 4 });
    expect(range.sourceInPoint).toBeCloseTo(2, 6);
    expect(range.sourceOutPoint).toBeCloseTo(3, 6);
  });

  it('clamps to the clip and never makes an empty range', () => {
    const range = phoneRegionFromTimes(clip, 10, 10);
    expect(range.endTime).toBeCloseTo(6, 6);
    expect(range.endTime - range.startTime).toBeGreaterThanOrEqual(0.0099);
    expect(phoneRegionAll(clip)).toMatchObject({ startTime: 2, endTime: 6 });
  });

  it('moves the range without moving the clip, clamped at the clip end', () => {
    const moved = phoneRegionMoved(clip, phoneRegionFromTimes(clip, 3, 4), 5);
    expect(moved.startTime).toBeCloseTo(5, 6);
    expect(moved.endTime).toBeCloseTo(6, 6);
  });

  it('resizes one edge and keeps the other', () => {
    const resized = phoneRegionResized(clip, phoneRegionFromTimes(clip, 3, 4), 'left', 2.5);
    expect(resized.startTime).toBeCloseTo(2.5, 6);
    expect(resized.endTime).toBeCloseTo(4, 6);
  });

  it('converts strip positions and percentages', () => {
    expect(phoneRegionTimeAt(clip, 50, 200)).toBeCloseTo(3, 6);
    expect(phoneRegionPercent(clip, phoneRegionFromTimes(clip, 3, 4))).toEqual({ left: 25, width: 25 });
  });

  it('applies the channel choice to range edits but not to channel commands', () => {
    expect(phoneRegionChannelMask('both', 'silence')).toBeUndefined();
    expect(phoneRegionChannelMask('left', 'silence')).toEqual([0]);
    expect(phoneRegionChannelMask('right', 'effect')).toEqual([1]);
    expect(phoneRegionChannelMask('left', 'swap-channels')).toBeUndefined();
  });
});

describe('shared audio region split and cut', () => {
  beforeEach(() => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'audio-1', type: 'audio' })],
      clips: [toneClip()],
      clipKeyframes: new Map(),
      selectedClipIds: new Set(),
      audioRegionSelection: null,
      audioRegionClipboard: null,
      isExporting: false,
    });
  });
  afterEach(() => useTimelineStore.setState({ clips: [], tracks: [], clipKeyframes: new Map(), audioRegionSelection: null, audioRegionClipboard: null }));

  it('split cuts at both range edges and selects the middle piece', () => {
    const clip = useTimelineStore.getState().clips[0];
    const result = splitAudioRegionOfClip('tone', phoneRegionFromTimes(clip, 3, 4));
    expect(result.ok).toBe(true);
    const pieces = useTimelineStore.getState().clips.filter((candidate) => candidate.trackId === 'audio-1')
      .map((candidate) => [Number(candidate.startTime.toFixed(3)), Number(candidate.duration.toFixed(3))])
      .sort((a, b) => a[0] - b[0]);
    expect(pieces).toEqual([[2, 1], [3, 1], [4, 2]]);
    expect(result.ok && result.middleClipId && useTimelineStore.getState().selectedClipIds.has(result.middleClipId)).toBe(true);
    expect(useTimelineStore.getState().audioRegionSelection).toBeNull();
  });

  it('cut copies the range to the clipboard and leaves a gap', () => {
    const clip = useTimelineStore.getState().clips[0];
    const result = cutAudioRegionOfClip('tone', phoneRegionFromTimes(clip, 3, 4));
    expect(result.ok).toBe(true);
    expect(useTimelineStore.getState().audioRegionClipboard).toMatchObject({ sourceClipId: 'tone', duration: 1 });
    const covered = useTimelineStore.getState().clips.filter((candidate) => candidate.trackId === 'audio-1')
      .some((candidate) => candidate.startTime < 3.5 && candidate.startTime + candidate.duration > 3.5);
    expect(covered).toBe(false);
  });

  it('says why without a range', () => {
    expect(splitAudioRegionOfClip('tone', null)).toMatchObject({ ok: false });
    expect(cutAudioRegionOfClip('tone', null)).toMatchObject({ ok: false });
  });
});

describe('punch range, rescue list and score clips', () => {
  it('needs punch-out at least 0.1 s after punch-in', () => {
    expect(resolvePhonePunchProblem(1, 2)).toBeNull();
    expect(resolvePhonePunchProblem(1, 1.05)).toMatch(/0\.1 s/);
    expect(resolvePhonePunchProblem(Number.NaN, 2)).not.toBeNull();
  });

  it('hides only the recording that is running right now', () => {
    const entry = (sessionId: string, status: 'active' | 'stopped') => ({ sessionId, status, targetTrackIds: [], inputDeviceIds: [], startedAt: 0, startTime: 0 });
    const entries = [entry('live', 'active'), entry('old', 'active'), entry('kept', 'stopped')];
    expect(rescuablePhoneRecoveryEntries({ phase: 'recording', sessionId: 'live' }, entries).map((item) => item.sessionId)).toEqual(['old', 'kept']);
  });

  it('finds the selected score clip only', () => {
    const score = createMockClip({ id: 's', trackId: 't', source: { type: 'score', naturalDuration: 4 } as TimelineClip['source'] });
    expect(findSelectedPhoneScoreClip([toneClip(), score], ['tone'])).toBeNull();
    expect(findSelectedPhoneScoreClip([toneClip(), score], ['tone', 's'])?.id).toBe('s');
  });
});
