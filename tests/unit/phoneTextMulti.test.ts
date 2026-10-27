// Styling several titles at once on the phone (G2, INV-5/text-multiselect-style): three different
// sizes grow by the same step, a fourth title on a locked track stays as it is, an animated size gets a
// key at the playhead, shared values apply to all and unpicking puts a title back.
import { beforeEach, describe, expect, it } from 'vitest';

import {
  EMPTY_PHONE_TEXT_MULTI_DRAFT, applyPhoneTextMulti, capturePhoneTextOriginal, listPhoneTextCandidates, phoneTextMultiSize,
  type PhoneTextOriginal,
} from '../../src/components/mobileSkin/text/phoneTextMulti';
import type { EditableTextClip } from '../../src/components/panels/properties/textSelectionEditing';
import { DEFAULT_TRANSFORM, useTimelineStore } from '../../src/stores/timeline';
import { DEFAULT_TEXT_PROPERTIES } from '../../src/stores/timeline/constants';
import type { Keyframe } from '../../src/types/keyframes';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';

const initialTimelineState = useTimelineStore.getState();
const videoTrack = initialTimelineState.tracks.find((track) => track.type === 'video') as TimelineTrack;

function title(id: string, trackId: string, startTime: number, fontSize: number): TimelineClip {
  return {
    id, trackId, name: id, startTime, duration: 4, inPoint: 0, outPoint: 4,
    source: { type: 'text' }, transform: structuredClone(DEFAULT_TRANSFORM), effects: [],
    textProperties: { ...DEFAULT_TEXT_PROPERTIES, text: id, fontSize },
  } as TimelineClip;
}

const sizeOf = (id: string) => useTimelineStore.getState().clips.find((clip) => clip.id === id)!.textProperties!;

function originals(): Map<string, PhoneTextOriginal> {
  const state = useTimelineStore.getState();
  return new Map(listPhoneTextCandidates(state).filter((entry) => entry.reason === null)
    .map((entry) => [entry.clip.id, capturePhoneTextOriginal(state, entry.clip as EditableTextClip)]));
}

beforeEach(() => {
  useTimelineStore.setState(initialTimelineState);
  const animatedKeys: Keyframe[] = [
    { id: 'c-k0', clipId: 'c', property: 'text.fontSize', time: 0, value: 80, easing: 'linear' },
    { id: 'c-k4', clipId: 'c', property: 'text.fontSize', time: 4, value: 120, easing: 'linear' },
  ];
  useTimelineStore.setState({
    tracks: [{ ...videoTrack, id: 'v1', locked: false }, { ...videoTrack, id: 'v-locked', locked: true }],
    clips: [title('a', 'v1', 0, 40), title('b', 'v1', 4, 64), title('c', 'v1', 8, 100), title('locked', 'v-locked', 0, 50)],
    clipKeyframes: new Map([['c', animatedKeys]]),
    // Playhead in the middle of 'c' (local 2 s): its animated size there is 100.
    playheadPosition: 10,
    selectedClipIds: new Set(['a']),
  });
});

describe('phone multi-title style', () => {
  it('lists every title and greys the one on a locked track', () => {
    const list = listPhoneTextCandidates();
    expect(list.map((entry) => entry.clip.id)).toEqual(['a', 'locked', 'b', 'c']);
    expect(list.find((entry) => entry.clip.id === 'locked')!.reason).toMatch(/locked track/);
  });

  it('grows three different sizes by the same step; the locked title stays', () => {
    const base = originals();
    expect(base.has('locked')).toBe(false);
    const report = applyPhoneTextMulti(base, new Set(['a', 'b', 'c']), { ...EMPTY_PHONE_TEXT_MULTI_DRAFT, sizeDelta: 8 });
    expect(report).toEqual({ styled: 3, nodeDrivenSize: [] });
    expect(sizeOf('a').fontSize).toBe(48);
    expect(sizeOf('b').fontSize).toBe(72);
    expect(sizeOf('locked').fontSize).toBe(50);
    // The animated size gets a key at the playhead with its own value there plus the step.
    const keyAtPlayhead = useTimelineStore.getState().clipKeyframes.get('c')!.find((key) => Math.abs(key.time - 2) < 1e-6);
    expect(keyAtPlayhead?.value).toBe(108);
  });

  it('applies shared values to all picked titles and is safe to repeat', () => {
    const base = originals();
    const draft = { sizeDelta: 0, color: '#ff8a1f', bold: true, textAlign: 'right' as const, shadowEnabled: true };
    applyPhoneTextMulti(base, new Set(['a', 'b']), draft);
    applyPhoneTextMulti(base, new Set(['a', 'b']), draft);
    for (const id of ['a', 'b']) {
      expect(sizeOf(id)).toMatchObject({ color: '#ff8a1f', textAlign: 'right', shadowEnabled: true });
      expect(sizeOf(id).fontWeight).toBeGreaterThanOrEqual(600);
    }
    expect(sizeOf('c').color).toBe(DEFAULT_TEXT_PROPERTIES.color);
  });

  it('puts an unpicked title back to how it was when the sheet opened', () => {
    const base = originals();
    applyPhoneTextMulti(base, new Set(['a', 'b']), { sizeDelta: 12, color: '#000000' });
    applyPhoneTextMulti(base, new Set(['b']), { sizeDelta: 12, color: '#000000' });
    expect(sizeOf('a')).toMatchObject({ fontSize: 40, color: DEFAULT_TEXT_PROPERTIES.color });
    expect(sizeOf('b')).toMatchObject({ fontSize: 76, color: '#000000' });
  });

  it('keeps the size inside the editor limits', () => {
    expect(phoneTextMultiSize({ fontSize: 10 }, { sizeDelta: -1000 })).toBeGreaterThan(0);
  });
});
