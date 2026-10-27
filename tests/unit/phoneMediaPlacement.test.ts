import { describe, expect, it } from 'vitest';

import {
  describePhonePlacement,
  findPhoneMainVideoTrackId,
  planPhoneMediaPlacement,
  type PhonePlacementRequest,
  type PhonePlacementTimeline,
} from '../../src/components/mobileSkin/media/phoneMediaPlacement';
import type { FileImportResult } from '../../src/stores/mediaStore/types';

const tracks: PhonePlacementTimeline['tracks'] = [
  { id: 'v2', type: 'video' },
  { id: 'v1', type: 'video' },
  { id: 'a1', type: 'audio' },
  { id: 'a2', type: 'audio' },
];

function timeline(overrides: Partial<PhonePlacementTimeline> = {}): PhonePlacementTimeline {
  return { tracks, clips: [], playhead: 0, ...overrides };
}

const visual = (key: string, duration: number): PhonePlacementRequest => ({ key, lane: 'visual', duration });
const audio = (key: string, duration: number): PhonePlacementRequest => ({ key, lane: 'audio', duration });

describe('phone media placement plan', () => {
  it('uses the lowest unlocked video track as the main track', () => {
    expect(findPhoneMainVideoTrackId(tracks)).toBe('v1');
    expect(findPhoneMainVideoTrackId([{ id: 'v2', type: 'video' }, { id: 'v1', type: 'video', locked: true }])).toBe('v2');
    expect(findPhoneMainVideoTrackId([{ id: 'a1', type: 'audio' }])).toBeNull();
  });

  it('appends in pick order after the last clip of the main track', () => {
    const plan = planPhoneMediaPlacement(
      [visual('first', 3), visual('second', 5), visual('third', 2)],
      timeline({ clips: [{ trackId: 'v1', startTime: 0, duration: 4 }, { trackId: 'v2', startTime: 0, duration: 20 }] }),
      'append',
    );
    expect(plan.lanes.visual).toEqual({ trackId: 'v1', createTrack: null, startTime: 4 });
    expect(plan.steps).toEqual([
      { key: 'first', lane: 'visual', startTime: 4 },
      { key: 'second', lane: 'visual', startTime: 7 },
      { key: 'third', lane: 'visual', startTime: 12 },
    ]);
  });

  it('routes audio files to the end of the first audio track, independent of the video lane', () => {
    const plan = planPhoneMediaPlacement(
      [visual('clip', 3), audio('song', 30), visual('photo', 5), audio('voice', 4)],
      timeline({ clips: [{ trackId: 'a1', startTime: 0, duration: 2 }] }),
      'append',
    );
    expect(plan.lanes.audio).toEqual({ trackId: 'a1', createTrack: null, startTime: 2 });
    expect(plan.steps.map((step) => [step.key, step.lane, step.startTime])).toEqual([
      ['clip', 'visual', 0],
      ['song', 'audio', 2],
      ['photo', 'visual', 3],
      ['voice', 'audio', 32],
    ]);
  });

  it('asks for new tracks when the composition has none of the needed type', () => {
    const plan = planPhoneMediaPlacement([visual('clip', 3), audio('song', 3)], timeline({ tracks: [] }), 'append');
    expect(plan.lanes.visual).toEqual({ trackId: null, createTrack: 'video', startTime: 0 });
    expect(plan.lanes.audio).toEqual({ trackId: null, createTrack: 'audio', startTime: 0 });
  });

  it('overlays at the playhead on a free video track above the main one', () => {
    const plan = planPhoneMediaPlacement(
      [visual('logo', 2), visual('sticker', 3)],
      timeline({ playhead: 6, clips: [{ trackId: 'v1', startTime: 0, duration: 20 }] }),
      'overlay',
    );
    expect(plan.lanes.visual).toEqual({ trackId: 'v2', createTrack: null, startTime: 6 });
    expect(plan.steps.map((step) => step.startTime)).toEqual([6, 8]);
  });

  it('creates a new top track when every track above the main one is busy at the playhead', () => {
    const plan = planPhoneMediaPlacement(
      [visual('logo', 2), visual('sticker', 3)],
      // v2 is free at 6..8 but not for the whole 6..11 overlay.
      timeline({ playhead: 6, clips: [{ trackId: 'v2', startTime: 10, duration: 4 }] }),
      'overlay',
    );
    expect(plan.lanes.visual).toEqual({ trackId: null, createTrack: 'video', startTime: 6 });
  });

  it('never overlays on the main track itself', () => {
    const plan = planPhoneMediaPlacement([visual('logo', 2)], timeline({ tracks: [{ id: 'v1', type: 'video' }], playhead: 1 }), 'overlay');
    expect(plan.lanes.visual.createTrack).toBe('video');
  });

  it('overlays audio on the first audio track that is free at the playhead', () => {
    const plan = planPhoneMediaPlacement(
      [audio('hit', 1)],
      timeline({ playhead: 3, clips: [{ trackId: 'a1', startTime: 0, duration: 10 }] }),
      'overlay',
    );
    expect(plan.lanes.audio).toEqual({ trackId: 'a2', createTrack: null, startTime: 3 });
  });
});

describe('phone media placement durations', () => {
  it('gives images the default still duration and routes audio to the audio lane', () => {
    expect(describePhonePlacement({ id: 'i', type: 'image', name: 'p.jpg', url: '' } as unknown as FileImportResult))
      .toEqual({ lane: 'visual', duration: 5 });
    expect(describePhonePlacement({ id: 'a', type: 'audio', name: 's.mp3', url: '', duration: 12 } as unknown as FileImportResult))
      .toEqual({ lane: 'audio', duration: 12 });
    expect(describePhonePlacement({ id: 'v', type: 'video', name: 'c.mp4', url: '', duration: 7.5 } as unknown as FileImportResult))
      .toEqual({ lane: 'visual', duration: 7.5 });
  });
});
