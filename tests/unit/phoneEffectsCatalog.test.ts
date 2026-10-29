import { describe, expect, it } from 'vitest';

import { getAllEffects } from '../../src/effects';
import { STARTER_LOOKS } from '../../src/effects/looks/starterLooks';
import { PHONE_ADJUST_CONTROLS } from '../../src/components/mobileSkin/effects/phoneAdjustControls';
import {
  filterPhoneEffects, formatPhoneParamValue, phoneEffectAvailability, phoneEffectGroups, phonePrimaryParam,
} from '../../src/components/mobileSkin/effects/phoneEffectCatalog';
import { choosePhoneOverlayTrack, resolvePhoneVisualSelection } from '../../src/components/mobileSkin/effects/phoneEffectTargets';
import {
  detectPhoneFilter, phoneStrengthControl, phoneStrengthValue, phoneUnscaledEffectNames,
} from '../../src/components/mobileSkin/effects/phoneLookFilters';
import { phoneEffectMoveIndex, phoneVisibleEffects } from '../../src/components/mobileSkin/effects/usePhoneEffectsCommands';
import { PRIMARY_COLOR_PARAM_DEFS } from '../../src/types/colorCorrection';
import type { Effect } from '../../src/types/effects';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const effect = (id: string, type: string, extra: Partial<Effect> = {}): Effect => ({ id, name: type, type: type as Effect['type'], enabled: true, params: {}, ...extra });

describe('phone effect catalog', () => {
  it('lists every catalog effect of the editor registry, each exactly once', () => {
    const listed = filterPhoneEffects(phoneEffectGroups(), 'all', '').map((definition) => definition.id);
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed.toSorted()).toEqual(getAllEffects().map((definition) => definition.id).toSorted());
  });

  it('filters by group and by search text', () => {
    const groups = phoneEffectGroups();
    const blur = filterPhoneEffects(groups, 'blur', '');
    expect(blur.map((definition) => definition.id)).toContain('gaussian-blur');
    expect(blur.every((definition) => groups.find((group) => group.id === 'blur')!.effects.includes(definition))).toBe(true);
    expect(filterPhoneEffects(groups, 'all', 'gauss').map((definition) => definition.id)).toEqual(['gaussian-blur']);
    expect(filterPhoneEffects(groups, 'all', 'no such effect')).toEqual([]);
  });

  it('picks an intensity-like main parameter and none for on/off effects', () => {
    expect(phonePrimaryParam('brightness')?.name).toBe('amount');
    expect(phonePrimaryParam('gaussian-blur')?.name).toBe('radius');
    expect(phonePrimaryParam('exposure')?.name).toBe('exposure');
    expect(phonePrimaryParam('levels')?.name).toBe('gamma');
    expect(phonePrimaryParam('scanlines')?.name).toBe('opacity');
    expect(phonePrimaryParam('invert')).toBeNull();
    expect(phonePrimaryParam('not-an-effect')).toBeNull();
    // Every main parameter is a visible, non-quality number control.
    for (const definition of getAllEffects()) {
      const primary = phonePrimaryParam(definition.id);
      if (primary) expect(primary.param.type, definition.id).toBe('number');
      if (primary) expect(primary.param.hidden || primary.param.quality || primary.param.deprecated, definition.id).toBeFalsy();
    }
  });

  it('offers every editor-admitted effect on adjustment layers and says why the rest are refused', () => {
    expect(phoneEffectAvailability('glow', 'clip')).toEqual({ kind: 'available' });
    expect(phoneEffectAvailability('brightness', 'adjustment')).toEqual({ kind: 'available' });
    expect(phoneEffectAvailability('glow', 'adjustment')).toEqual({ kind: 'available' });
    const refused = phoneEffectAvailability('slit-scan', 'adjustment');
    expect(refused.kind).toBe('unavailable');
    expect(refused.kind === 'unavailable' && refused.reason).toMatch(/Slit Scan cannot run on an adjustment layer: .*source video/);
  });

  it('formats values in the display unit', () => {
    expect(formatPhoneParamValue({ step: 0.01 }, 0.5)).toBe('0.50');
    expect(formatPhoneParamValue({ step: 1, unit: 'px' }, 12)).toBe('12px');
    expect(formatPhoneParamValue({ step: Math.PI / 180, displayUnit: 'degrees' }, Math.PI / 2)).toBe('90°');
  });
});

describe('phone effect stack', () => {
  it('lists video effects in the chain only and moves across hidden entries', () => {
    const effects = [effect('a', 'brightness'), effect('x', 'audio-volume'), effect('g', 'glow', { detached: true }), effect('b', 'contrast')];
    expect(phoneVisibleEffects(effects).map((item) => item.id)).toEqual(['a', 'b']);
    expect(phoneEffectMoveIndex(effects, 'a', 1)).toBe(3);
    expect(phoneEffectMoveIndex(effects, 'b', -1)).toBe(0);
    expect(phoneEffectMoveIndex(effects, 'a', -1)).toBeNull();
    expect(phoneEffectMoveIndex(effects, 'b', 1)).toBeNull();
  });
});

describe('phone selection for the design sheets', () => {
  const tracks = [createMockTrack({ id: 'v2', type: 'video', locked: true }), createMockTrack({ id: 'v1', type: 'video' }), createMockTrack({ id: 'a1', type: 'audio' })];
  const clips = [
    createMockClip({ id: 'pic', trackId: 'v1' }), createMockClip({ id: 'pic2', trackId: 'v1' }),
    createMockClip({ id: 'locked', trackId: 'v2' }), createMockClip({ id: 'sound', trackId: 'a1' }),
  ];

  it('puts the primary clip first and leaves out audio and locked clips with a reason', () => {
    const selection = resolvePhoneVisualSelection({ clips, tracks, selectedClipIds: new Set(['pic', 'pic2', 'locked', 'sound']), primarySelectedClipId: 'pic2' });
    expect(selection.clips.map((clip) => clip.id)).toEqual(['pic2', 'pic']);
    expect(selection.primary?.id).toBe('pic2');
    expect(selection.note).toMatch(/1 audio clip has no picture; 1 clip is on a locked track, so left out/);
  });

  it('keeps adjustment layers in the selection: Effects, Filters and Adjust all edit them', () => {
    const withLayer = [...clips, createMockClip({ id: 'layer', trackId: 'v1', source: { type: 'motion-adjustment' } as never })];
    const state = { clips: withLayer, tracks, selectedClipIds: new Set(['layer', 'pic']), primarySelectedClipId: 'layer' };
    const selection = resolvePhoneVisualSelection(state);
    expect(selection.clips.map((clip) => clip.id)).toEqual(['layer', 'pic']);
    expect(selection.note).toBeNull();
  });

  it('places an adjustment layer on the nearest free unlocked track above the main picture', () => {
    const many = [createMockTrack({ id: 'v3' }), createMockTrack({ id: 'v2' }), createMockTrack({ id: 'v1' })];
    expect(choosePhoneOverlayTrack(many, [], 1, 5)).toBe('v2');
    expect(choosePhoneOverlayTrack(many, [{ trackId: 'v2', startTime: 0, duration: 3 }], 1, 5)).toBe('v3');
    expect(choosePhoneOverlayTrack([createMockTrack({ id: 'v1' })], [], 0, 5)).toBeNull();
    expect(choosePhoneOverlayTrack([createMockTrack({ id: 'v2', locked: true }), createMockTrack({ id: 'v1' })], [], 0, 5)).toBeNull();
  });

  it('reports root scope and fully blocked selections', () => {
    expect(resolvePhoneVisualSelection({ clips, tracks, selectedClipIds: new Set(), primarySelectedClipId: null }).nothingSelected).toBe(true);
    const blocked = resolvePhoneVisualSelection({ clips, tracks, selectedClipIds: new Set(['sound']), primarySelectedClipId: 'sound' });
    expect(blocked.clips).toEqual([]);
    expect(blocked.nothingSelected).toBe(false);
    expect(blocked.note).toMatch(/nothing can change here/);
  });
});

describe('phone filters (Looks) strength', () => {
  it('scales mix-like controls from zero and colour recipes from their neutral value', () => {
    expect(phoneStrengthControl('grain')).toEqual({ name: 'amount', neutral: 0 });
    expect(phoneStrengthControl('contrast')).toEqual({ name: 'amount', neutral: 1 });
    expect(phoneStrengthControl('scanlines')).toEqual({ name: 'opacity', neutral: 0 });
    expect(phoneStrengthControl('posterize')).toBeNull();
    expect(phoneStrengthControl('edge-detect')).toBeNull();
    expect(phoneStrengthValue({ control: { name: 'amount', neutral: 1 }, full: 1.08 }, 0.5)).toBeCloseTo(1.04, 10);
    expect(phoneStrengthValue({ control: { name: 'amount', neutral: 0 }, full: 0.8 }, 2)).toBeCloseTo(0.8, 10);
    expect(phoneStrengthValue({ control: null, full: 0 }, 0.5)).toBeNull();
  });

  const lookEffects = (lookId: string, strength = 1, prefix = 'e'): Effect[] => {
    const look = STARTER_LOOKS.find((candidate) => candidate.id === lookId)!;
    return look.stack.map((entry, index) => {
      const params: Record<string, number | boolean | string> = { ...entry.params };
      const control = phoneStrengthControl(entry.effectId);
      if (control && typeof params[control.name] === 'number') {
        params[control.name] = control.neutral + ((params[control.name] as number) - control.neutral) * strength;
      }
      return effect(`${prefix}${index}`, entry.effectId, { params });
    });
  };

  it('finds an applied Look again from the end of the stack, with its strength', () => {
    const effects = [effect('own', 'blur'), ...lookEffects('digital-noir', 0.5)];
    expect(effects[1].params.amount).toBeCloseTo(0.41, 10);
    const found = detectPhoneFilter('clip', effects, STARTER_LOOKS);
    expect(found?.filter.lookId).toBe('digital-noir');
    expect(found?.filter.effects.map((item) => item.effectId)).toEqual(['e0', 'e1']);
    expect(found?.strength).toBeCloseTo(0.5, 6);
    expect(detectPhoneFilter('clip', [effect('v', 'vignette')], STARTER_LOOKS)).toBeNull();
  });

  it('tells Looks with the same effect types apart by their values', () => {
    for (const lookId of ['pal-broadcast', 'weak-antenna', 'worn-vhs']) {
      expect(detectPhoneFilter('clip', lookEffects(lookId), STARTER_LOOKS)?.filter.lookId, lookId).toBe(lookId);
      expect(detectPhoneFilter('clip', lookEffects(lookId, 0.4), STARTER_LOOKS)?.filter.lookId, `${lookId} at 40 %`).toBe(lookId);
    }
  });

  it('does not take an effect with the person\'s own values for a filter', () => {
    const own = effect('mine', 'analog-signal-lab', { params: { rfNoise: 0.9, scanlines: 0.1 } });
    expect(detectPhoneFilter('clip', [own], STARTER_LOOKS)).toBeNull();
    const stitch = lookEffects('stitch-portrait');
    stitch[0].params.scale = 24;
    expect(detectPhoneFilter('clip', stitch, STARTER_LOOKS)).toBeNull();
    // One strength control off the common strength: edited by hand, not a filter any more.
    const noir = lookEffects('digital-noir', 0.5);
    noir[1].params.amount = 0.48;
    expect(detectPhoneFilter('clip', noir, STARTER_LOOKS)).toBeNull();
  });

  it('names the effects Strength leaves alone', () => {
    const mosaic = STARTER_LOOKS.find((look) => look.id === 'mosaic-motion')!;
    const found = detectPhoneFilter('clip', lookEffects('mosaic-motion'), [mosaic]);
    expect(phoneUnscaledEffectNames(found!.filter)).toEqual(['Posterize']);
  });
});

describe('phone adjust controls', () => {
  it('reach every primary colour grade parameter, with Brightness on Offset', () => {
    expect(PHONE_ADJUST_CONTROLS.map((control) => control.key).toSorted()).toEqual(PRIMARY_COLOR_PARAM_DEFS.map((def) => def.key).toSorted());
    expect(PHONE_ADJUST_CONTROLS[0]).toMatchObject({ key: 'offset', label: 'Brightness' });
    for (const label of ['Exposure', 'Contrast', 'Saturation', 'Temperature', 'Tint', 'Highlights', 'Shadows']) {
      expect(PHONE_ADJUST_CONTROLS.some((control) => control.label === label), label).toBe(true);
    }
  });
});
