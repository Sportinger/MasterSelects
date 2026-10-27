import { describe, expect, it } from 'vitest';

import { PHONE_SHEET_REGISTRY } from '../../src/components/mobileSkin/sheets/phoneSheetRegistry';
import {
  PHONE_SHEET_LAYOUT, PHONE_SHEET_SIZES, phoneSheetCaps, phoneSheetSettle, phoneSheetSizeFor, phoneSheetStep, phoneSheetStops,
  phoneSheetToggle, rememberPhoneSheetDetent, rememberedPhoneSheetDetent, resetRememberedPhoneSheetDetents,
} from '../../src/components/mobileSkin/sheets/phoneSheetSizing';

const PHONES = [
  { name: 'pixel-7', viewport: 915 },
  { name: 'iphone-viewport', viewport: 844 },
  { name: 'short (keyboard open)', viewport: 520 },
];
const TOP = 85;

describe('phone sheet sizing', () => {
  it('gives every registered sheet a size in the one map', () => {
    expect(Object.keys(PHONE_SHEET_SIZES).toSorted()).toEqual(Object.keys(PHONE_SHEET_REGISTRY).toSorted());
  });

  it.each(PHONES)('keeps the preview at its minimum on $name', ({ viewport }) => {
    const caps = phoneSheetCaps(viewport, TOP);
    const minPreview = Math.max(viewport * PHONE_SHEET_LAYOUT.minPreviewShare, PHONE_SHEET_LAYOUT.minPreviewPx);
    const preview = (sheet: number) => viewport - TOP - PHONE_SHEET_LAYOUT.transportPx - sheet;
    expect(preview(caps.full)).toBeGreaterThanOrEqual(Math.min(minPreview, viewport - TOP - PHONE_SHEET_LAYOUT.transportPx - PHONE_SHEET_LAYOUT.minSheetPx));
    expect(caps.peek).toBeLessThanOrEqual(caps.tool);
    expect(caps.tool).toBeLessThanOrEqual(caps.full);
    expect(caps.full).toBeLessThanOrEqual(viewport * 0.56);
  });

  it('keeps 40 % for tool sheets on a tall phone', () => {
    const caps = phoneSheetCaps(915, TOP);
    expect(915 - TOP - 48 - caps.tool).toBeGreaterThanOrEqual(915 * 0.4 - 1);
  });

  it('collapses detents of equal height and fills fixed-height sheets', () => {
    const caps = { peek: 176, tool: 400, full: 500 };
    expect(phoneSheetStops('tool', caps, 300).map((stop) => stop.detent)).toEqual(['peek', 'fit']);
    expect(phoneSheetStops('tool', caps, 900).map((stop) => [stop.detent, stop.height])).toEqual([['peek', 176], ['fit', 400], ['full', 500]]);
    expect(phoneSheetStops('list', caps, 900).map((stop) => stop.detent)).toEqual(['peek', 'fit']);
    expect(phoneSheetStops('fill', caps, 10).map((stop) => stop.height)).toEqual([176, 500]);
    expect(phoneSheetStops('tool', caps, 120).map((stop) => stop.detent)).toEqual(['peek']);
  });

  it('toggles, steps and settles between stops', () => {
    const stops = phoneSheetStops('tool', { peek: 176, tool: 400, full: 500 }, 900);
    expect(phoneSheetToggle('fit', stops)).toBe('full');
    expect(phoneSheetToggle('full', stops)).toBe('fit');
    expect(phoneSheetToggle('peek', stops)).toBe('full');
    expect(phoneSheetStep('fit', stops, -1)).toBe('peek');
    expect(phoneSheetStep('peek', stops, -1)).toBe('peek');
    expect(phoneSheetStep('fit', stops, 1)).toBe('full');
    expect(phoneSheetSettle({ current: 'fit', stops, startHeight: 400, endHeight: 470, velocity: 0 })).toBe('full');
    expect(phoneSheetSettle({ current: 'fit', stops, startHeight: 400, endHeight: 380, velocity: 0.9 })).toBe('peek');
    expect(phoneSheetSettle({ current: 'peek', stops, startHeight: 176, endHeight: 150, velocity: 0.9 })).toBe('close');
    expect(phoneSheetSettle({ current: 'peek', stops, startHeight: 176, endHeight: 60, velocity: 0 })).toBe('close');
    expect(phoneSheetSettle({ current: 'peek', stops, startHeight: 176, endHeight: 150, velocity: 0 })).toBe('peek');
    expect(phoneSheetSettle({ current: 'peek', stops, startHeight: 176, endHeight: 260, velocity: -0.8 })).toBe('fit');
  });

  it('remembers the detent per sheet id and maps legacy heights', () => {
    resetRememberedPhoneSheetDetents();
    expect(rememberedPhoneSheetDetent('effects')).toBe('fit');
    rememberPhoneSheetDetent('effects', 'peek');
    expect(rememberedPhoneSheetDetent('effects')).toBe('peek');
    expect(rememberedPhoneSheetDetent('crop')).toBe('fit');
    expect(phoneSheetSizeFor('panel', 'tall')).toBe('fill');
    expect(phoneSheetSizeFor(null, 'tall')).toBe('list');
    expect(phoneSheetSizeFor(null, undefined)).toBe('tool');
  });
});
