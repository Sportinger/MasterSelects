// Phone attribute clipboard (G2): copy effects, colour and animation of one clip and paste them onto
// several clips through the editor's clipboard actions, plus the root fix that lets copyKeyframes take
// explicit ids and pasteKeyframes take explicit targets and a clip-local start.
import { beforeEach, describe, expect, it } from 'vitest';

import {
  copyPhoneAttributes, pastePhoneAttributes, phonePastableGroups, phonePasteCandidates, summarizePhoneAttributes,
  usePhoneClipboardStore,
} from '../../src/components/mobileSkin/clipboard/phoneClipboardCommands';
import { DEFAULT_TRANSFORM, useTimelineStore } from '../../src/stores/timeline';
import type { Keyframe } from '../../src/types/keyframes';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';

const initialTimelineState = useTimelineStore.getState();

function clip(id: string, trackId: string, startTime: number, duration = 4, extra: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id, trackId, name: id, file: new File([], `${id}.mp4`), startTime, duration, inPoint: 0, outPoint: duration,
    source: { type: 'video' }, transform: structuredClone(DEFAULT_TRANSFORM), effects: [], ...extra,
  };
}

function key(id: string, clipId: string, property: string, time: number, value: number): Keyframe {
  return { id, clipId, property: property as Keyframe['property'], time, value, easing: 'linear' };
}

const videoTrack = initialTimelineState.tracks.find((track) => track.type === 'video') as TimelineTrack;
const tracks: TimelineTrack[] = [
  { ...videoTrack, id: 'v1', locked: false },
  { ...videoTrack, id: 'v-locked', locked: true },
];

beforeEach(() => {
  useTimelineStore.setState(initialTimelineState);
  usePhoneClipboardStore.setState({ copied: null, focus: null });
  const source = clip('src', 'v1', 0, 4, {
    effects: [{ id: 'fx-blur', name: 'Blur', type: 'gaussian-blur', enabled: true, params: { radius: 12 } }],
  });
  useTimelineStore.setState({
    tracks,
    clips: [source, clip('a', 'v1', 4), clip('b', 'v1', 8), clip('locked', 'v-locked', 0)],
    clipKeyframes: new Map([
      ['src', [
        key('k-fx', 'src', 'effect.fx-blur.radius', 1, 20),
        key('k-op1', 'src', 'opacity', 0.5, 0.2),
        key('k-op2', 'src', 'opacity', 2, 1),
      ]],
      ['a', [key('a-old-fx', 'a', 'effect.gone.amount', 1, 3)]],
    ]),
    selectedClipIds: new Set(['src']),
    primarySelectedClipId: 'src',
    clipboardEffects: null,
    clipboardColor: null,
    clipboardKeyframes: null,
    selectedKeyframeIds: new Set(),
  });
});

describe('phone attribute clipboard', () => {
  it('summarizes the groups of a clip', () => {
    const state = useTimelineStore.getState();
    const source = state.clips.find((candidate) => candidate.id === 'src')!;
    expect(summarizePhoneAttributes(source, state.clipKeyframes.get('src')!)).toEqual({
      effects: 1, effectKeys: 1, colourGraded: false, colourKeys: 0, animationKeys: 2,
    });
  });

  it('lists clips of the same track kind and greys locked ones with a reason', () => {
    const candidates = phonePasteCandidates('video');
    expect(candidates.map((entry) => entry.clip.id)).toEqual(['src', 'locked', 'a', 'b']);
    expect(candidates.find((entry) => entry.clip.id === 'locked')!.reason).toMatch(/locked track/);
    expect(candidates.filter((entry) => entry.reason === null)).toHaveLength(3);
  });

  it('copies effects and animation, then pastes them onto two clips with new effect ids', () => {
    const copied = copyPhoneAttributes('src', ['effects', 'animation']);
    expect(copied.ok).toBe(true);
    expect(phonePastableGroups(usePhoneClipboardStore.getState().copied)).toEqual(['effects', 'animation']);

    const pasted = pastePhoneAttributes(['a', 'b', 'locked'], ['effects', 'animation']);
    expect(pasted).toEqual({ ok: true, message: 'Pasted effects, animation onto 2 clips' });

    const state = useTimelineStore.getState();
    for (const id of ['a', 'b']) {
      const target = state.clips.find((candidate) => candidate.id === id)!;
      expect(target.effects).toHaveLength(1);
      expect(target.effects[0].type).toBe('gaussian-blur');
      expect(target.effects[0].id).not.toBe('fx-blur');
      const keys = state.clipKeyframes.get(id)!;
      // The effect key follows the new instance; the old effect key of 'a' is replaced (paste replaces the stack).
      expect(keys.filter((entry) => entry.property.startsWith('effect.')).map((entry) => entry.property))
        .toEqual([`effect.${target.effects[0].id}.radius`]);
      // Animation keys land at the same clip-local times as on the source.
      expect(keys.filter((entry) => entry.property === 'opacity').map(({ time, value }) => [time, value]))
        .toEqual([[0.5, 0.2], [2, 1]]);
    }
    expect(state.clips.find((candidate) => candidate.id === 'locked')!.effects).toEqual([]);
    expect(state.clipKeyframes.get('locked')).toBeUndefined();
  });

  it('pastes a colour grade with its keys and leaves effects and transform alone', () => {
    expect(copyPhoneAttributes('src', ['colour']).ok).toBe(true);
    const before = useTimelineStore.getState().clips.find((candidate) => candidate.id === 'a')!;
    expect(pastePhoneAttributes(['a'], ['colour']).ok).toBe(true);
    const after = useTimelineStore.getState().clips.find((candidate) => candidate.id === 'a')!;
    expect(after.colorCorrection).toBeDefined();
    expect(after.effects).toBe(before.effects);
    expect(after.transform).toEqual(before.transform);
  });

  it('names targets shorter than the animation, whose late keys the editor puts at their end', () => {
    useTimelineStore.setState({ clips: [...useTimelineStore.getState().clips, clip('tiny', 'v1', 12, 1)] });
    copyPhoneAttributes('src', ['animation']);
    const result = pastePhoneAttributes(['tiny'], ['animation']);
    expect(result.message).toMatch(/tiny is shorter than the animation/);
    expect(useTimelineStore.getState().clipKeyframes.get('tiny')!.map(({ time }) => time)).toEqual([0.5, 1]);
  });

  it('says why nothing can be copied or pasted instead of failing silently', () => {
    expect(copyPhoneAttributes('a', ['animation'])).toMatchObject({ ok: false, message: expect.stringMatching(/no animation/) });
    expect(pastePhoneAttributes(['a'], ['effects'])).toMatchObject({ ok: false, message: expect.stringMatching(/Nothing copied/) });
    copyPhoneAttributes('src', ['effects']);
    expect(pastePhoneAttributes(['locked'], ['effects'])).toMatchObject({ ok: false, message: expect.stringMatching(/locked/) });
    // Another copy (here of a different clip's effects) replaces the editor clipboard: the phone notices.
    useTimelineStore.getState().copyClipEffects('a');
    expect(phonePastableGroups(usePhoneClipboardStore.getState().copied)).toEqual([]);
  });
});

describe('editor keyframe clipboard with explicit ids and targets (root fix)', () => {
  it('copies exactly the given keys and pastes them into several clips at a clip-local time', () => {
    const store = useTimelineStore.getState();
    store.copyKeyframes(['k-op1', 'k-op2']);
    expect(useTimelineStore.getState().clipboardKeyframes?.map((entry) => entry.time)).toEqual([0, 1.5]);
    useTimelineStore.getState().pasteKeyframes({ targetClipIds: ['a', 'b'], clipLocalTime: 1 });
    for (const id of ['a', 'b']) {
      const keys = useTimelineStore.getState().clipKeyframes.get(id)!.filter((entry) => entry.property === 'opacity');
      expect(keys.map(({ time, value }) => [time, value])).toEqual([[1, 0.2], [2.5, 1]]);
    }
    // Pasting again at the same place replaces instead of doubling.
    useTimelineStore.getState().pasteKeyframes({ targetClipIds: ['a'], clipLocalTime: 1 });
    expect(useTimelineStore.getState().clipKeyframes.get('a')!.filter((entry) => entry.property === 'opacity')).toHaveLength(2);
  });

  it('keeps the old behaviour without arguments: lane selection, selected clip, playhead', () => {
    useTimelineStore.setState({ selectedKeyframeIds: new Set(['k-op2']) });
    useTimelineStore.getState().copyKeyframes();
    expect(useTimelineStore.getState().clipboardKeyframes).toHaveLength(1);
    useTimelineStore.setState({ selectedClipIds: new Set(['b']), playheadPosition: 9 });
    useTimelineStore.getState().pasteKeyframes();
    expect(useTimelineStore.getState().clipKeyframes.get('b')!.map(({ time }) => time)).toEqual([1]);
  });

  it('never falls back to a clip paste when explicit targets get nothing to paste', () => {
    useTimelineStore.setState({ clipboardKeyframes: null, clipboardData: [] });
    const clipsBefore = useTimelineStore.getState().clips;
    useTimelineStore.getState().pasteKeyframes({ targetClipIds: ['a'] });
    expect(useTimelineStore.getState().clips).toBe(clipsBefore);
  });
});
