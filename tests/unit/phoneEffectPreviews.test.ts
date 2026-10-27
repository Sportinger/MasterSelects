import { describe, expect, it } from 'vitest';

import { getDefaultParams, getEffect } from '../../src/effects';
import { phoneEffectPreviewLook } from '../../src/components/mobileSkin/effects/phoneEffectCatalog';
import {
  PHONE_EFFECT_PREVIEW_PARAMS, phoneEffectPreviewParams,
} from '../../src/components/mobileSkin/effects/phoneEffectPreviewParams';
import {
  createPhoneSampleFrame, PHONE_SAMPLE_FRAME_HEIGHT, PHONE_SAMPLE_FRAME_WIDTH,
} from '../../src/components/mobileSkin/effects/phoneSampleFrame';
import { hasPictureAt } from '../../src/components/mobileSkin/effects/usePhonePreviewSource';
import { createMockClip, createMockTrack } from '../helpers/mockData';

describe('phone effect card previews', () => {
  it('previews an effect as a one-effect Look at its default parameters (as the desktop picker does)', () => {
    const look = phoneEffectPreviewLook(getEffect('invert')!);
    expect(look.id).toBe('effect-preview-invert');
    expect(look.stack).toEqual([{ effectId: 'invert', params: getDefaultParams('invert'), enabled: true }]);
  });

  it('previews effects that are neutral at their defaults at a fixed demonstrative strength', () => {
    const look = phoneEffectPreviewLook(getEffect('brightness')!);
    expect(look.id).toBe('effect-preview-brightness-demo');
    expect(look.stack[0].params).toEqual({ ...getDefaultParams('brightness'), amount: 0.35 });
    expect(phoneEffectPreviewParams('contrast')).toEqual({ params: { ...getDefaultParams('contrast'), amount: 1.8 }, demo: true });
    expect(phoneEffectPreviewParams('glow').demo).toBe(false);
  });

  it('names only real number parameters inside their range, each away from its default', () => {
    for (const [effectId, overrides] of Object.entries(PHONE_EFFECT_PREVIEW_PARAMS)) {
      const definition = getEffect(effectId);
      expect(definition, `${effectId} exists`).toBeTruthy();
      for (const [name, value] of Object.entries(overrides)) {
        const param = definition!.params[name];
        expect(param?.type, `${effectId}.${name} is a number parameter`).toBe('number');
        expect(value).toBeGreaterThanOrEqual(param!.min ?? -Infinity);
        expect(value).toBeLessThanOrEqual(param!.max ?? Infinity);
        expect(value, `${effectId}.${name} differs from its default`).not.toBe(param!.default);
      }
    }
  });

  it('builds an opaque 16:9 sample frame with full range, colour and fine detail', () => {
    const frame = createPhoneSampleFrame();
    expect([frame.width, frame.height]).toEqual([PHONE_SAMPLE_FRAME_WIDTH, PHONE_SAMPLE_FRAME_HEIGHT]);
    expect(frame.data.length).toBe(frame.width * frame.height * 4);
    let min = 255, max = 0, saturated = 0;
    for (let offset = 0; offset < frame.data.length; offset += 4) {
      const [r, g, b, a] = frame.data.subarray(offset, offset + 4);
      expect(a).toBe(255);
      min = Math.min(min, r, g, b);
      max = Math.max(max, r, g, b);
      if (Math.max(r, g, b) - Math.min(r, g, b) > 120) saturated++;
    }
    expect(min).toBe(0);
    expect(max).toBe(255);
    expect(saturated / (frame.width * frame.height)).toBeGreaterThan(0.1);
    // The centre checker alternates every 4 pixels (blur and sharpen show there).
    const at = (x: number, y: number) => frame.data[(y * frame.width + x) * 4];
    const y = Math.floor(frame.height * 0.5);
    const x = Math.floor(frame.width * 0.6 / 4) * 4;
    expect(Math.abs(at(x, y) - at(x + 4, y))).toBeGreaterThan(200);
  });

  it('uses the sample frame only when no visible video clip covers the playhead', () => {
    const video = createMockTrack({ id: 'v1', type: 'video', visible: true });
    const hidden = createMockTrack({ id: 'v2', type: 'video', visible: false });
    const audio = createMockTrack({ id: 'a1', type: 'audio', visible: true });
    const clip = (trackId: string) => createMockClip({ id: `c-${trackId}`, trackId, startTime: 1, duration: 2 });
    expect(hasPictureAt([clip('v1')], [video], 1.5)).toBe(true);
    expect(hasPictureAt([clip('v1')], [video], 3)).toBe(false);
    expect(hasPictureAt([clip('v1')], [video], 0.5)).toBe(false);
    expect(hasPictureAt([clip('v2')], [hidden], 1.5)).toBe(false);
    expect(hasPictureAt([clip('a1')], [audio], 1.5)).toBe(false);
  });
});
