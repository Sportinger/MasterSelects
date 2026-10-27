import { describe, expect, it } from 'vitest';

import {
  PHONE_TRACK_COLORS, nearestPhoneTrackHeight, phoneTrackDeleteReason, phoneTrackSection, planPhoneTrackMove,
} from '../../src/components/mobileSkin/tracks/phoneTrackCommands';
import { createMockTrack } from '../helpers/mockData';

const tracks = [
  createMockTrack({ id: 'v2', type: 'video' }),
  createMockTrack({ id: 'v1', type: 'video' }),
  createMockTrack({ id: 'a1', type: 'audio' }),
  createMockTrack({ id: 'm1', type: 'midi' }),
];

describe('phone track commands', () => {
  it('moves within the section only: video among video, audio and MIDI together', () => {
    expect(planPhoneTrackMove(tracks, 'v1', 'up')).toEqual({ ok: true, targetId: 'v2', placeBelow: false });
    expect(planPhoneTrackMove(tracks, 'v2', 'down')).toEqual({ ok: true, targetId: 'v1', placeBelow: true });
    expect(planPhoneTrackMove(tracks, 'v1', 'down').ok).toBe(false);
    expect(planPhoneTrackMove(tracks, 'a1', 'up').ok).toBe(false);
    expect(planPhoneTrackMove(tracks, 'm1', 'up')).toEqual({ ok: true, targetId: 'a1', placeBelow: false });
    expect(phoneTrackSection({ type: 'midi' })).toBe('audio');
  });

  it('explains why a locked track cannot move or be deleted', () => {
    const locked = [createMockTrack({ id: 'x', type: 'video', locked: true }), createMockTrack({ id: 'y', type: 'video' })];
    const move = planPhoneTrackMove(locked, 'x', 'down');
    expect(move.ok).toBe(false);
    if (!move.ok) expect(move.reason).toMatch(/Unlock/);
    expect(phoneTrackDeleteReason({ locked: true })).toMatch(/Unlock/);
    expect(phoneTrackDeleteReason({ locked: false })).toBeNull();
  });

  it('picks the nearest height preset and reuses the desktop label palette', () => {
    expect(nearestPhoneTrackHeight(40)).toBe('small');
    expect(nearestPhoneTrackHeight(60)).toBe('medium');
    expect(nearestPhoneTrackHeight(300)).toBe('large');
    expect(PHONE_TRACK_COLORS[0].key).toBe('none');
    expect(PHONE_TRACK_COLORS.find((color) => color.key === 'red')?.hex).toBe('#e2514c');
  });
});
