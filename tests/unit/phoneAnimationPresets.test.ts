import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  EMPTY_PHONE_ANIMATION, PHONE_COMBO_PRESETS, PHONE_IN_PRESETS, PHONE_OUT_PRESETS, fitPhoneAnimationDurations,
  mergePhoneAnimationChoice, planPhoneAnimation, recognizePhoneAnimation, type PhoneAnimationChoice,
} from '../../src/components/mobileSkin/animation/phoneAnimationPresets';
import { capturePhoneAnimationTargets, planForTarget, writePhoneAnimation } from '../../src/components/mobileSkin/animation/phoneAnimationWrite';
import { useTimelineStore } from '../../src/stores/timeline';
import { DEFAULT_TRANSFORM } from '../../src/stores/timeline/constants';
import type { Keyframe } from '../../src/types/keyframes';
import { interpolateKeyframes } from '../../src/utils/keyframeInterpolation';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const transform = structuredClone(DEFAULT_TRANSFORM);
const choice = (patch: Partial<PhoneAnimationChoice>): PhoneAnimationChoice => ({ ...EMPTY_PHONE_ANIMATION, ...patch });
const asKeys = (desired: ReturnType<typeof planPhoneAnimation>['desired']): Keyframe[] =>
  desired.map((key, index) => ({ ...key, id: `k${index}`, clipId: 'c' }));
const sample = (keys: Keyframe[], property: string, time: number, base: number) => interpolateKeyframes(keys, property as Keyframe['property'], time, base);

describe('phone animation presets (keyframe plan)', () => {
  it('Fade in keys opacity 0 at the start and the settled value at the duration', () => {
    const plan = planPhoneAnimation({ baseKeys: [], clipDuration: 4, transform, choice: choice({ in: { preset: 'fade', duration: 0.5 } }) });
    expect(plan.desired.map((key) => [key.property, key.time, key.value, key.easing])).toEqual([
      ['opacity', 0, 0, 'ease-out'], ['opacity', 0.5, 1, 'linear'],
    ]);
    const keys = asKeys(plan.desired);
    expect(sample(keys, 'opacity', 0.25, 1)).toBeGreaterThan(0);
    expect(sample(keys, 'opacity', 0.25, 1)).toBeLessThan(1);
    expect(sample(keys, 'opacity', 2, 1)).toBe(1);
  });

  it('From left starts one composition width to the left; To right ends one width to the right', () => {
    const plan = planPhoneAnimation({
      baseKeys: [], clipDuration: 4, transform: { ...transform, position: { x: 0.25, y: 0, z: 0 } },
      choice: choice({ in: { preset: 'left', duration: 1 }, out: { preset: 'right', duration: 0.5 } }),
    });
    const keys = asKeys(plan.desired);
    expect(sample(keys, 'position.x', 0, 0.25)).toBeCloseTo(-1.75, 6);
    expect(sample(keys, 'position.x', 1, 0.25)).toBeCloseTo(0.25, 6);
    expect(sample(keys, 'position.x', 2, 0.25)).toBeCloseTo(0.25, 6);
    expect(sample(keys, 'position.x', 4, 0.25)).toBeCloseTo(2.25, 6);
  });

  it('every preset and combo is recognised again from the keys it writes', () => {
    for (const preset of PHONE_IN_PRESETS) {
      const plan = planPhoneAnimation({ baseKeys: [], clipDuration: 3, transform, choice: choice({ in: { preset: preset.id, duration: 0.8 } }) });
      expect(recognizePhoneAnimation(asKeys(plan.desired), 3).choice.in, preset.id).toEqual({ preset: preset.id, duration: 0.8 });
    }
    for (const preset of PHONE_OUT_PRESETS) {
      const plan = planPhoneAnimation({ baseKeys: [], clipDuration: 3, transform, choice: choice({ out: { preset: preset.id, duration: 0.6 } }) });
      const out = recognizePhoneAnimation(asKeys(plan.desired), 3).choice.out;
      expect(out?.preset, preset.id).toBe(preset.id);
      expect(out?.duration).toBeCloseTo(0.6, 6);
    }
    for (const combo of PHONE_COMBO_PRESETS) {
      const plan = planPhoneAnimation({ baseKeys: [], clipDuration: 2, transform, choice: choice({ combo: combo.id, in: { preset: combo.in, duration: 1 }, out: { preset: combo.out, duration: 1 } }) });
      expect(recognizePhoneAnimation(asKeys(plan.desired), 2).choice.combo, combo.id).toBe(combo.id);
    }
  });

  it('replaces keys inside the window of the touched properties and keeps everything else', () => {
    const base: Keyframe[] = [
      { id: 'a', clipId: 'c', property: 'opacity', time: 0.2, value: 0.4, easing: 'linear' },
      { id: 'b', clipId: 'c', property: 'opacity', time: 2, value: 0.8, easing: 'ease-in', handleOut: { x: 0.1, y: 0 } },
      { id: 'c', clipId: 'c', property: 'position.x', time: 0.2, value: 0.3, easing: 'linear' },
    ];
    const plan = planPhoneAnimation({ baseKeys: base, clipDuration: 4, transform, choice: choice({ in: { preset: 'fade', duration: 0.5 } }) });
    expect(plan.replaced).toBe(1);
    expect(plan.desired.find((key) => key.property === 'opacity' && key.time === 2)).toMatchObject({ value: 0.8, easing: 'ease-in', handleOut: { x: 0.1, y: 0 } });
    expect(plan.desired.find((key) => key.property === 'position.x')).toMatchObject({ time: 0.2, value: 0.3 });
    // The settled value comes from the remaining keys: opacity at 0.5 s holds the 2 s key's value.
    expect(plan.desired.find((key) => key.property === 'opacity' && key.time === 0.5)?.value).toBeCloseTo(0.8, 6);
  });

  it('shortens In + Out that do not fit the clip and says so', () => {
    const fitted = fitPhoneAnimationDurations(choice({ in: { preset: 'fade', duration: 2 }, out: { preset: 'fade', duration: 2 } }), 3);
    expect(fitted.clamped).toBe(true);
    expect(fitted.choice.in!.duration + fitted.choice.out!.duration).toBeCloseTo(3, 6);
    expect(fitPhoneAnimationDurations(choice({ in: { preset: 'fade', duration: 1 } }), 3).clamped).toBe(false);
  });

  it('a character reveal keys text.reveal from 0 to 1', () => {
    const plan = planPhoneAnimation({ baseKeys: [], clipDuration: 3, transform, choice: choice({ reveal: { mode: 'decode', duration: 1.5, cursor: true } }) });
    expect(plan.desired).toEqual([
      { property: 'text.reveal', time: 0, value: 0, easing: 'linear' },
      { property: 'text.reveal', time: 1.5, value: 1, easing: 'linear' },
    ]);
    expect(recognizePhoneAnimation(asKeys(plan.desired), 3, { mode: 'decode', cursor: true }).choice.reveal).toEqual({ mode: 'decode', duration: 1.5, cursor: true });
  });
});

describe('phone animation write (editor keyframe actions)', () => {
  beforeEach(() => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' }), createMockTrack({ id: 'audio-1', type: 'audio' })],
      clips: [
        createMockClip({ id: 'v', trackId: 'video-1', startTime: 2, duration: 4 }),
        createMockClip({ id: 'a', trackId: 'audio-1', startTime: 2, duration: 4 }),
      ],
      clipKeyframes: new Map([['v', [{ id: 'keep', clipId: 'v', property: 'effect.e1.amount', time: 1, value: 3, easing: 'linear' }]]]),
      selectedClipIds: new Set(['v', 'a']),
      primarySelectedClipId: 'v',
      playheadPosition: 2,
      isExporting: false,
    });
  });
  afterEach(() => {
    useTimelineStore.setState({ clips: [], clipKeyframes: new Map(), selectedClipIds: new Set(), primarySelectedClipId: null });
  });

  it('skips audio clips with a reason and writes the preset as ordinary keys; repeating is harmless', () => {
    const { targets, skipped } = capturePhoneAnimationTargets();
    expect(targets.map((target) => target.clipId)).toEqual(['v']);
    expect(skipped).toEqual([{ clipId: 'a', name: expect.any(String), reason: expect.stringMatching(/audio/) }]);

    const fade = choice({ in: { preset: 'fade', duration: 0.5 }, out: { preset: 'top', duration: 1 } });
    writePhoneAnimation(targets, fade);
    const first = useTimelineStore.getState().clipKeyframes.get('v')!;
    writePhoneAnimation(targets, fade);
    const again = useTimelineStore.getState().clipKeyframes.get('v')!;
    expect(again.map((key) => key.id)).toEqual(first.map((key) => key.id));
    expect(first.map((key) => `${key.property}@${key.time}=${key.value}`).toSorted()).toEqual([
      'effect.e1.amount@1=3', 'opacity@0.5=1', 'opacity@0=0', 'position.y@3=0', 'position.y@4=-2',
    ]);

    // Switching to None removes the preset keys again; the effect key stays.
    writePhoneAnimation(targets, EMPTY_PHONE_ANIMATION);
    expect(useTimelineStore.getState().clipKeyframes.get('v')!.map((key) => key.id)).toEqual(['keep']);
  });

  it('reopening recognises the written preset and switching replaces it instead of stacking', () => {
    writePhoneAnimation(capturePhoneAnimationTargets().targets, choice({ in: { preset: 'zoom-in', duration: 1 } }));
    const reopened = capturePhoneAnimationTargets().targets[0];
    expect(reopened.recognized.in).toEqual({ preset: 'zoom-in', duration: 1 });
    writePhoneAnimation([reopened], choice({ in: { preset: 'left', duration: 0.5 } }));
    const properties = new Set(useTimelineStore.getState().clipKeyframes.get('v')!.map((key) => key.property));
    expect([...properties].toSorted()).toEqual(['effect.e1.amount', 'position.x']);
  });

  it('a multi-clip edit writes only the touched part: a secondary clip keeps its own In when only Out changes', () => {
    useTimelineStore.setState({
      clips: [
        createMockClip({ id: 'v', trackId: 'video-1', startTime: 2, duration: 4 }),
        createMockClip({ id: 'w', trackId: 'video-1', startTime: 7, duration: 4 }),
      ],
      clipKeyframes: new Map(),
      selectedClipIds: new Set(['w']),
      primarySelectedClipId: 'w',
    });
    writePhoneAnimation(capturePhoneAnimationTargets().targets, choice({ in: { preset: 'left', duration: 0.5 } }));
    useTimelineStore.setState({ selectedClipIds: new Set(['v', 'w']), primarySelectedClipId: 'v' });
    const { targets } = capturePhoneAnimationTargets();
    expect(targets.map((target) => target.clipId)).toEqual(['v', 'w']);
    const outOnly = choice({ out: { preset: 'fade', duration: 0.5 } });
    writePhoneAnimation(targets, outOnly, new Set(['out']));
    const reread = capturePhoneAnimationTargets().targets;
    expect(reread[0].recognized).toMatchObject({ in: null, out: { preset: 'fade', duration: 0.5 } });
    expect(reread[1].recognized).toMatchObject({ in: { preset: 'left', duration: 0.5 }, out: { preset: 'fade', duration: 0.5 } });
  });

  it('merges touched parts only and keeps a combo only when both sides come from one source', () => {
    const base = choice({ in: { preset: 'fade', duration: 1 }, out: { preset: 'fade', duration: 1 }, combo: 'fade-in-out', reveal: null });
    const picked = choice({ in: { preset: 'left', duration: 0.5 }, out: { preset: 'top', duration: 0.5 } });
    expect(mergePhoneAnimationChoice(base, picked, new Set(['in']))).toEqual({ ...base, in: picked.in, combo: null });
    expect(mergePhoneAnimationChoice(base, picked, new Set())).toEqual(base);
    expect(mergePhoneAnimationChoice(base, picked, new Set(['in', 'out']))).toEqual({ ...picked, reveal: null });
  });

  it('keeps hand-made easing and bezier handles of a recognised part the user did not change', () => {
    const handles = { handleIn: { x: -0.2, y: 0.1 }, handleOut: { x: 0.3, y: -0.4 } };
    useTimelineStore.setState({
      clipKeyframes: new Map([['v', [
        { id: 'o0', clipId: 'v', property: 'opacity', time: 0, value: 0, easing: 'bezier', ...handles },
        { id: 'o1', clipId: 'v', property: 'opacity', time: 1, value: 1, easing: 'ease-in-out' },
      ]]]),
    } as never);
    const [target] = capturePhoneAnimationTargets().targets;
    expect(target.recognized.in).toEqual({ preset: 'fade', duration: 1 });
    const outToo = { ...target.recognized, out: { preset: 'fade', duration: 0.5 } };
    expect(planForTarget(target, outToo, new Set(['out'])).desired.filter((key) => key.time <= 1)).toEqual([
      { property: 'opacity', time: 0, value: 0, easing: 'bezier', ...handles },
      { property: 'opacity', time: 1, value: 1, easing: 'ease-in-out' },
    ]);
    writePhoneAnimation([target], outToo, new Set(['out']));
    const keys = useTimelineStore.getState().clipKeyframes.get('v')!;
    expect(keys.find((key) => key.id === 'o0')).toMatchObject({ easing: 'bezier', ...handles });
    expect(keys.find((key) => key.id === 'o1')).toMatchObject({ easing: 'ease-in-out' });
    // Changing the In duration re-plans that part with the phone's easing.
    writePhoneAnimation([target], { ...outToo, in: { preset: 'fade', duration: 0.8 } }, new Set(['in', 'out']));
    const replanned = useTimelineStore.getState().clipKeyframes.get('v')!.find((key) => key.property === 'opacity' && key.time === 0);
    expect(replanned?.easing).toBe('ease-out');
  });
});
